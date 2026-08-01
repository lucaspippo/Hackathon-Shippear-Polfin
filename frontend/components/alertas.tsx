"use client";
// Alertas: la señal de riesgo. Rojo y verde SOLO acá y en los estados de pago.
import { useMemo } from "react";
import { pesos, fechaCorta, type EntidadDetalle, type ScoreResumen } from "@/lib/api";
import type { Rol, Vista } from "@/lib/roles";
import { Carta, Etiqueta, Pill, Punto, useApi } from "@/components/ui";

const diasDeAtraso = (venc: string) =>
  Math.max(0, Math.round((Date.now() - new Date(venc + "T00:00:00").getTime()) / 86400000));

export function Alertas({
  rol, irA, refresh,
}: { rol: Rol; irA: (v: Vista, foco?: number) => void; refresh: number }) {
  const { data: det } = useApi<EntidadDetalle>(`/api/entidades/${rol.entidadId}`, [refresh]);
  const { data: scores } = useApi<ScoreResumen[]>("/api/scores", [refresh]);
  const esConsumidor = false; // el consumidor final ya no es usuario de la app

  const vencidas = useMemo(
    () => (det?.como_acreedor ?? []).filter((t) => t.estado === "vencida")
      .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento)),
    [det]
  );
  const enRiesgo = useMemo(() => {
    if (!det || !scores) return [];
    const mios = new Set(det.como_acreedor.map((t) => t.deudor_id));
    return scores.filter((s) => mios.has(s.id) && s.score != null && s.score < 400);
  }, [det, scores]);
  const misVencimientos = useMemo(
    () => (det?.como_deudor ?? []).filter((t) => t.estado === "pendiente")
      .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento)),
    [det]
  );

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <h1 className="text-[28px] font-semibold tracking-tight">Alertas</h1>
      <p className="mt-1 text-[13.5px] text-tenue">
        {esConsumidor ? "Tus vencimientos y tu señal en la red." : "Riesgo real, sin ruido: quién se atrasó y quién empeoró."}
      </p>

      {!esConsumidor && (
        <>
          <section className="mt-6">
            <div className="flex items-center gap-2">
              <Punto tono="mal" />
              <h2 className="text-[15px] font-semibold">Crédito vencido sin cobrar ({vencidas.length})</h2>
            </div>
            <div className="mt-3 space-y-2">
              {vencidas.length === 0 && (
                <Carta><p className="flex items-center gap-2 text-[13px] text-tenue">
                  <Punto tono="ok" /> Nadie está atrasado con vos. Cartera al día.
                </p></Carta>
              )}
              {vencidas.map((t) => (
                <Carta key={t.id} className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium">{t.deudor_nombre}</div>
                    <div className="text-[12px] text-tenue">{t.concepto} · venció el {fechaCorta(t.fecha_vencimiento)}</div>
                  </div>
                  <Pill tono="mal">{diasDeAtraso(t.fecha_vencimiento)} días de atraso</Pill>
                  <div className="num w-28 text-right text-[16px] font-semibold text-mal">{pesos(t.monto)}</div>
                  <button onClick={() => irA("cerebro", t.deudor_id)}
                    className="shrink-0 rounded-full border border-linea px-3 py-1.5 text-[12px] hover:border-brand/50 hover:text-brand">
                    Ver el porqué →
                  </button>
                </Carta>
              ))}
            </div>
          </section>

          <section className="mt-8">
            <div className="flex items-center gap-2">
              <Punto tono="mal" />
              <h2 className="text-[15px] font-semibold">Clientes en zona de riesgo ({enRiesgo.length})</h2>
            </div>
            <div className="mt-3 space-y-2">
              {enRiesgo.length === 0 && (
                <Carta><p className="flex items-center gap-2 text-[13px] text-tenue">
                  <Punto tono="ok" /> Ningún cliente tuyo está en zona de riesgo.
                </p></Carta>
              )}
              {enRiesgo.map((s) => (
                <Carta key={s.id} className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium">{s.nombre}</div>
                    <div className="text-[12px] text-tenue">
                      {s.pct_puntual}% puntual · límite sugerido {pesos(s.limite_sugerido_pesos)}
                    </div>
                  </div>
                  <Pill tono="mal">score {s.score} · {s.riesgo}</Pill>
                  <button onClick={() => irA("cerebro", s.id)}
                    className="shrink-0 rounded-full border border-linea px-3 py-1.5 text-[12px] hover:border-brand/50 hover:text-brand">
                    Ver el porqué →
                  </button>
                </Carta>
              ))}
            </div>
          </section>
        </>
      )}

      {esConsumidor && (
        <section className="mt-6">
          <div className="flex items-center gap-2">
            <Punto tono="brand" />
            <h2 className="text-[15px] font-semibold">Tus próximos vencimientos ({misVencimientos.length})</h2>
          </div>
          <div className="mt-3 space-y-2">
            {misVencimientos.length === 0 && (
              <Carta><p className="flex items-center gap-2 text-[13px] text-tenue">
                <Punto tono="ok" /> No debés nada. Tu score te lo agradece.
              </p></Carta>
            )}
            {misVencimientos.map((t) => (
              <Carta key={t.id} className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium">{t.acreedor_nombre}</div>
                  <div className="text-[12px] text-tenue">{t.concepto}</div>
                </div>
                <Pill tono="tenue">vence {fechaCorta(t.fecha_vencimiento)}</Pill>
                <div className="num w-28 text-right text-[16px] font-semibold">{pesos(t.monto)}</div>
              </Carta>
            ))}
            <Carta>
              <Etiqueta>Por qué importa</Etiqueta>
              <p className="mt-1.5 text-[13px] leading-relaxed text-tenue">
                Cada pago en fecha suma a tu score en TODA la red. Un atraso acá te encarece
                el crédito en cualquier comercio adherido.
              </p>
            </Carta>
          </div>
        </section>
      )}
    </div>
  );
}
