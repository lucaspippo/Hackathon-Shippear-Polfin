# On-chain provider-supplier chain on Avalanche Fuji (Prompt 4)

Date: 2026-08-01
Status: approved for planning

## Context

PolFin's agent (`backend/src/agente/`) has three tools marked `PROMPT 4` in
`tools.js` that are currently mocked stubs backed by random hex strings:

- `generarInstrumento` — creates the e-pagaré (credit instrument) for an
  approved credit decision.
- `registrarScoreOnChain` — writes an entity's score to a portable
  reputation registry.
- `ejecutarPagoStablecoin` — settles a payment in USDC on testnet (already
  gated behind mandatory human approval in `policy.js`, regardless of
  amount).

The DB schema (`instrumentos`, `scores_onchain` tables in `backend/src/db.js`)
already has `contrato_address` / `tx_hash` / `red` columns sized for real
values — today they hold `fuji-mock` data from `randomBytes()`.

This spec covers replacing those three stubs with real integrations against
Avalanche Fuji testnet, without changing the deterministic pipeline
architecture (`pipelineCredito.js`) or the "no decision number is invented"
principle described in the root `CLAUDE.md`.

## Goals

- All three on-chain tools make real transactions against Avalanche Fuji
  when enabled.
- The system stays demo-safe: a toggle to fall back to the existing
  deterministic mock path, mirroring the existing `LLM_MODE` (`mock` /
  `anthropic`) convention.
- No silent fallback from a failed real chain call to fabricated mock data —
  a chain error is a real error, surfaced through the existing `auditoria`
  error path.
- Judges/reviewers can verify the pitch's claims by clicking through to
  `testnet.snowtrace.io`.

## Non-goals

- Per-entity wallets. All chain writes are signed by a single PolFin
  operator wallet; `deudorId`/`acreedorId`/`entidadId` remain internal DB
  integers stored as contract data, not addresses.
- A broader test suite for the backend/frontend. Only the new Solidity
  contracts get tests.
- Real (non-mock) USDC. We deploy and control our own mock ERC20 so the demo
  never depends on a third-party faucet's balance or rate limits.
- Any change to `policy.js`'s approval rules — those are unaffected by
  where the tx actually executes.

## Architecture

### 1. New `contracts/` package

A third top-level package next to `backend/` and `frontend/`, using Hardhat
(JS-native, fits this all-Node monorepo, easy ethers.js integration). Root
`package.json` gets `npm --prefix contracts ...` scripts matching the
existing `backend`/`frontend` pattern.

Three contracts, all `Ownable` by the single PolFin operator address:

- **`ScoreRegistry.sol`** — `mapping(uint256 entidadId => Score)` where
  `Score = { uint256 score; uint64 timestamp }`. `registrarScore(entidadId,
  score)` is `onlyOwner`, overwrites the latest value, and emits
  `ScoreRegistrado(entidadId, score, timestamp)`. The full score history is
  the event log (readable on Snowtrace) — the contract itself only needs to
  answer "what's the latest score."
- **`EPagare.sol`** (ERC-721, OpenZeppelin `Ownable` + `ERC721`) — one NFT
  per credit instrument, always minted to the operator wallet's address
  (custodial; see Non-goals). Per-token data: `{deudorId, acreedorId,
  monto, tasaTnaBps, plazoDias, fechaVencimiento, estado}` where `estado`
  is an enum `{Activo, Pagado, Vencido}`. `generarInstrumento(...)` mints
  (`onlyOwner`); `marcarPagado(tokenId)` updates state (`onlyOwner`, for
  future use — not wired to any caller yet).
- **`MockUSDC.sol`** (ERC20, 6 decimals) — `mint(to, amount)` `onlyOwner`.
  `ejecutarPagoStablecoin` mints (or transfers from a pre-minted operator
  balance) to the `destino` address passed in by the caller.

A Hardhat deploy script deploys all three to Fuji and writes their
addresses to a `deployments/fuji.json` (or equivalent) that the backend
reads at startup.

