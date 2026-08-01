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
// GARANTÍA: ningún número de decisión (score, tasa, plazo, límite) nace acá.
// Si el LLM alucinara un número en la verbalización, no afecta la decisión:
// la decisión ya está persistida por el pipeline antes de llamar a este
// módulo, y la UI muestra los valores estructurados del pipeline, no los
// del texto.
//
// Para activar: ANTHROPIC_API_KEY=... y LLM_MODE=anthropic.
// ============================================================================
import Anthropic from '@anthropic-ai/sdk';

export function crearAnthropicProvider() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'LLM_MODE=anthropic pero falta ANTHROPIC_API_KEY. ' +
      'Seteala (o usá LLM_MODE=mock mientras tanto).'
    );
  }
  const client = new Anthropic(); // toma ANTHROPIC_API_KEY del entorno
  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

  return {
    nombre: `anthropic:${model}`,

    // ---------------- ENTRADA: texto → parámetros estructurados ----------------
    async extraerPedido({ texto, entidades }) {
      const lista = entidades.map((e) => `${e.id}: ${e.nombre} (${e.tipo}${e.rol_cadena ? ', ' + e.rol_cadena : ''})`).join('\n');
      const resp = await client.messages.create({
        model,
        max_tokens: 16000,
        system:
          'Extraés parámetros de pedidos de crédito comercial. NO evaluás, NO decidís, ' +
          'NO calculás nada: solo identificás quién pide (deudor), dónde pide (acreedor) ' +
          'y cuánto (monto en pesos), usando los IDs de la lista de entidades.\n\n' +
          'Entidades de la red:\n' + lista,
        tools: [{
          name: 'registrar_pedido',
          description: 'Registra los parámetros del pedido de crédito interpretado.',
          input_schema: {
            type: 'object',
            properties: {
              deudorId: { type: 'integer', description: 'ID de quien pide el crédito' },
              acreedorId: { type: 'integer', description: 'ID del comercio donde lo pide' },
              monto: { type: 'integer', description: 'Monto en pesos, sin puntos ni símbolos' },
            },
            required: ['deudorId', 'acreedorId', 'monto'],
          },
        }],
        // Forzamos la tool: la ÚNICA salida posible es el schema estructurado.
        tool_choice: { type: 'tool', name: 'registrar_pedido' },
        messages: [{ role: 'user', content: texto }],
      });
      if (resp.stop_reason === 'refusal') return null;
      const bloque = resp.content.find((b) => b.type === 'tool_use');
      return bloque ? bloque.input : null;
    },

    // ---------------- SALIDA: resultado calculado → texto ----------------
    async verbalizar({ resultado }) {
      // Le pasamos SOLO datos ya decididos por el pipeline determinístico.
      const datos = {
        estado: resultado.estado,
        deudor: resultado.deudor, acreedor: resultado.acreedor,
        monto: resultado.monto, score: resultado.score,
        condiciones: resultado.condiciones,
        instrumento: resultado.instrumento,
        pendiente_por: resultado.pendiente_por,
      };
      const resp = await client.messages.create({
        model,
        max_tokens: 16000,
        system:
          'Sos Ángela, la agente de crédito de PolFin. Contá la decisión del motor en ' +
          'castellano rioplatense, claro y directo.\n' +
          'REGLA INQUEBRANTABLE: todos los números (score, tasa, plazo, límite, montos) ' +
          'salen del JSON que te paso — la decisión YA está tomada por el motor ' +
          'determinístico. No inventes, redondees ni calcules ningún número nuevo. ' +
          'Si un dato no está en el JSON, no lo menciones.',
        messages: [{ role: 'user', content: `Resultado del pipeline:\n${JSON.stringify(datos, null, 2)}` }],
      });
      if (resp.stop_reason === 'refusal') return resultado.razonamiento;
      const texto = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      // Red de seguridad: si el LLM no devolvió texto, va la verbalización determinística.
      return texto || resultado.razonamiento;
    },
  };
}
