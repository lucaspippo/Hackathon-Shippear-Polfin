"use client";
// Cuentas de la cadena (multi-rol real): lo que me deben (como acreedor) y
// lo que debo (como deudor). Para el consumidor: su historial y sus límites.
import { useMemo } from "react";
import { pesos, fechaCorta, type EntidadDetalle, type Score, type Tx } from "@/lib/api";
import type { Rol, Vista } from "@/lib/roles";
import { Carta, Etiqueta, Pill, Punto, tonoRiesgo, useApi } from "@/components/ui";

function FilaTx({ t, contraparte, irA }: { t: Tx; contraparte: string; irA?: () => void }) {
  const tono = t.estado === "vencida" ? "mal" : t.estado === "pendiente" ? "tenue" : "ok";
  return (
    <button onClick={irA} disabled={!irA}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors enabled:hover:bg-white/4">
      <Punto tono={tono} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px]">{contraparte}</span>
        <span className="block text-[11.5px] text-tenue">
          {t.concepto} · {t.estado === "pagada"
            ? `pagada el ${fechaCorta(t.fecha_pago_real!)}`
            : `vence ${fechaCorta(t.fecha_vencimiento)}`}
        </span>
      </span>
      <span className={`num shrink-0 text-[13.5px] ${t.estado === "vencida" ? "text-mal" : ""}`}>
        {pesos(t.monto)}
      </span>
    </button>
  );
}

export function Cartera({
  rol, irA, refresh,
}: { rol: Rol; irA: (v: Vista, foco?: number) => void; refresh: number }) {
  const { data: det } = useApi<EntidadDetalle>(`/api/entidades/${rol.entidadId}`, [refresh]);
  const { data: score } = useApi<Score>(`/api/score/${rol.entidadId}`, [refresh]);
  const esConsumidor = rol.id === "consumidor";

  const resumen = useMemo(() => {
    if (!det) return null;
    const vivasCobrar = det.como_acreedor.filter((t) => t.estado !== "pagada");
    const vencidasCobrar = det.como_acreedor.filter((t) => t.estado === "vencida");
    const vivasPagar = det.como_deudor.filter((t) => t.estado !== "pagada");
    return {
      porCobrar: vivasCobrar.reduce((s, t) => s + t.monto, 0),
      vencido: vencidasCobrar.reduce((s, t) => s + t.monto, 0),
      porPagar: vivasPagar.reduce((s, t) => s + t.monto, 0),
      vivasCobrar, vivasPagar,
      historial: det.como_deudor.slice(0, 14),
    };
  }, [det]);

  if (!resumen) return <div className="p-10 text-[13px] text-tenue">Cargando la cartera…</div>;

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <h1 className="text-[28px] font-semibold tracking-tight">
        {esConsumidor ? "Mi historial y límites" : "Cuentas de la cadena"}
      </h1>
      <p className="mt-1 text-[13.5px] text-tenue">
        {esConsumidor
          ? "Todo lo que construyó tu reputación, transacción por transacción."
          : "Las dos caras de tu negocio: a quién le fiás y a quién le comprás."}
      </p>

      {/* resumen */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        {!esConsumidor && (
          <>
            <Carta><Etiqueta>Por cobrar</Etiqueta>
              <div className="num mt-1.5 text-[24px] font-semibold">{pesos(resumen.porCobrar)}</div></Carta>
            <Carta><Etiqueta>Vencido</Etiqueta>
              <div className={`num mt-1.5 text-[24px] font-semibold ${resumen.vencido ? "text-mal" : ""}`}>
                {pesos(resumen.vencido)}</div></Carta>
            <Carta><Etiqueta>Por pagar</Etiqueta>
              <div className="num mt-1.5 text-[24px] font-semibold">{pesos(resumen.porPagar)}</div></Carta>
          </>
        )}
        {esConsumidor && score && (
          <>
            <Carta><Etiqueta>Tu score</Etiqueta>
              <div className="num mt-1.5 text-[24px] font-semibold">{score.score ?? "—"}</div>
              <Pill tono={tonoRiesgo(score.condiciones.riesgo)}>riesgo {score.condiciones.riesgo}</Pill></Carta>
            <Carta><Etiqueta>Tu límite en la red</Etiqueta>
              <div className="num mt-1.5 text-[24px] font-semibold">{pesos(score.condiciones.limite_sugerido_pesos)}</div>
              <div className="mt-1 text-[11.5px] text-tenue">tasa {score.condiciones.tasa_sugerida_tna}% · {score.condiciones.plazo_max_dias} días</div></Carta>
            <Carta><Etiqueta>Fiado vivo</Etiqueta>
              <div className="num mt-1.5 text-[24px] font-semibold">{pesos(resumen.porPagar)}</div></Carta>
          </>
        )}
      </div>

      <div className={`mt-6 grid gap-5 ${esConsumidor ? "" : "grid-cols-2"}`}>
        {!esConsumidor && (
          <Carta>
            <h3 className="text-[15px] font-semibold">Le fío a ({resumen.vivasCobrar.length} vivas)</h3>
            <div className="mt-2 divide-y divide-linea/60">
              {resumen.vivasCobrar.slice(0, 12).map((t) => (
                <FilaTx key={t.id} t={t} contraparte={t.deudor_nombre ?? ""} irA={() => irA("cerebro", t.deudor_id)} />
              ))}
              {resumen.vivasCobrar.length === 0 && <p className="py-3 text-[12.5px] text-tenue">Nada vivo por cobrar.</p>}
            </div>
          </Carta>
        )}
        <Carta>
          <h3 className="text-[15px] font-semibold">
            {esConsumidor ? "Mi historial (lo que ve la red)" : `Le compro a (${resumen.vivasPagar.length} vivas)`}
          </h3>
          <div className="mt-2 divide-y divide-linea/60">
            {(esConsumidor ? resumen.historial : resumen.vivasPagar.slice(0, 12)).map((t) => (
              <FilaTx key={t.id} t={t} contraparte={t.acreedor_nombre ?? ""} irA={() => irA("cerebro", t.acreedor_id)} />
            ))}
          </div>
        </Carta>
      </div>
    </div>
  );
}
