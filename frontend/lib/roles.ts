// El selector de rol de la demo: UN usuario que cambia su lugar en la cadena.
// DECISIÓN DE PRODUCTO: el consumidor final YA NO es un usuario de la app (no lo
// obligamos a usar PolFin). Los roles son los eslabones que compran Y venden:
// Fábrica, Distribuidora, Mayorista, Minorista. El consumidor final sigue
// existiendo como ENTIDAD en los datos (se le fía, tiene score, aparece en el
// cerebro y en las cuentas) — lo que se elimina es su login/vista propia. Para
// venderle, el vendedor genera el documento y se lo entrega por fuera de la app.
export type RolId = "fabrica" | "distribuidora" | "mayorista" | "minorista";

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
    id: "mayorista",
    etiqueta: "Mayorista",
    entidadId: 7,
    entidadNombre: "Corralón Materiales Ovidio Lagos",
    persona: "Aldo",
    saludo: "Tus clientes a plazo, con el riesgo a la vista",
    // Venta a plazo a un consumidor final (Marcela): el vendedor genera y entrega
    // el documento; el comprador no entra a la app.
    accion: {
      texto: "Nueva venta a plazo: Marcela Benítez, $180.000 a plazo",
      deudorId: 14, acreedorId: 7, monto: 180_000,
    },
  },
  {
    id: "minorista",
    etiqueta: "Minorista",
    entidadId: 9,
    entidadNombre: "Almacén Doña Marta",
    persona: "Marta",
    saludo: "Tu fiado, sin libreta y sin sustos",
    accion: {
      texto: "Nueva venta a plazo: Rubén Alcaraz pide $120.000 de fiado",
      deudorId: 16, acreedorId: 9, monto: 120_000,
    },
  },
];

export const rolPorId = (id: RolId) => ROLES.find((r) => r.id === id)!;

export type Vista =
  | "inicio" | "cerebro" | "alertas" | "aprobaciones" | "decisiones"
  | "pagos" | "cartera" | "mapa" | "compras" | "perfil";
