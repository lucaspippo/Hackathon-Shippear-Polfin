// ============================================================================
// Provider "con forma de Anthropic" — la lógica compartida de los dos bordes.
// ----------------------------------------------------------------------------
// El AnthropicProvider directo y el GatewayProvider (Vercel AI Gateway) hacen
// EXACTAMENTE lo mismo: hablan la Messages API de Anthropic. Lo único que cambia
// entre ellos es CÓMO se construye el cliente y QUÉ modelo se nombra:
//   · anthropic  → new Anthropic()                       + 'claude-opus-5'
//   · gateway    → new Anthropic({ apiKey, baseURL: … })  + 'anthropic/claude-opus-5'
//
// Por eso la lógica de los bordes vive UNA sola vez acá y ambos la reusan
// pasando su cliente ya configurado. Así, si mañana el Gateway cambia el string
// del modelo o el baseURL, no se toca la lógica; y un fix en la extracción o la
// verbalización beneficia a los dos modos por igual.
//
// Contrato (idéntico al de mock.js):
//   extraerPedido({texto, entidades}) → {deudorId, acreedorId, monto} | null
//   verbalizar({resultado})           → string (sin números nuevos)
//
// GARANTÍA: ningún número de decisión (score, tasa, plazo, límite) nace acá.
// La ENTRADA solo mapea texto → parámetros vía tool use FORZADO; la SALIDA solo
// cuenta en castellano lo que el pipeline determinístico ya calculó.
// ============================================================================

export function crearProviderAnthropicShaped({ client, model, nombre }) {
  return {
    nombre,

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
