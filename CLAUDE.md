# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PolFin — "el buró de crédito de la economía informal": a scoring/credit engine for
informal commerce chains (fábrica → distribuidora → mayorista → minorista →
consumidor), built for Hackathon Shippear (Rosario). See `README.md` for the
full narrative (in Spanish) including the demo script and verified sample
scores — read it before making architecture-level changes, it's the primary
design doc for this repo.

## Commands

Monorepo, no workspaces — root scripts just shell out via `--prefix`.

```bash
npm install                      # root deps (just `concurrently`)
npm --prefix backend install
npm --prefix frontend install

npm run seed                     # (re)generate backend/data/polfin.db — required before first run
npm run dev                      # API (:4000) + frontend (:3000) together
npm run dev:api                  # backend only
npm run dev:web                  # frontend only
```

Backend (`backend/`): `npm run dev` (`node src/server.js`, no watch/reload),
`npm run seed`, `npm run scores` (console score report over the seeded data).

Frontend (`frontend/`): `npm run dev`, `npm run build`, `npm run start`,
`npm run lint`.

There is no test suite in this repo.

Requires **Node 22.5+** — the backend uses the built-in `node:sqlite` module
(no native deps to compile). The API refuses to start if
`backend/data/polfin.db` doesn't exist yet — run `npm run seed` first.

The dataset is deterministic: mulberry32 PRNG seeded `20260801`, fixed
reference date `2026-08-01`. Re-running `npm run seed` always produces the
same entities/transactions/scores — useful for verifying a change didn't
shift the numbers.

## Architecture

**Shape**: `backend/` (Node + Express + SQLite) serves a REST API;
`frontend/` (Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui) is a
thin client over it via `fetch`.

### Data model

One table, `entidades`, holds both comercios and personas. Any entity can be
creditor (`acreedor`) *and* debtor (`deudor`) at once, because a real chain
link buys from one side and sells to the other (e.g. the corner store owes
its distributor but is owed by its fiado customers). `transacciones`
references `acreedor_id`/`deudor_id` against that same table — there's no
separate debtor/creditor schema. See `backend/src/db.js` for the full schema
and `backend/src/seed.js` for how the designed customer profiles (the
"star" payer, the "thin file", the delinquent, etc.) are generated.

### Scoring engine (`backend/src/scoring.js`)

