"use client";
// Primitivas visuales de PolFin: quietas, espaciadas, precisas.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

// ------------------------------------------------------------------ hook de datos
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let vivo = true;
    api<T>(path)
      .then((d) => vivo && setData(d))
      .catch((e) => vivo && setError(String(e.message ?? e)));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  return { data, error };
}

// true en pantallas chicas (mobile). El foco mobile es el consumidor.
export function useEsMobile(bp = 1023) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const set = () => setMobile(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, [bp]);
  return mobile;
}

// Estado booleano persistido en localStorage (colapsos de sidebar/chat, etc).
// Hidrata post-mount para no romper el SSR con un mismatch de contenido.
export function usePersistente(clave: string, porDefecto: boolean) {
  const [valor, setValor] = useState(porDefecto);
  useEffect(() => {
    const guardado = window.localStorage.getItem(clave);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (guardado !== null) setValor(guardado === "1");
  }, [clave]);
  const set = (v: boolean) => {
    setValor(v);
    window.localStorage.setItem(clave, v ? "1" : "0");
  };
  return [valor, set] as const;
}

export function useMedida<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [medida, setMedida] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) =>
      setMedida({ w: e.contentRect.width, h: e.contentRect.height })
    );
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, ...medida };
}

// ------------------------------------------------------------------ piezas
export function Pill({
  tono, children,
}: { tono: "brand" | "mal" | "ok" | "tenue"; children: React.ReactNode }) {
  const estilos = {
    brand: "bg-brand/12 text-brand",
    mal: "bg-mal/12 text-mal",
    ok: "bg-okk/12 text-okk",
    tenue: "bg-white/6 text-tenue",
  }[tono];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide ${estilos}`}>
      {children}
    </span>
  );
}

export function Punto({ tono }: { tono: "brand" | "mal" | "ok" | "tenue" }) {
  const c = { brand: "bg-brand", mal: "bg-mal", ok: "bg-okk", tenue: "bg-tenue" }[tono];
  return <span className={`inline-block size-1.5 rounded-full ${c}`} />;
}

export function Carta({
  children, onClick, className = "",
}: { children: React.ReactNode; onClick?: () => void; className?: string }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border border-linea bg-carta p-5 transition-colors ${
        onClick ? "cursor-pointer hover:bg-carta2" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function Etiqueta({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-tenue">
      {children}
    </div>
  );
}

// Copia `valor` al portapapeles y confirma con un check breve (1.5s). Usarlo
// junto a hashes/direcciones on-chain — son largos, feos de transcribir a mano.
export function BotonCopiar({ valor, className = "" }: { valor: string; className?: string }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // portapapeles bloqueado (permisos/http sin TLS): sin feedback, no rompe nada más.
    }
  };
  return (
    <button
      type="button"
      onClick={copiar}
      title={copiado ? "¡Copiado!" : "Copiar"}
      aria-label="Copiar"
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md text-tenue transition-colors hover:bg-white/8 hover:text-brand ${className}`}
    >
      {copiado ? (
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden><path d="M5 12.5 10 17l9-10" stroke="var(--color-brand)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
          <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" fill="none" />
          <path d="M5 16V6a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

export function VerElPorque({ onClick, texto = "Ver el porqué" }: { onClick?: () => void; texto?: string }) {
  return (
    <button
      onClick={onClick}
      className="mt-3 inline-flex items-center gap-1 rounded-full border border-linea px-3.5 py-1.5 text-[13px] text-tinta transition-colors hover:border-brand/50 hover:text-brand"
    >
      {texto} <span aria-hidden>→</span>
    </button>
  );
}

// Riesgo: verde/rojo SOLO acá (señal), nunca decorativo.
export function tonoRiesgo(riesgo: string | null | undefined): "ok" | "mal" | "tenue" {
  if (riesgo === "muy bajo" || riesgo === "bajo") return "ok";
  if (riesgo === "alto" || riesgo === "muy alto") return "mal";
  return "tenue";
}

// El arco de score 0–1000 — el instrumento del buró.
export function ArcoScore({ score, riesgo, tamano = 140 }: { score: number | null; riesgo: string | null; tamano?: number }) {
  const r = 56, cx = 70, cy = 70;
  const frac = score === null ? 0 : Math.max(0.02, score / 1000);
  const largo = 2 * Math.PI * r * 0.75; // arco de 270°
  const colorSenal = riesgo === "alto" || riesgo === "muy alto" ? "#ff453a" : "#ff6a00";
  return (
    <div className="relative" style={{ width: tamano, height: tamano }}>
      <svg viewBox="0 0 140 140" width={tamano} height={tamano} className="-rotate-[135deg]">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#232327" strokeWidth="8"
          strokeDasharray={`${largo} ${2 * Math.PI * r}`} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={colorSenal} strokeWidth="8"
          strokeDasharray={`${largo * frac} ${2 * Math.PI * r}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 900ms cubic-bezier(0.22,1,0.36,1)" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="num text-4xl font-semibold leading-none">{score ?? "—"}</div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-tenue">de 1000</div>
      </div>
    </div>
  );
}
