"use client";
// Mis compras a crédito — la vista del consumidor final. Recibe las operaciones
// que le generaron (le fiaron tras presentar su score), las acepta desde su
// lado (firma el e-pagaré como deudor), y ve sus créditos activos con su
// documento. Responsive: es la vista pensada para el teléfono.
import { pesos, fechaCorta, type Instrumento, type Score } from "@/lib/api";
import type { Rol, Vista } from "@/lib/roles";
import { Carta, Etiqueta, Pill, Punto, tonoRiesgo, useApi } from "@/components/ui";
import type { DocRef } from "@/components/documento";

const diasA = (venc: string) =>
  Math.round((new Date(venc + "T00:00:00").getTime() - Date.now()) / 86400000);

export function MisCompras({
  rol, refresh, irA, abrirDoc,
}: {
  rol: Rol; refresh: number;
  irA: (v: Vista, foco?: number) => void;
  abrirDoc: (d: DocRef) => void;
}) {
  const { data: score } = useApi<Score>(`/api/score/${rol.entidadId}`, [refresh]);
  const { data: instrumentos } = useApi<Instrumento[]>(`/api/instrumentos?deudor=${rol.entidadId}`, [refresh]);

  const porAceptar = (instrumentos ?? []).filter((i) => i.aceptado === 0);
  const activos = (instrumentos ?? []).filter((i) => i.aceptado === 1);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="text-[24px] font-semibold tracking-tight sm:text-[28px]">Mis compras a crédito</h1>
      <p className="mt-1 text-[13.5px] text-tenue">
        Lo que te fiaron con tu reputación. Aceptás desde acá — sos quien firma como deudor.
      </p>

      {/* franja: score + accesos */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Carta className="!p-4">
          <Etiqueta>Tu score</Etiqueta>
          <div className="num mt-1 text-[22px] font-semibold">{score?.score ?? "—"}</div>
          {score && <Pill tono={tonoRiesgo(score.condiciones.riesgo)}>riesgo {score.condiciones.riesgo}</Pill>}
        </Carta>
        <button onClick={() => irA("pagos")} className="text-left">
          <Carta onClick={() => irA("pagos")} className="!p-4 h-full">
            <Etiqueta>Mis pagos</Etiqueta>
            <div className="mt-1 text-[13px] text-tinta">ver y pagar →</div>
          </Carta>
        </button>
        <button onClick={() => irA("mapa")} className="text-left">
          <Carta onClick={() => irA("mapa")} className="!p-4 h-full">
            <Etiqueta>Dónde usar mi score</Etiqueta>
            <div className="mt-1 text-[13px] text-tinta">los adheridos →</div>
          </Carta>
        </button>
        <Carta className="!p-4">
          <Etiqueta>Límite en la red</Etiqueta>
          <div className="num mt-1 text-[15px] font-semibold">{pesos(score?.condiciones.limite_sugerido_pesos ?? 0)}</div>
        </Carta>
      </div>

      {/* operaciones que le generaron y esperan su aceptación */}
      {porAceptar.length > 0 && (
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <Punto tono="brand" />
            <h2 className="text-[16px] font-semibold">Para aceptar ({porAceptar.length})</h2>
          </div>
          <p className="mt-1 text-[12.5px] text-tenue">
            Te fiaron. Revisá las condiciones y el documento, y aceptá para formalizar.
          </p>
          <div className="mt-3 space-y-3">
            {porAceptar.map((i) => (
              <Carta key={i.id} className="subiendo border-brand/30 bg-brand/[0.04]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Pill tono="brand"><Punto tono="brand" /> Esperando tu aceptación</Pill>
                    <h3 className="mt-2 text-[16px] font-semibold">Te fiaron en {i.acreedor_nombre}</h3>
                    <p className="mt-1 text-[13px] text-tenue">
                      Tasa <span className="num text-tinta">{i.tasa_tna}%</span> TNA · plazo{" "}
                      <span className="num text-tinta">{i.plazo_dias}</span> días · vence{" "}
                      <span className="text-tinta">{fechaCorta(i.fecha_vencimiento)}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <Etiqueta>Monto</Etiqueta>
                    <div className="num text-[24px] font-semibold">{pesos(i.monto)}</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => abrirDoc({ tipo: "epagare", id: i.id })}
                    className="rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-black transition-transform hover:scale-[1.02]">
                    Ver términos y aceptar
                  </button>
                </div>
              </Carta>
            ))}
          </div>
        </section>
      )}

      {/* créditos activos */}
      <section className="mt-8">
        <h2 className="text-[16px] font-semibold">Mis créditos activos ({activos.length})</h2>
        <div className="mt-3 space-y-2">
          {activos.length === 0 && porAceptar.length === 0 && (
            <Carta><p className="flex items-center gap-2 text-[13px] text-tenue">
              <Punto tono="tenue" /> Todavía no tenés compras a crédito. Presentá tu score en un comercio adherido.
            </p></Carta>
          )}
          {activos.map((i) => {
            const dias = diasA(i.fecha_vencimiento);
            const vencido = dias < 0;
            return (
              <Carta key={i.id} className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium">{i.acreedor_nombre}</span>
                    {vencido ? <Pill tono="mal">vencido</Pill> : <Pill tono="ok">al día</Pill>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-tenue">
                    {i.tasa_tna}% TNA · vence {fechaCorta(i.fecha_vencimiento)} ({vencido ? `hace ${-dias}` : `en ${dias}`} días)
                  </div>
                </div>
                <div className="num text-right text-[16px] font-semibold">{pesos(i.monto)}</div>
                <button onClick={() => abrirDoc({ tipo: "epagare", id: i.id })}
                  className="shrink-0 rounded-full border border-linea px-3.5 py-1.5 text-[12.5px] text-tinta/85 transition-colors hover:border-brand/50 hover:text-brand">
                  Ver e-pagaré
                </button>
              </Carta>
            );
          })}
        </div>
      </section>
    </div>
  );
}
