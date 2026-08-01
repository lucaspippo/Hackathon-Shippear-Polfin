// El selector de rol de la demo: UN usuario que cambia su lugar en la cadena.
// Cada rol se ancla a una entidad REAL del dataset — el feed, el cerebro y la
// cartera se re-parametrizan con su id. Sin auth: el selector ES el login.
export type RolId = "fabrica" | "distribuidora" | "comercio" | "consumidor";

export type Rol = {
  id: RolId;
  etiqueta: string;        // lo que muestra el selector
  entidadId: number;       // el nodo focal en la DB
  entidadNombre: string;
  persona: string;         // quién sos en la demo
  saludo: string;          // el H1 del feed
  // la acción demo de Ángela para este rol (dispara al agente real del P3)
  accion: { texto: string; deudorId: number; acreedorId: number; monto: number };
};

export const ROLES: Rol[] = [
  {
    id: "fabrica",
    etiqueta: "Fábrica",
    entidadId: 2,
    entidadNombre: "Fábrica de Pastas La Rosarina",
    persona: "Nicolás",
    saludo: "Tus distribuidores, con el riesgo a la vista",
    accion: {
      texto: "Evaluá: Distribuidora Ceres pide $4.000.000 a 60 días",
      deudorId: 4, acreedorId: 2, monto: 4_000_000,
    },
  },
  {
    id: "distribuidora",
    etiqueta: "Distribuidora",
    entidadId: 3,
    entidadNombre: "Distribuidora de Bebidas El Paraná",
    persona: "Carla",
    saludo: "Tu cartera de comercios, ordenada",
    accion: {
      texto: "Evaluá: Kiosco El Gringo pide $900.000 de reposición",
      deudorId: 10, acreedorId: 3, monto: 900_000,
    },
  },
  {
    id: "comercio",
    etiqueta: "Comercio",
    entidadId: 9,
    entidadNombre: "Almacén Doña Marta",
    persona: "Marta",
    saludo: "Tu fiado, sin libreta y sin sustos",
    accion: {
      texto: "Evaluá: Rubén Alcaraz pide $120.000 de fiado",
      deudorId: 16, acreedorId: 9, monto: 120_000,
    },
  },
  {
    id: "consumidor",
    etiqueta: "Consumidor final",
    entidadId: 14,
    entidadNombre: "Marcela Benítez",
    persona: "Marcela",
    saludo: "Tu reputación te abre puertas",
    accion: {
      texto: "Presentá tu score en el Corralón Ovidio Lagos ($180.000)",
      deudorId: 14, acreedorId: 7, monto: 180_000,
    },
  },
];

export const rolPorId = (id: RolId) => ROLES.find((r) => r.id === id)!;

export type Vista =
  | "inicio" | "cerebro" | "alertas" | "aprobaciones" | "decisiones"
  | "pagos" | "cartera" | "mapa" | "compras";
