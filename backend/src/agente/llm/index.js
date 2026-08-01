// Selector de LLMProvider — SOLO para los bordes conversacionales.
// El pipeline de crédito es determinístico y NO pasa por acá (pipelineCredito.js).
// Contrato de los tres providers:
//   extraerPedido({texto, entidades}) → {deudorId, acreedorId, monto} | null
//   verbalizar({resultado})           → string (sin números nuevos)
//   LLM_MODE=mock       → matcher determinístico + passthrough (default, sin key)
//   LLM_MODE=anthropic  → Claude por la API directa de Anthropic (ANTHROPIC_API_KEY)
//   LLM_MODE=gateway    → Claude por el AI Gateway de Vercel/V0 (AI_GATEWAY_API_KEY)
//
// Los tres son conmutables con una sola variable: si el Gateway falla, se vuelve
// a mock o anthropic cambiando LLM_MODE, sin tocar código.
import { crearMockProvider } from './mock.js';
import { crearAnthropicProvider, crearClienteAnthropic } from './anthropic.js';
import { crearGatewayProvider, crearClienteGateway } from './gateway.js';

export function elegirProvider() {
  const modo = (process.env.LLM_MODE || 'mock').toLowerCase();
  if (modo === 'anthropic') return crearAnthropicProvider();
  if (modo === 'gateway') return crearGatewayProvider();
  if (modo !== 'mock') {
    console.warn(`LLM_MODE="${modo}" desconocido — uso mock. Valores: mock | anthropic | gateway`);
  }
  return crearMockProvider();
}

// Cliente LLM crudo (client + model) para el modo activo, para usos que NO son
// los bordes del pipeline de crédito sino un loop agéntico propio (el chat
// abierto de Ángela). En mock devuelve client:null — el chat necesita un modelo
// real y lo informa con claridad, sin romper nada.
export function crearClienteLLM() {
  const modo = (process.env.LLM_MODE || 'mock').toLowerCase();
  if (modo === 'gateway') return { modo, ...crearClienteGateway() };
  if (modo === 'anthropic') return { modo, ...crearClienteAnthropic() };
  return { modo: 'mock', client: null, model: null, nombre: 'mock (sin modelo real)' };
}
