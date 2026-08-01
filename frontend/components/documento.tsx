"use client";
// Documentos legibles: el e-pagaré y el comprobante de pago, con identidad
// PolFin. El logo es marca, no requisito legal — el documento vale por los
// datos y la firma/aceptación de las partes. Se abre como overlay desde
// cualquier lado (comercio, consumidor, Pagos, Aprobaciones).
import Image from "next/image";
import { useEffect } from "react";
import { jsPDF } from "jspdf";
import { pesos, fechaCorta, type Comprobante, type Instrumento } from "@/lib/api";
import { useApi } from "@/components/ui";

export type DocRef =
  | { tipo: "epagare"; id: number }
  | { tipo: "comprobante"; codigo: string };

function Marca() {
  return (
    <div className="flex items-center justify-between border-b border-linea px-7 py-5">
      <Image src="/polfin-logo.jpeg" alt="PolFin" width={104} height={50}
        className="h-auto w-[96px] rounded" />
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-[0.16em] text-tenue">
          El buró de crédito de la economía informal
        </div>
        <div className="text-[11px] text-tenue">documento verificable de la red PolFin</div>
      </div>
    </div>
  );
}

function Campo({ etiqueta, valor, mono, tono }: { etiqueta: string; valor: React.ReactNode; mono?: boolean; tono?: "ok" | "brand" }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-tenue">{etiqueta}</div>
      <div className={`mt-1 text-[14px] ${mono ? "num" : ""} ${tono === "ok" ? "text-okk" : tono === "brand" ? "text-brand" : "text-tinta"}`}>
        {valor}
      </div>
    </div>
  );
}

