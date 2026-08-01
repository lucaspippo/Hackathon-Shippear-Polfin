// ============================================================================
// PolFin — Policy engine del agente (Prompt 3.B)
// ----------------------------------------------------------------------------
// El agente decide; el policy engine impone los límites ANTES de ejecutar
// cualquier tool. Patrón agéntico 2026 (Coinbase AgentKit, Google AP2): la
// respuesta a "¿cómo controlan que el agente no haga una macana con la plata?"
//
// Reglas:
//  · Allowlist: solo las tools registradas pueden ejecutarse; las de consulta
//    son libres, las que mueven dinero pasan por límites.
//  · Límite por operación: el agente aprueba solo hasta LIMITE_AUTONOMO_PESOS.
//  · Human-in-the-loop: por encima del límite NO se ejecuta — la operación
//    queda "pendiente de aprobación del dueño" y se dispara notificarDueno.
//  · Pagos en stablecoin: SIEMPRE requieren OK humano.
//  · Auditoría: cada decisión de policy y cada tool ejecutada queda logueada.
// ============================================================================

export const POLICY = {
  // Monto máximo (en pesos) que el agente puede aprobar sin intervención humana
  limite_autonomo_pesos: Number(process.env.POLFIN_LIMITE_AUTONOMO || 500_000),

  // Tools de consulta/aviso: el agente las llama libremente
  libres: [
    'getHistorialCliente',
    'calcularScoring',
    'consultarMacro',
    'decidirCondiciones',
    'notificarDueno',
  ],

  // Tools que mueven dinero/generan instrumentos: sujetas al límite por operación
  con_limite_por_monto: ['generarInstrumento'],

  // Registrar reputación no mueve plata, pero es una escritura on-chain:
  // permitida solo dentro de una corrida del agente (no expuesta suelta)
  escrituras_permitidas: ['registrarScoreOnChain'],

  // SIEMPRE requieren aprobación humana explícita, sin importar el monto
  siempre_aprobacion_humana: ['ejecutarPagoStablecoin'],
};

/**
 * Evalúa si una tool puede ejecutarse con estos parámetros.
 * `proactiva`: la acción la inició Ángela sola (monitoreo, no un pedido del
 * usuario) → todo lo que mueve dinero requiere SIEMPRE el OK del dueño,
 * sin importar el monto. Lo que no mueve plata (avisos, consultas) fluye.
 * @returns {{ permitido: boolean, requiere_aprobacion: boolean, motivo: string }}
 */
export function evaluarPolicy(nombre, input, { aprobacionHumana = false, proactiva = false } = {}) {
  if (POLICY.libres.includes(nombre) || POLICY.escrituras_permitidas.includes(nombre)) {
    return { permitido: true, requiere_aprobacion: false, motivo: 'tool en allowlist libre' };
  }

  if (POLICY.siempre_aprobacion_humana.includes(nombre)) {
    if (aprobacionHumana) {
      return { permitido: true, requiere_aprobacion: false, motivo: 'aprobación humana explícita registrada' };
    }
    return {
      permitido: false,
      requiere_aprobacion: true,
      motivo: `${nombre} siempre requiere aprobación del dueño (mueve fondos)`,
    };
  }

  if (POLICY.con_limite_por_monto.includes(nombre)) {
    const monto = Number(input.monto || 0);
    if (aprobacionHumana) {
      return { permitido: true, requiere_aprobacion: false, motivo: 'aprobación humana explícita registrada' };
    }
    if (proactiva) {
      return {
        permitido: false,
        requiere_aprobacion: true,
        motivo: `acción iniciada proactivamente por Ángela: mover dinero sin pedido del dueño requiere SIEMPRE su OK`,
      };
    }
    if (monto <= POLICY.limite_autonomo_pesos) {
      return {
        permitido: true,
        requiere_aprobacion: false,
        motivo: `monto $${monto.toLocaleString('es-AR')} dentro del límite autónomo ($${POLICY.limite_autonomo_pesos.toLocaleString('es-AR')})`,
      };
    }
    return {
      permitido: false,
      requiere_aprobacion: true,
      motivo: `monto $${monto.toLocaleString('es-AR')} supera el límite autónomo del agente ($${POLICY.limite_autonomo_pesos.toLocaleString('es-AR')}): requiere aprobación del dueño`,
    };
  }

  // Tool fuera de la allowlist: se niega siempre
  return { permitido: false, requiere_aprobacion: false, motivo: `tool "${nombre}" fuera de la allowlist` };
}

// ------------------------------------------------------------------ auditoría
export function crearAuditor(db, corridaId) {
  let seq = 0;
  const ins = db.prepare(`
    INSERT INTO auditoria (corrida_id, seq, tipo, tool, params_json, resultado_json, permitido, motivo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return function auditar(tipo, { tool = null, params = null, resultado = null, permitido = null, motivo = null } = {}) {
    seq += 1;
    ins.run(
      corridaId, seq, tipo, tool,
      params !== null ? JSON.stringify(params) : null,
      resultado !== null ? JSON.stringify(resultado) : null,
      permitido === null ? null : (permitido ? 1 : 0),
      motivo,
    );
    return seq;
  };
}
