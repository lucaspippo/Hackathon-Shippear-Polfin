"use client";
// Panel derecho: Ángela, tu guía. Ahora con CHAT REAL — el dueño le pregunta
// cualquier cosa sobre su negocio en lenguaje natural y ella razona sobre los
// datos reales (POST /api/agente/chat, tools de solo-lectura encadenadas por el
// modelo). Arriba: estado + acción demo + monitor. Abajo: la conversación.
import { useEffect, useRef, useState } from "react";
import type { Auditoria } from "@/lib/api";
import { apiPost, pesos } from "@/lib/api";
import type { Rol, Vista } from "@/lib/roles";
import { humanizarAuditoria, fechaRelativa } from "@/lib/actividad";
import { Punto } from "@/components/ui";
import type { ResultadoAgente } from "@/components/shell";

type Msg = { role: "user" | "assistant"; content: string; tools?: string[] };

type RespChat = {
  ok: boolean; respuesta: string; provider: string;
  tools_usadas?: string[]; error?: string;
};

// Formato mínimo para un panel angosto: **negrita** + saltos de línea.
function Rico({ texto }: { texto: string }) {
  return (
    <>
      {texto.split("\n").map((linea, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {linea.split(/(\*\*[^*]+\*\*)/g).map((frag, j) =>
            frag.startsWith("**") && frag.endsWith("**") ? (
              <strong key={j} className="font-semibold text-tinta">{frag.slice(2, -2)}</strong>
            ) : (
              <span key={j}>{frag}</span>
            )
          )}
        </span>
      ))}
    </>
  );
}

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

  // ----------------------------------------------------------------- chat state
  const [mensajes, setMensajes] = useState<Msg[]>([]);
  const [entrada, setEntrada] = useState("");
  const [pensando, setPensando] = useState(false);
  const hiloRef = useRef<HTMLDivElement>(null);

  // Al cambiar de rol/entidad, la conversación arranca de cero (otro contexto).
  useEffect(() => { setMensajes([]); setEntrada(""); }, [rol.id]);

  // Auto-scroll al último mensaje.
  useEffect(() => {
    hiloRef.current?.scrollTo({ top: hiloRef.current.scrollHeight, behavior: "smooth" });
  }, [mensajes, pensando]);

  const sugeridas = [
    "¿Quién de los que me deben es el más riesgoso ahora?",
    "Si tuviera que darle más crédito a un solo cliente, ¿a cuál y por qué?",
    "¿Cómo viene mi cartera comparada con hace unos meses?",
  ];

  async function preguntar(texto: string) {
    const q = texto.trim();
    if (!q || pensando) return;
    const historial = mensajes.map((m) => ({ role: m.role, content: m.content }));
    setMensajes((prev) => [...prev, { role: "user", content: q }]);
    setEntrada("");
    setPensando(true);
    try {
      const r = await apiPost<RespChat>("/api/agente/chat", {
        pregunta: q, entidadId: rol.entidadId, rol: rol.etiqueta,
        nombre: rol.entidadNombre, historial,
      });
      setMensajes((prev) => [
        ...prev,
        { role: "assistant", content: r.respuesta || r.error || "No pude responder.", tools: r.tools_usadas },
      ]);
    } catch (e) {
      setMensajes((prev) => [
        ...prev,
        { role: "assistant", content: `Se me cortó la consulta: ${String((e as Error).message ?? e)}` },
      ]);
    } finally {
      setPensando(false);
    }
  }

  return (
    <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden border-l border-linea bg-panel">
      {/* ----------------------------------------------------- cabecera (fija) */}
      <div className="shrink-0 px-5 pb-3 pt-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-tenue">Tu guía</div>
        <div className="mt-3 flex items-center gap-3">
          <span className="relative flex size-11 items-center justify-center rounded-full bg-brand/15">
            <span className="size-4.5 rounded-full bg-brand" />
            {(evaluando || pensando) && <span className="absolute inset-0 animate-ping rounded-full bg-brand/25" />}
          </span>
          <div>
            <div className="text-[16px] font-semibold">Ángela</div>
            <div className="flex items-center gap-1.5 text-[11.5px] text-tenue">
              <Punto tono={evaluando || esperando || pensando ? "brand" : "tenue"} />
              {pensando ? "Pensando…" : evaluando ? "Evaluando un crédito…" : esperando ? "Esperando tu OK" : "Atenta a la red"}
            </div>
          </div>
        </div>
      </div>

      {/* --------------------------------------------------- hilo de chat (crece) */}
      <div ref={hiloRef} className="min-h-0 flex-1 overflow-y-auto px-5">
        {/* intro + resultado + acciones — arriba del hilo, se scrollea con él */}
        {mensajes.length === 0 && (
          <>
            <div className="rounded-2xl rounded-tl-md border border-linea bg-carta p-3.5 text-[13px] leading-relaxed text-tinta/90">
              Soy Ángela. Preguntame por tu crédito, tus clientes o tu score — te
              contesto con los números reales de la red, y las decisiones las firmás vos.
            </div>

            {resultado && (
              <div className={`subiendo mt-3 rounded-2xl border p-3.5 text-[12.5px] leading-relaxed ${
                resultado.estado === "aprobada" || resultado.estado === "pendiente_aprobacion"
                  ? "border-brand/40 bg-brand/8" : "border-linea bg-carta"
              }`}>
                <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
                  <Punto tono={resultado.estado === "rechazada" ? "tenue" : "brand"} />
                  {resultado.estado === "aprobada" ? "Crédito aprobado y ejecutado"
                    : resultado.estado === "pendiente_aprobacion" ? "Esperando tu OK"
                    : resultado.estado === "rechazada" ? "No lo recomendé" : "No pude evaluar"}
                </div>
                <p className="text-tinta/85">
                  {resultado.deudor.nombre || "—"} · {pesos(resultado.monto)}
                  {resultado.score != null && <> · score <span className="num">{resultado.score}</span></>}
                </p>
                <button onClick={() => irA(resultado.estado === "pendiente_aprobacion" ? "decisiones" : "cerebro", resultado.deudor.id)}
                  className="mt-2 text-[12px] font-medium text-brand hover:underline">
                  {resultado.estado === "pendiente_aprobacion" ? "Ir a aprobar →" : "Verlo en el Cerebro →"}
                </button>
              </div>
            )}

            {/* acción demo + monitor proactivo */}
            <div className="mt-3 space-y-2">
              <button onClick={correrAgente} disabled={evaluando}
                className="w-full rounded-2xl bg-brand px-4 py-3 text-left transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-black/60">
                  {evaluando ? "Evaluando…" : "Pedime una evaluación"}
                </div>
                <div className="mt-0.5 text-[13px] font-semibold leading-snug text-black">{rol.accion.texto}</div>
              </button>
              <button onClick={vigilarAhora} disabled={vigilando}
                className="w-full rounded-2xl border border-brand/40 bg-brand/8 px-4 py-3 text-left transition-colors hover:bg-brand/14 disabled:opacity-60">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-brand/80">
                  {vigilando ? "Recorriendo la red…" : "Modo proactivo"}
                </div>
                <div className="mt-0.5 text-[13px] font-semibold leading-snug text-brand">Vigilá la red ahora</div>
              </button>
            </div>

            {/* lo que hice hace poco */}
            {actividad.length > 0 && (
              <div className="mt-5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-tenue">Lo que hice hace poco</div>
                <div className="mt-2 space-y-2">
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
            )}

            {/* preguntas de ejemplo — arrancan la conversación */}
            <div className="mb-2 mt-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-tenue">Probá preguntarme</div>
              <div className="mt-2 flex flex-col gap-2">
                {sugeridas.map((s) => (
                  <button key={s} onClick={() => preguntar(s)}
                    className="rounded-xl border border-linea bg-carta px-3 py-2 text-left text-[12.5px] text-tinta/85 transition-colors hover:border-brand/50 hover:text-brand">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* conversación */}
        <div className="space-y-3 py-3">
          {mensajes.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed ${
                m.role === "user"
                  ? "rounded-br-md bg-brand/15 text-tinta"
                  : "rounded-tl-md border border-linea bg-carta text-tinta/90"
              }`}>
                {m.role === "assistant" && m.tools && m.tools.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap items-center gap-1 text-[10px] text-tenue">
                    <span className="uppercase tracking-wide">consultó</span>
                    {m.tools.map((t, k) => (
                      <span key={k} className="rounded-full border border-linea px-1.5 py-0.5 font-mono text-[9.5px]">{t}</span>
                    ))}
                  </div>
                )}
                <Rico texto={m.content} />
              </div>
            </div>
          ))}
          {pensando && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-linea bg-carta px-3.5 py-3">
                <span className="size-1.5 animate-bounce rounded-full bg-tenue [animation-delay:-0.2s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-tenue [animation-delay:-0.1s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-tenue" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* --------------------------------------------------------- entrada (fija) */}
      <div className="shrink-0 border-t border-linea p-4">
        {mensajes.length > 0 && (
          <button onClick={() => setMensajes([])}
            className="mb-2 text-[11px] text-tenue hover:text-brand">Empezar de nuevo</button>
        )}
        <form onSubmit={(e) => { e.preventDefault(); preguntar(entrada); }}
          className="flex items-center gap-2 rounded-full border border-linea bg-carta px-4 py-2 focus-within:border-brand/50">
          <input value={entrada} onChange={(e) => setEntrada(e.target.value)}
            placeholder="Preguntale a Ángela…" disabled={pensando}
            className="w-full bg-transparent text-[13px] text-tinta placeholder:text-tenue focus:outline-none disabled:opacity-60" />
          <button type="submit" aria-label="Enviar" disabled={pensando || !entrada.trim()}
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-black disabled:opacity-40">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      </div>
    </aside>
  );
}
