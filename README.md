# PolFin

**El buró de crédito de la economía informal, construido desde el comercio verificado.**
Track Finanzas · Hackathon Shippear (Rosario, 1 de agosto 2026) · Sponsor: Team1 de Avalanche.

Un agente de IA (Ángela) ordena el crédito comercial de la cadena
(fábrica → distribuidora → mayorista → minorista → consumidor) construyendo un
buró de crédito **portable y verificable** entre comercios. La **decisión** de
crédito es una fórmula determinística y auditable; la **IA** interpreta, explica,
conversa y detecta señales tempranas — nunca inventa un número de decisión.

**Qué hay hoy:**
- **Scoring 0–1000** determinístico y explicable + **pipeline** de crédito como
  máquina de estados (con approval gate humano para lo que mueve plata).
- **Ángela por el AI Gateway de Vercel (V0)** — `LLM_MODE=gateway`, modelo
  `anthropic/claude-sonnet-5`. Chat abierto: el dueño pregunta cualquier cosa y
  Ángela razona encadenando tools de **solo lectura** sobre datos reales.
- **Lectura macro** (`contexto_macro.json`): el contexto del país ajusta **plazo
  y spread** (nunca el score), de forma neutral (solo riesgo, nunca política).
- **Insights proactivos**: Ángela lee la red y genera tarjetas de early-warning
  (cambio de comportamiento, concentración, oportunidad, anomalía, cobros).
- **Shell** (`frontend/`, Next.js): selector de rol en la cadena
  (Fábrica/Distribuidora/Mayorista/Minorista), feed inteligente, Cerebro
  (grafo de red), mapa, "Nueva venta a plazo" que genera el e-pagaré para entregar.
- On-chain (Avalanche Fuji) sigue en stubs marcados `PROMPT 4` en `tools.js`.

**Deploy:** dos web services en Render (backend + frontend) vía `render.yaml`.
La DB SQLite se **auto-seedea en el arranque**. Ver **[DEPLOY.md](DEPLOY.md)**.

## Estructura

```
polfin/
├── backend/    Node + Express + SQLite (node:sqlite, sin deps nativas)
│   ├── src/db.js      esquema (entidades multi-rol + transacciones + macro)
│   ├── src/seed.js    generador de datos sintéticos argentinos (seedeado)
│   ├── src/scoring.js motor de scoring 0–1000 (determinístico y explicable)
│   ├── src/scores-report.js  reporte por consola (npm run scores)
│   ├── src/agente/    el agente (Prompt 3)
│   │   ├── agente.js       loop percibe→decide→ejecuta + human-in-the-loop
│   │   ├── tools.js        registro de tools (schema Anthropic) + stubs on-chain
│   │   ├── policy.js       policy engine (límites, allowlist, auditoría)
│   │   └── llm/            LLMProvider: mock.js | anthropic.js (por LLM_MODE)
│   ├── src/server.js  API REST
│   └── data/polfin.db la DB generada (gitignoreada, se regenera)
└── frontend/   Next.js + React + Tailwind + shadcn/ui
```

## Cómo correrlo

Requiere Node 22.5+ (usa `node:sqlite`). Desde `polfin/`:

```bash
npm install
npm --prefix backend install
npm --prefix frontend install
npm run seed   # genera la DB con el dataset sintético (reproducible)
npm run dev    # levanta API (:4000) + frontend (:3000) juntos
```

Abrí http://localhost:3000 — la página muestra el dataset y verifica el cableado front ↔ API.

## El modelo de datos (la decisión importante)

Una sola tabla **`entidades`** (comercios y personas). Cualquier entidad puede ser
**acreedora Y deudora a la vez**, porque en la cadena real cada comercio compra y
vende según su posición: fábrica → distribuidora → mayorista → minorista → consumidor.
`transacciones` referencia `acreedor_id` y `deudor_id` contra la misma tabla.
Ej.: el Almacén Doña Marta es *acreedor* de sus clientas de fiado y *deudor* de la
Distribuidora Ceres.

## El dataset sintético (seedeado y diseñado)

- **Reproducible:** PRNG mulberry32 con seed `20260801` + fecha de referencia fija
  `2026-08-01`. Correr `npm run seed` las veces que quieras: siempre da lo mismo.
