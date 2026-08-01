// ============================================================================
// PolFin — Tools de SOLO LECTURA para el chat abierto de Ángela.
// ----------------------------------------------------------------------------
// Registro SEPARADO del de tools.js a propósito: el chat abierto es de CONSULTA
// y ANÁLISIS. Acá NO existe ninguna tool que mueva dinero (generar e-pagaré,
// aprobar, liquidar USDC): el modelo, en el chat, físicamente no las tiene a
// mano. Si el dueño pide ejecutar algo, Ángela lo deriva al flujo formal con su
// approval gate (ver el system prompt en chatAngela.js). Defensa en profundidad:
// ejecutarChatTool solo entiende nombres de este registro.
//
// El modelo decide QUÉ tools llamar, EN QUÉ ORDEN y CUÁNTAS veces según la
// pregunta (que no conocemos de antemano). Todos los números salen de la DB y
// del motor de scoring determinístico — nunca del modelo.
// ============================================================================
import { calcularScore } from '../scoring.js';
import { contextoMacroPublico } from '../macro.js';

const pesosAr = (n) => '$' + Math.round(n || 0).toLocaleString('es-AR');

// Nombres de tools: ^[a-zA-Z0-9_-]{1,64}$ (sin ñ ni tildes).
export const CHAT_TOOLS = [
  {
    name: 'buscarEntidades',
    description:
      'Busca entidades (personas o comercios) por nombre parcial y/o filtros. Úsala PRIMERO para resolver un nombre mencionado por el usuario (ej. "Rubén") a su ID antes de consultar su historial o score. Devuelve id, nombre, tipo y rol.',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Parte del nombre a buscar (case/acento-insensible). Vacío = trae todas.' },
        tipo: { type: 'string', enum: ['persona', 'comercio'], description: 'Filtrar por tipo' },
        rol: { type: 'string', enum: ['fabrica', 'distribuidora', 'mayorista', 'minorista'], description: 'Filtrar comercios por rol en la cadena' },
        limite: { type: 'integer', description: 'Máximo de resultados (default 20)' },
      },
    },
  },
  {
    name: 'getHistorialCliente',
    description:
      'Historial de crédito COMPLETO de una entidad como deudora en la red: operaciones, en qué comercios operó, cuántas pagó/vencidas/pendientes, y el detalle de sus transacciones (montos, vencimientos, si pagó en fecha).',
    input_schema: {
      type: 'object',
      properties: { entidadId: { type: 'integer', description: 'ID de la entidad' } },
      required: ['entidadId'],
    },
  },
  {
    name: 'calcularScoring',
    description:
      'Corre el motor de scoring determinístico sobre el historial verificable y devuelve el score 0-1000, el desglose por factor (puntualidad, historial, volumen, diversidad, tendencia) con su aporte, la explicación en lenguaje natural y las condiciones sugeridas (tasa, plazo, límite). Úsala para responder "por qué el score es X" o para comparar riesgo.',
    input_schema: {
      type: 'object',
      properties: { entidadId: { type: 'integer', description: 'ID de la entidad a puntuar' } },
      required: ['entidadId'],
    },
  },
  {
    name: 'consultarMacro',
    description:
      'Contexto macroeconómico REAL de Argentina (inflación, tasas TAMAR/cheques PyME, tipo de cambio, riesgo país, mora del sistema) y la política de crédito que se deriva: cómo el contexto ajusta PLAZO y SPREAD (nunca el score). Incluye las reglas activas y la regla de neutralidad. Úsala para explicar por qué el contexto ajusta las condiciones. IMPORTANTE: al usarla, hablá SOLO de riesgo e indicadores, nunca de política ni de gobiernos.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'simularCondiciones',
    description:
      'ANÁLISIS (no ejecuta nada): cruza el score de la entidad con la base macro y un monto hipotético, y devuelve las condiciones sugeridas y si el monto entra en el límite. Sirve para razonar "¿cuánto le podría fiar?" — NO fía ni aprueba nada.',
    input_schema: {
      type: 'object',
      properties: {
        entidadId: { type: 'integer', description: 'ID del deudor' },
        montoSolicitado: { type: 'integer', description: 'Monto hipotético en pesos' },
      },
      required: ['entidadId', 'montoSolicitado'],
    },
  },
  {
    name: 'rankingClientes',
    description:
      'Lista clientes puntuados y ordenados por score, con su riesgo y (si el alcance es la cartera propia) cuánto le deben. alcance="mi_cartera" = solo quienes le deben a la entidad activa; alcance="red" = toda la red. orden="score_asc" para ver los MÁS riesgosos primero; "score_desc" para los mejores. Ideal para "¿quién es el más riesgoso?" o "¿a quién le doy más crédito?".',
    input_schema: {
      type: 'object',
      properties: {
        alcance: { type: 'string', enum: ['mi_cartera', 'red'], description: 'mi_cartera (default) = deudores de la entidad activa; red = todos' },
        orden: { type: 'string', enum: ['score_asc', 'score_desc'], description: 'score_asc = más riesgosos primero (default); score_desc = mejores primero' },
        tipo: { type: 'string', enum: ['persona', 'comercio'], description: 'Filtrar por tipo (solo con alcance=red)' },
        limite: { type: 'integer', description: 'Máximo de filas (default 8)' },
      },
    },
  },
  {
    name: 'carteraDe',
    description:
      'Resumen de la cartera de una entidad como ACREEDOR (lo que le deben): total por cobrar vivo, monto vencido, cantidad de deudores, distribución por nivel de riesgo, y el top de deudores con su saldo, score y riesgo. Úsala para "¿cómo viene mi cartera?" o "¿quién de los que me deben es más riesgoso?". Si no pasás entidadId, usa la entidad activa.',
    input_schema: {
      type: 'object',
      properties: { entidadId: { type: 'integer', description: 'ID del acreedor (default: entidad activa)' } },
    },
  },
  {
    name: 'cuentasPorPagar',
    description:
      'Deudas VIVAS de una entidad como DEUDORA (lo que ella debe): saldo total, cuánto está vencido, y el detalle por acreedor con vencimientos. Si no pasás entidadId, usa la entidad activa.',
    input_schema: {
      type: 'object',
      properties: { entidadId: { type: 'integer', description: 'ID del deudor (default: entidad activa)' } },
    },
  },
  {
    name: 'quienSeAtrasa',
    description:
      'Detecta deudores en señal de riesgo: con deudas vencidas impagas o con tendencia de pago EMPEORANDO respecto a su propio patrón. alcance="mi_cartera" (default) mira solo a quienes le deben a la entidad activa; "red" mira toda la red. Ideal para "¿quién se está atrasando?" o "¿a quién vigilo?".',
    input_schema: {
      type: 'object',
      properties: {
        alcance: { type: 'string', enum: ['mi_cartera', 'red'] },
        limite: { type: 'integer', description: 'Máximo de filas (default 8)' },
      },
    },
  },
  {
    name: 'evolucionCartera',
    description:
      'Serie mensual de la cartera de una entidad como acreedor en los últimos N meses: monto emitido, cobrado y vencido por mes, más una comparación del tramo reciente vs el anterior. Úsala para "¿cómo viene mi cartera comparada con hace unos meses?". Si no pasás entidadId, usa la entidad activa.',
    input_schema: {
      type: 'object',
      properties: {
        entidadId: { type: 'integer', description: 'ID del acreedor (default: entidad activa)' },
        meses: { type: 'integer', description: 'Cantidad de meses hacia atrás (default 6)' },
      },
    },
  },
  {
    name: 'compararEntidades',
    description:
      'Compara 2 o más entidades lado a lado: score, riesgo, % puntual, operaciones, vencidas y límite sugerido. Úsala cuando el usuario pide comparar clientes.',
    input_schema: {
      type: 'object',
      properties: {
        entidadIds: { type: 'array', items: { type: 'integer' }, description: 'IDs a comparar (2 o más)' },
      },
      required: ['entidadIds'],
    },
  },
];

