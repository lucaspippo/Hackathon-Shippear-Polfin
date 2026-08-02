"use client";
// Aprobaciones — la bandeja de decisiones que esperan el OK del dueño.
// Todo lo que el approval gate frenó por monto + las propuestas proactivas de
// Ángela que mueven plata. Aprobar/rechazar reusa el endpoint del Prompt A
// (el pipeline retoma desde PENDIENTE_APROBACION por la máquina de estados).
import { useState } from "react";
import { apiPost, pesos, type Solicitud } from "@/lib/api";
import type { Rol, Vista } from "@/lib/roles";
import { Carta, Etiqueta, Pill, Punto } from "@/components/ui";
import { fechaRelativa } from "@/lib/actividad";
import type { DocRef } from "@/components/documento";

type Resuelta = { estado: string; instrumento?: { instrumento_id: number; contrato_address: string; fecha_vencimiento: string; tx_hash: string; red: string; red_label?: string; explorer_url?: string | null } };

export function Aprobaciones({
  rol, solicitudes, recargar, irA, abrirDoc,
}: {
  rol: Rol; solicitudes: Solicitud[]; recargar: () => void;
  irA: (v: Vista, foco?: number) => void; abrirDoc: (d: DocRef) => void;
}) {
  const [ocupada, setOcupada] = useState<number | null>(null);
  const [resueltas, setResueltas] = useState<Record<number, Resuelta>>({});
  const [abierta, setAbierta] = useState<number | null>(null);

  // Pendientes + las que resolví en esta sesión (aunque ya salieron de la
  // cola tras recargar), para que quede a la vista el resultado COMPLETADO.
  const enCola = solicitudes.filter(
    (s) => s.estado === "pendiente_aprobacion" || resueltas[s.id]
  );
  const orden = [...enCola].sort((a, b) => {
    const ra = resueltas[a.id] ? 1 : 0, rb = resueltas[b.id] ? 1 : 0;
    if (ra !== rb) return ra - rb; // resueltas al final
    return (a.acreedor_id === rol.entidadId ? 0 : 1) - (b.acreedor_id === rol.entidadId ? 0 : 1) || b.id - a.id;
  });

  const resolver = async (id: number, que: "aprobar" | "rechazar") => {
    setOcupada(id);
    try {
      const r = await apiPost<Resuelta & { instrumento?: Resuelta["instrumento"] }>(`/api/solicitudes/${id}/${que}`);
      setResueltas((prev) => ({ ...prev, [id]: r }));
      recargar();
    } catch (e) { alert(String((e as Error).message)); }
    finally { setOcupada(null); }
  };

  const totalEnJuego = orden.filter((x) => !resueltas[x.id]).reduce((s, x) => s + x.monto, 0);
  const quedanPendientes = orden.some((x) => !resueltas[x.id]);

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Aprobaciones</h1>
          <p className="mt-1 text-[13.5px] text-tenue">
            Lo que espera tu OK. El motor ya evaluó y calculó las condiciones — vos firmás.
          </p>
        </div>
        {quedanPendientes && (
          <div className="text-right">
            <Etiqueta>En juego</Etiqueta>
            <div className="num text-[22px] font-semibold">{pesos(totalEnJuego)}</div>
          </div>
        )}
      </div>

      <div className="mt-6 space-y-3">
        {orden.length === 0 && Object.keys(resueltas).length === 0 && (
          <Carta><p className="flex items-center gap-2 text-[13.5px] text-tenue">
            <Punto tono="ok" /> No hay nada esperando tu OK. Bandeja al día.
          </p></Carta>
        )}

        {orden.map((s) => {
          const cond = s.condiciones_json ? JSON.parse(s.condiciones_json) : null;
          const resuelta = resueltas[s.id];
          const proactiva = s.origen === "proactiva";
          return (
            <Carta key={s.id} className="subiendo">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {resuelta ? (
                      <Pill tono={resuelta.estado === "aprobada" ? "ok" : "tenue"}>
                        {resuelta.estado === "aprobada" ? "✓ Aprobada y ejecutada" : "Rechazada"}
                      </Pill>
                    ) : (
                      <Pill tono="brand"><Punto tono="brand" /> Esperando tu OK</Pill>
                    )}
                    {proactiva && <Pill tono="brand">Iniciada por Ángela</Pill>}
                    {s.acreedor_id !== rol.entidadId && <span className="text-[11px] text-tenue">en la red</span>}
                    <span className="text-[11px] text-tenue">{fechaRelativa(s.created_at)}</span>
                  </div>
                  <h3 className="mt-2.5 text-[16px] font-semibold">
                    {s.deudor_nombre} <span className="font-normal text-tenue">pide crédito en</span> {s.acreedor_nombre}
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
                  {/* el motivo por el que requiere aprobación */}
                  <p className="mt-2 rounded-lg bg-brand/8 px-3 py-1.5 text-[12px] text-brand/90">
                    {proactiva
                      ? "Ángela lo propuso sola: mover plata sin tu pedido siempre necesita tu OK."
                      : "Supera el límite que el agente puede aprobar solo."}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Etiqueta>Monto</Etiqueta>
                  <div className="num text-[24px] font-semibold">{pesos(s.monto)}</div>
                </div>
              </div>

              {resuelta ? (
                <div className="subiendo mt-3 rounded-xl border border-linea bg-ink/60 p-3 text-[12.5px] text-tinta/85">
                  {resuelta.estado === "aprobada" ? (
                    <>e-Pagaré emitido{resuelta.instrumento ? (
                      <> (vence {resuelta.instrumento.fecha_vencimiento}, contrato{" "}
                        {resuelta.instrumento.explorer_url ? (
                          <a href={resuelta.instrumento.explorer_url} target="_blank" rel="noopener noreferrer"
                            className="num text-brand hover:underline">{resuelta.instrumento.contrato_address.slice(0, 14)}…</a>
                        ) : (
                          <span className="num">{resuelta.instrumento.contrato_address.slice(0, 14)}…</span>
                        )})</>
                    ) : ""}. Solicitud en <span className="font-semibold text-okk">COMPLETADO</span>.
                    {" "}<button onClick={() => irA("pagos")} className="font-medium text-brand hover:underline">Ver en Pagos →</button>
                    {resuelta.instrumento && (
                      <>{" "}<button onClick={() => abrirDoc({ tipo: "epagare", id: resuelta.instrumento!.instrumento_id })} className="font-medium text-brand hover:underline">Ver documento →</button></>
                    )}</>
                  ) : (
                    <>Rechazo registrado. La solicitud queda como no aprobada.</>
                  )}
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button onClick={() => resolver(s.id, "aprobar")} disabled={ocupada === s.id}
                    className="rounded-full bg-brand px-4 py-1.5 text-[13px] font-semibold text-black transition-transform hover:scale-[1.02] disabled:opacity-60">
                    {ocupada === s.id ? "Ejecutando…" : "Aprobar y emitir e-pagaré"}
                  </button>
                  <button onClick={() => resolver(s.id, "rechazar")} disabled={ocupada === s.id}
                    className="rounded-full border border-linea px-4 py-1.5 text-[13px] text-tinta/85 hover:border-mal/50 hover:text-mal">
                    Rechazar
                  </button>
                  {s.razonamiento && (
                    <button onClick={() => setAbierta(abierta === s.id ? null : s.id)}
                      className="rounded-full border border-linea px-3.5 py-1.5 text-[13px] text-tinta/85 hover:border-brand/50 hover:text-brand">
                      {abierta === s.id ? "Cerrar" : "Ver el porqué →"}
                    </button>
                  )}
                  <button onClick={() => irA("cerebro", s.deudor_id)}
                    className="rounded-full border border-linea px-3.5 py-1.5 text-[13px] text-tinta/85 hover:border-brand/50 hover:text-brand">
                    Verlo en el Cerebro
                  </button>
                </div>
              )}

              {abierta === s.id && s.razonamiento && (
                <div className="subiendo mt-3 whitespace-pre-line rounded-xl bg-ink/60 p-4 text-[12.5px] leading-relaxed text-tinta/80">
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
