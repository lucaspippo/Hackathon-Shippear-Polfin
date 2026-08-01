// d3-force-3d no trae tipos propios y react-force-graph-2d lo usa de forma
// transitiva. Declaramos el módulo para que `next build` (que type-checkea)
// no falle por un implicit-any en un paquete de terceros.
declare module "d3-force-3d";
