"use client";
// Vista pública de VERIFICACIÓN del score on-chain — a esto apunta el QR del
// perfil en modo mock (POLFIN_CHAIN_MODE=mock). Muestra el registro real que
// produjo la capa on-chain (hash, score, timestamp, entidad), de forma honesta.
// En POLFIN_CHAIN_MODE=fuji el QR apunta directo a Snowtrace en su lugar.
import { use, useEffect, useState } from "react";
import { api, type OnchainScore } from "@/lib/api";

export default function VerificarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<OnchainScore | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<OnchainScore>(`/api/onchain/score/${id}`).then(setData).catch((e) => setError(String(e.message ?? e)));
  }, [id]);

  return (
    <div className="min-h-screen bg-ink px-4 py-10 text-tinta">
      <div className="mx-auto max-w-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/polfin-logo.jpeg" alt="PolFin" className="mx-auto h-auto w-[120px] rounded" />
        <p className="mt-2 text-center text-[11px] uppercase tracking-[0.16em] text-tenue">
          Verificación de score on-chain
        </p>

        <div className="mt-6 rounded-2xl border border-linea bg-panel p-6">
          {error && <p className="text-[13px] text-mal">No se pudo verificar: {error}</p>}
          {!data && !error && <p className="text-[13px] text-tenue">Verificando en la cadena…</p>}
          {data && (
            <>
              <div className="flex items-center justify-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-brand/15">
                  <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden><path d="M5 12.5 10 17l9-10" stroke="var(--color-brand)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <span className="text-[15px] font-semibold text-brand">Verificado on-chain · Avalanche</span>
              </div>

              <h1 className="mt-5 text-center text-[22px] font-semibold tracking-tight">{data.entidad.nombre}</h1>
              <p className="text-center text-[12.5px] text-tenue">
                {data.entidad.tipo === "persona" ? "Consumidor final" : data.entidad.rubro ?? "Comercio"}
                {data.entidad.ciudad ? ` · ${data.entidad.ciudad}` : ""}
              </p>

              <div className="mt-5 grid place-items-center rounded-xl bg-ink/60 py-5">
                <div className="text-[10px] uppercase tracking-[0.14em] text-tenue">Score registrado</div>
                <div className="num text-[52px] font-semibold leading-none text-brand">{data.score ?? "—"}</div>
              </div>

              <div className="mt-5 space-y-2 text-[12px]">
                <Fila k="Red" v={`Avalanche ${data.es_real ? "Fuji (testnet)" : "Fuji (testnet · mock)"}`} />
                {data.contrato_address && <Fila k="Contrato" v={data.contrato_address} mono />}
                <Fila k="Tx hash" v={data.tx_hash ?? "—"} mono />
                {data.timestamp && <Fila k="Registrado" v={data.timestamp} />}
              </div>

              {data.explorer_url && (
                <a href={data.explorer_url} target="_blank" rel="noopener noreferrer"
                  className="mt-5 block rounded-full bg-brand py-2 text-center text-[13px] font-semibold text-black">
                  Ver la transacción en Snowtrace →
                </a>
              )}

              <p className="mt-5 text-[11.5px] leading-relaxed text-tenue">
                Este score no vive solo en la base de datos de PolFin: está registrado en
                Avalanche, es <span className="text-tinta">portable, infalsificable y propiedad
                del cliente</span>. Cualquiera puede verificarlo sin depender de PolFin — ese es
                el buró de crédito descentralizado.
                {!data.es_real && (
                  <span className="mt-2 block text-tenue/70">
                    Modo demostración: el registro es simulado pero íntegro. Con la cadena real
                    (Fuji) activada, este código lleva a la transacción verificable en Snowtrace.
                  </span>
                )}
              </p>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-tenue">PolFin · el buró de crédito de la economía informal</p>
      </div>
    </div>
  );
}

function Fila({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-tenue">{k}</span>
      <span className={`truncate text-tinta ${mono ? "num" : ""}`}>{v}</span>
    </div>
  );
}
