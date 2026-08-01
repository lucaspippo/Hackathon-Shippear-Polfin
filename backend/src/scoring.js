// ============================================================================
// PolFin — Motor de scoring (Prompt 2, sección 3 del doc maestro)
// ----------------------------------------------------------------------------
// Puro algoritmo determinístico sobre las transacciones verificables de la DB.
// Nada de LLM, nada de on-chain, nada hardcodeado por entidad.
//
// Score 0–1000 = suma de 5 factores ponderados (cada factor vale 0..1):
//   puntualidad 35% · historial 15% · volumen 15% · diversidad 20% · tendencia 15%
//
// Decisiones de diseño (defendibles ante jurado):
//  · Pagar tarde nunca vale más que CASTIGO_ATRASO (0.6): la puntualidad se
//    premia fuerte, y el valor decae linealmente hasta 0 a los 45 días de atraso.
//  · Una deuda vencida impaga vale 0 en calidad (peor que pagar tarde).
//  · Poca evidencia amortigua: con menos de 6 operaciones cerradas, la
//    puntualidad y la tendencia se corren hacia 0.5 (neutro). Así el thin file
//    no puntúa como estrella por 3 pagos puntuales (el problema que PolFin
//    le explica al jurado: sin historial no hay confianza).
//  · Diversidad = comercios con buen comportamiento SOSTENIDO (≥60% puntual,
//    sin vencidas). Premia la portabilidad — el corazón de PolFin.
//  · Tendencia = calidad de pago ponderada por recencia (semivida 9 meses):
//    lo último pesa más que lo viejo.
// ============================================================================

export const PESOS = {
  puntualidad: 0.35,
  historial: 0.15,
  volumen: 0.15,
  diversidad: 0.20,
  tendencia: 0.15,
};

const CASTIGO_ATRASO = 0.6;        // techo de calidad para un pago fuera de fecha
const ATRASO_CERO_DIAS = 45;       // a los 45 días de atraso, la operación vale 0
const EVIDENCIA_PLENA = 6;         // operaciones cerradas para confiar del todo
const SEMIVIDA_TENDENCIA_DIAS = 270;
const ANTIGUEDAD_PLENA_MESES = 24; // 2 años de historial = factor lleno
const CERRADAS_OK_PLENAS = 20;     // 20 operaciones pagadas = factor lleno
const VOLUMEN_PISO = 50_000;       // $50k → 0 ; escala logarítmica
const VOLUMEN_TECHO = 10_000_000;  // $10M → 1
const DIVERSIDAD_PLENA = 5;        // 5 comercios con buen comportamiento = 1.0
const DIA_MS = 24 * 60 * 60 * 1000;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const dias = (desde, hasta) => Math.round((hasta - desde) / DIA_MS);
const fecha = (s) => new Date(`${s}T00:00:00Z`);
const pesosAr = (n) => "$" + Math.round(n).toLocaleString("es-AR");

// Calidad de pago de UNA operación cerrada (pagada o vencida), en 0..1.
function calidadTx(tx) {
  if (tx.estado === "vencida") return 0;
  const atraso = dias(fecha(tx.fecha_vencimiento), fecha(tx.fecha_pago_real));
  if (atraso <= 0) return 1;
  return CASTIGO_ATRASO * clamp01(1 - atraso / ATRASO_CERO_DIAS);
}

// Con poca evidencia, el valor se corre hacia 0.5 (neutro).
const amortiguar = (valor, nCerradas) =>
  0.5 + (valor - 0.5) * Math.min(1, nCerradas / EVIDENCIA_PLENA);

