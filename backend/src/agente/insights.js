// ============================================================================
// PolFin — Insights proactivos de Ángela (lo que la hace AI-native, no chatbot).
// ----------------------------------------------------------------------------
// Ángela LEE la red del vendedor y genera tarjetas de early-warning de crédito
// comercial, priorizadas, SIN que nadie pregunte. Cada tarjeta trae la señal en
// números reales, la explicación de por qué la muestra, y la acción sugerida.
//
// Basado en prácticas de early-warning de crédito comercial. La más potente es
// el CAMBIO DE COMPORTAMIENTO: no el nivel absoluto sino la DESVIACIÓN respecto
// del propio patrón del cliente — un humano perdona un atraso reciente, el
// modelo no. La detección y la priorización son deterministas y auditables (la
// distinción IA-detecta / motor-decide es a propósito); Ángela las surfacea.
// ============================================================================
import { calcularScore } from '../scoring.js';

const $ar = (n) => '$' + Math.round(n || 0).toLocaleString('es-AR');

function saldoVivo(db, tx) {
  if (tx.estado === 'pagada') return 0;
  const pagado = db.prepare('SELECT COALESCE(SUM(monto),0) AS s FROM pagos WHERE transaccion_id = ?').get(tx.id).s;
  return Math.max(0, tx.monto - pagado);
}

// Días de atraso histórico promedio del deudor (cuando pagó tarde).
function atrasoHistorico(db, deudorId) {
  const r = db.prepare(`
    SELECT AVG(julianday(fecha_pago_real) - julianday(fecha_vencimiento)) AS h
    FROM transacciones
    WHERE deudor_id = ? AND estado = 'pagada' AND fecha_pago_real > fecha_vencimiento
  `).get(deudorId);
  return r?.h ?? 0;
}

/**
 * Genera los insights para un vendedor (acreedor) `entidadId`.
 * @returns {Array<{tipo,severidad,titulo,senal,explicacion,accion,datos,fuente}>}
 */
