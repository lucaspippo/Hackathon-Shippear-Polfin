"use client";
// Pagos — cobros que entran y cuánto falta para cerrar cada deuda. El progreso
// sale de la tabla `pagos` real (parciales incluidos), no de un % inventado.
// Registrar pago es mock (sin Mercado Pago): suma un pago total o parcial,
// baja el saldo y, si llega a 0, salda la deuda.
import { useState } from "react";
import { apiPost, pesos, fechaCorta, type ResumenPagos, type Tx } from "@/lib/api";
import type { Rol } from "@/lib/roles";
import { Carta, Etiqueta, Pill, Punto, useApi } from "@/components/ui";
import type { DocRef } from "@/components/documento";

const diasA = (venc: string) =>
  Math.round((new Date(venc + "T00:00:00").getTime() - Date.now()) / 86400000);

function Progreso({ pagado, total }: { pagado: number; total: number }) {
  const pct = Math.min(100, Math.round((pagado / total) * 100));
  return (
    <div className="mt-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-linea">
        <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-tenue">
        <span>pagó <span className="num text-tinta">{pesos(pagado)}</span></span>
        <span className="num">{pct}%</span>
      </div>
    </div>
  );
}

function FilaDeuda({
  t, contraparte, cobrable, onPago,
}: {
  t: Tx; contraparte: string; cobrable: boolean;
  onPago: (txId: number, monto: number) => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const saldo = t.saldo ?? t.monto;
  const pagado = t.pagado ?? 0;
  const dias = diasA(t.fecha_vencimiento);
  const vencida = t.estado === "vencida";

  const registrar = async (total: boolean) => {
    const m = total ? saldo : Math.round(Number(monto.replace(/\./g, "")));
    if (!Number.isFinite(m) || m <= 0) return;
    setOcupado(true);
    try { await onPago(t.id, m); setAbierto(false); setMonto(""); }
    finally { setOcupado(false); }
  };

  return (
    <div className="rounded-xl border border-linea bg-carta p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Punto tono={vencida ? "mal" : "tenue"} />
            <span className="text-[14px] font-medium">{contraparte}</span>
            {vencida
              ? <Pill tono="mal">vencida hace {-dias} d</Pill>
              : <Pill tono="tenue">vence {fechaCorta(t.fecha_vencimiento)}</Pill>}
          </div>
          <p className="mt-1 pl-4 text-[12px] text-tenue">{t.concepto}</p>
        </div>
        <div className="shrink-0 text-right">
          <Etiqueta>Falta</Etiqueta>
          <div className={`num text-[18px] font-semibold ${vencida ? "text-mal" : ""}`}>{pesos(saldo)}</div>
          <div className="text-[11px] text-tenue">de {pesos(t.monto)}</div>
        </div>
      </div>

      <Progreso pagado={pagado} total={t.monto} />

      {cobrable && (
        <div className="mt-3">
          {!abierto ? (
            <button onClick={() => setAbierto(true)}
              className="rounded-full border border-linea px-3.5 py-1.5 text-[12.5px] text-tinta/85 transition-colors hover:border-brand/50 hover:text-brand">
              Registrar pago
            </button>
          ) : (
            <div className="subiendo flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-full border border-linea bg-ink px-3 py-1.5">
                <span className="text-[12px] text-tenue">$</span>
                <input
                  autoFocus inputMode="numeric" value={monto}
                  onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder={`parcial (máx ${saldo.toLocaleString("es-AR")})`}
                  className="num w-40 bg-transparent text-[13px] text-tinta placeholder:text-tenue focus:outline-none"
                />
              </div>
              <button onClick={() => registrar(false)} disabled={ocupado || !monto}
                className="rounded-full bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-black transition-transform hover:scale-[1.02] disabled:opacity-50">
                {ocupado ? "…" : "Cobrar parcial"}
              </button>
              <button onClick={() => registrar(true)} disabled={ocupado}
                className="rounded-full border border-brand/40 bg-brand/10 px-3.5 py-1.5 text-[12.5px] font-medium text-brand disabled:opacity-50">
                Saldar todo ({pesos(saldo)})
              </button>
              <button onClick={() => setAbierto(false)} className="text-[12.5px] text-tenue hover:text-tinta">cancelar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Pagos({
  rol, refresh, recargar, abrirDoc,
}: { rol: Rol; refresh: number; recargar: () => void; abrirDoc: (d: DocRef) => void }) {
  const [tick, setTick] = useState(0);
  const dep = [refresh, tick];
  const { data: resumen } = useApi<ResumenPagos>(`/api/pagos/resumen/${rol.entidadId}`, dep);
  const { data: porCobrar } = useApi<Tx[]>(`/api/pagos/por-cobrar/${rol.entidadId}`, dep);
  const { data: porPagar } = useApi<Tx[]>(`/api/pagos/por-pagar/${rol.entidadId}`, dep);
  const [ultimo, setUltimo] = useState<{ comprobante: string; monto: number; saldada: boolean } | null>(null);
  const esConsumidor = rol.id === "consumidor";

  const registrarPago = async (txId: number, monto: number) => {
    const r = await apiPost<{ comprobante: string; monto: number; saldada: boolean }>("/api/pagos", {
      transaccion_id: txId, monto, metodo: "transferencia",
    });
    setUltimo(r);
    setTick((n) => n + 1);   // refresca resumen + listas de esta vista
    recargar();              // refresca badges/feed del resto de la app
  };

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <h1 className="text-[28px] font-semibold tracking-tight">
        {esConsumidor ? "Mis pagos" : "Pagos y cobros"}
      </h1>
      <p className="mt-1 text-[13.5px] text-tenue">
        {esConsumidor
          ? "Lo que debés y cuánto te falta para saldar cada compra."
          : "Los cobros que entran y cuánto falta para cerrar cada deuda de la cadena."}
      </p>

      {/* resumen del rol */}
      <div className="mt-6 grid grid-cols-4 gap-4">
        {!esConsumidor && (
          <Carta><Etiqueta>Cobrado</Etiqueta>
            <div className="num mt-1.5 text-[22px] font-semibold text-okk">{pesos(resumen?.cobrado ?? 0)}</div></Carta>
        )}
        {!esConsumidor && (
          <Carta><Etiqueta>Por cobrar (vivo)</Etiqueta>
            <div className="num mt-1.5 text-[22px] font-semibold">{pesos(resumen?.por_cobrar ?? 0)}</div></Carta>
        )}
        {!esConsumidor && (
          <Carta><Etiqueta>Vencido sin cobrar</Etiqueta>
            <div className={`num mt-1.5 text-[22px] font-semibold ${(resumen?.vencido ?? 0) > 0 ? "text-mal" : "text-tenue"}`}>{pesos(resumen?.vencido ?? 0)}</div></Carta>
        )}
        <Carta className={esConsumidor ? "col-span-2" : ""}>
          <Etiqueta>{esConsumidor ? "Lo que debés" : "Le debés a proveedores"}</Etiqueta>
          <div className="num mt-1.5 text-[22px] font-semibold">{pesos(resumen?.debe ?? 0)}</div></Carta>
      </div>

      {ultimo && (
        <div className="subiendo mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-okk/30 bg-okk/8 px-4 py-2.5 text-[13px]">
          <Punto tono="ok" />
          Pago de {pesos(ultimo.monto)} registrado · comprobante <span className="num">{ultimo.comprobante}</span>
          {ultimo.saldada && <span className="font-medium text-okk">· deuda saldada ✓</span>}
          <button onClick={() => abrirDoc({ tipo: "comprobante", codigo: ultimo.comprobante })}
            className="ml-auto rounded-full border border-okk/40 px-3 py-1 text-[12px] font-medium text-okk hover:bg-okk/10">
            Ver comprobante →
          </button>
        </div>
      )}

      {/* cobros: deudas vivas donde soy acreedor (no aplica a consumidor) */}
      {!esConsumidor && (
        <section className="mt-8">
          <h2 className="text-[15px] font-semibold">Por cobrar — cuánto falta ({porCobrar?.length ?? 0})</h2>
          <p className="mt-1 text-[12.5px] text-tenue">Registrá lo que te van pagando; el saldo baja en el acto.</p>
          <div className="mt-3 space-y-2">
            {porCobrar?.length === 0 && <p className="text-[13px] text-tenue">Nada vivo por cobrar.</p>}
            {porCobrar?.map((t) => (
              <FilaDeuda key={t.id} t={t} contraparte={t.deudor_nombre ?? ""} cobrable onPago={registrarPago} />
            ))}
          </div>
        </section>
      )}

      {/* cuentas por pagar: deudas vivas donde soy deudor */}
      <section className="mt-8">
        <h2 className="text-[15px] font-semibold">
          {esConsumidor ? "Tu fiado vivo — cuánto falta" : "Le compro a — cuánto le debo"} ({porPagar?.length ?? 0})
        </h2>
        <div className="mt-3 space-y-2">
          {porPagar?.length === 0 && <p className="text-[13px] text-tenue">Sin cuentas por pagar vivas.</p>}
          {porPagar?.map((t) => (
            <FilaDeuda key={t.id} t={t} contraparte={t.acreedor_nombre ?? ""}
              cobrable={esConsumidor} onPago={registrarPago} />
          ))}
        </div>
      </section>
    </div>
  );
}