export function calcularScore(db, entidadId, hoy = new Date()) {
  const ent = db.prepare("SELECT * FROM entidades WHERE id = ?").get(entidadId);
  if (!ent) return null;

  const txs = db.prepare(`
    SELECT t.*, e.nombre AS acreedor_nombre
    FROM transacciones t JOIN entidades e ON e.id = t.acreedor_id
    WHERE t.deudor_id = ? ORDER BY t.fecha_emision
  `).all(entidadId);

  const macro = db.prepare(
    "SELECT * FROM macro_referencia ORDER BY mes DESC LIMIT 1"
  ).get() ?? { tasa_referencia_tna: 29, mes: "s/d" };

  if (txs.length === 0) {
    return {
      entidad: { id: ent.id, nombre: ent.nombre, tipo: ent.tipo },
      score: null,
      explicacion: `${ent.nombre} no tiene historial verificable como deudor en la red. Sin operaciones registradas no hay score: PolFin solo puntúa comportamiento comprobable.`,
      desglose: [],
      condiciones: condicionesPara(null, macro, null),
      metricas: { operaciones: 0 },
    };
  }

  // ------------------------------------------------------------- métricas base
  const cerradas = txs.filter((t) => t.estado === "pagada" || t.estado === "vencida");
  const pagadas = txs.filter((t) => t.estado === "pagada");
  const vencidas = txs.filter((t) => t.estado === "vencida");
  const pendientes = txs.filter((t) => t.estado === "pendiente");
  const puntuales = pagadas.filter((t) => t.fecha_pago_real <= t.fecha_vencimiento);
  const tardias = pagadas.filter((t) => t.fecha_pago_real > t.fecha_vencimiento);
  const atrasoProm = tardias.length
    ? tardias.reduce((s, t) => s + dias(fecha(t.fecha_vencimiento), fecha(t.fecha_pago_real)), 0) / tardias.length
    : 0;
  const montoPagado = pagadas.reduce((s, t) => s + t.monto, 0);
  const mesesAntiguedad = Math.max(0, dias(fecha(txs[0].fecha_emision), hoy) / 30.44);

  // comercios con buen comportamiento sostenido (la portabilidad)
  const porComercio = new Map();
  for (const t of cerradas) {
    if (!porComercio.has(t.acreedor_id)) {
      porComercio.set(t.acreedor_id, { nombre: t.acreedor_nombre, pagadas: 0, puntuales: 0, vencidas: 0 });
    }
    const c = porComercio.get(t.acreedor_id);
    if (t.estado === "vencida") c.vencidas++;
    else {
      c.pagadas++;
      if (t.fecha_pago_real <= t.fecha_vencimiento) c.puntuales++;
    }
  }
  const comerciosBuenos = [...porComercio.values()].filter(
    (c) => c.pagadas >= 1 && c.vencidas === 0 && c.puntuales / c.pagadas >= 0.6
  );
  const comerciosOperados = porComercio.size;

  // mediana de monto de los últimos 12 meses (para el límite sugerido)
  const hace12m = new Date(hoy.getTime() - 365 * DIA_MS);
  const recientes = txs.filter((t) => fecha(t.fecha_emision) >= hace12m);
  const base12m = (recientes.length ? recientes : txs).map((t) => t.monto).sort((a, b) => a - b);
  const medianaMonto = base12m[Math.floor(base12m.length / 2)];

  // ------------------------------------------------------------- los 5 factores
  const calidadMedia = cerradas.length
    ? cerradas.reduce((s, t) => s + calidadTx(t), 0) / cerradas.length
    : 0.5;
  const fPuntualidad = amortiguar(calidadMedia, cerradas.length);

  const fHistorial =
    0.5 * clamp01(mesesAntiguedad / ANTIGUEDAD_PLENA_MESES) +
    0.5 * clamp01(pagadas.length / CERRADAS_OK_PLENAS);

  const fVolumen = montoPagado <= 0 ? 0 : clamp01(
    (Math.log10(montoPagado) - Math.log10(VOLUMEN_PISO)) /
    (Math.log10(VOLUMEN_TECHO) - Math.log10(VOLUMEN_PISO))
  );

  const fDiversidad = clamp01(comerciosBuenos.length / DIVERSIDAD_PLENA);

  // calidad ponderada por recencia (lo nuevo pesa más) + delta para el relato
  let wSum = 0, wq = 0;
  let qRec = { s: 0, n: 0 }, qViejo = { s: 0, n: 0 };
  const hace180 = new Date(hoy.getTime() - 180 * DIA_MS);
  for (const t of cerradas) {
    const edad = Math.max(0, dias(fecha(t.fecha_vencimiento), hoy));
    const w = Math.pow(0.5, edad / SEMIVIDA_TENDENCIA_DIAS);
    const q = calidadTx(t);
    wSum += w; wq += w * q;
    if (fecha(t.fecha_vencimiento) >= hace180) { qRec.s += q; qRec.n++; }
    else { qViejo.s += q; qViejo.n++; }
  }
  const fTendencia = amortiguar(wSum ? wq / wSum : 0.5, cerradas.length);
  let tendenciaLabel = "estable";
  if (qRec.n >= 2 && qViejo.n >= 2) {
    const delta = qRec.s / qRec.n - qViejo.s / qViejo.n;
    if (delta > 0.08) tendenciaLabel = "mejorando";
    else if (delta < -0.08) tendenciaLabel = "empeorando";
  } else if (qViejo.n < 2) {
    tendenciaLabel = "historial demasiado corto para medir tendencia";
  }

  // ------------------------------------------------------------------- el score
  const factores = {
    puntualidad: fPuntualidad,
    historial: fHistorial,
    volumen: fVolumen,
    diversidad: fDiversidad,
    tendencia: fTendencia,
  };
  const score = Math.round(
    1000 * Object.entries(PESOS).reduce((s, [k, w]) => s + w * factores[k], 0)
  );

  const pctPuntual = pagadas.length
    ? Math.round((100 * puntuales.length) / pagadas.length) : null;

  const desglose = [
    {
      factor: "puntualidad", peso: PESOS.puntualidad,
      valor: +fPuntualidad.toFixed(3), aporte: Math.round(1000 * PESOS.puntualidad * fPuntualidad), maximo: 350,
      detalle: `${puntuales.length}/${pagadas.length} pagos en fecha (${pctPuntual ?? 0}%)` +
        (tardias.length ? `, atraso promedio ${atrasoProm.toFixed(0)} días` : "") +
        (vencidas.length ? `, ${vencidas.length} vencida(s) impaga(s)` : "") +
        (cerradas.length < EVIDENCIA_PLENA ? ` — amortiguado por poca evidencia (${cerradas.length} cerradas)` : ""),
    },
    {
      factor: "historial", peso: PESOS.historial,
      valor: +fHistorial.toFixed(3), aporte: Math.round(1000 * PESOS.historial * fHistorial), maximo: 150,
      detalle: `${mesesAntiguedad.toFixed(0)} meses en la red, ${pagadas.length} operaciones cerradas OK`,
    },
    {
      factor: "volumen", peso: PESOS.volumen,
      valor: +fVolumen.toFixed(3), aporte: Math.round(1000 * PESOS.volumen * fVolumen), maximo: 150,
      detalle: `${pesosAr(montoPagado)} operados y pagados (escala log ${pesosAr(VOLUMEN_PISO)}–${pesosAr(VOLUMEN_TECHO)})`,
    },
    {
      factor: "diversidad", peso: PESOS.diversidad,
      valor: +fDiversidad.toFixed(3), aporte: Math.round(1000 * PESOS.diversidad * fDiversidad), maximo: 200,
      detalle: `buen comportamiento sostenido en ${comerciosBuenos.length} de ${comerciosOperados} comercios donde opera` +
        (comerciosBuenos.length ? `: ${comerciosBuenos.map((c) => c.nombre).join(", ")}` : ""),
    },
    {
      factor: "tendencia", peso: PESOS.tendencia,
      valor: +fTendencia.toFixed(3), aporte: Math.round(1000 * PESOS.tendencia * fTendencia), maximo: 150,
      detalle: `calidad de pago ponderada por recencia (semivida 9 meses); tendencia: ${tendenciaLabel}`,
    },
  ];

  const condiciones = condicionesPara(score, macro, medianaMonto);
  const explicacion = armarExplicacion({
    ent, score, condiciones, cerradas, pagadas, vencidas, puntuales,
    pctPuntual, atrasoProm, comerciosBuenos, mesesAntiguedad, montoPagado, tendenciaLabel,
  });

  return {
    entidad: { id: ent.id, nombre: ent.nombre, tipo: ent.tipo, rol_cadena: ent.rol_cadena },
    score,
    explicacion,
    desglose,
    condiciones,
    metricas: {
      operaciones: txs.length,
      cerradas: cerradas.length,
      pagadas: pagadas.length,
      puntuales: puntuales.length,
      vencidas_impagas: vencidas.length,
      pendientes: pendientes.length,
      pct_puntual: pctPuntual,
      atraso_promedio_dias: +atrasoProm.toFixed(1),
      monto_pagado: montoPagado,
      meses_antiguedad: +mesesAntiguedad.toFixed(1),
      comercios_operados: comerciosOperados,
      comercios_con_buen_comportamiento: comerciosBuenos.length,
      mediana_monto_12m: medianaMonto,
    },
  };
}

