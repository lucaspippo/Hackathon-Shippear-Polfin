"use client";
// Perfil de crédito de una entidad (la propia o un cliente): foto, score grande
// (fórmula auditable), desglose, condiciones, historial/relaciones, y el bloque
// de VERIFICACIÓN ON-CHAIN con QR — la prueba de que el score vive en Avalanche,
// no solo en la DB de PolFin. Responsive: anda en mobile (~375px).
import { useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  pesos, fechaCorta, type Score, type EntidadDetalle, type OnchainScore, type Instrumento,
} from "@/lib/api";
import type { Rol, Vista } from "@/lib/roles";
import type { DocRef } from "@/components/documento";
import { Carta, Etiqueta, Pill, Punto, useApi, tonoRiesgo } from "@/components/ui";
import { Avatar } from "@/components/avatar";

const ROL_LABEL: Record<string, string> = {
  fabrica: "Fábrica", distribuidora: "Distribuidora", mayorista: "Mayorista", minorista: "Minorista",
};

export function Perfil({
  rol, entidadId, irA, abrirDoc,
}: { rol: Rol; entidadId: number; irA: (v: Vista, foco?: number) => void; abrirDoc?: (d: DocRef) => void }) {
  const { data: score } = useApi<Score>(`/api/score/${entidadId}`, [entidadId]);
  const { data: det } = useApi<EntidadDetalle>(`/api/entidades/${entidadId}`, [entidadId]);
  const { data: chain } = useApi<OnchainScore>(`/api/onchain/score/${entidadId}`, [entidadId]);
  const { data: docs } = useApi<Instrumento[]>(`/api/instrumentos?entidad=${entidadId}`, [entidadId]);

  const esYo = entidadId === rol.entidadId;

  // Relaciones: contrapartes distintas como comprador (deudor) y vendedor (acreedor).
  const relaciones = useMemo(() => {
    if (!det) return { proveedores: [] as string[], clientes: [] as string[] };
    const proveedores = [...new Set(det.como_deudor.map((t) => t.acreedor_nombre).filter(Boolean) as string[])];
    const clientes = [...new Set(det.como_acreedor.map((t) => t.deudor_nombre).filter(Boolean) as string[])];
    return { proveedores, clientes };
  }, [det]);

  const ent = score?.entidad ?? det;
  const rolCad = det?.rol_cadena ?? null;
  const tipoTxt = det?.tipo === "persona" ? "Consumidor final" : (rolCad ? ROL_LABEL[rolCad] ?? "Comercio" : "Comercio");
  const zona = [det?.rubro, det?.ciudad].filter(Boolean).join(" · ");

  // Valor del QR: en Fuji real → explorador Snowtrace; en mock → vista propia de
  // verificación (honesta: muestra hash, score, timestamp, entidad). Al pasar a
  // POLFIN_CHAIN_MODE=fuji, explorer_url viene poblado y el QR apunta a la cadena.
  const qrValue = chain?.explorer_url ?? (typeof window !== "undefined" ? `${window.location.origin}/verificar/${entidadId}` : "");

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
      {/* cabecera: foto + identidad */}
      <div className="flex items-center gap-4">
        <Avatar id={entidadId} nombre={ent?.nombre ?? "—"} size={72} className="ring-2 ring-brand/20" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight sm:text-[26px]">{ent?.nombre ?? "…"}</h1>
            {esYo && <Pill tono="brand">Tu perfil</Pill>}
          </div>
          <p className="mt-0.5 text-[13px] text-tenue">{tipoTxt}{zona ? ` · ${zona}` : ""}</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* ---- SCORE (fórmula auditable) ---- */}
        <Carta className="lg:col-span-3">
          <div className="flex items-start justify-between">
            <div>
              <Etiqueta>Score crediticio</Etiqueta>
              <div className="mt-1 flex items-end gap-3">
                <span className="num text-[56px] font-semibold leading-none">{score?.score ?? "—"}</span>
                {score?.condiciones && (
                  <Pill tono={tonoRiesgo(score.condiciones.riesgo)}>
                    <Punto tono={tonoRiesgo(score.condiciones.riesgo)} /> Riesgo {score.condiciones.riesgo}
                  </Pill>
                )}
              </div>
            </div>
            <span className="cursor-help whitespace-nowrap text-[10px] uppercase tracking-[0.1em] text-tenue"
              title="El score lo calcula una fórmula determinística y auditable sobre las transacciones reales, NO la IA. Ángela solo lo lee y explica.">
              Ⓘ Fórmula auditable
            </span>
          </div>

          {/* desglose por factor */}
          {score?.desglose?.length ? (
            <div className="mt-5 space-y-2.5">
              {score.desglose.map((f) => (
                <div key={f.factor}>
                  <div className="flex items-baseline justify-between text-[12px]">
                    <span className="capitalize text-tinta/85">{f.factor}</span>
                    <span className="num text-tenue">{f.aporte}/{f.maximo}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/6">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round((f.aporte / f.maximo) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {score?.explicacion && (
            <p className="mt-4 rounded-xl bg-ink/50 p-3.5 text-[12.5px] leading-relaxed text-tinta/80">{score.explicacion}</p>
          )}
        </Carta>

        {/* ---- VERIFICACIÓN ON-CHAIN + QR ---- */}
        <Carta className="lg:col-span-2">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-brand/15">
              <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden><path d="M5 12.5 10 17l9-10" stroke="var(--color-brand)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <div className="text-[13px] font-semibold">{chain && !chain.registrado ? "Reputación on-chain" : "Verificado on-chain"}</div>
            <Pill tono="brand">{chain?.red_label ?? "Avalanche"}</Pill>
          </div>

          {chain && !chain.registrado ? (
            <p className="mt-3 text-[12px] leading-relaxed text-tenue">
              Todavía no tiene score de comprador para registrar en la cadena — opera como
              proveedor en la red. Cuando tome crédito, su score queda escrito en Avalanche y
              aparece acá con su QR de verificación.
            </p>
          ) : (
          <>
          <div className="mt-3 flex flex-col items-center">
            {qrValue ? (
              <div className="rounded-xl bg-white p-2.5">
                <QRCodeSVG value={qrValue} size={132} level="M" />
              </div>
            ) : (
              <div className="grid size-[152px] place-items-center rounded-xl bg-white/5 text-[12px] text-tenue">Generando…</div>
            )}
            <div className="mt-2 text-[11px] text-tenue">Escaneá para verificar el score</div>
          </div>

          <div className="mt-3 space-y-1.5 text-[11.5px]">
            <div className="flex justify-between gap-3">
              <span className="text-tenue">Red</span>
              <span className="num text-tinta">{chain?.red_label ?? "Avalanche (modo demo)"}</span>
            </div>
            {chain?.contrato_address && (
              <div className="flex justify-between gap-3">
                <span className="shrink-0 text-tenue">Contrato</span>
                <span className="num truncate text-tinta">{chain.contrato_address}</span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="shrink-0 text-tenue">Tx</span>
              <span className="num truncate text-tinta">{chain?.tx_hash ?? "…"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-tenue">Score registrado</span>
              <span className="num text-tinta">{chain?.score ?? "—"}</span>
            </div>
          </div>

          {chain?.explorer_url ? (
            <a href={chain.explorer_url} target="_blank" rel="noopener noreferrer"
              className="mt-3 block rounded-full border border-brand/50 py-1.5 text-center text-[12.5px] font-semibold text-brand hover:bg-brand/10">
              Ver en Snowtrace →
            </a>
          ) : (
            <button onClick={() => window.open(`/verificar/${entidadId}`, "_blank")}
              className="mt-3 block w-full rounded-full border border-brand/50 py-1.5 text-center text-[12.5px] font-semibold text-brand hover:bg-brand/10">
              Abrir verificación →
            </button>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-tenue">
            El score no vive solo en PolFin: queda registrado en Avalanche —
            portable, infalsificable y propiedad {esYo ? "tuya" : "del cliente"}. Ese es el
            buró de crédito descentralizado, hecho visible.
            {!chain?.es_real && <span className="block mt-1 text-tenue/70">(Modo demo: registro simulado. Con POLFIN_CHAIN_MODE=fuji o avalanche el QR lleva a la transacción real en Snowtrace.)</span>}
          </p>
          </>
          )}
        </Carta>
      </div>

      {/* ---- condiciones + historial + relaciones ---- */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {score?.condiciones && (
          <Carta>
            <Etiqueta>Condiciones sugeridas</Etiqueta>
            <div className="mt-2 space-y-1.5 text-[13px]">
              <div className="flex justify-between"><span className="text-tenue">Límite</span><span className="num">{pesos(score.condiciones.limite_sugerido_pesos)}</span></div>
              <div className="flex justify-between"><span className="text-tenue">Tasa</span><span className="num">{score.condiciones.tasa_sugerida_tna != null ? `${score.condiciones.tasa_sugerida_tna}% TNA` : "—"}</span></div>
              <div className="flex justify-between"><span className="text-tenue">Plazo</span><span className="num">{score.condiciones.plazo_max_dias} días</span></div>
            </div>
          </Carta>
        )}
        {score?.metricas && (
          <Carta>
            <Etiqueta>Historial</Etiqueta>
            <div className="mt-2 space-y-1.5 text-[13px]">
              <div className="flex justify-between"><span className="text-tenue">Operaciones</span><span className="num">{score.metricas.operaciones ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-tenue">% puntual</span><span className="num">{score.metricas.pct_puntual ?? "—"}%</span></div>
              <div className="flex justify-between"><span className="text-tenue">Vencidas</span><span className={`num ${(score.metricas.vencidas_impagas ?? 0) > 0 ? "text-mal" : ""}`}>{score.metricas.vencidas_impagas ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-tenue">Antigüedad</span><span className="num">{score.metricas.meses_antiguedad ?? 0} m</span></div>
            </div>
          </Carta>
        )}
        <Carta>
          <Etiqueta>Relaciones en la red</Etiqueta>
          <div className="mt-2 space-y-2 text-[12.5px]">
            {relaciones.proveedores.length > 0 && (
              <div>
                <div className="text-[11px] text-tenue">Le compra a ({relaciones.proveedores.length})</div>
                <div className="text-tinta/85">{relaciones.proveedores.slice(0, 3).join(", ")}{relaciones.proveedores.length > 3 ? "…" : ""}</div>
              </div>
            )}
            {relaciones.clientes.length > 0 && (
              <div>
                <div className="text-[11px] text-tenue">Le fía a ({relaciones.clientes.length})</div>
                <div className="text-tinta/85">{relaciones.clientes.slice(0, 3).join(", ")}{relaciones.clientes.length > 3 ? "…" : ""}</div>
              </div>
            )}
            {relaciones.proveedores.length === 0 && relaciones.clientes.length === 0 && (
              <p className="text-tenue">Sin relaciones registradas todavía.</p>
            )}
            <button onClick={() => irA("cerebro", entidadId)} className="text-[12px] font-medium text-brand hover:underline">Ver en el Cerebro →</button>
          </div>
        </Carta>
      </div>

      {/* documentos: e-pagarés de la entidad — ver y descargar (PDF) */}
      {docs && docs.length > 0 && (
        <Carta className="mt-4">
          <Etiqueta>Documentos · e-Pagarés ({docs.length})</Etiqueta>
          <div className="mt-2 divide-y divide-linea/60">
            {docs.slice(0, 6).map((i) => (
              <button key={i.id} onClick={() => abrirDoc?.({ tipo: "epagare", id: i.id })}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-white/4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/12 text-brand">
                  <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden><path d="M7 3h7l4 4v14H7z" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinejoin="round" /><path d="M14 3v4h4" stroke="currentColor" strokeWidth="1.7" fill="none" /></svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">e-Pagaré · {i.deudor_nombre} → {i.acreedor_nombre}</span>
                  <span className="block text-[11.5px] text-tenue">{pesos(i.monto)} · vence {fechaCorta(i.fecha_vencimiento)}</span>
                </span>
                <span className="shrink-0 text-[12px] text-brand">Ver / PDF →</span>
              </button>
            ))}
          </div>
        </Carta>
      )}
    </div>
  );
}
