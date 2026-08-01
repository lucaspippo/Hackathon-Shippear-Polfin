// ============================================================================
// PolFin — Ángela proactiva: el monitor que vigila la red y actúa solo.
// ----------------------------------------------------------------------------
// Lo agéntico está en la ACCIÓN (percibir → iniciar → ejecutar/pedir OK), no
// en la decisión de crédito, que sigue siendo el pipeline determinístico del
// refactor. Las reglas de detección son UMBRALES determinísticos — ningún
// LLM decide qué es riesgo:
//
//  1) AMPLIACIÓN: score alto + poco límite disponible → Ángela corre el
//     pipeline con origen='proactiva'. El policy engine fuerza el approval
//     gate (mover plata sin pedido del dueño = SIEMPRE su OK): la propuesta
//     queda PENDIENTE_APROBACION, nunca auto-ejecutada.
//  2) RIESGO DE ATRASO: el atraso vivo de un deudor supera su patrón
//     histórico por un margen ("paga X% más lento que su histórico — la
//     desviación es la señal") → recordatorio de cobro al dueño. No mueve
//     plata: se entrega directo.
//  3) VENCIMIENTO: un e-pagaré activo llega a su fecha → notificación de
//     cobro/liquidación lista. No mueve plata: directo. (La liquidación en
//     stablecoin seguiría necesitando OK — ejecutarPagoStablecoin es
//     siempre_aprobacion_humana en el policy engine.)
//
// Dedup: cada situación tiene una `clave` única en la tabla detecciones —
// el mismo hallazgo no se re-dispara en cada ciclo.
// ============================================================================
import { randomUUID } from 'node:crypto';
import { calcularScore } from '../scoring.js';
import { ejecutarTool } from './tools.js';
import { crearAuditor } from './policy.js';
import { evaluarCredito } from './agente.js';

export const REGLAS = {
  ampliacion_score_minimo: 700,        // solo buenos pagadores comprobados
  ampliacion_umbral_disponible: 0.40,  // dispara si ya usa >60% de su límite
  ampliacion_max_por_ciclo: 3,         // Ángela propone de a poco: las 3 mejores
                                       // por score por ciclo; el resto espera al
                                       // próximo (dedup evita repetir las hechas)
  ampliacion_factor: 0.5,              // propuesta = +50% del límite sugerido
  atraso_margen: 1.3,                  // atraso vivo > 1.3× su promedio histórico
  atraso_novedoso_dias: 7,             // nunca se atrasó y lleva más de 7 días
  vencimiento_ventana_dias: Number(process.env.POLFIN_VENC_VENTANA || 7),
};

const $ar = (n) => '$' + Math.round(n).toLocaleString('es-AR');