// ------------------------------------------------- score → condiciones (tabla §3)
// La tasa parte de la base macro (última tasa de referencia TNA) + recargo en
// puntos porcentuales según riesgo. El límite se ancla en la mediana de compra
// de los últimos 12 meses (qué tamaño de operación es "normal" para esta persona).
const BANDAS = [
  { min: 800, riesgo: "muy bajo",  recargo_pp: 0,    plazo_max_dias: 90, limite: "alto",        mult: 3.0 },
  { min: 600, riesgo: "bajo",      recargo_pp: 5,    plazo_max_dias: 60, limite: "medio-alto",  mult: 2.0 },
  { min: 400, riesgo: "medio",     recargo_pp: 12,   plazo_max_dias: 30, limite: "medio",       mult: 1.0 },
  { min: 200, riesgo: "alto",      recargo_pp: 25,   plazo_max_dias: 15, limite: "bajo",        mult: 0.4 },
  { min: 0,   riesgo: "muy alto",  recargo_pp: null, plazo_max_dias: 0,  limite: "sin crédito", mult: 0 },
];

export function condicionesPara(score, macro, medianaMonto) {
  if (score === null) {
    return {
      riesgo: "sin datos",
      decision: "sin historial verificable: pedir garantía o arrancar con contado/montos mínimos",
      tasa_base_tna: macro.tasa_referencia_tna,
      tasa_sugerida_tna: null,
      recargo_pp: null,
      plazo_max_dias: 0,
      limite_categoria: "sin crédito",
      limite_sugerido_pesos: 0,
      macro_mes: macro.mes,
    };
  }
  const b = BANDAS.find((x) => score >= x.min);
  const rechazo = b.recargo_pp === null;
  const limitePesos = rechazo || !medianaMonto
    ? 0
    : Math.round((b.mult * medianaMonto) / 1000) * 1000;
  return {
    riesgo: b.riesgo,
    decision: rechazo
      ? "rechazar el crédito u operar solo de contado"
      : `fiar hasta ${pesosAr(limitePesos)} a ${b.plazo_max_dias} días máximo`,
    tasa_base_tna: macro.tasa_referencia_tna,
    tasa_sugerida_tna: rechazo ? null : +(macro.tasa_referencia_tna + b.recargo_pp).toFixed(1),
    recargo_pp: b.recargo_pp,
    plazo_max_dias: b.plazo_max_dias,
    limite_categoria: b.limite,
    limite_sugerido_pesos: limitePesos,
    macro_mes: macro.mes,
  };
}

