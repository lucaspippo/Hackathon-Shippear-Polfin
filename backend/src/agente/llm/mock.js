// ============================================================================
// MockProvider — los BORDES conversacionales, sin API key.
// ----------------------------------------------------------------------------
// Tras el refactor, el provider ya NO orquesta nada: el pipeline de crédito
// es una máquina de estados determinística (pipelineCredito.js). Acá quedan
// solo los dos bordes:
//   · extraerPedido: interpreta la frase con un matcher determinístico
//     (nombres de entidades reales + monto) — mismo contrato que el LLM real.
//   · verbalizar: repite la verbalización determinística que ya produjo el
//     pipeline. CERO números nuevos.
//
// GARANTÍA: este módulo no calcula ni altera ningún número de decisión.
// ============================================================================

const sinAcentos = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function crearMockProvider() {
  return {
    nombre: 'mock (bordes determinísticos, sin API key)',

    // texto → { deudorId, acreedorId, monto } | null
    // Heurística documentada: la primera entidad mencionada es el deudor
    // (quien pide), la segunda el acreedor (donde pide). El monto es el
    // primer número estilo $180.000 del texto.
    async extraerPedido({ texto, entidades }) {
      const t = sinAcentos(texto);

      const menciones = entidades
        .map((e) => {
          // matchea nombre completo o cualquier palabra distintiva (>3 letras)
          const palabras = sinAcentos(e.nombre).split(/\s+/).filter((w) => w.length > 3);
          let pos = -1;
          if (t.includes(sinAcentos(e.nombre))) pos = t.indexOf(sinAcentos(e.nombre));
          else {
            for (const w of palabras) {
              const i = t.indexOf(w);
              if (i >= 0 && (pos < 0 || i < pos)) pos = i;
            }
          }
          return { e, pos };
        })
        .filter((m) => m.pos >= 0)
        .sort((a, b) => a.pos - b.pos);

      const montoMatch = texto.replace(/\./g, '').match(/\$?\s?(\d[\d]*)/);
      const monto = montoMatch ? Number(montoMatch[1]) : null;

      if (menciones.length < 2 || !monto) return null;
      return {
        deudorId: menciones[0].e.id,
        acreedorId: menciones[1].e.id,
        monto,
      };
    },

    // resultado del pipeline → texto. Passthrough de la verbalización
    // determinística: no se genera ni un número acá.
    async verbalizar({ resultado }) {
      return resultado.razonamiento;
    },
  };
}