- **13 comercios** de Rosario y alrededores (San Lorenzo, Funes, VGG, Baigorria) con
  coordenadas reales para el mapa, cada uno con su rol en la cadena.
- **18 clientes** con perfiles diseñados en los datos (NO scores hardcodeados):
  - **Marcela Benítez** — la estrella: ~100% puntual, 2 años, 5 comercios distintos.
    **Nunca compró en el Corralón Ovidio Lagos** → ese es "el comercio nuevo" de la
    demo del scoring portable.
  - **Joaquín Paz** — thin file: 3 transacciones, un solo kiosco.
  - **Rubén Alcaraz** — el moroso: ~22% puntual, atrasos de 10–45 días, 6 vencidas.
  - **Graciela Mansilla** — buena pagadora pero en UN solo comercio (contraste con
    la portabilidad de Marcela).
  - Intermedios variados para densidad del grafo.
- **~270 transacciones** en los últimos 24 meses, B2B (la cadena fiándose entre sí)
  y B2C (fiado de mostrador), con montos en pesos realistas por rubro.
- **Macro de referencia** (inflación, TC, tasa TNA por mes) para `consultarMacro()`
  del agente. Valores plausibles — **verificar cifras reales cerca del evento**.

## El motor de scoring (Prompt 2)

Score **0–1000** determinístico y explicable sobre las transacciones verificables:
puntualidad 35% · diversidad de red 20% · historial 15% · volumen 15% · tendencia 15%
(fórmula de la sección 3 del doc maestro). Decisiones clave:

- Pagar tarde nunca vale más que 0.6 de calidad, y decae a 0 a los 45 días de
  atraso; una vencida impaga vale 0 (la señal más grave).
- **Amortiguación por evidencia**: con <6 operaciones cerradas, puntualidad y
  tendencia se corren hacia el neutro → el thin file no puntúa como estrella
  por 3 pagos puntuales.
- **Diversidad** = comercios con buen comportamiento *sostenido* (≥60% puntual,
  sin vencidas), tope en 5. Es el factor que premia la portabilidad.
- **Tendencia** = calidad de pago ponderada por recencia (semivida 9 meses).
- Score → condiciones (tabla §3): tasa = base macro (última TNA de
  `macro_referencia`) + recargo por banda de riesgo; límite anclado en la
  mediana de compra de los últimos 12 meses.

Endpoints: `GET /api/score/:id` (score + desglose por factor + explicación en
lenguaje natural + condiciones) · `GET /api/scores?tipo=persona` (ranking).
Reporte por consola: `npm --prefix backend run scores`.

Resultados sobre los perfiles diseñados (verificado): Marcela **966** (muy bajo,
90 días, tasa base) · Graciela **721** (buena pero mono-comercio: la brecha de
245 pts la explica la diversidad 40/200 vs 200/200) · Joaquín **438** (thin
file amortiguado, límite $23.000) · Rubén **290** (alto riesgo, 22% puntual,
6 vencidas, límite $36.000 a 15 días).

## El agente (Prompt 3, refactorizado)

**Principio de arquitectura**: el motor de crédito es **determinístico de punta a
punta** — no solo las tools, también la coordinación. `pipelineCredito.js` es una
máquina de estados explícita (`RECIBIDO → SCORING → CONDICIONES → POLICY_CHECK →
[PENDIENTE_APROBACION ⏸] → EJECUTANDO → COMPLETADO / RECHAZADO`) con orden de
pasos fijo. El approval gate es **asíncrono**: `PENDIENTE_APROBACION` es un estado
persistido (no una espera bloqueante); `reanudarPipeline()` retoma al aprobar.
El LLM vive SOLO en los bordes conversacionales: interpreta la frase de entrada y
verbaliza el resultado de salida — **ningún número de decisión nace en el LLM**.

