// ============================================================================
// PolFin — Lectura macro: el contexto del país ajusta la POLÍTICA de crédito.
// ----------------------------------------------------------------------------
// Ángela lee `contexto_macro.json` (indicadores REALES de Argentina) y ajusta
// PLAZO y SPREAD sobre la tasa base — NUNCA el score. El score sale de la
// fórmula determinística (scoring.js); la macro solo decide cuánto conviene
// exponerse dado el país. El cliente bueno sigue siendo bueno.
//
// Reglas: se evalúan los `reglas_ajuste_dinamico` del archivo contra los
// indicadores observados y (opcional) el sector del deudor. Todo determinístico
// y auditable — ningún LLM decide acá.
//
// NEUTRALIDAD (regla crítica, viene en _meta.neutralidad): se leen indicadores
// objetivos y se habla de RIESGO, nunca de política. El system prompt del chat
// la refuerza.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MACRO_PATH = process.env.POLFIN_MACRO_PATH
  || path.join(__dirname, '..', 'contexto_macro.json');

let _cache = null;

/** Carga (y cachea) el contexto macro. Si el archivo falta, devuelve null y el
 *  resto del sistema sigue con la política base (sin ajuste). */
export function cargarContextoMacro() {
  if (_cache !== null) return _cache || null;
  try {
    _cache = JSON.parse(readFileSync(MACRO_PATH, 'utf8'));
  } catch (e) {
    console.error(`[macro] no pude leer ${MACRO_PATH}: ${e.message} — sigo con política base.`);
    _cache = false;
  }
  return _cache || null;
}

// Mapea el rubro de una entidad a un sector macro (para las reglas por sector).
export function sectorDeRubro(rubro, tipo) {
  if (tipo === 'persona') return 'consumo';
  const r = (rubro || '').toLowerCase();
  if (/(construc|materiales|corral|bulon|herraj|pintur|sanitari|ferret)/.test(r)) return 'construccion';
  if (/(agro|semilla|cereal|campo|rural|fertiliz)/.test(r)) return 'agro';
  if (/(energ|combustible|gas|petrol|electric)/.test(r)) return 'energia';
  if (/(min|metal|acero)/.test(r)) return 'mineria';
  if (/(industri|fabric|manufactur|planta)/.test(r)) return 'industria';
  // alimentos, kiosco, limpieza, bebidas, almacén… = comercio/consumo masivo
  return 'comercio';
}

const SECTOR_DINAMICO = new Set(['agro', 'energia', 'mineria']);
const SECTOR_CONTRACCION = new Set(['industria', 'comercio', 'construccion', 'pesca']);

/**
 * Evalúa la política de crédito para el contexto actual + (opcional) el sector
 * del deudor. Devuelve deltas que ajustan plazo y spread, las reglas que se
 * activaron (para explicar), y los indicadores clave citables.
 *
 * @returns {{
 *   disponible: boolean,
 *   tasa_base_tna: number, techo_tasa_tna: number,
 *   plazo_base_dias: number, plazo_extensible_dias: number,
 *   spread_delta_pp: number, plazo_delta_dias: number,
 *   sector: string, sesgo: string, resumen: string,
 *   reglas_activas: {condicion:string, accion:string, nota:string}[],
 *   indicadores: object,
 * }}
 */