// Arma el PDF del e-pagaré con jsPDF (dibujado a mano, no captura de pantalla):
// el documento se entrega al cliente final por fuera de la app, así que tiene
// que quedar claro e imprimible, no un screenshot del tema oscuro de la UI.
function descargarPdf(i: Instrumento) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margen = 20;
  const anchoUtil = 210 - margen * 2;
  let y = margen;

  const linea = (texto: string, opts: { size?: number; bold?: boolean; color?: number[]; gap?: number } = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size ?? 10);
    doc.setTextColor(opts.color?.[0] ?? 20, opts.color?.[1] ?? 20, opts.color?.[2] ?? 20);
    doc.text(texto, margen, y);
    y += opts.gap ?? 6;
  };
  const gris = [110, 110, 110];

  linea("PolFin", { size: 16, bold: true, gap: 6 });
  linea("El buró de crédito de la economía informal", { size: 9, color: gris, gap: 8 });
  doc.setDrawColor(210, 210, 210);
  doc.line(margen, y, 210 - margen, y);
  y += 9;

  linea(`e-Pagaré N.º ${String(i.id).padStart(5, "0")}`, { size: 14, bold: true, gap: 6 });
  linea(
    `Instrumento de crédito comercial · emitido el ${fechaCorta(i.created_at)}`,
    { size: 9.5, color: gris, gap: 10 },
  );

  const colDerecha = margen + anchoUtil / 2;
  const yColumnas = y;
  linea("ACREEDOR (A FAVOR DE)", { size: 8, bold: true, color: gris, gap: 5 });
  linea(i.acreedor_nombre, { size: 11, gap: 5 });
  linea(
    `${i.acreedor_rubro ?? ""}${i.acreedor_ciudad ? ` · ${i.acreedor_ciudad}` : ""}`,
    { size: 9, color: gris, gap: 5 },
  );
  const yTrasIzquierda = y;
  y = yColumnas;
  doc.text("DEUDOR (SE OBLIGA A PAGAR)", colDerecha, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text(i.deudor_nombre, colDerecha, y + 5);
  doc.setFontSize(9);
  doc.setTextColor(gris[0], gris[1], gris[2]);
  doc.text(
    `${i.deudor_tipo === "persona" ? "Consumidor final" : "Comercio"}${i.deudor_ciudad ? ` · ${i.deudor_ciudad}` : ""}`,
    colDerecha, y + 10,
  );
  y = Math.max(yTrasIzquierda, y + 10) + 6;

  doc.setDrawColor(225, 225, 225);
  doc.setFillColor(247, 247, 247);
  doc.roundedRect(margen, y, anchoUtil, 22, 2, 2, "FD");
  const campo = (x: number, etiqueta: string, valor: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(gris[0], gris[1], gris[2]);
    doc.text(etiqueta, x, y + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text(valor, x, y + 15);
  };
  const anchoCol = anchoUtil / 4;
  campo(margen + 3, "MONTO", pesos(i.monto));
  campo(margen + anchoCol + 3, "TASA", `${i.tasa_tna}% TNA`);
  campo(margen + anchoCol * 2 + 3, "PLAZO", `${i.plazo_dias} días`);
  campo(margen + anchoCol * 3 + 3, "VENCE", fechaCorta(i.fecha_vencimiento));
  y += 30;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(60, 60, 60);
  const parrafo = doc.splitTextToSize(
    `Por el presente, ${i.deudor_nombre} se obliga a pagar a ${i.acreedor_nombre} la suma de ` +
    `${pesos(i.monto)} a la tasa y plazo pactados, con vencimiento el ${fechaCorta(i.fecha_vencimiento)}. ` +
    `Instrumento auto-ejecutable registrado on-chain, infalsificable y propiedad de las partes.`,
    anchoUtil,
  );
  doc.text(parrafo, margen, y);
  y += parrafo.length * 5 + 6;

  doc.setDrawColor(225, 225, 225);
  doc.setFillColor(250, 250, 250);
  const alturaChain = i.red === "fuji" && i.token_id != null ? 30 : 24;
  doc.roundedRect(margen, y, anchoUtil, alturaChain, 2, 2, "FD");
  y += 6;
  linea("REGISTRO ON-CHAIN", { size: 8, bold: true, color: gris, gap: 5 });
  linea(`Red: Avalanche ${i.red === "fuji-mock" ? "Fuji (testnet · mock)" : i.red}`, { size: 9, gap: 5 });
  linea(`Contrato: ${i.contrato_address}`, { size: 9, gap: 5 });
  linea(`Tx hash: ${i.tx_hash}`, { size: 9, gap: 5 });
  if (i.red === "fuji" && i.token_id != null) linea(`NFT: token #${i.token_id}`, { size: 9, gap: 5 });
  y += 6;

  const aceptado = i.aceptado === 1;
  linea(
    aceptado
      ? `Deudor: aceptó${i.aceptado_at ? ` el ${fechaCorta(i.aceptado_at)}` : ""}.`
      : "Deudor: pendiente de aceptación.",
    { size: 9, color: aceptado ? [30, 130, 76] : gris, gap: 5 },
  );

  doc.save(`e-pagare-${i.id}.pdf`);
}

function EPagare({ id, onAceptar }: { id: number; onAceptar?: (id: number) => void }) {
  const { data: i } = useApi<Instrumento>(`/api/instrumentos/${id}`);
  if (!i) return <div className="p-8 text-[13px] text-tenue">Cargando el documento…</div>;
  const aceptado = i.aceptado === 1;
  return (
    <>
      <Marca />
      <div className="px-7 py-6">
        <div className="flex items-center justify-between">
          <h2 className="text-[19px] font-semibold tracking-tight">e-Pagaré</h2>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${aceptado ? "bg-okk/12 text-okk" : "bg-brand/12 text-brand"}`}>
            {aceptado ? "Aceptado por ambas partes" : "Pendiente de aceptación del deudor"}
          </span>
        </div>
        <p className="mt-1 text-[12.5px] text-tenue">
          Instrumento de crédito comercial N.º {String(i.id).padStart(5, "0")} · emitido el {fechaCorta(i.created_at)}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
          <Campo etiqueta="Acreedor (a favor de)" valor={<>{i.acreedor_nombre}<span className="block text-[11px] text-tenue">{i.acreedor_rubro}{i.acreedor_ciudad ? ` · ${i.acreedor_ciudad}` : ""}</span></>} />
          <Campo etiqueta="Deudor (se obliga a pagar)" valor={<>{i.deudor_nombre}<span className="block text-[11px] text-tenue">{i.deudor_tipo === "persona" ? "Consumidor final" : "Comercio"}{i.deudor_ciudad ? ` · ${i.deudor_ciudad}` : ""}</span></>} />
        </div>

        <div className="mt-5 rounded-xl border border-linea bg-carta p-4">
          <div className="grid grid-cols-4 gap-4">
            <Campo etiqueta="Monto" valor={pesos(i.monto)} mono />
            <Campo etiqueta="Tasa" valor={`${i.tasa_tna}% TNA`} mono />
            <Campo etiqueta="Plazo" valor={`${i.plazo_dias} días`} mono />
            <Campo etiqueta="Vence" valor={fechaCorta(i.fecha_vencimiento)} mono />
          </div>
        </div>

        <p className="mt-4 text-[12px] leading-relaxed text-tenue">
          Por el presente, <span className="text-tinta">{i.deudor_nombre}</span> se obliga a
          pagar a <span className="text-tinta">{i.acreedor_nombre}</span> la suma de{" "}
          <span className="num text-tinta">{pesos(i.monto)}</span> a la tasa y plazo pactados,
          con vencimiento el {fechaCorta(i.fecha_vencimiento)}. Instrumento auto-ejecutable
          registrado on-chain, infalsificable y propiedad de las partes.
        </p>

        <div className="mt-5 rounded-xl border border-linea bg-ink/50 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-tenue">Registro on-chain</div>
          <div className="mt-1.5 grid grid-cols-1 gap-1 text-[11.5px]">
            <div className="flex justify-between gap-3"><span className="text-tenue">Red</span><span className="num text-tinta">Avalanche {i.red === "fuji-mock" ? "Fuji (testnet · mock)" : i.red}</span></div>
            <div className="flex justify-between gap-3">
              <span className="shrink-0 text-tenue">Contrato</span>
              {i.red === "fuji" ? (
                <a href={`https://testnet.snowtrace.io/address/${i.contrato_address}`} target="_blank" rel="noopener noreferrer"
                  className="num truncate text-brand hover:underline">{i.contrato_address}</a>
              ) : (
                <span className="num truncate text-tinta">{i.contrato_address}</span>
              )}
            </div>
            <div className="flex justify-between gap-3">
              <span className="shrink-0 text-tenue">Tx hash</span>
              {i.red === "fuji" ? (
                <a href={`https://testnet.snowtrace.io/tx/${i.tx_hash}`} target="_blank" rel="noopener noreferrer"
                  className="num truncate text-brand hover:underline">{i.tx_hash}</a>
              ) : (
                <span className="num truncate text-tinta">{i.tx_hash}</span>
              )}
            </div>
            {i.red === "fuji" && i.token_id != null && (
              <div className="flex justify-between gap-3">
                <span className="shrink-0 text-tenue">NFT</span>
                <a href={`https://testnet.snowtrace.io/nft/${i.contrato_address}/${i.token_id}`} target="_blank" rel="noopener noreferrer"
                  className="num truncate text-brand hover:underline">token #{i.token_id}</a>
              </div>
            )}
          </div>
        </div>

        {/* firma / aceptación de las partes */}
        <div className="mt-5 grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-linea p-3 text-center">
            <div className="text-[10px] uppercase tracking-[0.12em] text-tenue">Acreedor</div>
            <div className="mt-2 text-[13px] text-okk">✓ Emitió el instrumento</div>
          </div>
          <div className="rounded-xl border border-linea p-3 text-center">
            <div className="text-[10px] uppercase tracking-[0.12em] text-tenue">Deudor</div>
            {aceptado ? (
              <div className="mt-2 text-[13px] text-okk">✓ Aceptó{i.aceptado_at ? ` el ${fechaCorta(i.aceptado_at)}` : ""}</div>
            ) : onAceptar ? (
              <button onClick={() => onAceptar(i.id)}
                className="mt-2 w-full rounded-full bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-black transition-transform hover:scale-[1.02]">
                Aceptar y firmar
              </button>
            ) : (
              <div className="mt-2 text-[13px] text-tenue">Pendiente</div>
            )}
          </div>
        </div>

        {/* entregar el documento — el deudor (incl. consumidor final) no entra a
            la app: el vendedor lo descarga/imprime y se lo pasa por fuera. */}
        <div className="mt-5 flex flex-col gap-2 rounded-xl border border-linea bg-carta/60 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11.5px] leading-snug text-tenue">
            Entregáselo a tu cliente (impreso o por WhatsApp). No necesita entrar a PolFin.
          </p>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => descargarPdf(i)}
              className="rounded-full bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-black transition-transform hover:scale-[1.02]">
              Descargar PDF
            </button>
            <button onClick={() => window.print()}
              className="rounded-full border border-brand/50 px-3.5 py-1.5 text-[12.5px] font-semibold text-brand transition-colors hover:bg-brand/10">
              Imprimir
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function ComprobantePago({ codigo }: { codigo: string }) {
  const { data: c } = useApi<Comprobante>(`/api/comprobante/${codigo}`);
  if (!c) return <div className="p-8 text-[13px] text-tenue">Cargando el comprobante…</div>;
  return (
    <>
      <Marca />
      <div className="px-7 py-6">
        <div className="flex items-center justify-between">
          <h2 className="text-[19px] font-semibold tracking-tight">Comprobante de pago</h2>
          <span className="rounded-full bg-okk/12 px-2.5 py-1 text-[11px] font-medium text-okk">Pago registrado</span>
        </div>
        <p className="mt-1 num text-[12.5px] text-tenue">{c.comprobante} · {fechaCorta(c.fecha)}</p>

        <div className="mt-5 flex items-baseline justify-between rounded-xl border border-linea bg-carta p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-tenue">Monto pagado</div>
          <div className="num text-[26px] font-semibold text-okk">{pesos(c.monto)}</div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
          <Campo etiqueta="Pagó" valor={c.deudor_nombre} />
          <Campo etiqueta="Cobró" valor={c.acreedor_nombre} />
          <Campo etiqueta="Concepto" valor={c.concepto} />
          <Campo etiqueta="Método" valor={c.metodo.replace("_", " ")} />
          <Campo etiqueta="Deuda total" valor={pesos(c.deuda_total)} mono />
          <Campo etiqueta="Saldo tras el pago" valor={c.saldo_tras_pago === 0 ? "Saldada ✓" : pesos(c.saldo_tras_pago)} mono tono={c.saldo_tras_pago === 0 ? "ok" : undefined} />
        </div>

        <p className="mt-5 text-[11.5px] leading-relaxed text-tenue">
          Comprobante automático generado por PolFin al registrarse el pago. Vale por los
          datos de la operación; no requiere sello ni firma manuscrita.
        </p>
      </div>
    </>
  );
}

export function Documento({
  doc, onCerrar, onAceptar,
}: { doc: DocRef; onCerrar: () => void; onAceptar?: (id: number) => void }) {
  // cerrar con Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCerrar]);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center sm:p-6"
      onClick={onCerrar}>
      <div className="subiendo relative my-auto w-full max-w-lg overflow-hidden rounded-2xl border border-linea bg-panel shadow-2xl shadow-black/70"
        onClick={(e) => e.stopPropagation()}>
        <button onClick={onCerrar} aria-label="Cerrar"
          className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full bg-white/8 text-tenue transition-colors hover:bg-white/14 hover:text-tinta">
          ✕
        </button>
        {doc.tipo === "epagare"
          ? <EPagare id={doc.id} onAceptar={onAceptar} />
          : <ComprobantePago codigo={doc.codigo} />}
      </div>
    </div>
  );
}
