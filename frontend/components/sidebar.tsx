"use client";
// Sidebar: logo real de PolFin arriba, navegación agrupada por categoría,
// badges naranjas de contador, y el estado de Ángela abajo.
import Image from "next/image";
import type { Rol, Vista } from "@/lib/roles";
import { Punto } from "@/components/ui";

type Item = { id: Vista; etiqueta: string; icono: React.ReactNode; badge?: number };

const ic = {
  inicio: <path d="M3 10.5 12 3l9 7.5M5.5 9v10.5h13V9" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  cerebro: <><circle cx="6" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.7" fill="none" /><circle cx="18" cy="7" r="2.4" stroke="currentColor" strokeWidth="1.7" fill="none" /><circle cx="12" cy="17" r="2.4" stroke="currentColor" strokeWidth="1.7" fill="none" /><path d="M8 7.2 15.7 7M7.3 8.1 10.8 15M16.8 9.1 13.2 15" stroke="currentColor" strokeWidth="1.5" /></>,
  alertas: <path d="M12 4a5 5 0 0 0-5 5v3.5L5.5 16h13L17 12.5V9a5 5 0 0 0-5-5Zm-2 14a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  decisiones: <path d="M9 7h9M9 12h9M9 17h9M5 7h.01M5 12h.01M5 17h.01" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />,
  aprobaciones: <><path d="M5 12.5 10 17l9-10" stroke="currentColor" strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round" /></>,
  compras: <><path d="M6 7V6a4 4 0 0 1 8 0v1m-9 0h10l1 12H4L5 7Z" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></>,
  pagos: <><rect x="3.5" y="6" width="17" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.7" fill="none" /><circle cx="12" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.7" fill="none" /><path d="M6.5 9v6M17.5 9v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>,
  cartera: <><rect x="4" y="7" width="16" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.7" fill="none" /><path d="M4 11h16M8 4.5h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></>,
  mapa: <><path d="M12 21s-6.5-5.5-6.5-10.3A6.5 6.5 0 0 1 12 4a6.5 6.5 0 0 1 6.5 6.7C18.5 15.5 12 21 12 21Z" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinejoin="round" /><circle cx="12" cy="10.5" r="2" stroke="currentColor" strokeWidth="1.7" fill="none" /></>,
};

export function Sidebar({
  rol, vista, irA, pendientes, esperandoOk, ocultarCerebro = false,
}: {
  rol: Rol; vista: Vista; irA: (v: Vista) => void;
  pendientes: number; esperandoOk: boolean; ocultarCerebro?: boolean;
}) {
  const esConsumidor = false; // el consumidor final ya no es usuario de la app

  const grupos: { titulo: string | null; items: Item[] }[] = [
    {
      titulo: null,
      items: [
        { id: "inicio" as Vista, etiqueta: "Inicio", icono: ic.inicio },
        // El Cerebro es análisis de pantalla grande: se oculta al consumidor en mobile.
        ...(ocultarCerebro ? [] : [{ id: "cerebro" as Vista, etiqueta: "El Cerebro", icono: ic.cerebro }]),
        { id: "alertas" as Vista, etiqueta: "Alertas", icono: ic.alertas },
      ],
    },
    {
      titulo: "El crédito",
      items: [
        ...(esConsumidor
          ? [{ id: "compras" as Vista, etiqueta: "Mis compras a crédito", icono: ic.compras }]
          : [{ id: "aprobaciones" as Vista, etiqueta: "Aprobaciones", icono: ic.aprobaciones, badge: pendientes || undefined }]),
        ...(esConsumidor ? [] : [{ id: "decisiones" as Vista, etiqueta: "Decisiones de crédito", icono: ic.decisiones }]),
        { id: "pagos" as Vista, etiqueta: esConsumidor ? "Mis pagos" : "Pagos y cobros", icono: ic.pagos },
        { id: "cartera" as Vista, etiqueta: esConsumidor ? "Mi historial y límites" : "Cuentas de la cadena", icono: ic.cartera },
      ],
    },
    {
      titulo: "La red",
      items: [{ id: "mapa" as Vista, etiqueta: "Comercios adheridos", icono: ic.mapa }],
    },
  ];

  return (
    <aside className="flex w-[236px] shrink-0 flex-col border-r border-linea bg-panel">
      <div className="px-5 pb-2 pt-5">
        <Image src="/polfin-logo.jpeg" alt="PolFin" width={126} height={60} priority
          className="h-auto w-[118px] rounded-md" />
        <div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-tenue">
          El buró de la cadena
        </div>
      </div>

      <nav className="mt-3 flex-1 space-y-5 overflow-y-auto px-3">
        {grupos.map((g, i) => (
          <div key={i}>
            {g.titulo && (
              <div className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-tenue/80">
                {g.titulo}
              </div>
            )}
            <div className="space-y-0.5">
              {g.items.map((item) => {
                const activo = vista === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => irA(item.id)}
                    className={`group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-[13.5px] transition-colors ${
                      activo ? "bg-brand/12 font-medium text-brand" : "text-tinta/80 hover:bg-white/4 hover:text-tinta"
                    }`}
                  >
                    <svg width="19" height="19" viewBox="0 0 24 24" className={activo ? "text-brand" : "text-tenue group-hover:text-tinta"} aria-hidden>
                      {item.icono}
                    </svg>
                    {item.etiqueta}
                    {item.badge ? (
                      <span className="num ml-auto rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold leading-none text-black">
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* estado de Ángela + quién sos */}
      <div className="space-y-2 border-t border-linea p-3">
        <div className="flex items-center gap-2.5 rounded-xl bg-carta px-3 py-2.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-brand/15">
            <span className="size-3 rounded-full bg-brand" />
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-medium">Ángela</div>
            <div className="flex items-center gap-1.5 text-[11px] text-tenue">
              <Punto tono={esperandoOk ? "brand" : "tenue"} />
              {esperandoOk ? "Esperando tu OK" : "Atenta a la red"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-3 py-1">
          <span className="flex size-7 items-center justify-center rounded-full bg-white/8 text-[11px] font-semibold text-tenue">
            {rol.persona[0]}
          </span>
          <div className="leading-tight">
            <div className="text-[12.5px]">{rol.persona}</div>
            <div className="text-[11px] text-tenue">{rol.etiqueta}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
