// ============================================================================
// PolFin — El agente: DOS formas de invocar el MISMO pipeline determinístico.
// ----------------------------------------------------------------------------
// 1) Invocación DIRECTA (sin LLM): evaluarCredito({deudorId, acreedorId, monto})
//    corre pipelineCredito.js tal cual. Es lo que usa la UI. Ningún LLM toca
//    este camino.
// 2) Invocación CONVERSACIONAL (con LLM): conversar({texto}) — el LLM
//    interpreta la frase y extrae los parámetros (ENTRADA) y verbaliza el
//    resultado (SALIDA). En el medio corre EXACTAMENTE el mismo pipeline.
//
// GARANTÍA (revisada en el refactor): el LLM no produce NINGÚN número de
// decisión. Score, tasa, plazo y límite salen siempre de las tools
// determinísticas (scoring.js / tools.js) vía el pipeline; la verbalización
// —determinística acá, o del LLM en el borde de salida— solo repite esos
// valores ya calculados. Ver también pipelineCredito.js y llm/*.js.
// ============================================================================
import { randomUUID } from 'node:crypto';
import { correrPipeline, reanudarPipeline } from './pipelineCredito.js';
import { crearAuditor, POLICY } from './policy.js';
import { elegirProvider } from './llm/index.js';

const $ar = (n) => '$' + Number(n).toLocaleString('es-AR');

// ---------------------------------------------------------------------------
// 1) INVOCACIÓN DIRECTA — cero LLM. La máquina de estados y nada más.
// ---------------------------------------------------------------------------
export function evaluarCredito(db, { deudorId, acreedorId, monto, contexto = '', origen = 'directa' }) {
  const deudor = db.prepare('SELECT * FROM entidades WHERE id = ?').get(deudorId);
  const acreedor = db.prepare('SELECT * FROM entidades WHERE id = ?').get(acreedorId);
  if (!deudor || !acreedor) throw new Error('deudor o acreedor inexistente');
  if (!Number.isFinite(monto) || monto <= 0) throw new Error('monto inválido');

  const corridaId = randomUUID();
  const solicitud = db.prepare(`
    INSERT INTO solicitudes_credito (corrida_id, deudor_id, acreedor_id, monto, estado, origen)
    VALUES (?, ?, ?, ?, 'en_evaluacion', ?)
  `).run(corridaId, deudorId, acreedorId, monto, origen);
  const solicitudId = Number(solicitud.lastInsertRowid);

  crearAuditor(db, corridaId)('inicio', {
    params: { deudorId, deudor: deudor.nombre, acreedorId, acreedor: acreedor.nombre, monto, contexto },
    motivo: `motor=pipeline-deterministico · origen=${origen} · límite autónomo=${$ar(POLICY.limite_autonomo_pesos)}`,
  });

  const r = correrPipeline(db, { deudorId, acreedorId, monto, solicitudId, corridaId, origen });

  // Verbalización DETERMINÍSTICA: un template que solo repite los números
  // que ya calculó el pipeline. Sin LLM, sin invención posible.
  const razonamiento = verbalizarResultado(r, { deudor: deudor.nombre, acreedor: acreedor.nombre, monto });
  db.prepare('UPDATE solicitudes_credito SET razonamiento = ? WHERE id = ?').run(razonamiento, solicitudId);

  return armarRespuesta(r, {
    corridaId, solicitudId, deudor, acreedor, monto, razonamiento,
    motor: 'pipeline-deterministico (sin LLM)',
  });
}

// El gate asíncrono se cierra acá: el humano responde y el pipeline retoma.
export function aprobarSolicitud(db, solicitudId) {
  const r = reanudarPipeline(db, solicitudId, 'aprobar');
  return {
    solicitud_id: solicitudId, estado: r.estado_solicitud,
    estados: r.estados, instrumento: r.datos.instrumento, score_onchain: r.datos.onchain,
  };
}

export function rechazarSolicitud(db, solicitudId) {
  const r = reanudarPipeline(db, solicitudId, 'rechazar');
  return { solicitud_id: solicitudId, estado: r.estado_solicitud, estados: r.estados };
}

// ---------------------------------------------------------------------------
// 2) INVOCACIÓN CONVERSACIONAL — el LLM SOLO en los bordes.
//    entrada: texto → {deudorId, acreedorId, monto}   (interpretar)
//    medio:   el MISMO pipeline determinístico de arriba
//    salida:  resultado → texto                        (verbalizar)
// ---------------------------------------------------------------------------
export async function conversar(db, { texto }) {
  if (!texto?.trim()) throw new Error('falta el texto del pedido');
  const provider = elegirProvider();
  const entidades = db.prepare('SELECT id, nombre, tipo, rol_cadena FROM entidades').all();

  // ENTRADA: el LLM (o el matcher determinístico en mock) interpreta la frase.
  const pedido = await provider.extraerPedido({ texto, entidades });
  if (!pedido?.deudorId || !pedido?.acreedorId || !pedido?.monto) {
    return {
      entendido: false, provider: provider.nombre,
      respuesta: 'No pude identificar deudor, acreedor y monto en el pedido. Probá: "¿Le fío $180.000 a Marcela Benítez en el Corralón Ovidio Lagos?"',
    };
  }

  // MEDIO: exactamente el mismo pipeline determinístico (sin LLM).
  const resultado = evaluarCredito(db, {
    deudorId: pedido.deudorId, acreedorId: pedido.acreedorId, monto: pedido.monto,
    contexto: `pedido conversacional: "${texto}"`,
    origen: 'conversacional',
  });

  // SALIDA: el LLM verbaliza el resultado YA calculado (con instrucción
  // explícita de no inventar números); en mock, repite la verbalización
  // determinística del pipeline.
  const respuesta = await provider.verbalizar({ resultado });

  return { entendido: true, provider: provider.nombre, interpretacion: pedido, resultado, respuesta };
}

