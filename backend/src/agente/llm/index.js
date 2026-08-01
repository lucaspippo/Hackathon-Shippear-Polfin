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
import { crearAnthropicProvider } from './anthropic.js';
import { crearGatewayProvider } from './gateway.js';

export function elegirProvider() {
  const modo = (process.env.LLM_MODE || 'mock').toLowerCase();
  if (modo === 'anthropic') return crearAnthropicProvider();
  if (modo === 'gateway') return crearGatewayProvider();
  if (modo !== 'mock') {
    console.warn(`LLM_MODE="${modo}" desconocido — uso mock. Valores: mock | anthropic | gateway`);
  }
  return crearMockProvider();
}
