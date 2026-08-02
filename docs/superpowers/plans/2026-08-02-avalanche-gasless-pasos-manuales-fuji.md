# Pasos manuales pendientes — deploy + smoke test real en Avalanche Fuji

> Complementa a `docs/superpowers/plans/2026-08-01-avalanche-gasless.md`
> (Tareas 1-13, todas completas y pusheadas). Este documento es solo la
> Tarea 14 de ese plan, expandida paso a paso — nada de código nuevo (salvo
> los fixes puntuales documentados abajo), es la puesta en marcha real con
> credenciales tuyas. Todo en **Fuji (testnet)** — no hay AVAX real en juego
> en ningún paso.

**Nunca pegues una private key real en el chat, en un commit, ni en ningún
archivo que no sea `.env` (gitignoreado).**

---

## ⚠️ Hallazgo importante: 0xgasless NO patrocina gas en Fuji hoy

Ejecutado y confirmado en la práctica (dos veces, por dos vías independientes):

- El contrato factory de Smart Account que usa el SDK de 0xgasless
  (`DEFAULT_ZEROXGASLESS_FACTORY_ADDRESS = 0x6Ce624d571B376D8Ecfbf9d9d79A3639D62A86C8`,
  **una sola dirección, sin mapa por chain**, según el propio código del
  SDK) **no está deployado en Avalanche Fuji** (`eth_getCode` devuelve
  vacío) — pero **sí está deployado en Avalanche mainnet** (`eth_getCode`
  devuelve bytecode real). Se puede reproducir:
  ```bash
  curl -s -X POST "https://avalanche-fuji-c-chain.publicnode.com" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["0x6Ce624d571B376D8Ecfbf9d9d79A3639D62A86C8","latest"]}'
  # → "0x" (vacío, no existe)
  ```
- Independientemente, la lista de testnets que 0xgasless publica en su
  propio repo (`github.com/0xgasless/mcp`) — Sonic Testnet, Nillion
  Testnet, Babylon Testnet, MEGA Testnet, Kite Testnet, Ethereum Sepolia,
  Stable Testnet, Pharos Testnet — **no incluye Avalanche Fuji**.
- El bundler (`https://bundler.0xgasless.com/<chainId>`) y el paymaster
  (URL del dashboard) SÍ responden para Fuji (`chainId=43113`) — pero eso
  no alcanza: sin el contrato factory, el SDK no puede calcular la
  dirección de la Smart Account, así que no hay a quién transferirle el
  ownership ni a través de quién mandar una tx patrocinada.

**Consecuencia práctica:** en Fuji se puede deployar y probar que los 3
contratos funcionan de verdad (Pasos 1-6 de abajo), pero **el patrocinio de
gas de 0xgasless (el objetivo central de este trabajo) solo se puede
demostrar en Avalanche mainnet** — la única red donde confirmamos que el
factory existe. Eso es la Tarea 15 del plan original (con AVAX real, gate
de confirmación explícita).

Si en algún momento 0xgasless deploya su factory en Fuji, `npm run
contracts:deploy:fuji` va a volver a intentar la transferencia
automáticamente sin que haga falta tocar nada — el código ya lo soporta
(ver Paso 5).

---

## Paso 0 — Prerequisitos

```bash
node --version   # necesitás 22.5+
cp backend/.env.example backend/.env
cp contracts/.env.example contracts/.env
npm install && npm --prefix backend install && npm --prefix contracts install
npm run seed
```

## Paso 1 — Crear la wallet operadora descartable

Dos formas, elegí una — **ambas terminan en lo mismo: una address + una
private key que solo vas a usar para este proyecto.**

**Opción A — con MetaMask (recomendada, es la que funcionó en la práctica):**

1. En la extensión de MetaMask: menú de cuentas → **"Agregar cuenta"** →
   creá una cuenta nueva, dedicada solo a este proyecto (no reutilices una
   que ya tenga otras cosas).
2. Para exportar la private key: `⋮` (los tres puntos) en esa cuenta →
   **"Detalles de la cuenta"** → **"Mostrar clave privada"** → confirmá con
   tu contraseña de MetaMask.
3. Copiá la address (arriba de todo) y la private key.