export function evaluarPoliticaMacro({ rubro = null, tipo = null } = {}) {
  const m = cargarContextoMacro();
  const sector = sectorDeRubro(rubro, tipo);

  // Fallback si no hay archivo: política base sin ajuste, sobre la tasa vieja.
  if (!m) {
    return {
      disponible: false,
      tasa_base_tna: 29, techo_tasa_tna: 29,
      plazo_base_dias: 60, plazo_extensible_dias: 90,
      spread_delta_pp: 0, plazo_delta_dias: 0,
      sector, sesgo: 'sin datos macro', resumen: 'Sin contexto macro cargado: política base.',
      reglas_activas: [], indicadores: {},
    };
  }

  const pol = m.politica_credito_comercial || {};
  const inflMensual = m.inflacion?.ipc_mensual?.valor_pct ?? 2;
  const inflMensualTend = m.inflacion?.ipc_mensual?.tendencia ?? 'estable';
  const inflInteranual = m.inflacion?.ipc_interanual?.valor_pct ?? 40;
  const tamar = m.tasas_interes?.tamar_mayorista_tna?.valor_pct ?? 29;
  const techoTasa = m.tasas_interes?.descuento_cheques_pyme_tna?.valor_pct ?? 40;
  const riesgoPais = m.riesgo_pais_financiero?.riesgo_pais_embi_pb?.valor ?? 500;
  const moraPriv = m.riesgo_credito?.mora_sector_privado_pct?.valor_pct ?? 5;
  const dolarMay = m.tipo_de_cambio?.dolar_mayorista?.valor ?? null;
  const techoBanda = m.tipo_de_cambio?.techo_banda_aprox?.valor ?? null;
  const distanciaTechoPct = dolarMay && techoBanda ? ((techoBanda - dolarMay) / techoBanda) * 100 : null;

  const plazoBase = pol.plazo_base_dias ?? 60;
  const plazoExt = pol.plazo_extensible_dias ?? 90;

  let spread = 0;      // pp sobre la tasa base
  let plazoDelta = 0;  // días sobre el plazo base
  const activas = [];
  const activar = (condicion, accion, nota) => activas.push({ condicion, accion, nota });

  // ---- reglas_ajuste_dinamico (del archivo), evaluadas contra los indicadores ----
  if (inflMensual > 2.5) {
    plazoDelta -= 20; spread += 3;
    activar('inflación mensual > 2.5%', 'acortar plazos y subir spread por licuación',
      `IPC mensual ${inflMensual}% — la inflación alta licúa el crédito a plazo.`);
  } else if (inflMensual < 1.5) {
    plazoDelta += 30;
    activar('inflación mensual < 1.5% sostenida', 'habilitar plazos de 90-120 días',
      `IPC mensual ${inflMensual}% — desinflación consolidada, hay margen para plazos largos.`);
  } else {
    // zona intermedia con tendencia descendente = desinflación en curso: neutral,
    // el plazo base ya es competitivo. Se cita como contexto, sin castigo.
    activar('inflación mensual entre 1.5% y 2.5%',
      inflMensualTend === 'descendente' ? 'sostener el plazo base competitivo (desinflación en curso)' : 'sostener el plazo base',
      `IPC mensual ${inflMensual}% (${inflMensualTend}) — plazos de ${plazoBase}-${plazoExt} días razonables para buenos deudores.`);
  }

  const dolarCerca = distanciaTechoPct !== null && distanciaTechoPct < 5;
  if (riesgoPais > 600 || dolarCerca) {
    plazoDelta -= 15; spread += 2;
    activar('riesgo país > 600 pb o dólar a <5% del techo de banda', 'endurecer crédito: acortar plazos, subir spread',
      `Riesgo país ${riesgoPais} pb` + (dolarCerca ? ` y dólar cerca del techo de banda` : '') + ' — más cautela.');
  }

  if (moraPriv > 9) {
    plazoDelta -= 10; spread += 1;
    activar('mora del sector privado > 9%', 'aumentar previsiones y acortar plazos',
      `Mora del sistema ${moraPriv}% — señal de estrés en la cadena de pagos.`);
  } else if (moraPriv >= 6) {
    // elevada pero por debajo del umbral duro: cautela leve, se cita.
    activar('mora del sector privado elevada (6-9%)', 'cautela moderada',
      `Mora del sistema ${moraPriv}% (${m.riesgo_credito?.mora_sector_privado_pct?.tendencia ?? ''}) — vigilar sin endurecer.`);
  }

  if (inflInteranual < 20) {
    plazoDelta += 10;
    activar('inflación interanual < 20%', 'migrar a plazos estructuralmente más largos y tasas reales positivas',
      `Inflación interanual ${inflInteranual}% — régimen de tasas reales positivas estables.`);
  }

  // ---- ajuste por sector del deudor ----
  if (SECTOR_CONTRACCION.has(sector)) {
    plazoDelta -= 15; spread += 2;
    activar(`sector del deudor en contracción (${sector})`, 'mayor cautela: plazo más corto o spread más alto',
      `El sector ${sector} viene en contracción según INDEC — ponderar más riesgo.`);
  } else if (SECTOR_DINAMICO.has(sector)) {
    plazoDelta += 15; spread -= 1;
    activar(`sector del deudor dinámico (${sector})`, 'mayor apertura: plazo extensible, spread menor',
      `El sector ${sector} crece según INDEC — hay espacio para más plazo.`);
  }

  return {
    disponible: true,
    tasa_base_tna: tamar, techo_tasa_tna: techoTasa,
    plazo_base_dias: plazoBase, plazo_extensible_dias: plazoExt,
    spread_delta_pp: spread, plazo_delta_dias: plazoDelta,
    sector,
    sesgo: pol.lectura_actual?.sesgo ?? '',
    resumen: pol.lectura_actual?.resumen ?? '',
    reglas_activas: activas,
    indicadores: {
      inflacion_mensual_pct: inflMensual,
      inflacion_mensual_tendencia: inflMensualTend,
      inflacion_interanual_pct: inflInteranual,
      tamar_tna: tamar,
      techo_tasa_pyme_tna: techoTasa,
      riesgo_pais_pb: riesgoPais,
      mora_sector_privado_pct: moraPriv,
      dolar_mayorista: dolarMay,
      distancia_techo_banda_pct: distanciaTechoPct !== null ? +distanciaTechoPct.toFixed(1) : null,
      fecha_corte: m._meta?.fecha_corte ?? null,
    },
  };
}