**Ángela proactiva** (`agenteProactivo.js`): un monitor en loop de fondo
(`POLFIN_MONITOR_INTERVAL` segundos, default 300; 0 = apagado) recorre la red
con reglas determinísticas — ampliación (score ≥700 y >60% del límite usado),
riesgo de atraso (atraso vivo > 1.3× su patrón histórico: "paga X% más lento
que su histórico") y vencimientos de e-pagarés (`POLFIN_VENC_VENTANA` días).
Lo que no mueve plata se entrega directo; lo que mueve plata pasa por el MISMO
pipeline con `origen='proactiva'` y el policy engine fuerza el approval gate
**siempre** (sin importar el monto). Dedup por clave en la tabla `detecciones`.
Gatillo en vivo para el pitch: `POST /api/agente/monitorear`
(body opcional `{ventana_vencimiento}`) · `GET /api/agente/detecciones`.

Dos formas de invocar el MISMO pipeline:
- **Directa (sin LLM)**: `POST /api/agente/evaluar-credito` `{deudor_id,
  acreedor_id, monto}` — lo que usa la UI. Devuelve la trayectoria de `estados`.
- **Conversacional (LLM en bordes)**: `POST /api/agente/conversar` `{texto}` —
  extrae parámetros (mock: matcher determinístico / anthropic: tool use forzado),
  corre el pipeline, y verbaliza (con instrucción explícita de no inventar números).

- **Tools** ([tools.js](backend/src/agente/tools.js), formato oficial de tool use de
  Anthropic): `getHistorialCliente`, `calcularScoring`, `consultarMacro`,
  `decidirCondiciones` (lógica real) + `generarInstrumento`, `registrarScoreOnChain`,
  `ejecutarPagoStablecoin` (stubs on-chain con mock realista, marcados `PROMPT 4`)
  + `notificarDueno`.
- **Policy engine** ([policy.js](backend/src/agente/policy.js)): límite autónomo
  por operación (`POLFIN_LIMITE_AUTONOMO`, default $500.000), allowlist de tools,
  pagos en stablecoin SIEMPRE con OK humano, y log de auditoría completo
  (cada decisión de policy + cada tool con parámetros y resultado).
- **LLMProvider intercambiable por `LLM_MODE`** (default `mock`):
  - `mock`: secuencia determinística que reproduce el camino feliz completo SIN
    API key, citando los números reales que devuelven las tools.
  - `anthropic`: la llamada real (SDK oficial, `claude-opus-5`). Para activar:
    `ANTHROPIC_API_KEY=... LLM_MODE=anthropic` — nada más se toca. Opcional:
    `POLFIN_FALLBACKS=1` activa el rescate automático ante refusals (beta).
- **Human-in-the-loop**: si el monto supera el límite, el agente NO ejecuta —
  la solicitud queda `pendiente_aprobacion`, el dueño recibe la notificación y
  aprueba/rechaza con `POST /api/solicitudes/:id/aprobar|rechazar`.

Endpoints: `POST /api/agente/evaluar-credito` `{deudor_id, acreedor_id, monto}` ·
`GET /api/agente/auditoria?corrida=` · `/api/agente/policy` · `/api/solicitudes` ·
`/api/instrumentos` · `/api/notificaciones`.

Verificado en mock: Marcela + $180k en el corralón → aprobada y ejecutada (score
966 citado del motor, e-pagaré + score on-chain mock) · Los Pinos + $2,5M →
`pendiente_aprobacion` (policy bloquea, dueño notificado, aprobación posterior
emite el instrumento) · Rubén + $120k → rechazada (score 290, límite $36k).

## Cómo verificar que los datos quedaron bien

1. `npm run seed` imprime una tabla por deudor (tx, % puntual, vencidas, comercios).
2. `GET http://localhost:4000/api/resumen` — totales + comportamiento por deudor.
   Chequeá que Marcela ≈100% puntual en 5 comercios, Joaquín 3 tx, Rubén con vencidas.
3. `GET http://localhost:4000/api/entidades` · `/api/entidades/:id` (las dos caras:
   `como_acreedor` y `como_deudor`) · `/api/transacciones?deudor=14&estado=vencida` ·
   `/api/macro` · `/api/health`.
4. La home (http://localhost:3000) muestra todo eso renderizado.

## Próximos pasos (secuencia del doc maestro)

3. Agente (tools + loop + policy engine) → 4. On-chain (Fuji: scoring registry +
instrumento RWA) → 5. Vistas → 6. Cerebro/grafo → 7. Modo demo.
