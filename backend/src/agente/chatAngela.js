// ============================================================================
// PolFin — El chat abierto de Ángela (el uso de IA CENTRAL, sin orden fijo).
// ----------------------------------------------------------------------------
// El dueño pregunta cualquier cosa sobre su negocio en lenguaje natural y Ángela
// responde razonando sobre los datos reales. Acá el modelo decide QUÉ tools
// llamar, EN QUÉ ORDEN y CUÁNTAS veces según la pregunta (que no conocemos de
// antemano): ese encadenamiento decidido por el modelo es el uso agéntico real.
//
// Diferencias con conversar() (el borde del pipeline de crédito):
//   · conversar = 1 extracción forzada → pipeline determinístico → 1 verbalización.
//   · chatAngela = loop agéntico multi-turno con tools de SOLO LECTURA. El modelo
//     razona libremente; NUNCA ejecuta acciones que muevan dinero (no las tiene).
//
// Usa el cliente del modo activo (gateway/anthropic) vía crearClienteLLM(). En
// mock no hay modelo real: el chat lo dice con claridad y no rompe nada.
// ============================================================================
import { crearClienteLLM } from './llm/index.js';
import { CHAT_TOOLS, ejecutarChatTool } from './chatTools.js';

const MAX_TURNS = 8;     // techo de encadenamiento de tools por pregunta
const MAX_TOKENS = 1600;

function systemPrompt({ entidadActivaId, entidadNombre, rol }) {
  const quien = entidadNombre
    ? `${entidadNombre}${rol ? ` (rol: ${rol})` : ''}, entidad id ${entidadActivaId}`
    : 'el dueño del negocio';
  return (
    'Sos Ángela, la asistente de crédito de PolFin. Ayudás a comercios y a la ' +
    'red a decidir a quién fiar y en qué condiciones, con reputación de crédito ' +
    'portable y verificable.\n\n' +
    `PERSPECTIVA: estás hablando con ${quien}. Cuando diga "mis clientes", "los ` +
    'que me deben", "mi cartera", se refiere a las operaciones donde esa entidad ' +
    'es la ACREEDORA. Respondé desde su lugar en la cadena; no le ofrezcas datos ' +
    'que no le corresponden.\n\n' +
    'ALCANCE — SOLO CONSULTA Y ANÁLISIS: tenés herramientas de LECTURA para mirar ' +
    'historial, score, cartera, deudas y tendencias. NO ejecutás NINGUNA acción que ' +
    'mueva dinero: no aprobás, no fías, no generás e-pagarés, no liquidás pagos ' +
    'desde este chat. Si te piden ejecutar algo así, NO lo hagas: explicá que eso ' +
    'va por el flujo formal (evaluar el crédito y el dueño lo aprueba con su OK — ' +
    'el approval gate), y ofrecé el análisis para que decida. El chat informa y ' +
    'analiza; no es un atajo de los controles.\n\n' +
    'NÚMEROS: toda cifra que digas (score, montos, tasas, % puntual, vencidos) sale ' +
    'de lo que devuelven las herramientas. NUNCA inventes ni estimes un número. Si ' +
    'no tenés el dato, decilo. Para resolver un nombre a su ID, usá buscarEntidades ' +
    'antes de consultar historial o score.\n\n' +
    'MÉTODO: elegí y encadená las herramientas que hagan falta (pueden ser varias) ' +
    'para fundamentar la respuesta. Si la pregunta pide comparar o rankear, traé los ' +
    'datos de todos los involucrados antes de concluir.\n\n' +
    'ESTILO: castellano rioplatense, cálido y directo. Respuestas breves pero ' +
    'completas, citando los números reales que sostienen lo que decís. Se lee en ' +
    'un panel angosto: escribí en frases y listas cortas con guiones; podés ' +
    'resaltar con **negrita**. Evitá tablas y encabezados markdown.'
  );
}

export async function chatAngela(db, { pregunta, entidadActivaId = null, entidadNombre = null, rol = null, historial = [] }) {
  const { client, model, nombre, modo } = crearClienteLLM();

  // Mock (sin modelo real): el chat abierto necesita un LLM. Se informa claro,
  // sin romper el backend ni el camino feliz del pipeline (que sí corre en mock).
  if (!client) {
    return {
      ok: false, modo, provider: nombre, tools_usadas: [], traza: [],
      respuesta:
        'El chat abierto de Ángela necesita un modelo real. Configurá LLM_MODE=gateway ' +
        '(o anthropic) y la API key en backend/.env, y volvé a preguntar.',
    };
  }

  const system = systemPrompt({ entidadActivaId, entidadNombre, rol });
  const messages = [];
  for (const t of (historial || []).slice(-6)) {
    if ((t.role === 'user' || t.role === 'assistant') && t.content) {
      messages.push({ role: t.role, content: String(t.content) });
    }
  }
  messages.push({ role: 'user', content: pregunta });

  const ctx = { entidadActivaId, rol, nombre: entidadNombre };
  const toolsUsadas = [];
  const traza = [];

  try {
    for (let i = 0; i < MAX_TURNS; i++) {
      const resp = await client.messages.create({
        model, max_tokens: MAX_TOKENS, system, tools: CHAT_TOOLS, messages,
      });

      if (resp.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: resp.content });
        const toolResults = [];
        for (const block of resp.content) {
          if (block.type === 'tool_use') {
            toolsUsadas.push(block.name);
            const out = ejecutarChatTool(db, block.name, block.input || {}, ctx);
            traza.push({ tool: block.name, input: block.input || {} });
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out) });
          }
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      const texto = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      return { ok: true, modo, provider: nombre, respuesta: texto, tools_usadas: toolsUsadas, traza };
    }

    return {
      ok: true, modo, provider: nombre, tools_usadas: toolsUsadas, traza,
      respuesta: 'Di muchas vueltas con esa consulta. ¿La podés acotar un poco?',
    };
  } catch (e) {
    console.error(`[chat] Falló el chat de Ángela (${nombre}): ${e.message}`);
    return {
      ok: false, modo, provider: nombre, tools_usadas: toolsUsadas, traza,
      respuesta: 'Se me cortó la consulta al modelo. Probá de nuevo en un momento.',
      error_tecnico: String(e.message || e),
    };
  }
}