/** Vista pública del contexto macro para la UI y el chat (incluye la lectura
 *  actual y la regla de neutralidad). */
export function contextoMacroPublico() {
  const m = cargarContextoMacro();
  if (!m) return { disponible: false };
  const ajuste = evaluarPoliticaMacro({});
  return {
    disponible: true,
    fecha_corte: m._meta?.fecha_corte ?? null,
    neutralidad: m._meta?.neutralidad ?? null,
    regla_de_uso: m._meta?.regla_de_uso ?? null,
    indicadores: ajuste.indicadores,
    sesgo: ajuste.sesgo,
    resumen: ajuste.resumen,
    politica: {
      tasa_base_tna: ajuste.tasa_base_tna,
      techo_tasa_tna: ajuste.techo_tasa_tna,
      plazo_base_dias: ajuste.plazo_base_dias,
      plazo_extensible_dias: ajuste.plazo_extensible_dias,
    },
    reglas_activas_contexto: ajuste.reglas_activas, // sin sector
  };
}

/** Frase natural y NEUTRAL que explica el ajuste macro de una operación,
 *  citando indicadores reales. Sin juicios políticos. */
export function notaMacroNatural(ajuste) {
  if (!ajuste?.disponible) return null;
  const i = ajuste.indicadores;
  const partes = [];
  partes.push(`tasa base TAMAR ${i.tamar_tna}% TNA`);
  if (i.inflacion_mensual_pct != null) {
    partes.push(`inflación mensual ${i.inflacion_mensual_pct}% (${i.inflacion_mensual_tendencia})`);
  }
  if (ajuste.plazo_delta_dias > 0) partes.push(`el contexto habilita estirar el plazo`);
  else if (ajuste.plazo_delta_dias < 0) partes.push(`el contexto sugiere acortar el plazo`);
  if (ajuste.spread_delta_pp > 0) partes.push(`con un poco más de spread por riesgo de contexto`);
  return `Plazo y tasa consideran el contexto macro: ${partes.join(', ')}.`;
}
