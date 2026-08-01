"use client";
// Nueva venta a plazo — el vendedor (cualquier eslabón) habilita una compra a
// plazo para un cliente: carga cliente + monto + plazo, Ángela corre el pipeline
// determinístico y, si sale, GENERA el e-pagaré para ver/descargar/entregar. El
// deudor (incluido el consumidor final) NO necesita entrar a la app: el vendedor
// le entrega el documento por fuera (WhatsApp, impreso). Para lo que sube por la
// cadena (un comercio que le pide a su proveedor) sigue el flujo de aprobación.
import { useMemo, useState } from "react";
import { apiPost, pesos, type Entidad } from "@/lib/api";
import type { Rol, Vista } from "@/lib/roles";
import { useApi } from "@/components/ui";

type Resultado = {
  estado: "aprobada" | "pendiente_aprobacion" | "rechazada" | string;
  score: number | null;
  monto: number;
  deudor: { id: number; nombre: string };
  condiciones: {
    riesgo: string; tasa_sugerida_tna: number | null; plazo_max_dias: number;
    limite_sugerido_pesos: number;
    macro?: { aplicado?: boolean; nota?: string | null; sector?: string };
  } | null;
  instrumento: { instrumento_id: number } | null;
  pendiente_por: string | null;
  razonamiento: string;
};

