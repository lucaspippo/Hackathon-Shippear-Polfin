"use client";
// El feed del inicio, AHORA AI-NATIVE: arriba, los INSIGHTS que Ángela generó
// SOLA leyendo la red (cambio de comportamiento, concentración, oportunidad,
// anomalía, cobros) — cada uno marcado "Detectado por Ángela". Debajo, una tira
// de contexto MACRO (neutral) y el registro de lo que Ángela ya hizo. La
// distinción es a propósito: la IA DETECTA y prioriza; el motor determinístico
// DECIDE el score/condiciones (fórmula auditable).
import { useMemo } from "react";
import {
  pesos, type Auditoria, type Score, type Solicitud,
} from "@/lib/api";
import type { Rol, Vista } from "@/lib/roles";
import { humanizarAuditoria, fechaRelativa } from "@/lib/actividad";
import { Carta, Pill, Punto, useApi, tonoRiesgo } from "@/components/ui";

type Insight = {
  tipo: "cambio_comportamiento" | "concentracion" | "oportunidad" | "anomalia" | "cobros" | string;
  severidad: number; titulo: string; senal: string; explicacion: string; accion: string;
  datos: { deudorId?: number; [k: string]: unknown }; fuente: string;
};

type MacroCtx = {
  disponible: boolean;
  fecha_corte?: string; neutralidad?: string; sesgo?: string; resumen?: string;
  indicadores?: {
    inflacion_mensual_pct?: number; inflacion_mensual_tendencia?: string;
    tamar_tna?: number; riesgo_pais_pb?: number; mora_sector_privado_pct?: number;
  };
  politica?: { tasa_base_tna?: number; plazo_base_dias?: number; plazo_extensible_dias?: number };
};

// Marca visual: esto lo generó la IA (Ángela), no un filtro estático.
function MarcaAngela() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/12 px-2.5 py-1 text-[11px] font-medium text-brand">
      <span className="relative flex size-3 items-center justify-center">
        <span className="size-2 rounded-full bg-brand" />
        <span className="absolute inset-0 animate-ping rounded-full bg-brand/40" />
      </span>
      Detectado por Ángela
    </span>
  );
}

const ICONO_TIPO: Record<string, string> = {
  cambio_comportamiento: "Cambio de comportamiento",
  concentracion: "Riesgo de concentración",
  oportunidad: "Oportunidad de crédito",
  anomalia: "Anomalía de patrón",
  cobros: "Cobros y vencimientos",
};

function ctaDe(i: Insight): { texto: string; vista: Vista; foco?: number } {
  const foco = i.datos?.deudorId;
  switch (i.tipo) {
    case "cambio_comportamiento": return { texto: "Ver el porqué", vista: "cerebro", foco };
    case "concentracion": return { texto: "Ver mi cartera", vista: "cartera" };
    case "oportunidad": return { texto: "Verlo en el Cerebro", vista: "cerebro", foco };
    case "anomalia": return { texto: "Revisar el cliente", vista: "cerebro", foco };
    case "cobros": return { texto: "Ir a cobrar", vista: "pagos" };
    default: return { texto: "Ver", vista: "cerebro", foco };
  }
}