**Opción B — generándola con un script (offline, sin ninguna extensión):**

```bash
node --input-type=module -e "
import {Wallet} from 'ethers';
const w = Wallet.createRandom();
console.log('address:', w.address);
console.log('private key:', w.privateKey);
"
```

**Cualquiera sea la opción:** guardá los dos valores en un lugar tuyo
(gestor de contraseñas, `.txt` fuera del repo) — nunca en el chat de un
asistente ni en ningún archivo del repo que no sea `.env` (gitignoreado).
Es una wallet descartable de testnet, pero tratala con el mismo cuidado que
una real.

## Paso 2 — Fondearla con AVAX de testnet (gratis)

**Ruta que funcionó de verdad (probada):** `https://build.avax.network/` —
creá una cuenta, conectá la wallet del Paso 1 (si usaste la Opción A de
MetaMask, es literalmente la misma extensión) y pedí el faucet de **Testnet
AVAX · C-Chain · Chain 43113**. No pide login social ni coupon.

**Rutas que NO funcionaron, para no perder tiempo repitiéndolas:**
- `https://core.app/tools/testnet-faucet/` — pide un coupon **o** que la
  address ya tenga AVAX en **mainnet** (>0). Si conseguís un coupon del
  hackathon, esta sirve; si no, saltearla.
- `https://faucets.chain.link/fuji` — el drip de AVAX nativo ahí pide tener
  al menos 1 LINK en Ethereum mainnet (mismo tipo de gate anti-bot). El
  drip de **LINK** de Fuji que sí te puede dar sin ese requisito **no sirve
  para esto**: LINK es un token ERC-20 aparte, el gas en Fuji se paga en
  AVAX nativo, no en LINK.

Esto lo necesitás porque la wallet operadora es la que firma el **deploy**
de los contratos — en Fuji, hoy, paga su propio gas siempre (ver el
hallazgo de arriba). Con 0.5 AVAX de testnet alcanza de sobra.

## Paso 3 — Crear el paymaster en 0xgasless (igual sirve tenerlo armado)

Esto es en el navegador, seguí lo que te muestre la pantalla real (puede
diferir un poco de esta descripción). Aunque el patrocinio no vaya a
funcionar en Fuji (ver el hallazgo de arriba), dejar esto armado ahorra
tiempo cuando se pruebe en mainnet:

1. Entrá a `https://dashboard.0xgasless.com` y creá cuenta / iniciá sesión.
2. Creá un paymaster nuevo, chain **Avalanche Fuji**.
3. Pegá la `address` de la wallet operadora (Paso 1) como wallet autorizada.
4. El dashboard te da **API key**, **Paymaster URL** y **Creator address**
   — OJO, **NO te da una "Bundler URL" explícita**. Verificado en la
   práctica:

   - **Paymaster URL**: la que te dio el dashboard tal cual, con forma
     `https://paymaster.0xgasless.com/v1/<chainId>/rpc/<tu-key>`.
   - **Bundler URL**: **NO lleva key de proyecto** — es un endpoint
     compartido por chain: `https://bundler.0xgasless.com/<chainId>`. Para
     Fuji (`chainId=43113`): `https://bundler.0xgasless.com/43113`.
     Confirmado con una llamada de solo lectura
     (`eth_supportedEntryPoints`), que devolvió el EntryPoint estándar de
     ERC-4337 (`0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`):
     ```bash
     curl -s -X POST "https://bundler.0xgasless.com/43113" \
       -H "Content-Type: application/json" \
       -d '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}'
     ```
5. **Cargá el gas tank** del paymaster con fondos de testnet (para cuando
   sirva) — sin esto el patrocinio falla aunque todo lo demás esté bien.

## Paso 4 — Completar los `.env`

En **`backend/.env`** Y en **`contracts/.env`** (los mismos valores en los dos):

```
POLFIN_CHAIN_MODE=fuji
POLFIN_FUJI_RPC_URL=https://avalanche-fuji-c-chain.publicnode.com
POLFIN_OPERATOR_PRIVATE_KEY_FUJI=<la private key del Paso 1>
POLFIN_0XGASLESS_BUNDLER_URL_FUJI=<la URL del Paso 3>
POLFIN_0XGASLESS_PAYMASTER_URL_FUJI=<la URL del Paso 3>
```

