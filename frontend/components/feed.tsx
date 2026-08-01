"use client";
// El feed central: las tarjetas más importantes de hoy, con números REALES
// del backend (scoring P2, transacciones P1, solicitudes del agente P3).
import { useMemo } from "react";
import {
  pesos, fechaCorta,
  type Auditoria, type Deteccion, type EntidadDetalle, type Score, type ScoreResumen, type Solicitud,
} from "@/lib/api";
import type { Rol, Vista } from "@/lib/roles";
import { humanizarAuditoria, fechaRelativa } from "@/lib/actividad";
import { Carta, Etiqueta, Pill, Punto, VerElPorque, tonoRiesgo, useApi } from "@/components/ui";

type TarjetaDef = {
  clave: string;
  pill: { tono: "brand" | "mal" | "ok" | "tenue"; texto: string; n?: number };
  titulo: string;
  detalle: string;
  cifra?: { etiqueta: string; valor: string; tono?: "mal" | "ok" | "normal" };
  cta: { texto: string; vista: Vista; foco?: number };
};

export function Feed({
  rol, solicitudes, auditoria, irA, refresh,
}: {
  rol: Rol; solicitudes: Solicitud[]; auditoria: Auditoria[];
  irA: (v: Vista, foco?: number) => void; refresh: number;
}) {
  const { data: miScore } = useApi<Score>(`/api/score/${rol.entidadId}`, [refresh]);
  const { data: detalle } = useApi<EntidadDetalle>(`/api/entidades/${rol.entidadId}`, [refresh]);
  const { data: scores } = useApi<ScoreResumen[]>("/api/scores", [refresh]);
  const { data: detecciones } = useApi<Deteccion[]>("/api/agente/detecciones", [refresh]);

  const tarjetas = useMemo<TarjetaDef[]>(() => {
    const t: TarjetaDef[] = [];
    if (!detalle || !scores) return t;

    // Lo que Ángela detectó SOLA (monitoreo proactivo) va primero y se nota.
    for (const d of (detecciones ?? []).slice(0, 2)) {
      const datos = d.datos_json ? JSON.parse(d.datos_json) : {};
      t.push({
        clave: `deteccion-${d.id}`,
        pill: { tono: "brand", texto: "Ángela lo detectó sola" },
        titulo: d.titulo,
        detalle: d.detalle,
        cifra: datos.monto ? {
          etiqueta: d.tipo === "ampliacion" ? "Ampliación propuesta" : "En juego",
          valor: pesos(datos.monto),
          tono: d.tipo === "riesgo_atraso" ? "mal" : undefined,
        } : undefined,
        cta: d.tipo === "ampliacion"
          ? { texto: "Revisar y aprobar", vista: "aprobaciones" }
          : d.tipo === "riesgo_atraso"
            ? { texto: "Ver el porqué", vista: "alertas" }
            : { texto: "Ver la cuenta", vista: "pagos" },
      });
    }

    const vencidasCobrar = detalle.como_acreedor.filter((x) => x.estado === "vencida");
    const totalVencido = vencidasCobrar.reduce((s, x) => s + x.monto, 0);
    const deudoresVencidos = new Set(vencidasCobrar.map((x) => x.deudor_id)).size;
    const pendMias = solicitudes.filter(
      (s) => s.estado === "pendiente_aprobacion" && s.acreedor_id === rol.entidadId
    );
    const pendRed = solicitudes.filter((s) => s.estado === "pendiente_aprobacion");

    if (rol.id !== "consumidor") {
      // 1 · esperando tu OK
      const pend = pendMias.length ? pendMias : pendRed;
      if (pend.length) {
        const mayor = pend.reduce((a, b) => (a.monto > b.monto ? a : b));
        t.push({
          clave: "ok",
          pill: { tono: "brand", texto: "Esperando tu OK", n: pend.length },
          titulo: `${mayor.deudor_nombre} pide crédito`,
          detalle: `Ángela ya lo evaluó y las condiciones están listas. Falta solo tu aprobación${pendMias.length ? "" : " (en la red)"}.`,
          cifra: { etiqueta: "Monto del pedido", valor: pesos(mayor.monto) },
          cta: { texto: "Revisar y aprobar", vista: "aprobaciones" },
        });
      }

      // 2 · atrasados
      if (vencidasCobrar.length) {
        t.push({
          clave: "vencido",
          pill: { tono: "mal", texto: "Necesita tu atención", n: vencidasCobrar.length },
          titulo: `Cobrale a ${deudoresVencidos === 1 ? "tu cliente atrasado" : `los ${deudoresVencidos} clientes atrasados`}`,
          detalle: "Crédito vencido sin pagar. Cada día que pasa vale menos con esta inflación.",
          cifra: { etiqueta: "Vencido sin cobrar", valor: pesos(totalVencido), tono: "mal" },
          cta: { texto: "Ver el porqué", vista: "alertas" },
        });
      }

      // 3 · oportunidad: mi mejor pagador
      const misClientes = new Set(detalle.como_acreedor.map((x) => x.deudor_id));
      const mejor = scores
        .filter((s) => misClientes.has(s.id) && (s.score ?? 0) >= 700)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
      if (mejor) {
        t.push({
          clave: "oportunidad",
          pill: { tono: "brand", texto: "Oportunidad detectada" },
          titulo: `${mejor.nombre} merece más crédito`,
          detalle: `Score ${mejor.score} verificado en toda la red (${mejor.pct_puntual}% puntual). Podés fiarle más con menos riesgo.`,
          cifra: { etiqueta: "Límite sugerido", valor: pesos(mejor.limite_sugerido_pesos) },
          cta: { texto: "Verlo en el Cerebro", vista: "cerebro", foco: mejor.id },
        });
      }

      // 4 · mi reputación como comprador
      if (miScore?.score != null) {
        t.push({
          clave: "reputacion",
          pill: { tono: tonoRiesgo(miScore.condiciones.riesgo), texto: `Riesgo ${miScore.condiciones.riesgo}` },
          titulo: "Tu reputación como comprador",
          detalle: `Así te ven tus proveedores cuando les pedís plazo. Tu límite en la red: ${pesos(miScore.condiciones.limite_sugerido_pesos)}.`,
          cifra: { etiqueta: "Tu score", valor: String(miScore.score) },
          cta: { texto: "Ver el porqué", vista: "cerebro", foco: rol.entidadId },
        });
      }
    } else {
      // ------------------------- consumidor final -------------------------
      const vivas = detalle.como_deudor.filter((x) => x.estado === "pendiente");
      const totalVivo = vivas.reduce((s, x) => s + x.monto, 0);
      const proxima = vivas.sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))[0];

      if (miScore?.score != null) {
        t.push({
          clave: "score",
          pill: { tono: tonoRiesgo(miScore.condiciones.riesgo), texto: `Riesgo ${miScore.condiciones.riesgo}` },
          titulo: "Tu reputación, en un número",
          detalle: `Construida con ${miScore.metricas.pagadas} pagos reales en ${miScore.metricas.comercios_con_buen_comportamiento} comercios. Nadie te la puede inventar ni sacar.`,
          cifra: { etiqueta: "Tu score", valor: String(miScore.score) },
          cta: { texto: "Ver el porqué", vista: "cerebro", foco: rol.entidadId },
        });
        t.push({
          clave: "limite",
          pill: { tono: "tenue", texto: "Tu crédito en la red" },
          titulo: "Lo que tu score te consigue",
          detalle: `Tasa ${miScore.condiciones.tasa_sugerida_tna}% TNA y hasta ${miScore.condiciones.plazo_max_dias} días de plazo en cualquier comercio adherido.`,
          cifra: { etiqueta: "Límite sugerido", valor: pesos(miScore.condiciones.limite_sugerido_pesos) },
          cta: { texto: "Mis condiciones", vista: "cartera" },
        });
      }
      if (vivas.length) {
        t.push({
          clave: "deuda",
          pill: { tono: "tenue", texto: "Al día", n: vivas.length },
          titulo: "Tu fiado vivo",
          detalle: proxima
            ? `El próximo vence el ${fechaCorta(proxima.fecha_vencimiento)} en ${proxima.acreedor_nombre}. Pagarlo a tiempo te sube el score.`
            : "Sin vencimientos cerca.",
          cifra: { etiqueta: "Debés en total", valor: pesos(totalVivo) },
          cta: { texto: "Ver mi historial", vista: "cartera" },
        });
      }
      t.push({
        clave: "presentar",
        pill: { tono: "brand", texto: "Tu score te acompaña" },
        titulo: "Comprá donde nunca compraste",
        detalle: "Llegá a un comercio nuevo y presentá tu reputación de toda la red. Te fían como si te conocieran de años.",
        cta: { texto: "Ver mi red", vista: "cerebro", foco: rol.entidadId },
      });
    }
    return t.slice(0, 4);
  }, [detalle, scores, solicitudes, miScore, rol, detecciones]);

  const actividad = humanizarAuditoria(auditoria, 6);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <p className="text-[14px] text-tenue">Hola, {rol.persona}.</p>
      <h1 className="mt-1 text-[34px] font-semibold leading-tight tracking-tight">
        {rol.saludo}
      </h1>
      <p className="mt-2 text-[14px] text-tenue">
        {tarjetas.length
          ? `Esto es lo más importante de hoy — con los números reales de la red.`
          : "Cargando los números de la red…"}
      </p>

      {/* tarjetas */}
      <div className="mt-7 grid grid-cols-1 gap-4 md:grid-cols-2">
        {tarjetas.map((t) => (
          <Carta key={t.clave} className="subiendo flex flex-col">
            <div className="flex items-center justify-between">
              <Pill tono={t.pill.tono}>
                <Punto tono={t.pill.tono} /> {t.pill.texto}
              </Pill>
              {t.pill.n ? <span className="num text-[12px] text-tenue">{t.pill.n}</span> : null}
            </div>
            <h3 className="mt-3.5 text-[17px] font-semibold leading-snug">{t.titulo}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-tenue">{t.detalle}</p>
            <div className="mt-auto flex items-end justify-between pt-4">
              {t.cifra ? (
                <div>
                  <Etiqueta>{t.cifra.etiqueta}</Etiqueta>
                  <div className={`num mt-1 text-[26px] font-semibold leading-none ${
                    t.cifra.tono === "mal" ? "text-mal" : t.cifra.tono === "ok" ? "text-okk" : ""
                  }`}>
                    {t.cifra.valor}
                  </div>
                </div>
              ) : <div />}
              <VerElPorque texto={t.cta.texto} onClick={() => irA(t.cta.vista, t.cta.foco)} />
            </div>
          </Carta>
        ))}
      </div>

      {/* lo que Ángela ya hizo */}
      <section className="mt-10 rounded-2xl border border-linea bg-carta/60 p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-brand/15">
            <span className="size-3 rounded-full bg-brand" />
          </span>
          <h2 className="text-[16px] font-semibold">Lo que Ángela ya hizo</h2>
          <span className="ml-auto text-[12px] text-tenue">del log de auditoría real</span>
        </div>
        <div className="mt-4 divide-y divide-linea/70">
          {actividad.length === 0 && (
            <p className="py-4 text-[13px] text-tenue">
              Todavía no corrió ninguna evaluación. Pedile una desde el panel de la derecha →
            </p>
          )}
          {actividad.map((a) => (
            <div key={a.id} className="flex items-center gap-3 py-3">
              <Punto tono={a.tono === "mal" ? "mal" : a.tono} />
              <p className="text-[13.5px]">{a.texto}</p>
              <span className="ml-auto shrink-0 text-[12px] text-tenue">{fechaRelativa(a.fecha)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
