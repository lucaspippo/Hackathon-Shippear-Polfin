// ============================================================================
// PolFin — Pipeline de crédito: MÁQUINA DE ESTADOS DETERMINÍSTICA
// ----------------------------------------------------------------------------
// PRINCIPIO DE ARQUITECTURA: el motor de decisión de crédito es código
// determinístico de punta a punta. NINGÚN LLM decide ni orquesta este flujo.
// El orden de pasos es fijo y conocido; cada número de decisión (score,
// tasa, plazo, límite) sale de las tools determinísticas (scoring.js +
// tools.js). El LLM vive SOLO en los bordes conversacionales (agente.js):
// interpreta lenguaje natural a la entrada y verbaliza resultados a la
// salida — jamás en el medio.
//
// Estados:
//   RECIBIDO → SCORING → CONDICIONES → POLICY_CHECK
//        → (motor rechaza) ................ RECHAZADO
//        → (policy bloquea por monto) ..... PENDIENTE_APROBACION  ⏸ gate asíncrono
//        → (dentro del límite) ............ EJECUTANDO → COMPLETADO
//
// El approval gate es ASÍNCRONO por diseño: PENDIENTE_APROBACION es un
// estado persistido en la DB, no una espera bloqueante. El pipeline se
// detiene ahí (puede quedar segundos u horas) y `reanudarPipeline()` retoma
// desde ese estado cuando el humano responde.
// ============================================================================
import { ejecutarTool } from './tools.js';
import { evaluarPolicy, crearAuditor } from './policy.js';

export const ESTADOS = [
  'RECIBIDO', 'SCORING', 'CONDICIONES', 'POLICY_CHECK',
  'PENDIENTE_APROBACION', 'EJECUTANDO', 'COMPLETADO', 'RECHAZADO',
];

// estado de la máquina → estado persistible de la solicitud (columna con CHECK)
const ESTADO_SOLICITUD = {
  PENDIENTE_APROBACION: 'pendiente_aprobacion',
  COMPLETADO: 'aprobada',
  RECHAZADO: 'rechazada',
};

// Ejecuta una tool determinística dejando el mismo rastro de auditoría de
// siempre: decisión de policy + llamada con parámetros y resultado.
async function paso(db, auditar, nombre, input, ctx) {
  const pol = evaluarPolicy(nombre, input);
  auditar('policy', { tool: nombre, params: input, permitido: pol.permitido, motivo: pol.motivo });
  if (!pol.permitido) {
    const bloqueo = { bloqueado: true, motivo: pol.motivo, requiere_aprobacion: pol.requiere_aprobacion };
    auditar('tool_call', { tool: nombre, params: input, resultado: bloqueo });
    return bloqueo;
  }
  const resultado = await ejecutarTool(db, nombre, input, ctx);
  auditar('tool_call', { tool: nombre, params: input, resultado });
  return resultado;
}

/**
 * Corre el pipeline completo para una solicitud ya creada.
 * Determinístico: mismos datos → mismos estados → misma decisión.
 * @returns {{ estado, estados, datos, pendiente_por }}
 */
