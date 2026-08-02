# Continuación — avalanche-gasless (estado al 2026-08-02)

> Complementa a `docs/superpowers/plans/2026-08-01-avalanche-gasless.md`
> (Tareas 1-13, código) y a
> `docs/superpowers/plans/2026-08-02-avalanche-gasless-pasos-manuales-fuji.md`
> (Tarea 14 paso a paso). Este doc es el "dónde quedamos" para retomar sin
> releer toda la conversación.

## Qué está resuelto

- **Tareas 1-13 del plan** (contratos, backend, frontend, docs): completas,
  auditadas, commiteadas con firma SSH y pusheadas.
- **x402 facilitator de 0xgasless (bounty del sponsor): resuelto y
  verificado on-chain.** Ver `backend/scripts/probar-x402-facilitator.js` —
  liquida una autorización EIP-3009 real contra el facilitator
  (`https://x402.0xgasless.com/settle`) en Avalanche Fuji. Última corrida
  exitosa: tx `0x015e5ebad59abd300a461f288aac19c384acad773a261d9815f8f7f063702c5a`,
  confirmada en Snowtrace, `status: exitosa`, wallet operadora en 0 AVAX
  antes y después (el relayer de 0xgasless, `0x4B9E841a...847202`, pagó el
  gas). El shape correcto del request está documentado en el header del
  script — es un formato propio de 0xgasless, **no** el schema genérico del
  paquete npm `x402` (son dos facilitators distintos aunque compartan
  nombre de protocolo).

## Qué falta — Tarea 14 (deploy real de PolFin en Fuji)

Importante: esto es un producto de 0xgasless **distinto** del x402 que ya
resolvimos. Las 3 tools del agente (`registrarScoreOnChain`,
`generarInstrumento`, `ejecutarPagoStablecoin`) usan el flujo clásico
**Smart Account + Paymaster + Bundler (ERC-4337)**
(`backend/src/chain/gasless.js`), no el facilitator x402.

Bloqueante actual: **conseguir AVAX de testnet** en la wallet operadora de
Fuji. USDC no sirve para esto — el gas en Avalanche se paga siempre en AVAX
nativo, ningún token ERC-20 (ni siquiera vía swap, porque el swap en sí
también necesita AVAX para el gas). Probado y descartado:

- Faucet oficial (`core.app`/`faucet.avax.network`): no larga fondos.
- Pendiente de confirmar resultado: Chainlink (`faucets.chain.link/fuji`),
  Thirdweb (`thirdweb.com/avalanche-fuji`).
- Alternativa si los faucets siguen sin andar: pedir 0.05-0.1 AVAX
  transferidos directo de alguien que ya tenga en Fuji (es dinero de
  juguete, no hay problema en pedirlo así), o el canal `#faucet` del
  Discord de Avalanche.

Una vez resuelto el AVAX, according a
`2026-08-02-avalanche-gasless-pasos-manuales-fuji.md`, todavía falta un
paso nuevo no cubierto ahí: **crear el paymaster clásico** (no el x402) en
`dashboard.0xgasless.com` para la wallet operadora en Avalanche Fuji, y
completar `POLFIN_0XGASLESS_BUNDLER_URL_FUJI` /
`POLFIN_0XGASLESS_PAYMASTER_URL_FUJI` en `backend/.env` y `contracts/.env`
(son URLs distintas de todo lo que usamos para x402).

## Próximos pasos, en orden

1. Conseguir AVAX de testnet en `0x53f878315a47df6E330ab961C2F7993D1544487C`
   (o la wallet operadora que se esté usando).
2. Crear el paymaster **clásico** (Smart Account) en
   `dashboard.0xgasless.com` para Avalanche Fuji — distinto del x402.
3. Completar `backend/.env` / `contracts/.env` con las 5 variables de la
   Tarea 14 (`POLFIN_OPERATOR_PRIVATE_KEY_FUJI`,
   `POLFIN_0XGASLESS_BUNDLER_URL_FUJI`,
   `POLFIN_0XGASLESS_PAYMASTER_URL_FUJI`, más el RPC).
4. `npm run contracts:deploy:fuji` — confirmar que transfiere el ownership
   a la Smart Account (no el mensaje "OJO: no se transfirió...").
5. Levantar el backend en modo Fuji, disparar un crédito de prueba real, y
   verificar en Snowtrace que la wallet operadora no gastó AVAX en las 3
   tools (sí gastó en el deploy del paso 4, eso es esperado y único).
6. Verificar visualmente en el frontend que el e-pagaré muestra
   "Avalanche Fuji (testnet)" con links reales a Snowtrace.

Mainnet (Tarea 15) sigue fuera de alcance.
