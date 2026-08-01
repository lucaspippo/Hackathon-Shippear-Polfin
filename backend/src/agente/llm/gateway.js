// ============================================================================
// GatewayProvider — Ángela a través del AI Gateway de Vercel (V0).
// ----------------------------------------------------------------------------
// El AI Gateway de Vercel expone la MISMA Messages API de Anthropic, así que
// reusamos íntegra la lógica de los bordes (anthropicShaped.js). Lo único que
// cambia respecto al provider directo:
//   · baseURL → el endpoint del Gateway (el SDK le agrega /v1/messages).
//   · apiKey  → la key del Gateway (AI_GATEWAY_API_KEY), NO la de Anthropic.
//   · model   → el string prefijado por proveedor: 'anthropic/claude-opus-5'.
//
// Documentación oficial (verificada, no de memoria):
//   https://vercel.com/docs/ai-gateway/sdks-and-apis/anthropic-messages-api
//   - Base URL: https://ai-gateway.vercel.sh   (el SDK completa /v1/messages)
//   - Auth: API key del Gateway vía header Authorization: Bearer / x-api-key.
//           El SDK de Anthropic manda `apiKey` como x-api-key, que el Gateway
//           acepta.
//   - Modelo: prefijado por proveedor, p. ej. 'anthropic/claude-sonnet-5'
//             (último Sonnet: rápido y fuerte en tool use, ideal para chat en
//             vivo). Verificado contra el registro live del Gateway (/v1/models)
//             — no de memoria. Overrideable con GATEWAY_MODEL sin tocar código.
//
// Para activar: AI_GATEWAY_API_KEY=... y LLM_MODE=gateway (ver backend/.env).
// Si el Gateway falla (auth, modelo, timeout), el error queda CLARO en consola
// y se puede volver a mock/anthropic cambiando LLM_MODE — nunca tumba el backend.
// ============================================================================
import Anthropic from '@anthropic-ai/sdk';
import { crearProviderAnthropicShaped } from './anthropicShaped.js';

// Base URL oficial del AI Gateway de Vercel para la Messages API de Anthropic.
// El SDK de Anthropic le agrega `/v1/messages` por su cuenta.
export const GATEWAY_BASE_URL = process.env.AI_GATEWAY_BASE_URL || 'https://ai-gateway.vercel.sh';

// Construye el cliente del Gateway ya configurado (baseURL + key + modelo).
// Lo usan el provider de bordes (abajo) y el chat abierto (chatAngela.js).
export function crearClienteGateway() {
  // Aceptamos AI_GATEWAY_API_KEY (nombre de la doc de Vercel) o V0_API_KEY como alias.
  const apiKey = process.env.AI_GATEWAY_API_KEY || process.env.V0_API_KEY;
  if (!apiKey) {
    throw new Error(
      'LLM_MODE=gateway pero falta AI_GATEWAY_API_KEY. ' +
      'Pegala en backend/.env (o usá LLM_MODE=mock mientras tanto).'
    );
  }
  const model = process.env.GATEWAY_MODEL || 'anthropic/claude-sonnet-5';
  return { client: new Anthropic({ apiKey, baseURL: GATEWAY_BASE_URL }), model, nombre: `gateway:${model}` };
}

export function crearGatewayProvider() {
  const { client, model, nombre } = crearClienteGateway();
  const base = crearProviderAnthropicShaped({ client, model, nombre });

  // Envolvemos los dos bordes para que un fallo del Gateway sea CLARO en consola
  // y no silencioso, sin tumbar el backend:
  //   · extraerPedido: no se puede inventar la extracción → log + rethrow (el
  //     endpoint responde 400 con el mensaje; el server sigue vivo; se vuelve a
  //     mock cambiando LLM_MODE).
  //   · verbalizar: la decisión YA está calculada y persistida por el pipeline
  //     → log + fallback a la verbalización determinística (no perdemos la
  //     respuesta por un hipo del Gateway).
  return {
    nombre: base.nombre,

    async extraerPedido(args) {
      try {
        return await base.extraerPedido(args);
      } catch (e) {
        console.error(
          `[gateway] Falló extraerPedido contra ${GATEWAY_BASE_URL} (modelo ${model}): ${e.message}\n` +
          '          → revisá AI_GATEWAY_API_KEY / GATEWAY_MODEL, o volvé a LLM_MODE=mock.'
        );
        throw e;
      }
    },

    async verbalizar(args) {
      try {
        return await base.verbalizar(args);
      } catch (e) {
        console.error(
          `[gateway] Falló verbalizar contra ${GATEWAY_BASE_URL} (modelo ${model}): ${e.message}\n` +
          '          → uso la verbalización determinística del pipeline (la decisión ya estaba tomada).'
        );
        return args?.resultado?.razonamiento ?? '';
      }
    },
  };
}
