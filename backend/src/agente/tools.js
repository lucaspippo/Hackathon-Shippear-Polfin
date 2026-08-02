// ============================================================================
// PolFin — Registro de tools del agente (Prompt 3, sección 4 del doc maestro)
// ----------------------------------------------------------------------------
// Los schemas están en el formato de tool use de la API de Anthropic
// (name / description / input_schema JSON Schema). El MISMO registro lo usan
// el AnthropicProvider (se manda como `tools` en messages.create) y el
// MockProvider (que emite bloques tool_use contra estos nombres).
//
// Tools de consulta y decisión: lógica REAL (DB + motor de scoring Prompt 2).
// Tools on-chain: STUBS con mock realista — marcados "PROMPT 4" donde va la
// implementación real en Avalanche Fuji.
// ============================================================================
import { randomBytes } from 'node:crypto';
import { calcularScore } from '../scoring.js';
import { escribirScoreOnChain, mintearInstrumentoOnChain, liquidarPagoStablecoinOnChain } from '../chain/onchain.js';
import { esRedReal, redLabel, explorerUrl } from '../chain/redes.js';

const modoChain = () => (process.env.POLFIN_CHAIN_MODE || 'mock').toLowerCase();
const redActual = () => {
  const modo = modoChain();
  return esRedReal(modo) ? modo : 'mock';
};

// OJO: los nombres de tools deben matchear ^[a-zA-Z0-9_-]{1,64}$ (sin ñ).
export const TOOLS = [
  {
    name: 'getHistorialCliente',
    description:
      'Trae el historial de crédito COMPLETO de una entidad en toda la red PolFin: todas sus transacciones como deudor (en qué comercios compró a plazo, montos, si pagó en fecha, deudas vivas). Es el primer paso para evaluar un pedido de crédito.',
    input_schema: {
      type: 'object',
      properties: {
        entidadId: { type: 'integer', description: 'ID de la entidad (cliente o comercio) a consultar' },
      },
      required: ['entidadId'],
    },
  },
  {
    name: 'calcularScoring',
    description:
      'Corre el motor de scoring de PolFin sobre el historial verificable de la entidad y devuelve el score 0-1000 con el desglose por factor (puntualidad, historial, volumen, diversidad de red, tendencia) y una explicación en lenguaje natural. El score NO se inventa: se calcula sobre las transacciones reales.',
    input_schema: {
      type: 'object',
      properties: {
        entidadId: { type: 'integer', description: 'ID de la entidad a puntuar' },
      },
      required: ['entidadId'],
    },
  },
  {
    name: 'consultarMacro',
    description:
      'Devuelve el contexto macroeconómico argentino de referencia (inflación mensual, tipo de cambio, tasa de referencia TNA) que se usa como base para fijar la tasa y ajustar el plazo del crédito.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'decidirCondiciones',
    description:
      'Cruza el score de la entidad con la base macro y el monto solicitado, y devuelve las condiciones sugeridas: tasa TNA, plazo máximo, límite en pesos, y si el monto pedido entra dentro del límite. Usar DESPUÉS de calcularScoring.',
    input_schema: {
      type: 'object',
      properties: {
        entidadId: { type: 'integer', description: 'ID del deudor' },
        montoSolicitado: { type: 'integer', description: 'Monto del crédito pedido, en pesos' },
      },
      required: ['entidadId', 'montoSolicitado'],
    },
  },
  {
    name: 'generarInstrumento',
    description:
      'Genera el e-pagaré del crédito aprobado: registra el instrumento con monto, tasa, plazo y vencimiento, y lo despliega como smart contract. Es una acción que MUEVE DINERO: pasa por el policy engine y puede quedar bloqueada esperando aprobación del dueño.',
    input_schema: {
      type: 'object',
      properties: {
        deudorId: { type: 'integer', description: 'ID de quien debe pagar' },
        acreedorId: { type: 'integer', description: 'ID de quien fía / vende' },
        monto: { type: 'integer', description: 'Monto en pesos' },
        tasaTna: { type: 'number', description: 'Tasa TNA en % (de decidirCondiciones)' },
        plazoDias: { type: 'integer', description: 'Plazo en días (no exceder el máximo sugerido)' },
      },
      required: ['deudorId', 'acreedorId', 'monto', 'tasaTna', 'plazoDias'],
    },
  },
  {
    name: 'registrarScoreOnChain',
    description:
      'Escribe/actualiza el score de la entidad en el registro de reputación on-chain (Avalanche), dejándolo portable e infalsificable. Llamar después de generar un instrumento para que la reputación quede actualizada.',
    input_schema: {
      type: 'object',
      properties: {
        entidadId: { type: 'integer', description: 'ID de la entidad' },
        score: { type: 'integer', description: 'Score 0-1000 calculado por el motor' },
      },
      required: ['entidadId', 'score'],
    },
  },
  {
    name: 'ejecutarPagoStablecoin',
    description:
      'Liquida un pago en USDC (testnet Fuji) hacia una dirección destino. Es OPCIONAL (el pago por defecto es en pesos) y SIEMPRE requiere aprobación humana del dueño.',
    input_schema: {
      type: 'object',
      properties: {
        monto: { type: 'number', description: 'Monto en USDC' },
        destino: { type: 'string', description: 'Dirección destino (0x...)' },
      },
      required: ['monto', 'destino'],
    },
  },
  {
    name: 'notificarDueno',
    description:
      'Le manda un aviso al dueño del comercio (información o pedido de aprobación). Usar para avisar decisiones importantes o cuando una operación queda pendiente de su OK.',
    input_schema: {
      type: 'object',
      properties: {
        mensaje: { type: 'string', description: 'El mensaje para el dueño, claro y concreto' },
        tipo: { type: 'string', enum: ['info', 'aprobacion_requerida'], description: 'Tipo de aviso' },
        solicitudId: { type: 'integer', description: 'ID de la solicitud relacionada (si aplica)' },
      },
      required: ['mensaje'],
    },
  },
];

