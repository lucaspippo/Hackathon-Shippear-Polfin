import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 no corre ESLint en el build, así que el lint no tumba el deploy.
  // El type-check sí corre: los tipos están limpios (ver types/d3-force-3d.d.ts).
};

export default nextConfig;
