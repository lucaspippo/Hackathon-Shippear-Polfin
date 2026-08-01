// Humaniza el log de auditoría del agente (Prompt 3) para el feed y para Ángela.
import type { Auditoria } from "@/lib/api";
import { pesos } from "@/lib/api";

export type Actividad = {
  id: number;
  texto: string;
  tono: "brand" | "tenue" | "mal";
  fecha: string;
};

const j = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

export function humanizarAuditoria(entradas: Auditoria[], max = 8): Actividad[] {
  const out: Actividad[] = [];
  for (const a of entradas) {
    if (out.length >= max) break;
    const res = j(a.resultado_json);
    const par = j(a.params_json);

    if (a.tipo === "decision" && a.motivo?.startsWith("deteccion")) {
      // detecciones del monitor proactivo: fue Ángela la que lo inició, sola
      if (a.motivo === "deteccion_resumen") continue; // resumen interno del ciclo
      if (res?.titulo) {
        out.push({
          id: a.id,
          texto: `Vigilando la red, detecté sola: ${res.titulo}.`,
          tono: "brand",
          fecha: a.created_at,
        });
      }
    } else if (a.tipo === "decision") {
      const est = a.motivo;
      out.push({
        id: a.id,
        texto:
          est === "aprobada" ? "Aprobé y ejecuté un crédito con el scoring como respaldo."
          : est === "pendiente_aprobacion" ? "Dejé un crédito grande esperando tu OK — no ejecuto sola por encima del límite."
          : "Recomendé no aprobar un crédito: los números no lo respaldan.",
        tono: est === "pendiente_aprobacion" ? "brand" : "tenue",
        fecha: a.created_at,
      });
    } else if (a.tipo === "policy" && a.permitido === 0) {
      out.push({
        id: a.id,
        texto: `Frené una operación: ${a.motivo ?? "fuera de política"}.`,
        tono: "brand",
        fecha: a.created_at,
      });
    } else if (a.tipo === "aprobacion_humana") {
      out.push({
        id: a.id,
        texto: a.motivo?.includes("rechazó")
          ? "Registré tu rechazo de una operación pendiente."
          : "Con tu OK, ejecuté la operación que estaba pendiente.",
        tono: "tenue",
        fecha: a.created_at,
      });
    } else if (a.tipo === "tool_call" && a.tool === "generarInstrumento" && res && !res.bloqueado && !res.error) {
      out.push({
        id: a.id,
        texto: `Emití un e-pagaré por ${pesos(res.monto)} a ${res.plazo_dias} días (vence ${res.fecha_vencimiento}).`,
        tono: "tenue",
        fecha: a.created_at,
      });
    } else if (a.tipo === "tool_call" && a.tool === "registrarScoreOnChain" && res && !res.error) {
      out.push({
        id: a.id,
        texto: `Actualicé la reputación on-chain (score ${res.score}).`,
        tono: "tenue",
        fecha: a.created_at,
      });
    } else if (a.tipo === "tool_call" && a.tool === "calcularScoring" && res && !res.error) {
      out.push({
        id: a.id,
        texto: `Calculé el scoring de ${res.entidad?.nombre ?? "una entidad"} sobre su historial real: ${res.score}.`,
        tono: "tenue",
        fecha: a.created_at,
      });
    } else if (a.tipo === "tool_call" && a.tool === "notificarDueno" && par) {
      out.push({
        id: a.id,
        texto: par.tipo === "aprobacion_requerida" ? "Te pedí aprobación para una operación grande." : "Te dejé un aviso.",
        tono: par.tipo === "aprobacion_requerida" ? "brand" : "tenue",
        fecha: a.created_at,
      });
    }
  }
  return out;
}

export const fechaRelativa = (iso: string) => {
  const d = new Date(iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z"));
  const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
};