/** Corre UN ciclo de monitoreo. Determinístico. Devuelve lo detectado. */
export function ciclarMonitoreo(db, { ventanaVencimiento } = {}) {
  const corridaId = randomUUID();
  const auditar = crearAuditor(db, corridaId);
  const ventana = Number(ventanaVencimiento ?? REGLAS.vencimiento_ventana_dias);
  const nuevas = [];

  auditar('inicio', { motivo: `monitoreo proactivo: Ángela recorre la red (ventana vencimientos=${ventana}d)` });

  const yaDetectada = db.prepare('SELECT id FROM detecciones WHERE clave = ?');
  const insertar = db.prepare(`
    INSERT INTO detecciones (corrida_id, tipo, clave, titulo, detalle, datos_json, solicitud_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const registrar = (tipo, clave, titulo, detalle, datos = {}, solicitudId = null) => {
    insertar.run(corridaId, tipo, clave, titulo, detalle, JSON.stringify(datos), solicitudId);
    auditar('decision', { resultado: { titulo, detalle, ...datos }, motivo: `deteccion_${tipo}` });
    nuevas.push({ tipo, clave, titulo, detalle, datos, solicitud_id: solicitudId });
  };

  // ------------------------------------------------ 1 · oportunidad de ampliación
  // Dos pasadas: primero se juntan TODOS los candidatos (regla determinística),
  // después se proponen solo los mejores N del ciclo — Ángela no te inunda de
  // propuestas; las demás quedan para los próximos ciclos (el dedup evita
  // repetir las ya hechas). El recorte queda declarado en el resultado.
  const deudores = db.prepare('SELECT DISTINCT deudor_id AS id FROM transacciones').all();
  const candidatos = [];
  for (const { id } of deudores) {
    const clave = `ampliacion:${id}`;
    if (yaDetectada.get(clave)) continue;

    const s = calcularScore(db, id);
    if (!s?.score || s.score < REGLAS.ampliacion_score_minimo) continue;
    const limite = s.condiciones.limite_sugerido_pesos;
    if (!limite) continue;

    const viva = db.prepare(
      "SELECT COALESCE(SUM(monto), 0) AS v FROM transacciones WHERE deudor_id = ? AND estado = 'pendiente'"
    ).get(id).v;
    const disponible = limite - viva;
    if (disponible > REGLAS.ampliacion_umbral_disponible * limite) continue;

    // no proponer si ya hay una solicitud esperando OK para este deudor
    if (db.prepare(
      "SELECT id FROM solicitudes_credito WHERE deudor_id = ? AND estado = 'pendiente_aprobacion'"
    ).get(id)) continue;

    candidatos.push({ id, clave, s, limite, viva, disponible });
  }
  candidatos.sort((a, b) => b.s.score - a.s.score);
  const propuestos = candidatos.slice(0, REGLAS.ampliacion_max_por_ciclo);

  for (const c of propuestos) {
    const acreedor = db.prepare(`
      SELECT acreedor_id AS a, SUM(monto) AS m FROM transacciones
      WHERE deudor_id = ? GROUP BY acreedor_id ORDER BY m DESC LIMIT 1
    `).get(c.id);
    const monto = Math.round((c.limite * REGLAS.ampliacion_factor) / 1000) * 1000;

    // MISMO pipeline del Prompt A, origen proactivo → gate SIEMPRE.
    const r = evaluarCredito(db, {
      deudorId: c.id, acreedorId: acreedor.a, monto,
      origen: 'proactiva',
      contexto: 'ampliación de crédito propuesta por Ángela (monitoreo proactivo)',
    });
    const usoPct = Math.round((c.viva / c.limite) * 100);
    registrar(
      'ampliacion', c.clave,
      `Ampliación lista para ${c.s.entidad.nombre}`,
      `Score ${c.s.score} y ya usa el ${usoPct}% de su límite (${$ar(c.viva)} de ${$ar(c.limite)}). Dejé preparada una ampliación de ${$ar(monto)} — falta solo tu OK.`,
      { monto, score: c.s.score, disponible: c.disponible, limite: c.limite, uso_pct: usoPct, estado_solicitud: r.estado },
      r.solicitud_id,
    );
  }
  const ampliacionesEnEspera = candidatos.length - propuestos.length;
  if (ampliacionesEnEspera > 0) {
    auditar('decision', {
      resultado: { titulo: `${ampliacionesEnEspera} candidato(s) más a ampliación quedan para próximos ciclos` },
      motivo: 'deteccion_resumen',
    });
  }

  // ------------------------------------------------ 2 · riesgo de atraso (desviación)
  const atrasados = db.prepare(`
    SELECT t.deudor_id AS id, e.nombre,
           MAX(julianday('now') - julianday(t.fecha_vencimiento)) AS atraso_actual,
           COUNT(*) AS vencidas, SUM(t.monto) AS monto
    FROM transacciones t JOIN entidades e ON e.id = t.deudor_id
    WHERE t.estado = 'vencida'
    GROUP BY t.deudor_id
  `).all();
  for (const a of atrasados) {
    const clave = `atraso:${a.id}`;
    if (yaDetectada.get(clave)) continue;

    const hist = db.prepare(`
      SELECT AVG(julianday(fecha_pago_real) - julianday(fecha_vencimiento)) AS h
      FROM transacciones
      WHERE deudor_id = ? AND estado = 'pagada' AND fecha_pago_real > fecha_vencimiento
    `).get(a.id).h ?? 0;

    const actual = Math.round(a.atraso_actual);
    const senal = hist > 0
      ? a.atraso_actual > hist * REGLAS.atraso_margen
      : a.atraso_actual > REGLAS.atraso_novedoso_dias;
    if (!senal) continue;

    const detalle = hist > 0
      ? `${a.nombre} paga ${Math.round((a.atraso_actual / hist - 1) * 100)}% más lento que su histórico (${actual} días vs ${hist.toFixed(0)} de promedio) — la desviación es la señal. Recordatorio de cobro listo por ${$ar(a.monto)} en ${a.vencidas} operación(es).`
      : `${a.nombre} nunca se atrasaba y ya lleva ${actual} días vencido — la desviación es la señal. Recordatorio de cobro listo por ${$ar(a.monto)}.`;

    // no mueve plata → Ángela lo entrega directo (allowlist libre)
    ejecutarTool(db, 'notificarDueno', { mensaje: `COBRO ANTES DE QUE ESCALE: ${detalle}`, tipo: 'info' });
    auditar('tool_call', { tool: 'notificarDueno', params: { deudor: a.nombre }, resultado: { entregada: true } });
    registrar('riesgo_atraso', clave, `${a.nombre} se está atrasando más que su patrón`, detalle,
      { atraso_actual: actual, historico: +hist.toFixed(1), monto: a.monto, deudor_id: a.id });
  }

  // ------------------------------------------------ 3 · vencimientos de instrumentos
  const porVencer = db.prepare(`
    SELECT i.*, d.nombre AS deudor_nombre, a.nombre AS acreedor_nombre,
           julianday(i.fecha_vencimiento) - julianday('now') AS dias
    FROM instrumentos i
    JOIN entidades d ON d.id = i.deudor_id
    JOIN entidades a ON a.id = i.acreedor_id
    WHERE i.estado = 'activo' AND julianday(i.fecha_vencimiento) - julianday('now') <= ?
  `).all(ventana);
  for (const i of porVencer) {
    const clave = `vencimiento:${i.id}`;
    if (yaDetectada.get(clave)) continue;
    const dias = Math.ceil(i.dias);
    const cuando = dias < 0 ? `venció hace ${-dias} días` : dias === 0 ? 'vence HOY' : `vence en ${dias} días`;
    const detalle = `El e-pagaré #${i.id} de ${i.deudor_nombre} por ${$ar(i.monto)} ${cuando} (${i.fecha_vencimiento}). Dejé lista la notificación de cobro para ${i.acreedor_nombre}; la liquidación se dispara con tu OK.`;

    ejecutarTool(db, 'notificarDueno', { mensaje: `VENCIMIENTO: ${detalle}`, tipo: 'info' });
    auditar('tool_call', { tool: 'notificarDueno', params: { instrumento: i.id }, resultado: { entregada: true } });
    registrar('vencimiento', clave, `e-Pagaré de ${i.deudor_nombre} ${cuando}`, detalle,
      { instrumento_id: i.id, monto: i.monto, fecha_vencimiento: i.fecha_vencimiento, dias });
  }

  auditar('decision', {
    resultado: { detecciones_nuevas: nuevas.length, tipos: nuevas.map((n) => n.tipo) },
    motivo: 'deteccion_resumen',
  });

  return {
    corrida_id: corridaId,
    detecciones_nuevas: nuevas,
    total_nuevas: nuevas.length,
    ampliaciones_en_espera: ampliacionesEnEspera, // recorte declarado, no silencioso
  };
}

/** Arranca el loop de fondo. Intervalo en segundos (POLFIN_MONITOR_INTERVAL). */
export function arrancarMonitor(db) {
  const seg = Number(process.env.POLFIN_MONITOR_INTERVAL || 300);
  if (!seg || seg <= 0) return null;
  const timer = setInterval(() => {
    try {
      const r = ciclarMonitoreo(db);
      if (r.total_nuevas > 0) console.log(`[monitor] Ángela detectó ${r.total_nuevas} situación(es) nueva(s)`);
    } catch (e) {
      console.error('[monitor] error en el ciclo:', e.message);
    }
  }, seg * 1000);
  timer.unref?.(); // no impide que el proceso termine
  return seg;
}
