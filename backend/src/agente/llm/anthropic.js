// ============================================================================
// AnthropicProvider — el LLM SOLO en los bordes conversacionales.
// ----------------------------------------------------------------------------
// Tras el refactor de arquitectura, el LLM NO orquesta ni decide el pipeline
// de crédito (eso es pipelineCredito.js, determinístico). Acá quedan los dos
// únicos puntos donde toca el flujo:
//
//   ENTRADA · extraerPedido: interpreta una frase en lenguaje natural y
//     extrae {deudorId, acreedorId, monto} vía tool use FORZADO (tool_choice)
//     — el LLM solo mapea texto → parámetros estructurados. El schema de la
//     tool es la única salida posible.
//   SALIDA · verbalizar: recibe el resultado YA calculado por el pipeline y
//     lo cuenta en castellano. La instrucción es explícita: prohibido
//     introducir números que no estén en el JSON de entrada.
//
// La lógica de ambos bordes vive en anthropicShaped.js (la comparte con el
// GatewayProvider, que habla la misma Messages API). Acá solo se construye el
// cliente contra la API directa de Anthropic y se nombra el modelo.
//
// GARANTÍA: ningún número de decisión (score, tasa, plazo, límite) nace acá.
// Si el LLM alucinara un número en la verbalización, no afecta la decisión:
// la decisión ya está persistida por el pipeline antes de llamar a este
// módulo, y la UI muestra los valores estructurados del pipeline, no los
// del texto.
//
// Para activar: ANTHROPIC_API_KEY=... y LLM_MODE=anthropic.
// ============================================================================
import Anthropic from '@anthropic-ai/sdk';
import { crearProviderAnthropicShaped } from './anthropicShaped.js';

export function crearAnthropicProvider() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'LLM_MODE=anthropic pero falta ANTHROPIC_API_KEY. ' +
      'Seteala (o usá LLM_MODE=mock mientras tanto).'
    );
  }
  const client = new Anthropic(); // toma ANTHROPIC_API_KEY del entorno
  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
  return crearProviderAnthropicShaped({ client, model, nombre: `anthropic:${model}` });
}
