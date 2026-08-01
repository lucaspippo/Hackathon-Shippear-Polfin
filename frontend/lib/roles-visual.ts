// Lenguaje visual de los roles de la cadena — compartido entre el Cerebro
// (formas en canvas) y el Mapa (pins SVG), para que un mayorista se lea igual
// en las dos vistas.
export type RolCadena = "fabrica" | "distribuidora" | "mayorista" | "minorista";

export const ROL_ETIQUETA: Record<string, string> = {
  fabrica: "Fábrica",
  distribuidora: "Distribuidora",
  mayorista: "Mayorista",
  minorista: "Minorista",
};

// El mismo repertorio de formas que dibuja el canvas del Cerebro, en SVG path
// sobre una caja de 20×20 (para pins y leyendas).
export const ROL_FORMA_SVG: Record<string, string> = {
  fabrica: "M5 5h10v10H5z",                       // cuadrado
  distribuidora: "M10 3.5 16.5 10 10 16.5 3.5 10Z", // rombo
  mayorista: "M10 4 16.5 15.5h-13Z",              // triángulo
  minorista: "M10 10m-5.5 0a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0", // círculo
};

// Qué eslabón le interesa a cada rol cuando mira el mapa: sus contrapartes.
// El consumidor final ve dónde puede gastar su score (minoristas); cada
// eslabón ve de quién se abastece (aguas arriba de la cadena).
export const ROLES_RELEVANTES: Record<string, RolCadena[]> = {
  consumidor: ["minorista"],
  comercio: ["mayorista", "distribuidora"],
  distribuidora: ["distribuidora", "fabrica"],
  fabrica: ["distribuidora", "mayorista"],
};

export const RELEVANTE_TITULO: Record<string, string> = {
  consumidor: "Dónde podés usar tu score",
  comercio: "Tus proveedores en la red",
  distribuidora: "De quiénes te abastecés",
  fabrica: "Tu canal de distribución",
};