// ------------------------------------------------------- explicación en natural
function armarExplicacion(x) {
  const p = [];
  p.push(`Score ${x.score} — riesgo ${x.condiciones.riesgo}.`);

  if (x.cerradas.length < EVIDENCIA_PLENA) {
    p.push(`Historial corto: solo ${x.cerradas.length} operaciones cerradas en ${Math.max(1, Math.round(x.mesesAntiguedad))} mes(es), así que el score está amortiguado por falta de evidencia.`);
  }
  if (x.pagadas.length) {
    let s = `Paga en fecha el ${x.pctPuntual}% de sus operaciones (${x.puntuales.length}/${x.pagadas.length})`;
    if (x.atrasoProm > 0) s += `, con atraso promedio de ${x.atrasoProm.toFixed(0)} días cuando se pasa`;
    s += ".";
    p.push(s);
  }
  if (x.vencidas.length) {
    p.push(`Tiene ${x.vencidas.length} deuda(s) vencida(s) sin pagar — la señal más grave del perfil.`);
  }
  const nB = x.comerciosBuenos.length;
  if (nB >= 2) {
    p.push(`Buen comportamiento sostenido en ${nB} comercios distintos (${x.comerciosBuenos.map((c) => c.nombre).join(", ")}): reputación portable, verificada en toda la red.`);
  } else if (nB === 1) {
    p.push(`Su buen comportamiento está concentrado en un solo comercio (${x.comerciosBuenos[0].nombre}): todavía no es una reputación portable.`);
  } else {
    p.push("No sostiene buen comportamiento en ningún comercio de la red.");
  }
  if (x.cerradas.length >= EVIDENCIA_PLENA) {
    p.push(`Opera hace ${Math.round(x.mesesAntiguedad)} meses con ${pesosAr(x.montoPagado)} ya pagados. Tendencia reciente: ${x.tendenciaLabel}.`);
  }
  return p.join(" ");
}