const mockHash = () => '0x' + randomBytes(32).toString('hex');
const mockAddress = () => '0x' + randomBytes(20).toString('hex');

// ------------------------------------------------------------- implementaciones
// ctx: { solicitudId } — para vincular instrumentos/notificaciones a la solicitud.
export async function ejecutarTool(db, nombre, input, ctx = {}) {
  switch (nombre) {
    case 'getHistorialCliente': {
      const ent = db.prepare('SELECT * FROM entidades WHERE id = ?').get(input.entidadId);
      if (!ent) return { error: `no existe la entidad ${input.entidadId}` };
      const txs = db.prepare(`
        SELECT t.*, a.nombre AS acreedor_nombre FROM transacciones t
        JOIN entidades a ON a.id = t.acreedor_id
        WHERE t.deudor_id = ? ORDER BY t.fecha_emision DESC
      `).all(input.entidadId);
      const comercios = [...new Set(txs.map((t) => t.acreedor_nombre))];
      return {
        entidad: { id: ent.id, nombre: ent.nombre, tipo: ent.tipo },
        operaciones: txs.length,
        comercios_donde_opera: comercios,
        pagadas: txs.filter((t) => t.estado === 'pagada').length,
        pendientes: txs.filter((t) => t.estado === 'pendiente').length,
        vencidas_impagas: txs.filter((t) => t.estado === 'vencida').length,
        transacciones: txs.slice(0, 60).map((t) => ({
          fecha: t.fecha_emision, comercio: t.acreedor_nombre, monto: t.monto,
          plazo_dias: t.plazo_dias, vencimiento: t.fecha_vencimiento,
          pago: t.fecha_pago_real, estado: t.estado,
        })),
      };
    }

    case 'calcularScoring': {
      const r = calcularScore(db, input.entidadId);
      if (!r) return { error: `no existe la entidad ${input.entidadId}` };
      return {
        entidad: r.entidad, score: r.score, explicacion: r.explicacion,
        desglose: r.desglose, metricas: r.metricas,
      };
    }

    case 'consultarMacro': {
      const m = db.prepare('SELECT * FROM macro_referencia ORDER BY mes DESC LIMIT 1').get();
      return m
        ? {
            mes: m.mes,
            inflacion_mensual_pct: m.inflacion_mensual_pct,
            tipo_cambio_oficial: m.tipo_cambio_oficial,
            tasa_referencia_tna: m.tasa_referencia_tna,
            nota: m.nota,
          }
        : { error: 'sin datos macro — correr el seed' };
    }

    case 'decidirCondiciones': {
      const r = calcularScore(db, input.entidadId);
      if (!r) return { error: `no existe la entidad ${input.entidadId}` };
      const c = r.condiciones;
      const dentroDelLimite = c.limite_sugerido_pesos >= input.montoSolicitado;
      return {
        entidad: r.entidad,
        score: r.score,
        monto_solicitado: input.montoSolicitado,
        condiciones: c,
        dentro_del_limite: dentroDelLimite,
        rechazar: r.score !== null && r.score < 200,
        recomendacion:
          r.score === null ? 'sin historial: contado o garantía'
          : r.score < 200 ? 'rechazar el crédito u operar de contado'
          : !dentroDelLimite
            ? `el monto pedido ($${input.montoSolicitado.toLocaleString('es-AR')}) supera el límite sugerido ($${c.limite_sugerido_pesos.toLocaleString('es-AR')}): reducir monto o pedir garantía`
            : `aprobar: fiar $${input.montoSolicitado.toLocaleString('es-AR')} a tasa ${c.tasa_sugerida_tna}% TNA, plazo máximo ${c.plazo_max_dias} días`,
      };
    }

    case 'generarInstrumento': {
      // POLFIN_CHAIN_MODE=fuji|avalanche: mintea un NFT real (patrocinado) en
      // el contrato EPagare de esa red. POLFIN_CHAIN_MODE=mock (default):
      // mismo comportamiento simulado que siempre.
      const venc = new Date(Date.now() + input.plazoDias * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      const red = redActual();
      let contrato, tx, tokenId = null;
      if (red !== 'mock') {
        const resultadoChain = await mintearInstrumentoOnChain({
          deudorId: input.deudorId, acreedorId: input.acreedorId, monto: input.monto,
          tasaTna: input.tasaTna, plazoDias: input.plazoDias, fechaVencimiento: venc,
        });
        contrato = resultadoChain.contrato_address;
        tx = resultadoChain.tx_hash;
        tokenId = resultadoChain.token_id;
      } else {
        contrato = mockAddress();
        tx = mockHash();
      }
      const r = db.prepare(`
        INSERT INTO instrumentos
          (solicitud_id, deudor_id, acreedor_id, monto, tasa_tna, plazo_dias,
           fecha_vencimiento, contrato_address, tx_hash, red, token_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(ctx.solicitudId ?? null, input.deudorId, input.acreedorId, input.monto,
        input.tasaTna, input.plazoDias, venc, contrato, tx, red, tokenId);
      return {
        instrumento_id: Number(r.lastInsertRowid),
        tipo: 'e-pagare',
        monto: input.monto,
        tasa_tna: input.tasaTna,
        plazo_dias: input.plazoDias,
        fecha_vencimiento: venc,
        contrato_address: contrato,
        tx_hash: tx,
        token_id: tokenId,
        red,
        red_label: redLabel(red),
        explorer_url: explorerUrl(red, 'address', contrato),
        tx_explorer_url: explorerUrl(red, 'tx', tx),
        nft_explorer_url: tokenId != null ? explorerUrl(red, 'nft', `${contrato}/${tokenId}`) : null,
        nota: red !== 'mock'
          ? `NFT del e-pagaré minteado en ${redLabel(red)}`
          : 'MOCK: seteá POLFIN_CHAIN_MODE=fuji o avalanche con los contratos deployados para el mint real',
      };
    }

    case 'registrarScoreOnChain': {
      const red = redActual();
      const tx = red !== 'mock'
        ? (await escribirScoreOnChain(input.entidadId, input.score)).tx_hash
        : mockHash();
      db.prepare(`
        INSERT INTO scores_onchain (entidad_id, score, tx_hash, red)
        VALUES (?, ?, ?, ?)
      `).run(input.entidadId, input.score, tx, red);
      return {
        entidad_id: input.entidadId, score: input.score, tx_hash: tx, red,
        red_label: redLabel(red),
        explorer_url: explorerUrl(red, 'tx', tx),
        nota: red !== 'mock'
          ? `Score escrito en el ScoreRegistry real de ${redLabel(red)}`
          : 'MOCK: seteá POLFIN_CHAIN_MODE=fuji o avalanche con los contratos deployados para la escritura real',
      };
    }

    case 'ejecutarPagoStablecoin': {
      // Esta tool SIEMPRE requiere aprobación humana (ver policy.js), así que
      // en el flujo normal llega acá solo después de un OK explícito del dueño.
      const red = redActual();
      const tx = red !== 'mock'
        ? (await liquidarPagoStablecoinOnChain({ monto: input.monto, destino: input.destino })).tx_hash
        : mockHash();
      return {
        monto_usdc: input.monto, destino: input.destino,
        tx_hash: tx, red,
        red_label: redLabel(red),
        explorer_url: explorerUrl(red, 'tx', tx),
        nota: red !== 'mock'
          ? `USDC de prueba (pfUSDC) minteado y liquidado en ${redLabel(red)}`
          : 'MOCK: seteá POLFIN_CHAIN_MODE=fuji o avalanche con los contratos deployados para la liquidación real',
      };
    }

    case 'notificarDueno': {
      const r = db.prepare(`
        INSERT INTO notificaciones (tipo, mensaje, solicitud_id)
        VALUES (?, ?, ?)
      `).run(input.tipo === 'aprobacion_requerida' ? 'aprobacion_requerida' : 'info',
        input.mensaje, input.solicitudId ?? ctx.solicitudId ?? null);
      return { notificacion_id: Number(r.lastInsertRowid), entregada: true };
    }

    default:
      return { error: `tool desconocida: ${nombre}` };
  }
}
