"use client";
// El shell de PolFin: sidebar (navegación) · feed central · panel de Ángela.
// UN estado de rol re-parametriza todo: feed, cerebro, cartera y alertas.
import { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import { apiPost, type Auditoria, type Solicitud } from "@/lib/api";
import { ROLES, rolPorId, type RolId, type Vista } from "@/lib/roles";
import { useApi, useEsMobile } from "@/components/ui";
import { Sidebar } from "@/components/sidebar";
import { Feed } from "@/components/feed";
import { Angela } from "@/components/angela";
import { Cerebro } from "@/components/cerebro";
import { Decisiones } from "@/components/decisiones";
import { Aprobaciones } from "@/components/aprobaciones";
import { Pagos } from "@/components/pagos";
import { Cartera } from "@/components/cartera";
import { Alertas } from "@/components/alertas";
import { Mapa } from "@/components/mapa";
import { NuevaVenta } from "@/components/nuevaVenta";
import { Documento, type DocRef } from "@/components/documento";

export type ResultadoAgente = {
  estado: string; score: number | null; razonamiento: string;
  deudor: { id: number; nombre: string }; monto: number;
  pendiente_por: string | null;
} | null;

export function Shell() {
  const [rolId, setRolId] = useState<RolId>("minorista");
  const [vista, setVista] = useState<Vista>("inicio");
  const [foco, setFoco] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [evaluando, setEvaluando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoAgente>(null);
  const [selectorAbierto, setSelectorAbierto] = useState(false);

  const [menuAbierto, setMenuAbierto] = useState(false); // drawer mobile
  const [doc, setDoc] = useState<DocRef | null>(null);    // documento abierto
  const esMobile = useEsMobile();

  const rol = rolPorId(rolId);
  const focal = foco ?? rol.entidadId;
  const ocultarCerebro = false; // todos los roles (eslabones) ven el Cerebro
  const [ventaAbierta, setVentaAbierta] = useState(false); // modal "Nueva venta a plazo"

  const { data: solicitudes } = useApi<Solicitud[]>("/api/solicitudes", [refresh]);
  const { data: auditoria } = useApi<Auditoria[]>("/api/agente/auditoria?limit=60", [refresh]);

  const pendientes = useMemo(
    () => (solicitudes ?? []).filter((s) => s.estado === "pendiente_aprobacion"),
    [solicitudes]
  );
  const pendientesMias = useMemo(
    () => pendientes.filter((s) => s.acreedor_id === rol.entidadId),
    [pendientes, rol.entidadId]
  );

  const recargar = useCallback(() => setRefresh((n) => n + 1), []);

  const cambiarRol = (id: RolId) => {
    setRolId(id);
    setFoco(null);          // el cerebro se re-centra en el nuevo rol
    setResultado(null);
    setSelectorAbierto(false);
    setMenuAbierto(false);
    setVista("inicio");
  };

  const irA = useCallback((v: Vista, focoNuevo?: number) => {
    if (focoNuevo !== undefined) setFoco(focoNuevo);
    setVista(v);
    setMenuAbierto(false);
  }, []);

  // Abrir un documento (e-pagaré / comprobante) como overlay desde cualquier vista.
  const abrirDoc = useCallback((d: DocRef) => setDoc(d), []);
  // Aceptación del deudor sobre el e-pagaré (las dos partes atestiguan).
  const aceptarInstrumento = useCallback(async (id: number) => {
    try {
      await apiPost(`/api/instrumentos/${id}/aceptar`);
      setDoc(null);
      recargar();
    } catch (e) { alert(String((e as Error).message)); }
  }, [recargar]);

  // Despierta al monitor proactivo YA (el gatillo del pitch): Ángela recorre
  // la red, y lo detectado aparece en el feed + su panel vía auditoría.
  const [vigilando, setVigilando] = useState(false);
  const vigilarAhora = useCallback(async () => {
    if (vigilando) return;
    setVigilando(true);
    try {
      await apiPost("/api/agente/monitorear");
      setVista("inicio");
      recargar();
    } catch { /* el feed simplemente no cambia */ }
    finally { setVigilando(false); }
  }, [vigilando, recargar]);

  // La acción demo: dispara el agente REAL del Prompt 3 y lleva al cerebro.
  const correrAgente = useCallback(async () => {
    if (evaluando) return;
    setEvaluando(true);
    try {
      const r = await apiPost<NonNullable<ResultadoAgente> & { corrida_id: string }>(
        "/api/agente/evaluar-credito",
        { deudor_id: rol.accion.deudorId, acreedor_id: rol.accion.acreedorId, monto: rol.accion.monto }
      );
      setResultado(r);
      setFoco(rol.accion.deudorId);
      setVista("cerebro");
      recargar();
    } catch (e) {
      setResultado({
        estado: "error", score: null, monto: rol.accion.monto,
        deudor: { id: rol.accion.deudorId, nombre: "" },
        razonamiento: String((e as Error).message ?? e), pendiente_por: null,
      });
    } finally {
      setEvaluando(false);
    }
  }, [evaluando, rol, recargar]);

  const selectorRol = (
    <div className="relative">
      <button
        onClick={() => setSelectorAbierto((v) => !v)}
        className="flex items-center gap-2.5 rounded-full border border-linea bg-carta py-1.5 pl-2 pr-3 transition-colors hover:border-brand/40 sm:gap-3 sm:pr-3.5"
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-brand/15 text-[12px] font-semibold text-brand">
          {rol.persona[0]}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-[13px] font-medium">{rol.entidadNombre}</span>
          <span className="block text-[11px] text-tenue">{rol.etiqueta} · {rol.persona}</span>
        </span>
        <span className="text-left leading-tight sm:hidden">
          <span className="block text-[12px] font-medium">{rol.etiqueta}</span>
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" className="text-tenue" aria-hidden>
          <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {selectorAbierto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSelectorAbierto(false)} />
          <div className="subiendo absolute right-0 top-12 z-50 w-72 rounded-2xl border border-linea bg-panel p-1.5 shadow-2xl shadow-black/60">
            <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-tenue">
              Tu lugar en la cadena
            </div>
            {ROLES.map((r) => (
              <button key={r.id} onClick={() => cambiarRol(r.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                  r.id === rolId ? "bg-brand/10" : "hover:bg-white/4"}`}>
                <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
                  r.id === rolId ? "bg-brand text-black" : "bg-white/8 text-tenue"}`}>
                  {r.persona[0]}
                </span>
                <span className="leading-tight">
                  <span className="block text-[13px] font-medium">{r.etiqueta}</span>
                  <span className="block text-[11px] text-tenue">{r.entidadNombre}</span>
                </span>
                {r.id === rolId && <span className="ml-auto text-brand">·</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-ink text-tinta">
      {/* sidebar desktop */}
      <div className="hidden lg:flex">
        <Sidebar
          rol={rol} vista={vista} irA={irA} ocultarCerebro={ocultarCerebro}
          pendientes={pendientesMias.length || pendientes.length}
          esperandoOk={pendientesMias.length > 0 || pendientes.length > 0}
        />
      </div>

      {/* drawer mobile */}
      {menuAbierto && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setMenuAbierto(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="subiendo absolute left-0 top-0 h-full" onClick={(e) => e.stopPropagation()}>
            <Sidebar
              rol={rol} vista={vista} irA={irA} ocultarCerebro={ocultarCerebro}
              pendientes={pendientesMias.length || pendientes.length}
              esperandoOk={pendientesMias.length > 0 || pendientes.length > 0}
            />
          </div>
        </div>
      )}

      {/* -------------------------------------------------- zona central */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* topbar */}
        <header className="flex items-center gap-3 border-b border-linea px-4 py-3 sm:gap-4 sm:px-8 sm:py-4">
          {/* botón menú (mobile) */}
          <button onClick={() => setMenuAbierto(true)} aria-label="Menú"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-linea text-tinta lg:hidden">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
          </button>
          {/* logo (mobile) */}
          <Image src="/polfin-logo.jpeg" alt="PolFin" width={80} height={38}
            className="h-auto w-[72px] rounded lg:hidden" />

          {/* buscador (desktop) */}
          <div className="hidden h-10 flex-1 items-center gap-3 rounded-full border border-linea bg-carta px-4 text-[13px] text-tenue lg:flex">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m20 20-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input placeholder="¿Qué querés ver? Preguntale a Ángela…"
              className="w-full bg-transparent text-tinta placeholder:text-tenue focus:outline-none"
              onKeyDown={(e) => e.key === "Enter" && correrAgente()} />
          </div>
          <div className="flex-1 lg:hidden" />
          {/* Nueva venta a plazo: el vendedor genera el documento para entregar */}
          <button onClick={() => setVentaAbierta(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-3 py-2 text-[12.5px] font-semibold text-black transition-transform hover:scale-[1.02] sm:px-4">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
            <span className="hidden sm:inline">Nueva venta a plazo</span>
            <span className="sm:hidden">Vender</span>
          </button>
          {selectorRol}
        </header>

        {/* vista activa */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          {vista === "inicio" && (
            <Feed rol={rol} solicitudes={solicitudes ?? []} auditoria={auditoria ?? []}
              irA={irA} refresh={refresh} />
          )}
          {vista === "cerebro" && (
            ocultarCerebro ? (
              <div className="mx-auto max-w-md px-6 py-16 text-center">
                <h2 className="text-[18px] font-semibold">El Cerebro es una vista de escritorio</h2>
                <p className="mt-2 text-[13.5px] text-tenue">
                  El mapa de la red se ve mejor en pantalla grande. Desde el teléfono
                  tenés tu score, tus compras, tus pagos y el mapa de adheridos.
                </p>
                <button onClick={() => irA("compras")}
                  className="mt-4 rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-black">
                  Ir a mis compras
                </button>
              </div>
            ) : (
              <Cerebro rol={rol} focal={focal} setFocal={setFoco} refresh={refresh} resultado={resultado} />
            )
          )}
          {vista === "alertas" && <Alertas rol={rol} irA={irA} refresh={refresh} />}
          {vista === "aprobaciones" && (
            <Aprobaciones rol={rol} solicitudes={solicitudes ?? []} recargar={recargar} irA={irA} />
          )}
          {vista === "decisiones" && (
            <Decisiones rol={rol} solicitudes={solicitudes ?? []} recargar={recargar} irA={irA} />
          )}
          {vista === "pagos" && <Pagos rol={rol} refresh={refresh} recargar={recargar} abrirDoc={abrirDoc} />}
          {vista === "cartera" && <Cartera rol={rol} irA={irA} refresh={refresh} />}
          {vista === "mapa" && <Mapa rol={rol} irA={irA} />}
        </main>
      </div>

      {/* panel de Ángela — desktop grande (xl+); en mobile/consumidor no va */}
      <div className="hidden xl:flex">
        <Angela
          rol={rol} auditoria={auditoria ?? []} pendientes={pendientes.length}
          evaluando={evaluando} resultado={resultado}
          correrAgente={correrAgente} irA={irA}
          vigilarAhora={vigilarAhora} vigilando={vigilando}
        />
      </div>

      {/* Nueva venta a plazo: genera el e-pagaré para entregar al cliente */}
      {ventaAbierta && (
        <NuevaVenta
          rol={rol} irA={irA}
          onCerrar={() => setVentaAbierta(false)}
          onGenerado={(instrumentoId) => {
            setVentaAbierta(false);
            setDoc({ tipo: "epagare", id: instrumentoId });
            recargar();
          }}
        />
      )}

      {/* documentos (e-pagaré / comprobante) sobre cualquier vista */}
      {doc && <Documento doc={doc} onCerrar={() => setDoc(null)} onAceptar={aceptarInstrumento} />}
    </div>
  );
}