export function Feed({
  rol, solicitudes, auditoria, irA, refresh,
}: {
  rol: Rol; solicitudes: Solicitud[]; auditoria: Auditoria[];
  irA: (v: Vista, foco?: number) => void; refresh: number;
}) {
  const { data: miScore } = useApi<Score>(`/api/score/${rol.entidadId}`, [refresh]);
  const { data: insights } = useApi<Insight[]>(`/api/agente/insights?entidadId=${rol.entidadId}`, [refresh, rol.entidadId]);
  const { data: macro } = useApi<MacroCtx>("/api/macro/contexto", []);

  const pendMias = useMemo(
    () => solicitudes.filter((s) => s.estado === "pendiente_aprobacion" && s.acreedor_id === rol.entidadId),
    [solicitudes, rol.entidadId]
  );
  const actividad = humanizarAuditoria(auditoria, 6);
  const cargando = insights === undefined;

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <p className="text-[14px] text-tenue">Hola, {rol.persona}.</p>
      <h1 className="mt-1 text-[34px] font-semibold leading-tight tracking-tight">{rol.saludo}</h1>

      {/* tira de contexto macro (NEUTRAL: solo indicadores y su impacto en riesgo) */}
      {macro?.disponible && macro.indicadores && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-linea bg-carta/60 px-4 py-2.5 text-[12px]">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-tenue">Contexto del país</span>
          <span className="text-tinta/85">Inflación <span className="num">{macro.indicadores.inflacion_mensual_pct}%</span> mensual ({macro.indicadores.inflacion_mensual_tendencia})</span>
          <span className="text-tinta/85">TAMAR <span className="num">{macro.indicadores.tamar_tna}%</span> TNA</span>
          <span className="text-tinta/85">Mora sistema <span className="num">{macro.indicadores.mora_sector_privado_pct}%</span></span>
          <span className="ml-auto text-tenue" title={macro.neutralidad ?? undefined}>
            Plazos base {macro.politica?.plazo_base_dias}–{macro.politica?.plazo_extensible_dias}d · {macro.sesgo}
          </span>
        </div>
      )}

      {/* ---------------- INSIGHTS de Ángela (el feed inteligente) ---------------- */}
      <div className="mt-6 flex items-center gap-2">
        <h2 className="text-[15px] font-semibold">Lo que Ángela ve en tu red hoy</h2>
        <span className="text-[12px] text-tenue">— detectado y priorizado por ella, sin que preguntes</span>
      </div>

      {cargando && <p className="mt-4 text-[13px] text-tenue">Ángela está leyendo tu red…</p>}
      {!cargando && (insights?.length ?? 0) === 0 && (
        <p className="mt-4 text-[13px] text-tenue">Tu red viene tranquila: nada urgente para mostrarte ahora.</p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* esperando tu OK (flujo formal aguas arriba de la cadena) */}
        {pendMias.length > 0 && (
          <Carta className="subiendo flex flex-col border-brand/30">
            <div className="flex items-center justify-between">
              <Pill tono="brand"><Punto tono="brand" /> Esperando tu OK</Pill>
              <span className="num text-[12px] text-tenue">{pendMias.length}</span>
            </div>
            <h3 className="mt-3 text-[16px] font-semibold leading-snug">
              {pendMias.reduce((a, b) => (a.monto > b.monto ? a : b)).deudor_nombre} pide crédito
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-tenue">
              Ángela ya lo evaluó y las condiciones están listas. Falta solo tu aprobación.
            </p>
            <div className="mt-auto flex items-end justify-between pt-4">
              <div className="num text-[24px] font-semibold">{pesos(pendMias.reduce((a, b) => (a.monto > b.monto ? a : b)).monto)}</div>
              <button onClick={() => irA("aprobaciones")} className="text-[13px] font-medium text-brand hover:underline">Revisar y aprobar →</button>
            </div>
          </Carta>
        )}

        {(insights ?? []).map((i, k) => {
          const cta = ctaDe(i);
          const esRiesgo = i.tipo === "cambio_comportamiento" || i.tipo === "cobros" || i.tipo === "concentracion";
          return (
            <Carta key={k} className="subiendo flex flex-col">
              <div className="flex items-center justify-between">
                <MarcaAngela />
                <span className="text-[10px] uppercase tracking-[0.1em] text-tenue">{ICONO_TIPO[i.tipo] ?? "Insight"}</span>
              </div>
              <h3 className="mt-3 text-[16px] font-semibold leading-snug">{i.titulo}</h3>
              <p className={`mt-1.5 num text-[13px] font-medium ${esRiesgo ? "text-mal" : "text-tinta"}`}>{i.senal}</p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-tenue">{i.explicacion}</p>
              <div className="mt-3 rounded-lg border border-linea bg-carta/60 px-3 py-2 text-[12px] text-tinta/85">
                <span className="text-tenue">Ángela sugiere:</span> {i.accion}
              </div>
              <div className="mt-auto flex justify-end pt-3">
                <button onClick={() => irA(cta.vista, cta.foco)} className="text-[13px] font-medium text-brand hover:underline">{cta.texto} →</button>
              </div>
            </Carta>
          );
        })}

        {/* mi reputación como comprador — con la marca de "motor, no IA" */}
        {miScore?.score != null && (
          <Carta className="subiendo flex flex-col">
            <div className="flex items-center justify-between">
              <Pill tono={tonoRiesgo(miScore.condiciones.riesgo)}><Punto tono={tonoRiesgo(miScore.condiciones.riesgo)} /> Riesgo {miScore.condiciones.riesgo}</Pill>
              <span className="cursor-help text-[10px] uppercase tracking-[0.1em] text-tenue"
                title="El score y las condiciones los calcula una fórmula determinística y auditable, NO la IA. Ángela solo lee y explica.">
                ⓘ Fórmula auditable
              </span>
            </div>
            <h3 className="mt-3 text-[16px] font-semibold leading-snug">Tu reputación como comprador</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-tenue">
              Así te ven tus proveedores cuando les pedís plazo. Límite en la red: {pesos(miScore.condiciones.limite_sugerido_pesos)}.
            </p>
            <div className="mt-auto flex items-end justify-between pt-4">
              <div className="num text-[26px] font-semibold leading-none">{miScore.score}</div>
              <button onClick={() => irA("cerebro", rol.entidadId)} className="text-[13px] font-medium text-brand hover:underline">Ver el porqué →</button>
            </div>
          </Carta>
        )}
      </div>

      {/* lo que Ángela ya hizo (auditoría real) */}
      <section className="mt-10 rounded-2xl border border-linea bg-carta/60 p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-brand/15"><span className="size-3 rounded-full bg-brand" /></span>
          <h2 className="text-[16px] font-semibold">Lo que Ángela ya hizo</h2>
          <span className="ml-auto text-[12px] text-tenue">del log de auditoría real</span>
        </div>
        <div className="mt-4 divide-y divide-linea/70">
          {actividad.length === 0 && (
            <p className="py-4 text-[13px] text-tenue">Todavía no corrió ninguna evaluación. Pedile una desde el panel de la derecha →</p>
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
