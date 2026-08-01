// Selector de LLMProvider — SOLO para los bordes conversacionales.
// El pipeline de crédito es determinístico y NO pasa por acá (pipelineCredito.js).
// Contrato de ambos providers:
//   extraerPedido({texto, entidades}) → {deudorId, acreedorId, monto} | null
//   verbalizar({resultado})           → string (sin números nuevos)
//   LLM_MODE=mock       → matcher determinístico + passthrough (default, sin key)
//   LLM_MODE=anthropic  → Claude en los bordes (ANTHROPIC_API_KEY)
import { crearMockProvider } from './mock.js';
import { crearAnthropicProvider } from './anthropic.js';

export function elegirProvider() {
  const modo = (process.env.LLM_MODE || 'mock').toLowerCase();
  if (modo === 'anthropic') return crearAnthropicProvider();
  if (modo !== 'mock') {
    console.warn(`LLM_MODE="${modo}" desconocido — uso mock. Valores: mock | anthropic`);
  }
  return crearMockProvider();
}
