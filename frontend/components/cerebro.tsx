"use client";
// EL CEREBRO — una sola red que se re-centra según quién la mira.
// Capa de presentación pulida: nodos con identidad (forma por rol en la
// cadena, relleno por señal de riesgo, tamaño por volumen operado, etiqueta
// con backdrop), layout ordenado por eslabón (fábrica → consumidor, izquierda
// a derecha) con colisión anti-amontonamiento, y "vista de operación" en el
// panel izquierdo: resumen legible primero, exploración interactiva después.
// La lógica de datos, el pipeline y el agente NO se tocan acá.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { pesos, type EntidadDetalle, type Red, type Score } from "@/lib/api";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { forceCollide, forceX, forceY } from "d3-force-3d";
import type { Rol } from "@/lib/roles";
// el mismo lenguaje visual que usa el Mapa (formas/etiquetas por rol)
import { ROL_ETIQUETA as ETIQUETA_ROL } from "@/lib/roles-visual";
import { ArcoScore, Etiqueta, Pill, Punto, tonoRiesgo, useApi, useMedida } from "@/components/ui";
import type { ResultadoAgente } from "@/components/shell";

// react-force-graph es solo cliente (canvas + window)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false }) as any;

const NARANJA = "#ff6a00";
const ROJO = "#ff453a";
// señal de riesgo (la única licencia para verde/rojo) — apagados para el fondo negro
const RIESGO_OK = "#2fbf71";
const RIESGO_MEDIO = "#8e8e93";
const RIESGO_ALTO = "#ff453a";
const SIN_SCORE = "#4b4b52";

type NodoG = Red["nodos"][number] & { x?: number; y?: number; _monto?: number; _r?: number };

// posición objetivo por eslabón: la cadena se lee de izquierda a derecha
const X_POR_ROL: Record<string, number> = {
  fabrica: -430, distribuidora: -220, mayorista: -50, minorista: 150,
};
const xObjetivo = (n: NodoG) => (n.tipo === "persona" ? 380 : X_POR_ROL[n.rol_cadena ?? ""] ?? 0);

const colorRiesgo = (n: NodoG) => {
  if (n.score == null) return SIN_SCORE;
  if (n.riesgo === "muy bajo" || n.riesgo === "bajo") return RIESGO_OK;
  if (n.riesgo === "alto" || n.riesgo === "muy alto") return RIESGO_ALTO;
  return RIESGO_MEDIO;
};

// forma por rol en la cadena
function trazarForma(ctx: CanvasRenderingContext2D, n: NodoG, x: number, y: number, r: number) {
  ctx.beginPath();
  if (n.tipo === "persona") { ctx.arc(x, y, r, 0, 2 * Math.PI); return; }
  switch (n.rol_cadena) {
    case "fabrica": { // cuadrado redondeado
      const k = r * 0.92;
      ctx.roundRect(x - k, y - k, 2 * k, 2 * k, k * 0.3); return;
    }
    case "distribuidora": { // rombo
      ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.15, y);
      ctx.lineTo(x, y + r * 1.15); ctx.lineTo(x - r * 1.15, y); ctx.closePath(); return;
    }
    case "mayorista": { // triángulo
      ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.1, y + r * 0.85);
      ctx.lineTo(x - r * 1.1, y + r * 0.85); ctx.closePath(); return;
    }
    default: ctx.arc(x, y, r, 0, 2 * Math.PI); // minorista: círculo
  }
}

function GlifoRol({ rol, tipo }: { rol: string | null; tipo: string }) {
  const c = "currentColor";
  if (tipo === "persona") return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><circle cx="5" cy="5" r="3" fill={c} /></svg>;
  if (rol === "fabrica") return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill={c} /></svg>;
  if (rol === "distribuidora") return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M5 0.5 9.5 5 5 9.5 0.5 5Z" fill={c} /></svg>;
  if (rol === "mayorista") return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M5 0.8 9.4 8.8H0.6Z" fill={c} /></svg>;
  return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><circle cx="5" cy="5" r="4" fill={c} /></svg>;
}

