"use client";
// Mapa de comercios adheridos — mapa geográfico REAL (Leaflet + tiles oscuros
// de CARTO sobre OpenStreetMap: gratis, sin API key, sin scraping). Los
// comercios del dataset se posicionan sobre sus coordenadas reales de Rosario
// y alrededores, con pins que hablan el mismo lenguaje visual que el Cerebro
// (forma por rol) y filtrado según el rol activo en el selector de cadena.
// Los consumidores finales NO van al mapa: son personas, no locales.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { type Entidad } from "@/lib/api";
import type { Rol, Vista } from "@/lib/roles";
import {
  ROL_ETIQUETA, ROL_FORMA_SVG, ROLES_RELEVANTES, RELEVANTE_TITULO, type RolCadena,
} from "@/lib/roles-visual";
import { Etiqueta, useApi } from "@/components/ui";

const NARANJA = "#ff6a00";
const TENUE = "#8e8e93";
const ROSARIO: [number, number] = [-32.9468, -60.6393];
const ORDEN: RolCadena[] = ["fabrica", "distribuidora", "mayorista", "minorista"];

// El pin: la forma del rol dentro de una gota, en el naranja de marca cuando
// está activo/hover y en gris cuando es contexto.
const pinHtml = (rol: string, activo: boolean) => {
  const color = activo ? NARANJA : TENUE;
  const escala = activo ? 1 : 0.82;
  return `
    <div style="transform:translate(-50%,-100%) scale(${escala});transform-origin:bottom center;filter:drop-shadow(0 2px 6px rgba(0,0,0,.75))">
      <svg width="30" height="38" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 37C15 37 28 22.5 28 14A13 13 0 1 0 2 14c0 8.5 13 23 13 23Z"
              fill="${color}" stroke="rgba(0,0,0,.5)" stroke-width="1"/>
        <g transform="translate(5,4)" fill="#0a0a0b">
          <path d="${ROL_FORMA_SVG[rol] ?? ROL_FORMA_SVG.minorista}"/>
        </g>
      </svg>
    </div>`;
};

