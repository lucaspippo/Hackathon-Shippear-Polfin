"use client";
// Panel derecho: Ángela, tu guía. Estado del agente, lo que hizo hace poco
// (auditoría real del Prompt 3), la acción demo y preguntas sugeridas.
import type { Auditoria } from "@/lib/api";
import { pesos } from "@/lib/api";
import type { Rol, Vista } from "@/lib/roles";
import { humanizarAuditoria, fechaRelativa } from "@/lib/actividad";
import { Punto } from "@/components/ui";
import type { ResultadoAgente } from "@/components/shell";

export function Angela({
  rol, auditoria, pendientes, evaluando, resultado, correrAgente, irA,
  vigilarAhora, vigilando,
}: {
  rol: Rol; auditoria: Auditoria[]; pendientes: number;
  evaluando: boolean; resultado: ResultadoAgente;
  correrAgente: () => void; irA: (v: Vista, foco?: number) => void;
  vigilarAhora: () => void; vigilando: boolean;
}) {
  const actividad = humanizarAuditoria(auditoria, 3);
  const esperando = pendientes > 0;

  const sugeridas: { texto: string; accion: () => void }[] = [
    { texto: "¿Quién está atrasado?", accion: () => irA("alertas") },
    { texto: "¿A quién le puedo fiar más?", accion: () => irA("inicio") },
    { texto: "Mostrame mi red", accion: () => irA("cerebro", rol.entidadId) },
    { texto: "Llevame al mapa de comercios", accion: () => irA("mapa") },
  ];

  return (
    <aside className="flex w-[312px] shrink-0 flex-col overflow-y-auto border-l border-linea bg-panel">
      <div className="px-5 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-tenue">
        Tu guía
      </div>

      {/* cabecera */}
      <div className="flex items-center gap-3 px-5">
        <span className="relative flex size-11 items-center justify-center rounded-full bg-brand/15">
          <span className="size-4.5 rounded-full bg-brand" />
          {evaluando && <span className="absolute inset-0 animate-ping rounded-full bg-brand/25" />}
        </span>
        <div>
          <div className="text-[16px] font-semibold">Ángela</div>
          <div className="flex items-center gap-1.5 text-[11.5px] text-tenue">
            <Punto tono={evaluando || esperando ? "brand" : "tenue"} />
            {evaluando ? "Evaluando un crédito…" : esperando ? "Esperando tu OK" : "Atenta a la red"}
          </div>
        </div>
      </div>

      {/* intro */}
      <div className="mx-5 mt-4 rounded-2xl rounded-tl-md border border-linea bg-carta p-3.5 text-[13px] leading-relaxed text-tinta/90">
        Soy Ángela. Preguntame por tu crédito, tus clientes o tu score — te
        contesto con los números reales de la red, y las decisiones las firmás vos.
      </div>

      {/* resultado de la última corrida */}
      {resultado && (
        <div className={`subiendo mx-5 mt-3 rounded-2xl border p-3.5 text-[12.5px] leading-relaxed ${
          resultado.estado === "aprobada" ? "border-brand/40 bg-brand/8"
          : resultado.estado === "pendiente_aprobacion" ? "border-brand/40 bg-brand/8"
          : "border-linea bg-carta"
        }`}>
          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
            <Punto tono={resultado.estado === "rechazada" ? "tenue" : "brand"} />
            {resultado.estado === "aprobada" ? "Crédito aprobado y ejecutado"
              : resultado.estado === "pendiente_aprobacion" ? "Esperando tu OK"
              : resultado.estado === "rechazada" ? "No lo recomendé"
              : "No pude evaluar"}
          </div>
          <p className="text-tinta/85">
            {resultado.deudor.nombre || "—"} · {pesos(resultado.monto)}
            {resultado.score != null && <> · score <span className="num">{resultado.score}</span></>}
          </p>
          {resultado.pendiente_por && (
            <p className="mt-1 text-tenue">{resultado.pendiente_por}</p>
          )}
          <button onClick={() => irA(resultado.estado === "pendiente_aprobacion" ? "decisiones" : "cerebro", resultado.deudor.id)}
            className="mt-2 text-[12px] font-medium text-brand hover:underline">
            {resultado.estado === "pendiente_aprobacion" ? "Ir a aprobar →" : "Verlo en el Cerebro →"}
          </button>
        </div>
      )}

      {/* lo que hice hace poco */}
      <div className="mt-5 px-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-tenue">
          Lo que hice hace poco
        </div>
        <div className="mt-2 space-y-2">
          {actividad.length === 0 && (
            <p className="rounded-xl border border-linea bg-carta p-3 text-[12.5px] text-tenue">
              Nada todavía en esta sesión.
            </p>
          )}
          {actividad.map((a) => (
            <div key={a.id} className="flex items-start gap-2.5 rounded-xl border border-linea bg-carta p-3">
              <span className="mt-1"><Punto tono={a.tono === "mal" ? "mal" : a.tono} /></span>
              <div>
                <p className="text-[12.5px] leading-snug">{a.texto}</p>
                <p className="mt-0.5 text-[11px] text-tenue">{fechaRelativa(a.fecha)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* la acción demo — dispara el agente real */}
      <div className="mt-5 space-y-2 px-5">
        <button
          onClick={correrAgente}
          disabled={evaluando}
          className="w-full rounded-2xl bg-brand px-4 py-3 text-left transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
        >
          <div className="text-[11px] font-semibold uppercase tracking-wide text-black/60">
            {evaluando ? "Evaluando…" : "Pedime una evaluación"}
          </div>
          <div className="mt-0.5 text-[13px] font-semibold leading-snug text-black">
            {rol.accion.texto}
          </div>
        </button>

        {/* el monitor proactivo, gatillado en vivo */}
        <button
          onClick={vigilarAhora}
          disabled={vigilando}
          className="w-full rounded-2xl border border-brand/40 bg-brand/8 px-4 py-3 text-left transition-colors hover:bg-brand/14 disabled:opacity-60"
        >
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand/80">
            {vigilando ? "Recorriendo la red…" : "Modo proactivo"}
          </div>
          <div className="mt-0.5 text-[13px] font-semibold leading-snug text-brand">
            Vigilá la red ahora
          </div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-tenue">
            Busco ampliaciones, atrasos fuera de patrón y vencimientos — sola.
          </div>
        </button>
      </div>

      {/* sugeridas */}
      <div className="mt-4 flex flex-wrap gap-2 px-5 pb-4">
        {sugeridas.map((s) => (
          <button key={s.texto} onClick={s.accion}
            className="rounded-full border border-linea px-3 py-1.5 text-[12px] text-tinta/85 transition-colors hover:border-brand/50 hover:text-brand">
            {s.texto}
          </button>
        ))}
      </div>

      {/* entrada (decorativa: dispara la acción demo) */}
      <div className="mt-auto border-t border-linea p-4">
        <form
          onSubmit={(e) => { e.preventDefault(); correrAgente(); }}
          className="flex items-center gap-2 rounded-full border border-linea bg-carta px-4 py-2"
        >
          <input placeholder="Escribile a Ángela…"
            className="w-full bg-transparent text-[13px] text-tinta placeholder:text-tenue focus:outline-none" />
          <button type="submit" aria-label="Enviar"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-black">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      </div>
    </aside>
  );
}