Deterministic 0–1000 score from weighted, explainable factors: puntualidad
35%, diversidad de red 20%, historial 15%, volumen 15%, tendencia 15%.
Evidence-damping pulls puntualidad/tendencia toward neutral under 6 closed
ops (so a thin file can't score like a star off 3 lucky payments), and
diversidad only credits comercios with *sustained* good behavior (≥60%
puntual, no vencidas), capped at 5. Exposed via `GET /api/score/:id` (score +
breakdown + natural-language explanation + suggested conditions) and
`GET /api/scores` (ranking).

### The agent (`backend/src/agente/`)

The core architectural rule: **the credit-decision engine is deterministic
end to end — including the orchestration, not just the tools**.

- `pipelineCredito.js` is an explicit state machine:
  `RECIBIDO → SCORING → CONDICIONES → POLICY_CHECK → [PENDIENTE_APROBACION ⏸] → EJECUTANDO → COMPLETADO/RECHAZADO`.
  The approval gate is **async**: `PENDIENTE_APROBACION` is a state persisted
  in the DB, not a blocking wait — `reanudarPipeline()` resumes it whenever
  the human responds (could be seconds or hours later).
- The LLM lives **only at the conversational edges** (`agente.js`): parsing
  free-text input, verbalizing the output. No decision number (score, rate,
  limit) is ever produced by the LLM — those all come from the deterministic
  tools in `scoring.js` / `tools.js`.
- `tools.js` is an Anthropic tool-use-schema registry. The on-chain tools
  (`generarInstrumento`, `registrarScoreOnChain`, `ejecutarPagoStablecoin`)
  send real, gas-sponsored transactions (via 0xgasless) against Avalanche
  Fuji or mainnet C-Chain when `POLFIN_CHAIN_MODE` is `fuji`/`avalanche`;
  `mock` (default) keeps the old simulated behavior.
- `policy.js` enforces the autonomy limit (`POLFIN_LIMITE_AUTONOMO`), a tool
  allowlist, mandatory human approval for *any* stablecoin payment
  regardless of amount, and a full audit trail (every policy decision + tool
  call with params/result).
- `agente/llm/` is a pluggable `LLMProvider` selected by `LLM_MODE`: `mock`
  (default — scripted deterministic happy path, no API key needed) or
  `anthropic` (real SDK call using `claude-opus-5`; `POLFIN_FALLBACKS=1`
  enables an experimental refusal-rescue path).
- `agenteProactivo.js` is a background monitor loop
  (`POLFIN_MONITOR_INTERVAL` seconds, default 300, `0` disables) that scans
  the network with deterministic rules — ampliación (score ≥700 and >60% of
  limit used), riesgo de atraso (current delay > 1.3× historical pattern),
  vencimientos (`POLFIN_VENC_VENTANA` days out). Detections dedup via the
  `detecciones` table; anything that would move money still goes through the
  *same* pipeline (with `origen='proactiva'`), and policy always forces the
  approval gate for these regardless of amount.
- Two entry points into the *same* pipeline: `POST /api/agente/evaluar-credito`
  (direct, no LLM — what the UI calls) and `POST /api/agente/conversar`
  (LLM parses free text in, then verbalizes the result out).

### API (`backend/src/server.js`)

A single flat Express file (~440 lines, no router split) — read it directly
for the full endpoint list rather than assuming REST conventions; several
routes derive computed columns (e.g. `pagado`/`saldo` from the `pagos`
table) inline in SQL rather than storing them.

### Frontend

Effectively a single page (`app/page.tsx` → `components/shell.tsx`) built
around a **role selector** (`frontend/lib/roles.ts`) with no auth — the
selector *is* the login. Each of the 4 roles (Fábrica/Distribuidora/
Comercio/Consumidor final) is anchored to a real entity id in the seeded DB;
switching roles reparametrizes the feed, cerebro, cartera, and alertas
around that entity's id.

- `frontend/lib/api.ts` is the only fetch layer (`api`/`apiPost` against
  `NEXT_PUBLIC_API_URL`, default `http://localhost:4000`), with TS types
  mirroring the backend's JSON shapes — check the types here before assuming
  a response shape.
- `components/cerebro.tsx` renders the relationship graph
  (`react-force-graph-2d` + `d3-force-3d`) from `GET /api/red`.
- `components/mapa.tsx` uses Leaflet for the geographic view.
- `frontend/AGENTS.md` (imported by `frontend/CLAUDE.md` via `@AGENTS.md`)
  warns that this Next.js version has breaking changes vs. training data —
  check `node_modules/next/dist/docs/` before writing Next.js-specific code.

### Language convention

Identifiers, comments, and docs throughout the codebase are in Spanish
(Argentina): `deudor`, `acreedor`, `entidades`, `vencida`, `puntualidad`,
etc. Keep new code consistent with that rather than introducing English
names.

### Key env vars

`LLM_MODE`, `ANTHROPIC_API_KEY`, `POLFIN_FALLBACKS`,
`POLFIN_LIMITE_AUTONOMO`, `POLFIN_MONITOR_INTERVAL`, `POLFIN_VENC_VENTANA`,
`POLFIN_API_PORT` (backend, default 4000), `NEXT_PUBLIC_API_URL` (frontend →
backend base URL), `POLFIN_CHAIN_MODE` (`mock` default | `fuji` | `avalanche`),
`POLFIN_FUJI_RPC_URL` / `POLFIN_AVALANCHE_RPC_URL`,
`POLFIN_OPERATOR_PRIVATE_KEY_FUJI` / `POLFIN_OPERATOR_PRIVATE_KEY_AVALANCHE`,
`POLFIN_0XGASLESS_BUNDLER_URL_FUJI` / `POLFIN_0XGASLESS_PAYMASTER_URL_FUJI` /
`POLFIN_0XGASLESS_BUNDLER_URL_AVALANCHE` /
`POLFIN_0XGASLESS_PAYMASTER_URL_AVALANCHE` (gas patrocinado vía la Smart
Account de 0xgasless — ver
`docs/superpowers/specs/2026-08-01-avalanche-gasless-design.md`). Las
direcciones de los 3 contratos ya no van en el `.env`: se leen de
`contracts/deployments/{fuji|avalanche}.json`, generado por
`npm run contracts:deploy:fuji` / `:avalanche`.