export async function correrPipeline(db, { deudorId, acreedorId, monto, solicitudId, corridaId, origen = 'directa', plazoPreferido = null }) {
  const auditar = crearAuditor(db, corridaId);
  const ctx = { solicitudId };
  const estados = [];
  const datos = {};
  const marcar = (estado, detalle) => estados.push({ estado, detalle });

  // ---- RECIBIDO --------------------------------------------------------
  marcar('RECIBIDO', `pedido de $${monto.toLocaleString('es-AR')} (deudor ${deudorId} → acreedor ${acreedorId})`);

  // ---- SCORING ---------------------------------------------------------
  datos.historial = await paso(db, auditar, 'getHistorialCliente', { entidadId: deudorId }, ctx);
  datos.scoring = await paso(db, auditar, 'calcularScoring', { entidadId: deudorId }, ctx);
  marcar('SCORING', `score ${datos.scoring.score} sobre ${datos.historial.operaciones} operaciones verificables`);

  // ---- CONDICIONES -----------------------------------------------------
  datos.macro = await paso(db, auditar, 'consultarMacro', {}, ctx);
  datos.condiciones = await paso(db, auditar, 'decidirCondiciones', { entidadId: deudorId, montoSolicitado: monto }, ctx);
  marcar('CONDICIONES', datos.condiciones.recomendacion);

  // ¿El motor rechaza? (score en zona roja o monto fuera del límite sugerido)
  if (datos.condiciones.rechazar || !datos.condiciones.dentro_del_limite) {
    await paso(db, auditar, 'notificarDueno', {
      mensaje: `Pedido de ${datos.scoring.entidad.nombre} por $${monto.toLocaleString('es-AR')}: NO recomendado. ${datos.condiciones.recomendacion}`,
      tipo: 'info',
    }, ctx);
    marcar('RECHAZADO', datos.condiciones.recomendacion);
    return cerrar(db, auditar, solicitudId, 'RECHAZADO', estados, datos, null);
  }

  // ---- POLICY_CHECK ----------------------------------------------------
  // El plazo del instrumento = el macro-aware por riesgo, topeado por lo que el
  // vendedor pidió (si pidió menos). Ángela nunca lo estira más allá del máximo.
  const plazoMax = datos.condiciones.condiciones.plazo_max_dias;
  const plazoInstrumento = plazoPreferido ? Math.min(plazoPreferido, plazoMax) : plazoMax;
  const inputInstrumento = {
    deudorId, acreedorId, monto,
    tasaTna: datos.condiciones.condiciones.tasa_sugerida_tna,
    plazoDias: plazoInstrumento,
  };
  // origen 'proactiva' (Ángela sola) → el policy engine exige OK del dueño siempre
  const pol = evaluarPolicy('generarInstrumento', inputInstrumento, { proactiva: origen === 'proactiva' });
  auditar('policy', { tool: 'generarInstrumento', params: inputInstrumento, permitido: pol.permitido, motivo: pol.motivo });
  marcar('POLICY_CHECK', pol.motivo);

  if (!pol.permitido && pol.requiere_aprobacion) {
    // ---- ⏸ APPROVAL GATE ASÍNCRONO ------------------------------------
    // Estado persistido, NO espera bloqueante: acá el pipeline se detiene
    // y reanudarPipeline() retoma cuando el dueño responda.
    await ejecutarTool(db, 'notificarDueno', {
      mensaje: `APROBACIÓN REQUERIDA: crédito de $${monto.toLocaleString('es-AR')} para ${datos.scoring.entidad.nombre} (score ${datos.condiciones.score}, ${datos.condiciones.condiciones.riesgo}). Condiciones sugeridas: tasa ${datos.condiciones.condiciones.tasa_sugerida_tna}% TNA, hasta ${datos.condiciones.condiciones.plazo_max_dias} días. Supera el límite autónomo del agente: falta tu OK.`,
      tipo: 'aprobacion_requerida',
    }, ctx);
    marcar('PENDIENTE_APROBACION', pol.motivo);
    return cerrar(db, auditar, solicitudId, 'PENDIENTE_APROBACION', estados, datos, pol.motivo);
  }

  // ---- EJECUTANDO → COMPLETADO ----------------------------------------
  marcar('EJECUTANDO', 'dentro del límite autónomo: emito instrumento y actualizo reputación');
  datos.instrumento = await paso(db, auditar, 'generarInstrumento', inputInstrumento, ctx);
  datos.onchain = await paso(db, auditar, 'registrarScoreOnChain', { entidadId: deudorId, score: datos.condiciones.score }, ctx);
  marcar('COMPLETADO', `e-pagaré ${datos.instrumento.contrato_address} emitido`);
  return cerrar(db, auditar, solicitudId, 'COMPLETADO', estados, datos, null);
}