export function Mapa({ rol, irA }: { rol: Rol; irA: (v: Vista, foco?: number) => void }) {
  const { data: comercios } = useApi<Entidad[]>("/api/entidades?tipo=comercio");
  const cajaRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<LeafletMap | null>(null);
  const capaRef = useRef<LayerGroup | null>(null);
  const [sobre, setSobre] = useState<number | null>(null);
  const [listo, setListo] = useState(false);
  const [filtros, setFiltros] = useState<Set<RolCadena>>(new Set());
  const [tocado, setTocado] = useState(false); // ¿el usuario tocó los toggles?

  // Los roles que le importan a quien mira; se resetean al cambiar de rol
  // salvo que el usuario haya elegido sus propios toggles.
  const relevantes = useMemo(() => ROLES_RELEVANTES[rol.id] ?? ORDEN, [rol.id]);
  useEffect(() => {
    setFiltros(new Set(relevantes));
    setTocado(false);
  }, [relevantes]);

  const visibles = useMemo(
    () => (comercios ?? []).filter(
      (c) => c.lat != null && c.lng != null && filtros.has((c.rol_cadena ?? "") as RolCadena)
    ),
    [comercios, filtros]
  );

  // Montaje del mapa real (una sola vez, del lado del cliente)
  useEffect(() => {
    if (!cajaRef.current || mapaRef.current) return;
    let cancelado = false;
    (async () => {
      // el CSS de Leaflet se importa en globals.css (orden de cascada)
      const L = (await import("leaflet")).default;
      if (cancelado || !cajaRef.current) return;
      const mapa = L.map(cajaRef.current, {
        center: ROSARIO, zoom: 11, zoomControl: true, attributionControl: true,
        preferCanvas: false,
      });
      // Tiles oscuros de CARTO (basado en OSM) — combinan con el negro PolFin.
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
      }).addTo(mapa);
      capaRef.current = L.layerGroup().addTo(mapa);
      mapaRef.current = mapa;
      setTimeout(() => mapa.invalidateSize(), 60);
      setListo(true); // recién ahora el efecto de pins puede dibujar
    })();
    return () => {
      cancelado = true;
      mapaRef.current?.remove();
      mapaRef.current = null;
      capaRef.current = null;
      setListo(false);
    };
  }, []);

  // Pins: se redibujan cuando el mapa está listo o cambian los visibles/hover
  useEffect(() => {
    if (!listo || !mapaRef.current || !capaRef.current || !visibles.length) return;
    let cancelado = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelado || !capaRef.current) return;
      capaRef.current.clearLayers();

      for (const c of visibles) {
        const activo = sobre === null || sobre === c.id;
        const marcador = L.marker([c.lat!, c.lng!], {
          icon: L.divIcon({
            className: "polfin-pin",
            html: pinHtml(c.rol_cadena ?? "minorista", activo),
            iconSize: [30, 38], iconAnchor: [15, 38], popupAnchor: [0, -34],
          }),
          title: c.nombre,
        });
        marcador.bindPopup(`
          <div style="min-width:190px;font-family:Geist,system-ui,sans-serif">
            <div style="font-size:14px;font-weight:600;color:#f5f5f4">${c.nombre}</div>
            <div style="margin-top:2px;font-size:12px;color:#8e8e93">
              ${ROL_ETIQUETA[c.rol_cadena ?? ""] ?? "Comercio"} · ${c.rubro ?? ""}
            </div>
            <div style="font-size:12px;color:#8e8e93">${c.barrio ? c.barrio + ", " : ""}${c.ciudad}</div>
            <button data-cerebro="${c.id}"
              style="margin-top:10px;width:100%;border:0;border-radius:999px;background:#ff6a00;color:#0a0a0b;font:600 12px Geist,system-ui,sans-serif;padding:7px 12px;cursor:pointer">
              Verlo en el Cerebro →
            </button>
          </div>`,
          { className: "polfin-popup", closeButton: true });
        marcador.on("mouseover", () => setSobre(c.id));
        marcador.on("mouseout", () => setSobre(null));
        marcador.addTo(capaRef.current!);
      }

      // Encuadre sobre lo que se está mostrando (invalidateSize por si el
      // contenedor cambió de tamaño — p. ej. al pasar a una sola columna en mobile)
      mapaRef.current!.invalidateSize();
      const bounds = L.latLngBounds(visibles.map((c) => [c.lat!, c.lng!] as [number, number]));
      mapaRef.current!.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    })();
    return () => { cancelado = true; };
  }, [visibles, sobre, listo]);

  // El botón del popup lleva al Cerebro (el popup es HTML crudo de Leaflet)
  useEffect(() => {
    const caja = cajaRef.current;
    if (!caja) return;
    const alClick = (e: MouseEvent) => {
      const id = (e.target as HTMLElement)?.closest?.("[data-cerebro]")?.getAttribute("data-cerebro");
      if (id) irA("cerebro", Number(id));
    };
    caja.addEventListener("click", alClick);
    return () => caja.removeEventListener("click", alClick);
  }, [irA]);

  const alternar = (r: RolCadena) => {
    setTocado(true);
    setFiltros((prev) => {
      const s = new Set(prev);
      if (s.has(r)) s.delete(r); else s.add(r);
      return s;
    });
  };

  const conteos = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of comercios ?? []) {
      if (c.lat == null) continue;
      m.set(c.rol_cadena ?? "", (m.get(c.rol_cadena ?? "") ?? 0) + 1);
    }
    return m;
  }, [comercios]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Comercios adheridos</h1>
          <p className="mt-1 text-[13.5px] text-tenue">
            {RELEVANTE_TITULO[rol.id] ?? "La red PolFin"} — sobre el mapa real de Rosario y alrededores.
          </p>
        </div>
        {/* filtros por eslabón: arrancan en lo relevante para el rol activo */}
        <div className="flex flex-wrap items-center gap-1.5">
          {ORDEN.map((r) => {
            const activo = filtros.has(r);
            return (
              <button key={r} onClick={() => alternar(r)}
                aria-pressed={activo}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${
                  activo ? "border-brand/50 bg-brand/12 text-brand" : "border-linea text-tenue hover:text-tinta"
                }`}>
                <svg width="11" height="11" viewBox="0 0 20 20" aria-hidden>
                  <path d={ROL_FORMA_SVG[r]} fill="currentColor" />
                </svg>
                {ROL_ETIQUETA[r]}
                <span className="num opacity-60">{conteos.get(r) ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {!tocado && (
        <p className="mt-2 text-[12px] text-tenue">
          Filtrado por tu lugar en la cadena ({rol.etiqueta}). Tocá los eslabones para ver el resto de la red.
        </p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_248px]">
        {/* el mapa real */}
        <div className="relative overflow-hidden rounded-2xl border border-linea">
          <div ref={cajaRef} className="aspect-[16/11] w-full bg-carta" />
          {visibles.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded-xl bg-ink/85 px-4 py-2 text-[13px] text-tenue">
                Ningún eslabón seleccionado — activá alguno arriba.
              </p>
            </div>
          )}
        </div>

        {/* lista lateral, sincronizada con el mapa */}
        <div className="max-h-[520px] space-y-1 overflow-y-auto">
          <Etiqueta>{visibles.length} en el mapa</Etiqueta>
          {visibles.map((c) => (
            <button key={c.id}
              onClick={() => irA("cerebro", c.id)}
              onMouseEnter={() => setSobre(c.id)}
              onMouseLeave={() => setSobre(null)}
              className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                sobre === c.id ? "bg-brand/10" : "hover:bg-white/4"
              }`}>
              <svg width="11" height="11" viewBox="0 0 20 20" aria-hidden
                className={`mt-1 shrink-0 ${sobre === c.id ? "text-brand" : "text-tenue"}`}>
                <path d={ROL_FORMA_SVG[c.rol_cadena ?? "minorista"]} fill="currentColor" />
              </svg>
              <span className="min-w-0">
                <span className="block truncate text-[13px]">{c.nombre}</span>
                <span className="block text-[11px] text-tenue">
                  {ROL_ETIQUETA[c.rol_cadena ?? ""]} · {c.ciudad}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
