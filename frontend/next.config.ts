import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Raíz explícita del workspace = esta carpeta (frontend/). Sin esto, Turbopack
// ve el package-lock.json de la raíz del monorepo (que existe solo para el
// `npm run dev` con concurrently) y lo elige como raíz, dando el warning de
// "multiple lockfiles" y resolviendo dependencias desde el lugar equivocado.
const frontendDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: { root: frontendDir },
  // Next 16 no corre ESLint en el build, así que el lint no tumba el deploy.
  // El type-check sí corre: los tipos están limpios (ver types/d3-force-3d.d.ts).
};

export default nextConfig;