// Set de nombres válidos (defensa en profundidad).
const NOMBRES_VALIDOS = new Set(CHAT_TOOLS.map((t) => t.name));

const sinAcentos = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Saldo vivo de una tx (monto − pagos parciales) si no está pagada.
function saldoVivo(db, tx) {
  if (tx.estado === 'pagada') return 0;
  const pagado = db.prepare('SELECT COALESCE(SUM(monto),0) AS s FROM pagos WHERE transaccion_id = ?').get(tx.id).s;
  return Math.max(0, tx.monto - pagado);
}

// ---------------------------------------------------------------------------
// ejecutarChatTool: SOLO lectura. ctx = { entidadActivaId, rol, nombre }.
// ---------------------------------------------------------------------------
export function ejecutarChatTool(db, nombre, input = {}, ctx = {}) {
  if (!NOMBRES_VALIDOS.has(nombre)) {
    return { error: `tool no disponible en el chat de consulta: ${nombre}. El chat es de lectura/análisis; las acciones que mueven dinero van por el flujo formal con aprobación del dueño.` };
  }
  const activa = ctx.entidadActivaId ?? null;

  switch (nombre) {
    case 'buscarEntidades': {
      let sql = 'SELECT id, nombre, tipo, rol_cadena, rubro, ciudad FROM entidades WHERE 1=1';
      const p = [];
      if (input.tipo) { sql += ' AND tipo = ?'; p.push(input.tipo); }
      if (input.rol) { sql += ' AND rol_cadena = ?'; p.push(input.rol); }
      let filas = db.prepare(sql).all(...p);
      if (input.texto?.trim()) {
        const q = sinAcentos(input.texto);
        filas = filas.filter((e) => sinAcentos(e.nombre).includes(q));
      }
      return { total: filas.length, entidades: filas.slice(0, input.limite || 20) };
    }

    case 'getHistorialCliente': {
      const ent = db.prepare('SELECT * FROM entidades WHERE id = ?').get(input.entidadId);
      if (!ent) return { error: `no existe la entidad ${input.entidadId}` };
      const txs = db.prepare(`
        SELECT t.*, a.nombre AS acreedor_nombre FROM transacciones t
        JOIN entidades a ON a.id = t.acreedor_id
        WHERE t.deudor_id = ? ORDER BY t.fecha_emision DESC
      `).all(input.entidadId);
      return {
        entidad: { id: ent.id, nombre: ent.nombre, tipo: ent.tipo },
        operaciones: txs.length,
        comercios_donde_opera: [...new Set(txs.map((t) => t.acreedor_nombre))],
        pagadas: txs.filter((t) => t.estado === 'pagada').length,
        pendientes: txs.filter((t) => t.estado === 'pendiente').length,
        vencidas_impagas: txs.filter((t) => t.estado === 'vencida').length,
        transacciones: txs.slice(0, 40).map((t) => ({
          fecha: t.fecha_emision, comercio: t.acreedor_nombre, monto: t.monto,
          vencimiento: t.fecha_vencimiento, pago: t.fecha_pago_real, estado: t.estado,
        })),
      };
    }

    case 'calcularScoring': {
      const r = calcularScore(db, input.entidadId);
      if (!r) return { error: `no existe la entidad ${input.entidadId}` };
      return {
        entidad: r.entidad, score: r.score, explicacion: r.explicacion,
        desglose: r.desglose, condiciones: r.condiciones, metricas: r.metricas,
      };
    }

    case 'consultarMacro': {
      const ctx = contextoMacroPublico();
      if (!ctx.disponible) {
        const m = db.prepare('SELECT * FROM macro_referencia ORDER BY mes DESC LIMIT 1').get();
        return m ? { mes: m.mes, tasa_referencia_tna: m.tasa_referencia_tna, nota: m.nota } : { error: 'sin datos macro' };
      }
      return ctx; // indicadores + política + reglas activas + neutralidad
    }

    case 'simularCondiciones': {
      const r = calcularScore(db, input.entidadId);
      if (!r) return { error: `no existe la entidad ${input.entidadId}` };
      const c = r.condiciones;
      const dentro = c.limite_sugerido_pesos >= input.montoSolicitado;
      return {
        analisis: true,
        nota: 'Simulación de análisis: NO fía ni aprueba nada. Para ejecutar, va por el flujo formal con OK del dueño.',
        entidad: r.entidad, score: r.score, monto_evaluado: input.montoSolicitado,
        condiciones: c, dentro_del_limite: dentro,
        recomendacion:
          r.score === null ? 'sin historial: contado o garantía'
          : r.score < 200 ? 'no recomendable: score en zona de riesgo muy alto'
          : !dentro ? `el monto (${pesosAr(input.montoSolicitado)}) supera el límite sugerido (${pesosAr(c.limite_sugerido_pesos)})`
          : `entra dentro del límite sugerido (${pesosAr(c.limite_sugerido_pesos)}), a ${c.tasa_sugerida_tna}% TNA / ${c.plazo_max_dias} días`,
      };
    }

    case 'rankingClientes': {
      const alcance = input.alcance || 'mi_cartera';
      const orden = input.orden || 'score_asc';
      let ids;
      if (alcance === 'mi_cartera') {
        if (!activa) return { error: 'no hay entidad activa para acotar la cartera; usá alcance="red" o pasá una entidad' };
        ids = db.prepare('SELECT DISTINCT deudor_id AS id FROM transacciones WHERE acreedor_id = ?').all(activa).map((r) => r.id);
      } else {
        let sql = 'SELECT DISTINCT e.id FROM entidades e JOIN transacciones t ON t.deudor_id = e.id';
        const p = [];
        if (input.tipo) { sql += ' WHERE e.tipo = ?'; p.push(input.tipo); }
        ids = db.prepare(sql).all(...p).map((r) => r.id);
      }
      const filas = ids.map((id) => {
        const r = calcularScore(db, id);
        if (!r) return null;
        let saldoQueDebe = null;
        if (alcance === 'mi_cartera') {
          const txs = db.prepare("SELECT * FROM transacciones WHERE acreedor_id = ? AND deudor_id = ? AND estado != 'pagada'").all(activa, id);
          saldoQueDebe = txs.reduce((s, t) => s + saldoVivo(db, t), 0);
        }
        return {
          id: r.entidad.id, nombre: r.entidad.nombre, tipo: r.entidad.tipo,
          score: r.score, riesgo: r.condiciones.riesgo,
          pct_puntual: r.metricas.pct_puntual, vencidas_impagas: r.metricas.vencidas_impagas,
          ...(saldoQueDebe !== null ? { le_debe: saldoQueDebe } : {}),
        };
      }).filter(Boolean);
      filas.sort((a, b) => {
        const sa = a.score ?? -1, sb = b.score ?? -1;
        return orden === 'score_desc' ? sb - sa : sa - sb;
      });
      return { alcance, orden, total: filas.length, clientes: filas.slice(0, input.limite || 8) };
    }

    case 'carteraDe': {
      const id = input.entidadId ?? activa;
      if (!id) return { error: 'no hay entidad activa ni entidadId' };
      const ent = db.prepare('SELECT * FROM entidades WHERE id = ?').get(id);
      if (!ent) return { error: `no existe la entidad ${id}` };
      const vivas = db.prepare("SELECT * FROM transacciones WHERE acreedor_id = ? AND estado != 'pagada'").all(id);
      const porDeudor = new Map();
      let porCobrar = 0, vencido = 0;
      for (const t of vivas) {
        const saldo = saldoVivo(db, t);
        porCobrar += saldo;
        if (t.estado === 'vencida') vencido += saldo;
        const d = porDeudor.get(t.deudor_id) || { saldo: 0, vencido: 0 };
        d.saldo += saldo; if (t.estado === 'vencida') d.vencido += saldo;
        porDeudor.set(t.deudor_id, d);
      }
      const distrib = {};
      const deudores = [...porDeudor.entries()].map(([did, v]) => {
        const r = calcularScore(db, did);
        const riesgo = r ? r.condiciones.riesgo : 'sin datos';
        distrib[riesgo] = (distrib[riesgo] || 0) + 1;
        return { id: did, nombre: r?.entidad.nombre ?? `#${did}`, saldo: v.saldo, vencido: v.vencido, score: r?.score ?? null, riesgo };
      }).sort((a, b) => b.saldo - a.saldo);
      return {
        entidad: { id: ent.id, nombre: ent.nombre },
        total_por_cobrar: porCobrar, total_vencido: vencido,
        deudores_activos: deudores.length, distribucion_riesgo: distrib,
        deudores: deudores.slice(0, 12),
      };
    }

    case 'cuentasPorPagar': {
      const id = input.entidadId ?? activa;
      if (!id) return { error: 'no hay entidad activa ni entidadId' };
      const ent = db.prepare('SELECT * FROM entidades WHERE id = ?').get(id);
      if (!ent) return { error: `no existe la entidad ${id}` };
      const vivas = db.prepare(`
        SELECT t.*, a.nombre AS acreedor_nombre FROM transacciones t
        JOIN entidades a ON a.id = t.acreedor_id
        WHERE t.deudor_id = ? AND t.estado != 'pagada' ORDER BY t.fecha_vencimiento ASC
      `).all(id);
      let debe = 0, vencido = 0;
      const detalle = vivas.map((t) => {
        const saldo = saldoVivo(db, t);
        debe += saldo; if (t.estado === 'vencida') vencido += saldo;
        return { acreedor: t.acreedor_nombre, saldo, vencimiento: t.fecha_vencimiento, estado: t.estado };
      });
      return { entidad: { id: ent.id, nombre: ent.nombre }, total_a_pagar: debe, vencido, cuentas: detalle.slice(0, 20) };
    }

    case 'quienSeAtrasa': {
      const alcance = input.alcance || 'mi_cartera';
      let ids;
      if (alcance === 'mi_cartera') {
        if (!activa) return { error: 'no hay entidad activa; usá alcance="red"' };
        ids = db.prepare('SELECT DISTINCT deudor_id AS id FROM transacciones WHERE acreedor_id = ?').all(activa).map((r) => r.id);
      } else {
        ids = db.prepare('SELECT DISTINCT deudor_id AS id FROM transacciones').all().map((r) => r.id);
      }
      const enRiesgo = ids.map((id) => {
        const r = calcularScore(db, id);
        if (!r) return null;
        const t = r.desglose.find((d) => d.factor === 'tendencia');
        const empeorando = /empeorando/.test(t?.detalle || '');
        const vencidas = r.metricas.vencidas_impagas || 0;
        if (!empeorando && vencidas === 0) return null;
        const motivos = [];
        if (vencidas > 0) motivos.push(`${vencidas} deuda(s) vencida(s) impaga(s)`);
        if (empeorando) motivos.push('tendencia de pago empeorando');
        return { id: r.entidad.id, nombre: r.entidad.nombre, score: r.score, riesgo: r.condiciones.riesgo, vencidas_impagas: vencidas, motivos };
      }).filter(Boolean).sort((a, b) => (b.vencidas_impagas - a.vencidas_impagas) || ((a.score ?? 999) - (b.score ?? 999)));
      return { alcance, total: enRiesgo.length, en_riesgo: enRiesgo.slice(0, input.limite || 8) };
    }

    case 'evolucionCartera': {
      const id = input.entidadId ?? activa;
      if (!id) return { error: 'no hay entidad activa ni entidadId' };
      const meses = Math.max(2, Math.min(24, input.meses || 6));
      const ent = db.prepare('SELECT * FROM entidades WHERE id = ?').get(id);
      if (!ent) return { error: `no existe la entidad ${id}` };
      const txs = db.prepare('SELECT * FROM transacciones WHERE acreedor_id = ? ORDER BY fecha_emision').all(id);
      // buckets por mes YYYY-MM sobre los últimos `meses` con datos
      const mesesSet = [...new Set(txs.map((t) => t.fecha_emision.slice(0, 7)))].sort();
      const ultimos = mesesSet.slice(-meses);
      const serie = ultimos.map((m) => {
        const delMes = txs.filter((t) => t.fecha_emision.slice(0, 7) === m);
        return {
          mes: m,
          emitido: delMes.reduce((s, t) => s + t.monto, 0),
          operaciones: delMes.length,
          vencidas: delMes.filter((t) => t.estado === 'vencida').length,
          cobrado: delMes.filter((t) => t.estado === 'pagada').reduce((s, t) => s + t.monto, 0),
        };
      });
      // comparación tramo reciente vs anterior
      const mitad = Math.floor(serie.length / 2);
      const suma = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
      const anterior = serie.slice(0, mitad), reciente = serie.slice(mitad);
      const cmp = {
        emitido_anterior: suma(anterior, 'emitido'), emitido_reciente: suma(reciente, 'emitido'),
        vencidas_anterior: suma(anterior, 'vencidas'), vencidas_reciente: suma(reciente, 'vencidas'),
      };
      return { entidad: { id: ent.id, nombre: ent.nombre }, meses_con_datos: ultimos.length, serie_mensual: serie, comparacion: cmp };
    }

    case 'compararEntidades': {
      const ids = (input.entidadIds || []).slice(0, 6);
      if (ids.length < 2) return { error: 'pasá al menos 2 entidadIds' };
      const filas = ids.map((id) => {
        const r = calcularScore(db, id);
        if (!r) return { id, error: 'no existe' };
        return {
          id: r.entidad.id, nombre: r.entidad.nombre, score: r.score, riesgo: r.condiciones.riesgo,
          pct_puntual: r.metricas.pct_puntual, operaciones: r.metricas.operaciones,
          vencidas_impagas: r.metricas.vencidas_impagas, limite_sugerido_pesos: r.condiciones.limite_sugerido_pesos,
        };
      });
      return { comparacion: filas };
    }

    default:
      return { error: `tool desconocida: ${nombre}` };
  }
}