export function generarInsights(db, entidadId) {
  const yo = db.prepare('SELECT * FROM entidades WHERE id = ?').get(entidadId);
  if (!yo) return [];

  // Cartera viva: lo que me deben (soy acreedor), agrupado por deudor.
  const vivas = db.prepare("SELECT * FROM transacciones WHERE acreedor_id = ? AND estado != 'pagada'").all(entidadId);
  const todasMis = db.prepare('SELECT * FROM transacciones WHERE acreedor_id = ?').all(entidadId);
  const deudorIds = [...new Set(todasMis.map((t) => t.deudor_id))];

  const porDeudor = new Map();
  let totalPorCobrar = 0;
  for (const t of vivas) {
    const saldo = saldoVivo(db, t);
    totalPorCobrar += saldo;
    const d = porDeudor.get(t.deudor_id) || { saldo: 0, vencido: 0, vencidas: 0, txVivas: [] };
    d.saldo += saldo;
    if (t.estado === 'vencida') { d.vencido += saldo; d.vencidas++; }
    d.txVivas.push(t);
    porDeudor.set(t.deudor_id, d);
  }

  // Score de cada deudor (una vez).
  const scoreDe = new Map();
  const nombreDe = new Map();
  for (const id of deudorIds) {
    const s = calcularScore(db, id);
    if (s) { scoreDe.set(id, s); nombreDe.set(id, s.entidad.nombre); }
  }

  const insights = [];
  const empeorando = (s) => /empeorando/.test(s?.desglose?.find((d) => d.factor === 'tendencia')?.detalle || '');

  // ---------------------------------------------------------------- 1) CAMBIO DE COMPORTAMIENTO
  // La estrella: un cliente históricamente bueno que se DESVÍA de su patrón.
  for (const id of deudorIds) {
    const s = scoreDe.get(id);
    if (!s) continue;
    const m = s.metricas;
    const histPuntual = m.pct_puntual ?? null;
    const cartera = porDeudor.get(id);
    const tieneVencidoConmigo = (cartera?.vencido || 0) > 0;
    const liveAtraso = cartera ? Math.max(0, ...cartera.txVivas.map((t) =>
      t.estado === 'vencida' ? Math.round((Date.now() - new Date(t.fecha_vencimiento + 'T00:00:00Z').getTime()) / 86400000) : 0)) : 0;
    const histAtraso = atrasoHistorico(db, id);

    const eraBueno = histPuntual != null && histPuntual >= 65;
    const seDesvia =
      (eraBueno && tieneVencidoConmigo) ||
      (empeorando(s) && (histPuntual == null || histPuntual >= 55)) ||
      (histAtraso > 0 && liveAtraso > histAtraso * 1.3 && liveAtraso >= 5);
    if (!seDesvia) continue;

    const motivos = [];
    if (eraBueno && tieneVencidoConmigo) motivos.push(`pagaba en fecha el ${histPuntual}% de las veces y hoy tiene ${$ar(cartera.vencido)} vencido con vos`);
    if (empeorando(s)) motivos.push('su calidad de pago reciente viene cayendo respecto de su propio historial');
    if (histAtraso > 0 && liveAtraso > histAtraso * 1.3 && liveAtraso >= 5) motivos.push(`se está atrasando ${liveAtraso} días (su promedio histórico es ${histAtraso.toFixed(0)})`);

    insights.push({
      tipo: 'cambio_comportamiento',
      severidad: 100 + (cartera?.vencido || 0) / 1000 + (eraBueno ? 40 : 0),
      titulo: `${nombreDe.get(id)} cambió su forma de pagar`,
      senal: `Score ${s.score} · histórico ${histPuntual ?? '—'}% puntual` + (cartera?.vencido ? ` · ${$ar(cartera.vencido)} vencido con vos` : ''),
      explicacion: `Te lo muestro porque ${motivos.join('; ')}. No es su nivel de siempre: es un CAMBIO respecto de su propio patrón, y esa desviación es la señal temprana que conviene atender antes de que escale.`,
      accion: 'Contactar para regularizar antes de ampliar; revisar su historial completo.',
      datos: { deudorId: id, vencido: cartera?.vencido || 0, score: s.score },
      fuente: 'angela',
    });
  }

  // ---------------------------------------------------------------- 2) CONCENTRACIÓN / EXPOSICIÓN
  if (totalPorCobrar > 0 && porDeudor.size > 0) {
    const top = [...porDeudor.entries()].map(([id, v]) => ({ id, ...v, score: scoreDe.get(id)?.score ?? null }))
      .sort((a, b) => b.saldo - a.saldo)[0];
    const pct = Math.round((top.saldo / totalPorCobrar) * 100);
    const topDeteriora = (top.score != null && top.score < 500) || empeorando(scoreDe.get(top.id));
    if (pct >= 35 || (pct >= 25 && topDeteriora)) {
      insights.push({
        tipo: 'concentracion',
        severidad: 70 + pct / 2 + (topDeteriora ? 25 : 0),
        titulo: `Tu crédito está concentrado en ${nombreDe.get(top.id)}`,
        senal: `${pct}% de tu cartera por cobrar (${$ar(top.saldo)} de ${$ar(totalPorCobrar)}) está en un solo cliente` + (top.score != null ? ` · score ${top.score}` : ''),
        explicacion: `Te lo muestro porque una parte grande de lo que te deben depende de una sola persona${topDeteriora ? ', y encima su perfil se está deteriorando' : ''}. Si ese cliente falla, te pega fuerte: conviene diversificar o no ampliarle más.`,
        accion: topDeteriora ? 'No ampliar a ese cliente; priorizar su cobro y repartir el riesgo.' : 'Vigilar la exposición; evitar concentrar más en ese cliente.',
        datos: { deudorId: top.id, saldo: top.saldo, pct },
        fuente: 'angela',
      });
    }
  }

  // ---------------------------------------------------------------- 3) OPORTUNIDAD DE CRÉDITO
  for (const id of deudorIds) {
    const s = scoreDe.get(id);
    if (!s?.score || s.score < 700) continue;
    const limite = s.condiciones.limite_sugerido_pesos;
    if (!limite) continue;
    const cartera = porDeudor.get(id);
    if ((cartera?.vencido || 0) > 0) continue; // si te debe vencido, no es oportunidad
    const usado = cartera?.saldo || 0;
    const usoPct = Math.round((usado / limite) * 100);
    if (usoPct < 60) continue;
    insights.push({
      tipo: 'oportunidad',
      severidad: 50 + s.score / 100,
      titulo: `${nombreDe.get(id)} está listo para más crédito`,
      senal: `Score ${s.score} (${s.metricas.pct_puntual}% puntual) · usa el ${usoPct}% de su límite de ${$ar(limite)}`,
      explicacion: `Te lo muestro porque es un pagador confiable, verificado en la red, y ya está cerca de su tope. Ampliarle es crecer con poco riesgo — y si no, capaz compra a plazo en otro lado.`,
      accion: `Ofrecer ampliación de crédito (dentro del límite sugerido de ${$ar(limite)}).`,
      datos: { deudorId: id, limite, uso_pct: usoPct, score: s.score },
      fuente: 'angela',
    });
  }

  // ---------------------------------------------------------------- 4) ANOMALÍA DE PATRÓN
  for (const id of deudorIds) {
    const s = scoreDe.get(id);
    if (!s) continue;
    const mediana = s.metricas.mediana_monto_12m;
    if (!mediana) continue;
    const recientes = todasMis.filter((t) => t.deudor_id === id)
      .sort((a, b) => b.fecha_emision.localeCompare(a.fecha_emision)).slice(0, 3);
    const pico = recientes.find((t) => t.monto >= mediana * 2.5);
    if (!pico) continue;
    insights.push({
      tipo: 'anomalia',
      severidad: 45 + (pico.monto / Math.max(1, mediana)),
      titulo: `Pedido inusual de ${nombreDe.get(id)}`,
      senal: `Última operación ${$ar(pico.monto)} vs mediana histórica ${$ar(mediana)} (${(pico.monto / mediana).toFixed(1)}× su compra típica)`,
      explicacion: `Te lo muestro porque el monto se sale de lo que este cliente suele comprarte. Un pico repentino puede ser buena noticia (crece) o una señal temprana de estrés — vale la pena confirmar antes de fiar sin mirar.`,
      accion: 'Confirmar el pedido y su capacidad de pago antes de aprobar el monto completo.',
      datos: { deudorId: id, monto: pico.monto, mediana },
      fuente: 'angela',
    });
  }

  // ---------------------------------------------------------------- 5) COBROS / VENCIMIENTOS
  const vencidoTotal = [...porDeudor.values()].reduce((s, d) => s + d.vencido, 0);
  const proximos = db.prepare(`
    SELECT i.*, d.nombre AS deudor_nombre, julianday(i.fecha_vencimiento) - julianday('now') AS dias
    FROM instrumentos i JOIN entidades d ON d.id = i.deudor_id
    WHERE i.acreedor_id = ? AND i.estado = 'activo' AND julianday(i.fecha_vencimiento) - julianday('now') BETWEEN 0 AND 10
    ORDER BY i.fecha_vencimiento ASC
  `).all(entidadId);
  if (vencidoTotal > 0 || proximos.length) {
    const nVenc = [...porDeudor.values()].reduce((s, d) => s + d.vencidas, 0);
    const partes = [];
    if (vencidoTotal > 0) partes.push(`${$ar(vencidoTotal)} ya vencido en ${nVenc} operación(es)`);
    if (proximos.length) partes.push(`${proximos.length} e-pagaré(s) por vencer en ≤10 días (${$ar(proximos.reduce((s, p) => s + p.monto, 0))})`);
    insights.push({
      tipo: 'cobros',
      severidad: 60 + vencidoTotal / 1000,
      titulo: vencidoTotal > 0 ? 'Cobros atrasados y por vencer' : 'Vencimientos cerca',
      senal: partes.join(' · '),
      explicacion: `Te lo priorizo por plata y por riesgo: con la inflación, cada día de atraso vale menos. Lo vencido primero, después lo que está por caer.`,
      accion: 'Enviar recordatorios de cobro priorizados; gestionar lo vencido antes de que escale.',
      datos: { vencido: vencidoTotal, por_vencer: proximos.length },
      fuente: 'angela',
    });
  }

  // Dedup por deudor entre tipos "duros" (cambio_comportamiento gana) y priorizar.
  insights.sort((a, b) => b.severidad - a.severidad);
  return insights.slice(0, 6);
}