// ---------------------------------------------------------------------------
// verbalización determinística (el "relato" que ve la UI)
// ---------------------------------------------------------------------------
function verbalizarResultado(r, { deudor, acreedor, monto }) {
  const p = [];
  const s = r.datos.scoring;
  const h = r.datos.historial;
  const m = r.datos.macro;
  const d = r.datos.condiciones;

  p.push(`Llega un pedido de crédito: ${deudor} pide ${$ar(monto)} fiado en ${acreedor}. Primero levanto su historial en toda la red.`);
  if (h && !h.error) {
    p.push(`${h.entidad.nombre} tiene ${h.operaciones} operaciones en ${h.comercios_donde_opera.length} comercio(s) de la red (${h.vencidas_impagas} vencidas impagas). Corro el motor de scoring sobre ese historial.`);
  }
  if (s && !s.error) {
    p.push(`Score ${s.score} (${s.metricas.pct_puntual ?? '—'}% puntual, buen comportamiento en ${s.metricas.comercios_con_buen_comportamiento} comercios). Consulto el contexto macro para fijar la base de la tasa.`);
  }
  if (m && !m.error) {
    p.push(`Base macro: tasa de referencia ${m.tasa_referencia_tna}% TNA, inflación ${m.inflacion_mensual_pct}% mensual. Cruzo score + macro + monto pedido para decidir condiciones.`);
  }

  if (r.estado === 'RECHAZADO') {
    const motivo = d.rechazar
      ? `score ${d.score} en zona de riesgo muy alto`
      : `el monto pedido supera el límite sugerido de ${$ar(d.condiciones.limite_sugerido_pesos)}`;
    p.push(`No corresponde aprobar tal como está: ${motivo}. Aviso al dueño con la recomendación del motor.`);
    p.push(`DECISIÓN: NO APROBAR el crédito de ${$ar(monto)} para ${s.entidad.nombre}. Motivo del motor: ${d.recomendacion}. Fundamento del scoring (${d.score}): ${s.explicacion} El dueño ya fue notificado con la recomendación.`);
    return p.join('\n\n');
  }

  p.push(`Condiciones aprobadas por el motor: ${d.recomendacion}. Genero el e-pagaré (pasa por el policy engine).`);

  if (r.estado === 'PENDIENTE_APROBACION') {
    p.push(`El policy engine bloqueó la ejecución: ${r.pendiente_por}. Pido la aprobación del dueño.`);
    p.push(`DECISIÓN: APROBADO POR EL MOTOR, PENDIENTE DE APROBACIÓN DEL DUEÑO. ${s.entidad.nombre} califica (score ${d.score}, riesgo ${d.condiciones.riesgo}): ${s.explicacion} Condiciones sugeridas: ${$ar(monto)} a tasa ${d.condiciones.tasa_sugerida_tna}% TNA (base ${d.condiciones.tasa_base_tna}% + ${d.condiciones.recargo_pp}pp de riesgo), plazo máximo ${d.condiciones.plazo_max_dias} días. El policy engine no deja ejecutar solo (${r.pendiente_por}); el dueño ya tiene la notificación para aprobar con un clic.`);
    return p.join('\n\n');
  }

  const g = r.datos.instrumento;
  const oc = r.datos.onchain;
  p.push(`e-Pagaré generado (contrato ${g.contrato_address.slice(0, 10)}…). Actualizo la reputación on-chain para que el buen comportamiento le siga sumando.`);
  p.push(`DECISIÓN: CRÉDITO APROBADO Y EJECUTADO. ${s.entidad.nombre} pidió ${$ar(monto)} y su reputación portable lo respalda: score ${d.score} (riesgo ${d.condiciones.riesgo}). ${s.explicacion} Condiciones: tasa ${d.condiciones.tasa_sugerida_tna}% TNA (base macro ${d.condiciones.tasa_base_tna}% + ${d.condiciones.recargo_pp}pp), plazo ${d.condiciones.plazo_max_dias} días, vence el ${g.fecha_vencimiento}. e-Pagaré ${g.contrato_address} (tx ${g.tx_hash.slice(0, 18)}…) y reputación actualizada on-chain (tx ${oc.tx_hash.slice(0, 18)}…). Esto hoy no pasaría sin PolFin: el historial de toda la red lo avala.`);
  return p.join('\n\n');
}

// La respuesta de la API mantiene la forma de siempre (la UI no cambia) y
// suma la trayectoria de estados de la máquina.
function armarRespuesta(r, { corridaId, solicitudId, deudor, acreedor, monto, razonamiento, motor }) {
  return {
    corrida_id: corridaId,
    solicitud_id: solicitudId,
    provider: motor,
    estado: r.estado_solicitud,
    estados: r.estados,
    deudor: { id: deudor.id, nombre: deudor.nombre },
    acreedor: { id: acreedor.id, nombre: acreedor.nombre },
    monto,
    score: r.datos.condiciones?.score ?? null,
    condiciones: r.datos.condiciones?.condiciones ?? null,
    instrumento: r.datos.instrumento ?? null,
    score_onchain: r.datos.onchain ?? null,
    pendiente_por: r.pendiente_por,
    razonamiento,
  };
}
