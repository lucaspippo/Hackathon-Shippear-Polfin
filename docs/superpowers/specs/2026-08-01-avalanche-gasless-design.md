# On-chain real en Avalanche (Fuji + mainnet) con gas patrocinado por 0xgasless

Date: 2026-08-01
Status: approved for planning

## Context

El spec previo (`2026-08-01-onchain-fuji-design.md`) ya se implementó a nivel de
código: `backend/src/chain/{provider,contracts,onchain}.js` y las tres tools
`PROMPT 4` en `tools.js` (`generarInstrumento`, `registrarScoreOnChain`,
`ejecutarPagoStablecoin`) ya branchean por `POLFIN_CHAIN_MODE` y llaman a
contratos reales vía `ethers.js` cuando el modo es `fuji`. Los tres contratos
Hardhat (`ScoreRegistry.sol`, `EPagare.sol`, `MockUSDC.sol`) también existen,
con tests.

Lo que falta no es código — es 100% operativo: `contracts/node_modules` nunca
se instaló, nada se compiló ni deployó, no existe `backend/.env` con las
variables de chain, y `POLFIN_CHAIN_MODE` nunca se seteó (cae al default
`mock`).

Además, para el track/bounty de Avalanche del hackathon (sponsor del evento)
se suma un requisito nuevo: las transacciones del wallet operador deben ir
**patrocinadas** (gas gratis para el operador) usando
[0xgasless](https://dashboard.0xgasless.com/) (Account Abstraction ERC-4337).
El dashboard de 0xgasless permite crear un proyecto/API key tanto para
Avalanche Fuji (testnet) como para Avalanche C-Chain (mainnet) — el usuario ya
tiene un API key de mainnet creado y va a crear el de testnet.

Esto cambia el spec anterior en dos ejes:

1. **Gas patrocinado**: la wallet operadora deja de firmar transacciones EOA
   directas contra los contratos y pasa a ser el owner/signer de una Smart
   Account de 0xgasless que manda las transacciones patrocinadas.
2. **Dos redes reales en paralelo, no solo una**: el plan de trabajo pedido
   explícitamente es probar primero en Fuji con una wallet "falsa" (sin
   fondos reales en juego) y recién después repetir en mainnet con una wallet
   real — así que `fuji` y `avalanche` conviven como dos modos reales
   completos, no uno reemplaza al otro.

## Goals

- Los tres contratos se deployan de verdad, tanto en Fuji testnet como en
  Avalanche C-Chain mainnet, con un script de deploy parametrizado por red.
- Las tres tools on-chain (`generarInstrumento`, `registrarScoreOnChain`,
  `ejecutarPagoStablecoin`) mandan transacciones reales y **patrocinadas**
  (gas pagado por el paymaster de 0xgasless, no por el wallet operador) contra
  cualquiera de las dos redes, según `POLFIN_CHAIN_MODE`.
- Se puede probar todo el flujo primero en `fuji` (wallet descartable, sin
  riesgo) y recién pasar a `avalanche` (wallet real) cuando el flujo en Fuji
  esté verificado.
- El sistema sigue siendo demo-safe: `POLFIN_CHAIN_MODE=mock` (default) deja
  el comportamiento actual intacto, sin necesidad de ninguna de estas keys.
- Nada de fallback silencioso: un error de chain real (revert, rechazo del
  paymaster, timeout de RPC) es un error real, mismo camino que ya usa
  `server.js` (try/catch genérico → `400 { error }`).
- Los links "Ver en Snowtrace" del frontend apuntan al explorador correcto
  según la red (`testnet.snowtrace.io` para Fuji, `snowtrace.io` para
  mainnet), sin que cada componente tenga que decidirlo por su cuenta.

## Non-goals

- Wallets por entidad — sigue habiendo una sola wallet operadora **por red**
  (dos wallets en total: una para Fuji, una para mainnet), igual que el spec
  anterior.
- x402 / pagos agente-a-agente — evaluado y descartado explícitamente para
  este alcance.
- Test suite nueva de backend/frontend — solo se tocan los tests Hardhat
  existentes si algo deja de compilar (no se espera).
- Migrar `marcarPagado(tokenId)` a ningún flujo — sigue sin estar cableado,
  igual que antes.

## Architecture

### 1. `contracts/`

- `hardhat.config.js`: se agrega la red `avalanche` (mainnet, chainId 43114)
  junto a la `fuji` (testnet, chainId 43113) que ya existe. Cada red lee su
  propio par RPC/private-key con sufijo: `POLFIN_FUJI_RPC_URL` /
  `POLFIN_OPERATOR_PRIVATE_KEY_FUJI`, `POLFIN_AVALANCHE_RPC_URL` /
  `POLFIN_OPERATOR_PRIVATE_KEY_AVALANCHE`.
- `scripts/deploy.js`: deploya los tres contratos normalmente (owner = la EOA
  operadora, como hoy), después calcula la dirección de la Smart Account de
  0xgasless correspondiente a esa EOA en esa red (usando el API key
  `POLFIN_0XGASLESS_API_KEY_FUJI` / `_AVALANCHE` según corresponda) y llama
  `transferOwnership(smartAccountAddress)` en los tres contratos — así las
  llamadas `onlyOwner` posteriores, que van a llegar patrocinadas desde la
  Smart Account y no desde la EOA, siguen siendo válidas. Escribe direcciones
  + dirección de la Smart Account a `contracts/deployments/{red}.json`
  (`fuji.json` o `avalanche.json`), ya gitignoreado.
- `package.json`: se agrega `deploy:avalanche` junto al `deploy:fuji`
  existente.
- Sin cambios en el Solidity de los tres contratos ni en sus tests.

### 2. `backend/src/chain/`

- `provider.js`: en vez de una sola wallet, arma la wallet operadora según la
  red activa (`fuji` o `avalanche`, derivada de `POLFIN_CHAIN_MODE`), leyendo
  el RPC y la private key con el sufijo correspondiente.
- `gasless.js` (nuevo): inicializa el cliente de Smart Account de 0xgasless
  envolviendo esa wallet como owner/signer, usando el API key de la red
  activa. Expone una función para mandar una transacción patrocinada dado
  `{ to, data }` (calldata ya codificado) y devolver el hash de la
  transacción resultante. La superficie exacta del SDK (nombres de paquete,
  métodos, forma del objeto de config) se confirma al implementar leyendo el
  paquete instalado — la doc pública devolvió 403 a fetches automatizados en
  varias páginas, así que no se asume una API específica acá.
- `contracts.js`: en vez de leer 6 variables de entorno con las direcciones,
  lee `contracts/deployments/{red}.json` (misma carpeta que ya escribe el
  deploy) para obtener las tres direcciones de la red activa. Sigue
  exponiendo los `ethers.Interface` de los tres contratos (para codificar el
  calldata que consume `gasless.js`).
- `onchain.js`: `escribirScoreOnChain`, `mintearInstrumentoOnChain`,
  `liquidarPagoStablecoinOnChain` mantienen la misma firma y valor de
  retorno que hoy. Internamente: codifican el calldata con
  `Interface.encodeFunctionData(...)` y lo mandan vía `gasless.js` en vez de
  firmar una tx EOA directa con `ethers.Contract`. Donde hace falta leer el
  evento emitido (`InstrumentoGenerado` para el `tokenId`), se obtiene el
  receipt de la transacción (por hash, vía el provider) y se parsea igual
  que hoy.

### 3. `backend/src/agente/tools.js` y `server.js`

- `modoChain()` sigue devolviendo el valor crudo de `POLFIN_CHAIN_MODE`
  (`mock` | `fuji` | `avalanche`) — no cambia.
- El valor de `red` que se persiste cuando NO es una red real pasa de
  `'fuji-mock'` a simplemente `'mock'` (limpieza: hoy es confuso llamar
  "fuji-mock" a algo que no tiene nada que ver con Fuji). Cuando sí es real,
  `red` es literalmente `'fuji'` o `'avalanche'`.
- `server.js`: se define una tabla `REDES = { fuji: { label, explorerBase:
  'https://testnet.snowtrace.io' }, avalanche: { label, explorerBase:
  'https://snowtrace.io' } }` y se calcula `explorer_url`/`red_label` una
  sola vez ahí. Se agrega ese cálculo también a `GET /api/instrumentos` y
  `GET /api/instrumentos/:id` (hoy solo lo tiene el endpoint de perfil) para
  que el frontend deje de rearmar la URL de Snowtrace a mano en cada
  componente.

### 4. Frontend

- `frontend/lib/api.ts`: tipos `chain_mode`/`red` pasan de `"mock" | "fuji"`
  a `"mock" | "fuji" | "avalanche" | string`; se agrega `explorer_url` /
  `red_label` al tipo de `Instrumento` (ya existía en el tipo de perfil).
- `documento.tsx`, `aprobaciones.tsx`, `perfil.tsx`,
  `verificar/[id]/page.tsx`: reemplazan sus checks manuales
  (`red === "fuji"`, URLs de Snowtrace hardcodeadas) por los campos
  `explorer_url` / `red_label` / `es_real` que ahora vienen del backend en
  todos los endpoints relevantes, no solo en perfil.

### 5. Documentación

- `README.md`: el bullet "On-chain (Avalanche Fuji) sigue en stubs" se
  actualiza para reflejar que ya es real, en dos redes, con gas patrocinado.
- `CLAUDE.md`: la lista de env vars de chain se actualiza a los nuevos
  nombres (sufijados por red) y se menciona 0xgasless.

## Data flow (ejemplo: `generarInstrumento` en modo `avalanche`)

1. El pipeline llama `ejecutarTool(db, 'generarInstrumento', input, ctx)`.
2. `modoChain()` devuelve `'avalanche'`.
3. `mintearInstrumentoOnChain(...)` en `onchain.js` codifica el calldata de
   `generarInstrumento(...)` contra la dirección de `EPagare` leída de
   `deployments/avalanche.json`.
4. `gasless.js` manda esa transacción patrocinada a través del
   bundler/paymaster de 0xgasless del proyecto `_AVALANCHE`.
5. Se espera el receipt, se parsea el evento `InstrumentoGenerado` para el
   `tokenId`.
6. Se persiste `contrato_address`, `tx_hash`, `token_id`, `red='avalanche'`
   en `instrumentos`.
7. El frontend pide `/api/instrumentos/:id`, y muestra "Ver en Snowtrace"
   usando el `explorer_url` que ya viene armado
   (`https://snowtrace.io/tx/{tx_hash}`, sin el prefijo `testnet.`).

El flujo en modo `fuji` es idéntico, solo cambia qué archivo de deployments,
qué par de env vars (`_FUJI`) y qué `explorerBase` se usan.

## Error handling

Sin cambios de principio respecto al spec anterior: un error real de chain
(revert, rechazo del paymaster por gas tank sin fondos, timeout de RPC,
bundler caído) se propaga como excepción JS real. No hay fallback a datos
mock cuando el modo es `fuji` o `avalanche` — una operación fallida es una
operación fallida, no se degrada en silencio. El try/catch genérico que ya
envuelve cada handler en `server.js` la captura y devuelve
`400 { error: message }`.

## Testing

- Los tests Hardhat existentes (`EPagare.test.js`, `MockUSDC.test.js`,
  `ScoreRegistry.test.js`) corren contra la red local de Hardhat, no se ven
  afectados por agregar la red `avalanche` a la config.
- Sin test suite automatizada nueva para backend/frontend (consistente con
  que este repo no tiene test suite — ver `CLAUDE.md`).
- Verificación manual, en orden obligatorio:
  1. Deploy + smoke test completo en `fuji` con la wallet descartable.
     Confirmar que la transacción aparece en `testnet.snowtrace.io` y que el
     wallet operador **no gastó AVAX propio** (gas patrocinado).
  2. Recién después de confirmar (1), repetir exactamente el mismo flujo en
     `avalanche` con la wallet real.

## Environment variables (nuevas/cambiadas)

Ya reflejadas en `backend/.env.example` y `contracts/.env.example`:

- `POLFIN_CHAIN_MODE` — `mock` (default) | `fuji` | `avalanche`.
- `POLFIN_FUJI_RPC_URL` (ya existía) / `POLFIN_AVALANCHE_RPC_URL` (nueva).
- `POLFIN_OPERATOR_PRIVATE_KEY_FUJI` / `POLFIN_OPERATOR_PRIVATE_KEY_AVALANCHE`
  — reemplazan a `POLFIN_OPERATOR_PRIVATE_KEY` (una sola, sin sufijo). Dos
  wallets distintas, nunca la misma clave en las dos.
- `POLFIN_0XGASLESS_API_KEY_FUJI` / `POLFIN_0XGASLESS_API_KEY_AVALANCHE` —
  nuevas, un proyecto de 0xgasless por red.
- `POLFIN_SCORE_REGISTRY_ADDRESS` / `POLFIN_EPAGARE_ADDRESS` /
  `POLFIN_MOCK_USDC_ADDRESS` — **se eliminan** del `.env`; ahora se leen de
  `contracts/deployments/{red}.json`.

## Operational setup (no es código — lo hace el usuario)

- Crear el proyecto de 0xgasless para Fuji testnet en el dashboard (el de
  mainnet ya existe) y cargar su API key en `POLFIN_0XGASLESS_API_KEY_FUJI`.
- Generar/obtener dos private keys de wallet operadora: una descartable para
  Fuji, una real para mainnet. Nunca pegar la private key en el chat con el
  asistente.
- Fondear la wallet de Fuji con AVAX de testnet (faucet, gratis). Fondear la
  wallet de mainnet con AVAX real — el asistente no puede ejecutar esa
  transferencia.
- Cargar el gas tank del paymaster en el dashboard de 0xgasless, para cada
  uno de los dos proyectos, según la política que pida el dashboard.
- Dar el OK explícito antes de correr el script de deploy contra `avalanche`
  (gasta AVAX real, aunque sea centavos) — el deploy contra `fuji` no
  requiere ese chequeo por ser testnet gratuito.

## Open questions / risks

- La superficie exacta del SDK de 0xgasless (paquete npm, nombres de método
  para envolver un signer existente y mandar una tx patrocinada) no se pudo
  confirmar por doc pública (403 en fetches automatizados a
  `docs.0xgasless.com`) — se confirma al implementar, leyendo el paquete
  instalado.
- No hay confirmación de que el soporte de Fuji testnet de 0xgasless cubra
  exactamente las mismas capacidades de bundler/paymaster que mainnet — el
  primer deploy + llamada real en `fuji` es, en la práctica, la verificación
  de esto. Si Fuji resulta no estar soportado del todo, el fallback es
  probar directo en `avalanche` con montos mínimos.
- Se asume que el SDK de 0xgasless permite calcular la dirección
  "counterfactual" de la Smart Account (antes de que esa Smart Account tenga
  ninguna transacción propia on-chain) para poder hacer el
  `transferOwnership` justo después del deploy de los contratos. Si el SDK
  no lo permite así, la alternativa es mandar una primera transacción trivial
  patrocinada (ej. una lectura que dispare el deploy counterfactual) antes
  de transferir el ownership.
