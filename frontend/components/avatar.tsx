"use client";
// Foto de perfil de una entidad. Las fotos están en /public/perfiles/<id>.png
// (mapeadas por nombre desde la carpeta "fotos perfiles" — ver perfiles/). Si la
// entidad no tiene foto, cae a un placeholder con sus iniciales.
import { useState } from "react";

function iniciales(nombre: string): string {
  const w = (nombre || "").trim().split(/\s+/).filter((x) => x.length > 1);
  const dos = ((w[0]?.[0] ?? "") + (w[1]?.[0] ?? "")).toUpperCase();
  return dos || (nombre || "?").slice(0, 2).toUpperCase();
}

export function Avatar({
  id, nombre, size = 40, className = "",
}: { id: number | null | undefined; nombre: string; size?: number; className?: string }) {
  const [err, setErr] = useState(false);
  const px = size;

  if (err || id == null) {
    return (
      <div
        style={{ width: px, height: px, fontSize: Math.round(px * 0.38) }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-brand/15 font-semibold text-brand ${className}`}
        aria-label={nombre}
      >
        {iniciales(nombre)}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/perfiles/${id}.png`}
      alt={nombre}
      width={px}
      height={px}
      onError={() => setErr(true)}
      style={{ width: px, height: px }}
      className={`shrink-0 rounded-full object-cover ${className}`}
    />
  );
}