export function NuevaVenta({
  rol, onCerrar, onGenerado, irA,
}: {
  rol: Rol; onCerrar: () => void; onGenerado: (instrumentoId: number) => void;
  irA: (v: Vista, foco?: number) => void;
}) {
  const { data: entidades } = useApi<Entidad[]>("/api/entidades");
  const [busqueda, setBusqueda] = useState("");
  const [clienteId, setClienteId] = useState<number | null>(rol.accion.deudorId ?? null);
  const [monto, setMonto] = useState<string>(String(rol.accion.monto ?? ""));
  const [plazo, setPlazo] = useState<number>(60);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);

  const candidatos = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (entidades ?? [])
      .filter((e) => e.id !== rol.entidadId)
      .filter((e) => !q || e.nombre.toLowerCase().includes(q))
      .slice(0, 8);
  }, [entidades, busqueda, rol.entidadId]);

  const cliente = (entidades ?? []).find((e) => e.id === clienteId) ?? null;

  async function generar() {
    if (!clienteId || !Number(monto)) return;
    setEnviando(true); setError(null); setResultado(null);
    try {
      const r = await apiPost<Resultado>("/api/agente/evaluar-credito", {
        deudor_id: clienteId, acreedor_id: rol.entidadId,
        monto: Number(monto), plazo_dias: plazo,
        contexto: `venta a plazo generada por ${rol.entidadNombre}`,
      });
      setResultado(r);
      if (r.estado === "aprobada" && r.instrumento) {
        onGenerado(r.instrumento.instrumento_id); // abre el documento para entregar
      }
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center sm:p-6" onClick={onCerrar}>
      <div className="subiendo relative my-auto w-full max-w-lg overflow-hidden rounded-2xl border border-linea bg-panel shadow-2xl shadow-black/70" onClick={(e) => e.stopPropagation()}>
        <button onClick={onCerrar} aria-label="Cerrar"
          className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full bg-white/8 text-tenue transition-colors hover:bg-white/14 hover:text-tinta">✕</button>

        <div className="border-b border-linea px-6 py-5">
          <h2 className="text-[18px] font-semibold tracking-tight">Nueva venta a plazo</h2>
          <p className="mt-1 text-[12.5px] text-tenue">
            Cargá el cliente y el monto. Ángela evalúa con el score real y el contexto,
            y genera el documento para que se lo entregues.
          </p>
        </div>

        <div className="px-6 py-5">
          {/* cliente */}
          <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-tenue">Cliente</label>
          {cliente ? (
            <div className="mt-1.5 flex items-center justify-between rounded-xl border border-linea bg-carta px-3.5 py-2.5">
              <div>
                <div className="text-[14px]">{cliente.nombre}</div>
                <div className="text-[11px] text-tenue">{cliente.tipo === "persona" ? "Consumidor final" : cliente.rol_cadena ?? "Comercio"}{cliente.ciudad ? ` · ${cliente.ciudad}` : ""}</div>
              </div>
              <button onClick={() => { setClienteId(null); setResultado(null); }} className="text-[12px] text-brand hover:underline">Cambiar</button>
            </div>
          ) : (
            <>
              <input autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscá tu cliente por nombre…"
                className="mt-1.5 w-full rounded-xl border border-linea bg-carta px-3.5 py-2.5 text-[13px] text-tinta placeholder:text-tenue focus:border-brand/50 focus:outline-none" />
              <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
                {candidatos.map((e) => (
                  <button key={e.id} onClick={() => { setClienteId(e.id); setBusqueda(""); }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/5">
                    <span className="text-[13px]">{e.nombre}</span>
                    <span className="text-[11px] text-tenue">{e.tipo === "persona" ? "consumidor" : e.rol_cadena ?? "comercio"}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* monto + plazo */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-tenue">Monto</label>
              <input inputMode="numeric" value={monto}
                onChange={(e) => { setMonto(e.target.value.replace(/[^\d]/g, "")); setResultado(null); }}
                placeholder="0"
                className="mt-1.5 w-full rounded-xl border border-linea bg-carta px-3.5 py-2.5 num text-[14px] text-tinta placeholder:text-tenue focus:border-brand/50 focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-tenue">Plazo pedido</label>
              <div className="mt-1.5 flex gap-1.5">
                {[30, 60, 90].map((p) => (
                  <button key={p} onClick={() => setPlazo(p)}
                    className={`flex-1 rounded-xl border px-2 py-2.5 text-[13px] transition-colors ${plazo === p ? "border-brand bg-brand/12 text-brand" : "border-linea text-tinta/80 hover:border-brand/40"}`}>
                    {p}d
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* resultado */}
          {resultado && (
            <div className={`mt-4 rounded-xl border p-3.5 text-[12.5px] ${
              resultado.estado === "aprobada" ? "border-okk/40 bg-okk/8"
              : resultado.estado === "pendiente_aprobacion" ? "border-brand/40 bg-brand/8"
              : "border-mal/40 bg-mal/8"}`}>
              <div className="font-semibold">
                {resultado.estado === "aprobada" ? "✓ Documento generado — listo para entregar"
                  : resultado.estado === "pendiente_aprobacion" ? "Necesita tu OK (supera el límite autónomo)"
                  : "No recomendada por el motor"}
              </div>
              {resultado.condiciones && (
                <p className="mt-1.5 text-tinta/85">
                  Score <span className="num">{resultado.score ?? "—"}</span> · riesgo {resultado.condiciones.riesgo}
                  {resultado.condiciones.tasa_sugerida_tna != null && <> · <span className="num">{resultado.condiciones.tasa_sugerida_tna}%</span> TNA · {resultado.condiciones.plazo_max_dias} días</>}
                </p>
              )}
              {resultado.condiciones?.macro?.nota && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-tenue">
                  <span className="mt-0.5 inline-block size-1.5 shrink-0 rounded-full bg-brand" />
                  {resultado.condiciones.macro.nota}
                </p>
              )}
              {resultado.estado === "pendiente_aprobacion" && (
                <button onClick={() => { onCerrar(); irA("aprobaciones"); }} className="mt-2 text-[12px] font-medium text-brand hover:underline">Ir a aprobar →</button>
              )}
            </div>
          )}
          {error && <p className="mt-3 text-[12.5px] text-mal">{error}</p>}

          {/* nota + acción */}
          <p className="mt-4 text-[11px] leading-relaxed text-tenue">
            El motor de crédito decide score y condiciones con una fórmula auditable. El
            cliente no necesita entrar a la app: le entregás el documento por fuera.
          </p>
          <button onClick={generar} disabled={!clienteId || !Number(monto) || enviando}
            className="mt-3 w-full rounded-xl bg-brand px-4 py-3 text-[14px] font-semibold text-black transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50">
            {enviando ? "Evaluando y generando…" : "Generar documento"}
          </button>
        </div>
      </div>
    </div>
  );
}