/**
 * Reanuda un pipeline detenido en PENDIENTE_APROBACION (el gate asíncrono).
 * `decision`: 'aprobar' ejecuta con la marca de aprobación humana explícita;
 * 'rechazar' cierra en RECHAZADO. Retoma EXACTAMENTE desde donde quedó.
 */
export async function reanudarPipeline(db, solicitudId, decision) {
  const sol = db.prepare('SELECT * FROM solicitudes_credito WHERE id = ?').get(solicitudId);
  if (!sol) throw new Error('solicitud inexistente');
  if (sol.estado !== 'pendiente_aprobacion') {
    throw new Error(`la solicitud está "${sol.estado}", no pendiente de aprobación`);
  }
  const cond = sol.condiciones_json ? JSON.parse(sol.condiciones_json) : null;
  if (!cond?.condiciones) throw new Error('la solicitud no tiene condiciones calculadas');

  const auditar = crearAuditor(db, sol.corrida_id);
  const estados = sol.estados_json ? JSON.parse(sol.estados_json) : [];
  const datos = { condiciones: cond };
  const marcar = (estado, detalle) => estados.push({ estado, detalle });

  if (decision === 'rechazar') {
    auditar('aprobacion_humana', { permitido: false, motivo: 'el dueño rechazó la operación' });
    marcar('RECHAZADO', 'el dueño rechazó la operación pendiente');
    return cerrar(db, auditar, solicitudId, 'RECHAZADO', estados, datos, null, /*yaDecidido*/ true);
  }

  // aprobación humana explícita: el policy engine la registra y libera el paso
  const input = {
    deudorId: sol.deudor_id, acreedorId: sol.acreedor_id, monto: sol.monto,
    tasaTna: cond.condiciones.tasa_sugerida_tna, plazoDias: cond.condiciones.plazo_max_dias,
  };
  const pol = evaluarPolicy('generarInstrumento', input, { aprobacionHumana: true });
  auditar('aprobacion_humana', { tool: 'generarInstrumento', params: input, permitido: pol.permitido, motivo: 'el dueño aprobó la operación' });

  marcar('EJECUTANDO', 'aprobación humana registrada: retomo donde quedé');
  datos.instrumento = await ejecutarTool(db, 'generarInstrumento', input, { solicitudId });
  auditar('tool_call', { tool: 'generarInstrumento', params: input, resultado: datos.instrumento });
  datos.onchain = await ejecutarTool(db, 'registrarScoreOnChain', { entidadId: sol.deudor_id, score: cond.score }, { solicitudId });
  auditar('tool_call', { tool: 'registrarScoreOnChain', resultado: datos.onchain });
  marcar('COMPLETADO', `e-pagaré ${datos.instrumento.contrato_address} emitido con OK del dueño`);
  return cerrar(db, auditar, solicitudId, 'COMPLETADO', estados, datos, null, /*yaDecidido*/ true);
}

// Persiste el cierre (o la pausa) del pipeline y devuelve el resultado.
function cerrar(db, auditar, solicitudId, estadoFinal, estados, datos, pendientePor, yaDecidido = false) {
  db.prepare(`
    UPDATE solicitudes_credito
    SET estado = ?, condiciones_json = COALESCE(?, condiciones_json), estados_json = ?
    WHERE id = ?
  `).run(
    ESTADO_SOLICITUD[estadoFinal],
    datos.condiciones ? JSON.stringify(datos.condiciones) : null,
    JSON.stringify(estados),
    solicitudId,
  );
  auditar('decision', {
    resultado: {
      estado: ESTADO_SOLICITUD[estadoFinal],
      instrumento_id: datos.instrumento?.instrumento_id ?? null,
      score: datos.condiciones?.score ?? null,
      maquina: estados.map((e) => e.estado).join(' → '),
    },
    motivo: ESTADO_SOLICITUD[estadoFinal],
  });
  return { estado: estadoFinal, estado_solicitud: ESTADO_SOLICITUD[estadoFinal], estados, datos, pendiente_por: pendientePor, ya_decidido: yaDecidido };
}