### 2. Backend integration (`backend/src/chain/`)

- `provider.js` — `ethers.JsonRpcProvider` pointed at the Fuji RPC URL,
  plus a `Wallet` built from `POLFIN_OPERATOR_PRIVATE_KEY`.
- `contracts.js` — `ethers.Contract` instances for the three deployed
  addresses + their ABIs (copied/read from the Hardhat build artifacts).
- `tools.js` — each of the three `PROMPT 4` blocks branches on
  `POLFIN_CHAIN_MODE`:
  - `mock` (default): unchanged behavior, `mockHash()`/`mockAddress()`,
    `red: 'fuji-mock'`.
  - `fuji`: calls the real contract method, `await`s the tx receipt, and
    persists the **real** `contrato_address` / `tx_hash` with `red: 'fuji'`.

**Concurrency/async note**: `ejecutarTool` (`tools.js:124`) is currently
synchronous. Real chain calls are async, so `ejecutarTool` becomes `async`,
and its call sites become `await ejecutarTool(...)`:
`pipelineCredito.js:48`, `:103`, `:153`, `:155`, and the two
`agenteProactivo.js` call sites (functionally unaffected — `notificarDueno`
stays DB-only — but awaited for consistency now that the function is
`async`).

### 3. Frontend polish

Wherever `instrumentos` / `scores_onchain` rows render (cartera, cerebro
detail panel, wherever), add a "Ver en Snowtrace" link:
`https://testnet.snowtrace.io/tx/{tx_hash}` and
`https://testnet.snowtrace.io/address/{contrato_address}`, shown only when
`red === 'fuji'` (hidden for `fuji-mock` rows, since there's nothing real to
link to).

### 4. Error handling

In `fuji` mode, a reverted tx, RPC timeout, or insufficient-gas error
propagates as a real thrown JS error. Correction from an earlier draft of
this section: `auditoria.tipo` *allows* an `'error'` value in its `CHECK`
constraint, but no code actually writes one today — verified by search, zero
hits. So a chain failure surfaces exactly the way any other tool failure
already does: the generic `try/catch` already wrapping every route handler
in `server.js` catches it and returns `400 { error: message }`. No new
error-observability code is in scope here. No fallback to mock data on a
real-mode failure; a failed chain call is a failed operation, not silently
downgraded.

### 5. Testing

Minimal Hardhat tests for the three new contracts only: mint/read paths and
access control (`onlyOwner` reverts for non-owner callers). This repo has no
existing test suite and this spec doesn't introduce one for
backend/frontend — out of scope.

## Environment variables (new)

- `POLFIN_CHAIN_MODE` — `mock` (default) | `fuji`.
- `POLFIN_OPERATOR_PRIVATE_KEY` — Fuji-funded operator wallet private key
  (required only in `fuji` mode).
- `POLFIN_FUJI_RPC_URL` — Fuji RPC endpoint.
- `POLFIN_SCORE_REGISTRY_ADDRESS`, `POLFIN_EPAGARE_ADDRESS`,
  `POLFIN_MOCK_USDC_ADDRESS` — deployed contract addresses (populated after
  running the Hardhat deploy script).

## Operational setup (not code)

- Generate/fund the operator wallet with Fuji testnet AVAX from a faucet
  before any demo in `fuji` mode.
- Run the Hardhat deploy script once per environment/redeploy and update
  the backend `.env` with the resulting addresses.

## Open questions / risks

- Gas costs on Fuji are testnet AVAX (free from faucet) — not a real
  concern, but faucet rate limits mean the operator wallet should be topped
  up well before a live demo, not during it.
- `marcarPagado(tokenId)` on `EPagare.sol` is defined but not called from
  anywhere yet — no code path currently marks an instrument paid on-chain
  (the DB-side `instrumentos.estado` lifecycle is unaffected by this spec).
  Flagged here so it isn't mistaken for an oversight during implementation.