**Sobre el RPC:** el default de `.env.example`
(`api.avax-test.network/ext/bc/C/rpc`, el oficial de Avalanche) y el de
Ankr (`rpc.ankr.com/avalanche_fuji`) devolvieron `"state not available for
pending block"` al estimar gas durante el deploy — un problema conocido de
varios RPCs públicos de Fuji con `eth_estimateGas` contra el bloque
`pending`. `publicnode.com` funcionó bien. El deploy (Paso 5) ya no depende
de esto de todas formas (usa `gasLimit` fijo), pero para cualquier otra
interacción con la chain conviene este RPC.

## Paso 5 — Deployar los 3 contratos a Fuji

```bash
npm run contracts:deploy:fuji
```

Fijate en la salida — en Fuji, **hoy es normal y esperado** ver:

```
OJO: falló la resolución/transferencia a la Smart Account (...). Los contratos
quedan owned por la EOA operadora — seguí sin el gasless por ahora.
```

(Eso es exactamente el hallazgo de arriba, no un error de tu setup — el
script sigue igual y termina bien.) Si en cambio ves **"Transfiriendo
ownership a la Smart Account: 0x..."**, quiere decir que 0xgasless ya
deployó su factory en Fuji — genial, avisá al equipo, y en ese caso las
tools del agente sí van a poder patrocinar gas ahí.

Las direcciones quedan en `contracts/deployments/fuji.json` (no hace falta
copiarlas a mano a ningún lado).

**Verificación:** abrí `https://testnet.snowtrace.io/address/<scoreRegistry>`
con la dirección que imprimió — tiene que existir el contrato y mostrar la
tx de deploy.

## Paso 6 — Validar que los contratos funcionan de verdad (sin gasless)

Con el deploy del Paso 5 hecho:

```bash
cd contracts
npx hardhat run scripts/verificar-fuji-sin-gasless.js --network fuji
```

Manda dos transacciones reales firmadas directo por la wallet operadora
(`registrarScore` + `generarInstrumento`), lee los datos de vuelta del
contrato, y confirma que coinciden. Al final imprime los `tx_hash` con link
a Snowtrace. Esto **sí** funciona en Fuji hoy — valida la lógica de negocio
real (los contratos), aunque la wallet pague su propio gas (nada
patrocinado todavía).

## Pasos que requieren mainnet (no funcionan en Fuji hoy)

Los siguientes pasos del diseño original **no se pueden completar en
Fuji** por el hallazgo de arriba — quedan documentados para cuando se
haga la Tarea 15 (mainnet, con AVAX real y el gate de confirmación del
plan):

- **Probar el flujo completo vía el backend real**
  (`POST /api/agente/evaluar-credito`, `npm run dev:api`) — hoy
  `backend/src/chain/onchain.js` (Tareas 6-7) solo sabe mandar
  transacciones patrocinadas cuando `POLFIN_CHAIN_MODE=fuji|avalanche`, no
  tiene un camino "chain real sin gasless". Como el gasless no funciona en
  Fuji, este camino queda bloqueado en esta red específicamente — el Paso 6
  de arriba prueba los mismos contratos pero por fuera del backend.
- `backend/scripts/verificar-gasless-fuji.js` — el script automático de
  verificación gasless que dejó el equipo. Va a fallar en Fuji con el mismo
  error de la Smart Account por la misma razón; es exactamente el script
  correcto para correr en mainnet una vez ahí.
- La verificación visual en el frontend mostrando "Ver en Snowtrace" con
  gas patrocinado — depende de que el paso anterior funcione.

---

## Al terminar

Lo que se puede cerrar en Fuji hoy: Pasos 1-6 (deploy real + contratos
funcionando con transacciones reales, sin patrocinio). El patrocinio de
gas en sí — el objetivo central de este trabajo — se demuestra recién en
mainnet (Tarea 15). Marcá los checkboxes que correspondan en
`docs/superpowers/plans/2026-08-01-avalanche-gasless.md` una vez
confirmado.
