"use client";
// Decisiones de crédito: la cola que el agente preparó. Las pendientes se
// aprueban/rechazan acá (human-in-the-loop real contra el backend del P3).
import { useState } from "react";
import { apiPost, pesos, type Solicitud } from "@/lib/api";
import type { Rol, Vista } from "@/lib/roles";
import { Carta, Etiqueta, Pill, Punto, useApi } from "@/components/ui";
import { fechaRelativa } from "@/lib/actividad";

export function Decisiones({
  rol, solicitudes, recargar, irA,
}: {
  rol: Rol; solicitudes: Solicitud[]; recargar: () => void;
  irA: (v: Vista, foco?: number) => void;
}) {
  const [abierta, setAbierta] = useState<number | null>(null);
  const [ocupada, setOcupada] = useState<number | null>(null);
  const esConsumidor = false; // el consumidor final ya no es usuario de la app

  const lista = esConsumidor
    ? solicitudes.filter((s) => s.deudor_id === rol.entidadId)
    : [...solicitudes].sort((a, b) =>
        (a.acreedor_id === rol.entidadId ? 0 : 1) - (b.acreedor_id === rol.entidadId ? 0 : 1) || b.id - a.id);

  const accion = async (id: number, que: "aprobar" | "rechazar") => {
    setOcupada(id);
    try { await apiPost(`/api/solicitudes/${id}/${que}`); recargar(); }
    catch (e) { alert(String((e as Error).message)); }
    finally { setOcupada(null); }
  };

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <h1 className="text-[28px] font-semibold tracking-tight">
        {esConsumidor ? "Mis pedidos de crédito" : "Decisiones de crédito"}
      </h1>
      <p className="mt-1 text-[13.5px] text-tenue">
        {esConsumidor
          ? "Cada pedido tuyo, evaluado con tu reputación real."
          : "Ángela evalúa con el scoring de la red; vos firmás. Nada se ejecuta solo por encima de tu límite."}
      </p>

      <div className="mt-6 space-y-3">
        {lista.length === 0 && (
          <Carta><p className="text-[13.5px] text-tenue">
            Sin pedidos todavía. Pedile una evaluación a Ángela desde el panel derecho →
          </p></Carta>
        )}
        {lista.map((s) => {
          const cond = s.condiciones_json ? JSON.parse(s.condiciones_json) : null;
          const pendiente = s.estado === "pendiente_aprobacion";
          const mia = s.acreedor_id === rol.entidadId;
          return (
            <Carta key={s.id} className="subiendo">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {pendiente ? (
                      <Pill tono="brand"><Punto tono="brand" /> Esperando tu OK</Pill>
                    ) : s.estado === "aprobada" ? (
                      <Pill tono="tenue">Aprobada y ejecutada</Pill>
                    ) : (
                      <Pill tono="tenue">No recomendada</Pill>
                    )}
                    {s.origen === "proactiva" && (
                      <Pill tono="brand">Iniciada por Ángela</Pill>
                    )}
                    {!mia && !esConsumidor && <span className="text-[11px] text-tenue">en la red</span>}
                    <span className="text-[11px] text-tenue">{fechaRelativa(s.created_at)}</span>
                  </div>
                  <h3 className="mt-2.5 text-[16px] font-semibold">
                    {s.deudor_nombre} <span className="font-normal text-tenue">pide fiado en</span> {s.acreedor_nombre}
                  </h3>
                  {cond && (
                    <p className="mt-1 text-[13px] text-tenue">
                      Score <span className="num text-tinta">{cond.score}</span> · riesgo {cond.condiciones?.riesgo}
                      {cond.condiciones?.tasa_sugerida_tna != null && (
                        <> · tasa <span className="num text-tinta">{cond.condiciones.tasa_sugerida_tna}%</span> TNA
                        · hasta <span className="num text-tinta">{cond.condiciones.plazo_max_dias}</span> días</>
                      )}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <Etiqueta>Monto</Etiqueta>
                  <div className="num text-[24px] font-semibold">{pesos(s.monto)}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {pendiente && !esConsumidor && (
                  <>
                    <button onClick={() => accion(s.id, "aprobar")} disabled={ocupada === s.id}
                      className="rounded-full bg-brand px-4 py-1.5 text-[13px] font-semibold text-black transition-transform hover:scale-[1.02] disabled:opacity-60">
                      {ocupada === s.id ? "Ejecutando…" : "Aprobar y emitir e-pagaré"}
                    </button>
                    <button onClick={() => accion(s.id, "rechazar")} disabled={ocupada === s.id}
                      className="rounded-full border border-linea px-4 py-1.5 text-[13px] text-tinta/85 hover:border-mal/50 hover:text-mal">
                      Rechazar
                    </button>
                  </>
                )}
                <button onClick={() => setAbierta(abierta === s.id ? null : s.id)}
                  className="rounded-full border border-linea px-3.5 py-1.5 text-[13px] text-tinta/85 hover:border-brand/50 hover:text-brand">
                  {abierta === s.id ? "Cerrar" : "Ver el porqué →"}
                </button>
                <button onClick={() => irA("cerebro", s.deudor_id)}
                  className="rounded-full border border-linea px-3.5 py-1.5 text-[13px] text-tinta/85 hover:border-brand/50 hover:text-brand">
                  Verlo en el Cerebro
                </button>
              </div>

              {abierta === s.id && s.razonamiento && (
                <div className="subiendo mt-4 whitespace-pre-line rounded-xl bg-ink/60 p-4 text-[12.5px] leading-relaxed text-tinta/80">
                  {s.razonamiento}
                </div>
              )}
            </Carta>
          );
        })}
      </div>
    </div>
  );
}
