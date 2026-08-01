// Cliente HTTP mínimo contra el backend de PolFin (:4000).
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function api<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error ?? `${path} → ${r.status}`);
  return data as T;
}

export const pesos = (n: number) =>
  "$" + Math.round(n).toLocaleString("es-AR");

export const pesosCorto = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return "$" + (n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + " M";
  if (Math.abs(n) >= 1_000) return "$" + Math.round(n / 1000).toLocaleString("es-AR") + " mil";
  return pesos(n);
};

export const fechaCorta = (iso: string) => {
  // acepta 'YYYY-MM-DD', ISO con T, y el formato SQLite 'YYYY-MM-DD HH:MM:SS'
  const s = iso.includes("T") ? iso : iso.includes(" ") ? iso.replace(" ", "T") : iso + "T00:00:00";
  const d = new Date(s);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
};

// ------------------------------------------------------------------ tipos API
export type Entidad = {
  id: number; nombre: string; tipo: "comercio" | "persona";
  rol_cadena: string | null; rubro: string | null; barrio: string | null;
  ciudad: string; lat: number | null; lng: number | null;
};

export type Tx = {
  id: number; acreedor_id: number; deudor_id: number; monto: number;
  concepto: string; fecha_emision: string; plazo_dias: number;
  fecha_vencimiento: string; fecha_pago_real: string | null;
  estado: "pagada" | "pendiente" | "vencida";
  acreedor_nombre?: string; deudor_nombre?: string;
  pagado?: number; saldo?: number;   // progreso real (tabla pagos)
};

export type ResumenPagos = {
  cobrado: number; por_cobrar: number; vencido: number; debe: number;
};

export type Pago = {
  id: number; transaccion_id: number; monto: number; fecha: string;
  metodo: string; comprobante: string;
};

export type Instrumento = {
  id: number; deudor_id: number; acreedor_id: number; monto: number;
  tasa_tna: number; plazo_dias: number; fecha_vencimiento: string;
  estado: "activo" | "pagado" | "vencido";
  contrato_address: string; tx_hash: string; red: string;
  aceptado: number; aceptado_at: string | null; created_at: string;
  deudor_nombre: string; deudor_tipo?: string; deudor_ciudad?: string;
  acreedor_nombre: string; acreedor_rubro?: string; acreedor_ciudad?: string;
};

export type Comprobante = {
  id: number; transaccion_id: number; monto: number; fecha: string;
  metodo: string; comprobante: string; concepto: string;
  deuda_total: number; fecha_vencimiento: string;
  acreedor_nombre: string; deudor_nombre: string; saldo_tras_pago: number;
};

export type EntidadDetalle = Entidad & { como_acreedor: Tx[]; como_deudor: Tx[] };

export type Condiciones = {
  riesgo: string; decision: string; tasa_base_tna: number;
  tasa_sugerida_tna: number | null; recargo_pp: number | null;
  plazo_max_dias: number; limite_categoria: string; limite_sugerido_pesos: number;
};

export type Score = {
  entidad: { id: number; nombre: string; tipo: string };
  score: number | null;
  explicacion: string;
  desglose: { factor: string; peso: number; valor: number; aporte: number; maximo: number; detalle: string }[];
  condiciones: Condiciones;
  metricas: Record<string, number | null>;
};

export type ScoreResumen = {
  id: number; nombre: string; tipo: string; score: number | null; riesgo: string;
  tasa_sugerida_tna: number | null; plazo_max_dias: number;
  limite_sugerido_pesos: number; pct_puntual: number | null; comercios_buenos: number;
};

export type Solicitud = {
  id: number; corrida_id: string; deudor_id: number; acreedor_id: number;
  monto: number; estado: "en_evaluacion" | "aprobada" | "pendiente_aprobacion" | "rechazada";
  condiciones_json: string | null; razonamiento: string | null; created_at: string;
  deudor_nombre: string; acreedor_nombre: string;
  origen?: "directa" | "conversacional" | "proactiva";
};

export type Deteccion = {
  id: number; corrida_id: string;
  tipo: "ampliacion" | "riesgo_atraso" | "vencimiento";
  clave: string; titulo: string; detalle: string;
  datos_json: string | null; solicitud_id: number | null;
  estado: "activa" | "resuelta"; created_at: string;
};

export type Auditoria = {
  id: number; corrida_id: string; seq: number; tipo: string; tool: string | null;
  params_json: string | null; resultado_json: string | null;
  permitido: number | null; motivo: string | null; created_at: string;
};

export type Red = {
  nodos: {
    id: number; nombre: string; tipo: string; rol_cadena: string | null;
    rubro: string | null; ciudad: string; score: number | null; riesgo: string | null;
    operaciones: number; vencidas: number;
  }[];
  aristas: { source: number; target: number; n: number; monto_total: number; vencidas: number; pendientes: number }[];
};