export function Cerebro({
  rol, focal, setFocal, refresh, resultado,
}: {
  rol: Rol; focal: number; setFocal: (id: number) => void;
  refresh: number; resultado: ResultadoAgente;
}) {
  const { data: red } = useApi<Red>("/api/red", [refresh]);
  const { data: score } = useApi<Score>(`/api/score/${focal}`, [refresh]);
  const { data: detalle } = useApi<EntidadDetalle>(`/api/entidades/${focal}`, [refresh]);
  const { ref: cajaRef, w, h } = useMedida<HTMLDivElement>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const grafoRef = useRef<any>(null);
  const [pulso, setPulso] = useState(0);

  // graphData estable + tamaño por volumen operado (agregado client-side de
  // las aristas que ya llegan — presentación, no lógica nueva)
  const datos = useMemo(() => {
    if (!red) return null;
    const monto = new Map<number, number>();
    for (const a of red.aristas) {
      monto.set(a.source, (monto.get(a.source) ?? 0) + a.monto_total);
      monto.set(a.target, (monto.get(a.target) ?? 0) + a.monto_total);
    }
    const nodes = red.nodos.map((n) => {
      const m = monto.get(n.id) ?? 0;
      const r = n.tipo === "comercio"
        ? 5 + 2.1 * Math.max(0, Math.log10(Math.max(m, 1)) - 5.2)
        : 2.9 + 1.5 * Math.max(0, Math.log10(Math.max(m, 1)) - 4.6);
      return { ...n, _monto: m, _r: r };
    });
    return { nodes, links: red.aristas.map((a) => ({ ...a })) };
  }, [red]);

  // vecinos del focal (para iluminar el recorrido)
  const { vecinos, aristasFocal } = useMemo(() => {
    const v = new Set<number>([focal]);
    const af = new Set<string>();
    for (const a of red?.aristas ?? []) {
      if (a.source === focal || a.target === focal) {
        v.add(a.source); v.add(a.target);
        af.add(`${a.source}-${a.target}`);
      }
    }
    return { vecinos: v, aristasFocal: af };
  }, [red, focal]);

  // relaciones del focal (le vende a / le compra a)
  const relaciones = useMemo(() => {
    if (!red) return [];
    const porId = new Map(red.nodos.map((n) => [n.id, n]));
    const filas: { id: number; nombre: string; direccion: "le fío a" | "le compro a"; monto: number; n: number; vencidas: number }[] = [];
    for (const a of red.aristas) {
      if (a.source === focal) {
        const otro = porId.get(a.target);
        if (otro) filas.push({ id: otro.id, nombre: otro.nombre, direccion: "le fío a", monto: a.monto_total, n: a.n, vencidas: a.vencidas });
      } else if (a.target === focal) {
        const otro = porId.get(a.source);
        if (otro) filas.push({ id: otro.id, nombre: otro.nombre, direccion: "le compro a", monto: a.monto_total, n: a.n, vencidas: a.vencidas });
      }
    }
    return filas.sort((x, y) => y.monto - x.monto);
  }, [red, focal]);

  // vista de operación: números clave del focal (deudas vivas reales)
  const operacion = useMemo(() => {
    if (!detalle) return null;
    const vivasCobrar = detalle.como_acreedor.filter((t) => t.estado === "pendiente");
    const vencidasCobrar = detalle.como_acreedor.filter((t) => t.estado === "vencida");
    const vivasPagar = detalle.como_deudor.filter((t) => t.estado === "pendiente");
    return {
      porCobrar: vivasCobrar.reduce((s, t) => s + t.monto, 0),
      vencido: vencidasCobrar.reduce((s, t) => s + t.monto, 0),
      debe: vivasPagar.reduce((s, t) => s + t.monto, 0),
      clientes: new Set(detalle.como_acreedor.map((t) => t.deudor_id)).size,
      proveedores: new Set(detalle.como_deudor.map((t) => t.acreedor_id)).size,
    };
  }, [detalle]);

  // fuerzas: separación + colisión + orden por eslabón (se configura una vez por dataset)
  useEffect(() => {
    const fg = grafoRef.current;
    if (!fg || !datos) return;
    fg.d3Force("charge")?.strength(-130).distanceMax(340);
    fg.d3Force("link")?.distance((l: { source: NodoG; target: NodoG }) => {
      const s = l.source, t = l.target;
      return (s.tipo === "persona" || t.tipo === "persona") ? 34 : 85;
    });
    fg.d3Force("collide", forceCollide((n: NodoG) => (n._r ?? 4) + 3.5));
    fg.d3Force("x", forceX((n: NodoG) => xObjetivo(n)).strength(0.055));
    fg.d3Force("y", forceY(0).strength(0.035));
    fg.d3ReheatSimulation?.();
  }, [datos]);

  // re-centrar + animar cuando cambia el foco (el recorrido del agente)
  const enfocar = useCallback(() => {
    if (!datos) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPulso((p) => p + 1);
    let intentos = 0;
    const timer = setInterval(() => {
      const nodo = (datos.nodes as NodoG[]).find((n) => n.id === focal);
      if (nodo?.x != null && grafoRef.current) {
        grafoRef.current.centerAt(nodo.x, nodo.y, 900);
        grafoRef.current.zoom(2.3, 900);
        clearInterval(timer);
      }
      if (++intentos > 40) clearInterval(timer);
    }, 120);
  }, [datos, focal]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    enfocar();
  }, [enfocar]);

  const redCompleta = () => grafoRef.current?.zoomToFit(700, 60);

  const nodoFocal = red?.nodos.find((n) => n.id === focal);
  const esLinkFocal = (l: { source: number | { id: number }; target: number | { id: number } }) => {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    return aristasFocal.has(`${s}-${t}`);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* ------------------------------------------- panel de información */}
      <div className="w-[330px] shrink-0 overflow-y-auto border-r border-linea p-6">
        <Etiqueta>El Cerebro · nodo focal</Etiqueta>
        <h2 className="mt-1.5 text-[22px] font-semibold leading-tight tracking-tight">
          {nodoFocal?.nombre ?? "…"}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-tenue">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/6 px-2 py-0.5 text-tinta/85">
            <GlifoRol rol={nodoFocal?.rol_cadena ?? null} tipo={nodoFocal?.tipo ?? "comercio"} />
            {nodoFocal?.tipo === "persona" ? "Consumidor final" : ETIQUETA_ROL[nodoFocal?.rol_cadena ?? ""] ?? "Comercio"}
          </span>
          <span>{nodoFocal?.tipo === "persona" ? nodoFocal?.ciudad : `${nodoFocal?.rubro} · ${nodoFocal?.ciudad}`}</span>
        </div>

        {/* ---- VISTA DE OPERACIÓN: el resumen legible primero ---- */}
        <div className="mt-5 rounded-2xl border border-linea bg-carta p-4">
          <div className="flex items-center gap-4">
            <ArcoScore score={score?.score ?? null} riesgo={score?.condiciones.riesgo ?? null} tamano={104} />
            <div className="space-y-1.5">
              <Pill tono={tonoRiesgo(score?.condiciones.riesgo)}>
                <Punto tono={tonoRiesgo(score?.condiciones.riesgo)} />
                riesgo {score?.condiciones.riesgo ?? "—"}
              </Pill>
              {score?.score != null && (
                <div className="text-[11.5px] leading-relaxed text-tenue">
                  tasa <span className="num text-tinta">{score.condiciones.tasa_sugerida_tna ?? "—"}%</span> ·
                  plazo <span className="num text-tinta">{score.condiciones.plazo_max_dias}d</span><br />
                  límite <span className="num text-tinta">{pesos(score.condiciones.limite_sugerido_pesos)}</span>
                </div>
              )}
            </div>
          </div>

          {operacion && (
            <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-linea pt-3.5">
              <div>
                <Etiqueta>Opera con</Etiqueta>
                <div className="mt-0.5 text-[13px]">
                  {operacion.clientes > 0 && <>le vende a <span className="num">{operacion.clientes}</span></>}
                  {operacion.clientes > 0 && operacion.proveedores > 0 && <br />}
                  {operacion.proveedores > 0 && <>le compra a <span className="num">{operacion.proveedores}</span></>}
                </div>
              </div>
              <div>
                <Etiqueta>{nodoFocal?.tipo === "persona" ? "Debe vivo" : "Por cobrar vivo"}</Etiqueta>
                <div className="num mt-0.5 text-[15px] font-semibold">
                  {pesos(nodoFocal?.tipo === "persona" ? operacion.debe : operacion.porCobrar)}
                </div>
              </div>
              {nodoFocal?.tipo !== "persona" && (
                <div>
                  <Etiqueta>Debe vivo</Etiqueta>
                  <div className="num mt-0.5 text-[15px] font-semibold">{pesos(operacion.debe)}</div>
                </div>
              )}
              <div>
                <Etiqueta>Vencido sin cobrar{nodoFocal?.tipo === "persona" ? " (suyo)" : ""}</Etiqueta>
                <div className={`num mt-0.5 text-[15px] font-semibold ${operacion.vencido > 0 ? "text-mal" : "text-tenue"}`}>
                  {pesos(operacion.vencido)}
                </div>
              </div>
            </div>
          )}

          <button
            onClick={enfocar}
            className="mt-4 w-full rounded-full bg-brand/12 px-4 py-2 text-[13px] font-medium text-brand transition-colors hover:bg-brand/20"
          >
            Explorar en el Cerebro →
          </button>
        </div>

        {/* resultado del agente, si acaba de correr sobre este nodo */}
        {resultado && resultado.deudor.id === focal && (
          <div className="subiendo mt-4 rounded-xl border border-brand/40 bg-brand/8 p-3 text-[12px] leading-relaxed">
            <span className="font-semibold text-brand">Ángela recorrió esta red</span>{" "}
            y decidió: {resultado.estado === "aprobada" ? "aprobar y ejecutar"
              : resultado.estado === "pendiente_aprobacion" ? "aprobar, pendiente de tu OK"
              : "no aprobar"} el crédito de {pesos(resultado.monto)}.
          </div>
        )}

        {score?.explicacion && (
          <p className="mt-4 rounded-xl bg-carta p-3.5 text-[12.5px] leading-relaxed text-tinta/85">
            {score.explicacion}
          </p>
        )}

        {/* desglose del score */}
        {score?.desglose?.length ? (
          <div className="mt-5">
            <Etiqueta>Qué compone el score</Etiqueta>
            <div className="mt-2 space-y-2">
              {score.desglose.map((d) => (
                <div key={d.factor}>
                  <div className="flex justify-between text-[12px]">
                    <span className="capitalize">{d.factor}</span>
                    <span className="num text-tenue">{d.aporte}/{d.maximo}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-linea">
                    <div className="h-full rounded-full bg-brand/80 transition-all duration-700"
                      style={{ width: `${(d.aporte / d.maximo) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* con quién opera */}
        <div className="mt-6">
          <Etiqueta>Sus relaciones de crédito ({relaciones.length})</Etiqueta>
          <div className="mt-2 space-y-1">
            {relaciones.map((r) => (
              <button key={`${r.id}-${r.direccion}`} onClick={() => setFocal(r.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/4">
                <Punto tono={r.vencidas > 0 ? "mal" : "tenue"} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px]">{r.nombre}</span>
                  <span className="block text-[11px] text-tenue">{r.direccion} · {r.n} op.</span>
                </span>
                <span className="num ml-auto shrink-0 text-[12px] text-tenue">{pesos(r.monto)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* --------------------------------------------------- el grafo */}
      <div ref={cajaRef} className="relative min-w-0 flex-1 bg-ink">
        {/* chip flotante del score */}
        {score?.score != null && (
          <div key={pulso} className="subiendo pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 rounded-full border border-brand/40 bg-ink/85 px-4 py-2 backdrop-blur">
            <span className="text-[12px] text-tenue">{nodoFocal?.nombre}</span>{" "}
            <span className="num text-[15px] font-semibold text-brand">{score.score}</span>{" "}
            <span className="text-[11px] text-tenue">· riesgo {score.condiciones.riesgo}</span>
          </div>
        )}

        {/* controles de cámara */}
        <div className="absolute right-5 top-5 z-10 flex gap-2">
          <button onClick={redCompleta}
            className="rounded-full border border-linea bg-ink/80 px-3.5 py-1.5 text-[12px] text-tinta/85 backdrop-blur transition-colors hover:border-brand/50 hover:text-brand">
            ⤢ Toda la red
          </button>
          <button onClick={enfocar}
            className="rounded-full border border-linea bg-ink/80 px-3.5 py-1.5 text-[12px] text-tinta/85 backdrop-blur transition-colors hover:border-brand/50 hover:text-brand">
            ◎ Centrar foco
          </button>
        </div>

        {/* leyenda: formas por rol + señal de riesgo */}
        <div className="pointer-events-none absolute bottom-5 left-5 z-10 space-y-1.5 rounded-xl bg-ink/70 p-3 text-[11px] text-tenue backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-[3px] bg-tenue" /> fábrica</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rotate-45 bg-tenue" /> distribuidora</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-0 border-x-[5px] border-b-[9px] border-x-transparent border-b-tenue" /> mayorista</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full bg-tenue" /> minorista</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-1.5 rounded-full bg-tenue" /> consumidor</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ background: RIESGO_OK }} /> paga bien</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ background: RIESGO_ALTO }} /> riesgo / vencidas</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full bg-brand" /> foco y su círculo</span>
          </div>
          <div>la cadena fluye de izquierda (fábrica) a derecha (consumidor) · {red?.nodos.length ?? "…"} entidades · {red?.aristas.length ?? "…"} relaciones</div>
        </div>

        {datos && w > 0 && (
          <ForceGraph2D
            ref={grafoRef}
            width={w}
            height={h}
            graphData={datos}
            backgroundColor="#0a0a0b"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            nodeLabel={(n: any) => `${n.nombre}${n.score != null ? ` · score ${n.score}` : ""} · ${n.tipo === "persona" ? "consumidor" : ETIQUETA_ROL[n.rol_cadena] ?? ""}`}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onNodeClick={(n: any) => setFocal(n.id)}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            linkColor={(l: any) => (esLinkFocal(l) ? "rgba(255,106,0,0.7)" : "rgba(255,255,255,0.09)")}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            linkWidth={(l: any) => (esLinkFocal(l) ? 1.8 : Math.min(1.4, 0.4 + l.monto_total / 60_000_000))}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            linkDirectionalParticles={(l: any) => (esLinkFocal(l) ? 3 : 0)}
            linkDirectionalParticleWidth={2.6}
            linkDirectionalParticleSpeed={0.0065}
            linkDirectionalParticleColor={() => NARANJA}
            cooldownTicks={140}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            nodePointerAreaPaint={(n: any, color: string, ctx: CanvasRenderingContext2D) => {
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(n.x, n.y, (n._r ?? 4) + 4, 0, 2 * Math.PI);
              ctx.fill();
            }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            nodeCanvasObject={(n: any, ctx: CanvasRenderingContext2D, escala: number) => {
              const r = n._r ?? 4;
              const esFocal = n.id === focal;
              const esVecino = vecinos.has(n.id);

              ctx.save();
              if (!esFocal && !esVecino) ctx.globalAlpha = 0.42; // el resto respira atrás

              // halo del focal
              if (esFocal) {
                ctx.beginPath();
                ctx.arc(n.x, n.y, r + 8, 0, 2 * Math.PI);
                ctx.fillStyle = "rgba(255,106,0,0.16)";
                ctx.fill();
              }

              // el cuerpo: forma por rol, relleno por señal de riesgo
              trazarForma(ctx, n, n.x, n.y, r);
              ctx.fillStyle = esFocal ? NARANJA : colorRiesgo(n);
              ctx.fill();
              ctx.lineWidth = Math.max(0.5, r * 0.14);
              ctx.strokeStyle = esVecino && !esFocal ? NARANJA : "rgba(0,0,0,0.55)";
              ctx.stroke();

              // anillo rojo = crédito vencido impago (señal, siempre visible)
              if (n.vencidas > 0 && !esFocal) {
                ctx.beginPath();
                ctx.arc(n.x, n.y, r + 2.4, 0, 2 * Math.PI);
                ctx.strokeStyle = ROJO;
                ctx.lineWidth = 1.1;
                ctx.stroke();
              }

              // etiquetas con backdrop: foco y vecinos siempre; comercios al
              // acercarse; consumidores solo con zoom fuerte (anti-saturación)
              const muestraEtiqueta = esFocal || esVecino ||
                (n.tipo === "comercio" && escala > 1.05) ||
                (n.tipo === "persona" && escala > 2.6);
              if (muestraEtiqueta) {
                const fs = Math.max(3.2, (esFocal ? 5.4 : 4.4) / Math.sqrt(escala));
                ctx.font = `${esFocal ? 600 : 450} ${fs}px Geist, sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                const texto = n.nombre;
                const ancho = ctx.measureText(texto).width;
                const ty = n.y + r + 2.6;
                ctx.fillStyle = "rgba(10,10,11,0.72)";
                ctx.beginPath();
                ctx.roundRect(n.x - ancho / 2 - 2, ty - 1, ancho + 4, fs + 2.4, 2);
                ctx.fill();
                ctx.fillStyle = esFocal ? "#ffffff" : esVecino ? "rgba(245,245,244,0.95)" : "rgba(245,245,244,0.72)";
                ctx.fillText(texto, n.x, ty);
              }
              ctx.restore();
            }}
          />
        )}
      </div>
    </div>
  );
}
