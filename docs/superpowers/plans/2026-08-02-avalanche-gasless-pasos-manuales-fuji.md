# Pasos manuales pendientes — deploy + smoke test real en Avalanche Fuji

> Complementa a `docs/superpowers/plans/2026-08-01-avalanche-gasless.md`
> (Tareas 1-13, todas completas y pusheadas). Este documento es solo la
> Tarea 14 de ese plan, expandida paso a paso — nada de código nuevo, es la
> puesta en marcha real con credenciales tuyas. Todo en **Fuji (testnet)** —
> no hay AVAX real en juego en ningún paso. Mainnet (Tarea 15) queda fuera
> de alcance por ahora.

**Nunca pegues una private key real en el chat, en un commit, ni en ningún
archivo que no sea `.env` (gitignoreado).**

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
de los contratos (eso lo paga ella, normal, no patrocinado) — el gasless
solo aplica a las 3 tools del agente después del deploy. Con 0.5 AVAX de
testnet alcanza de sobra.

## Paso 3 — Crear el paymaster en 0xgasless

Esto es en el navegador, seguí lo que te muestre la pantalla real (puede
diferir un poco de esta descripción):

1. Entrá a `https://dashboard.0xgasless.com` y creá cuenta / iniciá sesión.
2. Creá un paymaster nuevo, chain **Avalanche Fuji**.
3. Pegá la `address` de la wallet operadora (Paso 1) como wallet autorizada.
4. El dashboard te da **API key**, **Paymaster URL** y **Creator address**
   — OJO, **NO te da una "Bundler URL" explícita** (a diferencia de lo que
   asumía una versión anterior de este doc). Verificado en la práctica:

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
5. **Cargá el gas tank** del paymaster con fondos de testnet — sin esto el
   patrocinio falla aunque todo lo demás esté bien.

## Paso 4 — Completar los `.env`

En **`backend/.env`** Y en **`contracts/.env`** (los mismos valores en los dos):

```
POLFIN_CHAIN_MODE=fuji
POLFIN_FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
POLFIN_OPERATOR_PRIVATE_KEY_FUJI=<la private key del Paso 1>
POLFIN_0XGASLESS_BUNDLER_URL_FUJI=<la URL del Paso 3>
POLFIN_0XGASLESS_PAYMASTER_URL_FUJI=<la URL del Paso 3>
```

## Paso 5 — Deployar los 3 contratos a Fuji

```bash
npm run contracts:deploy:fuji
```

Fijate en la salida:
- Tiene que decir **"Transfiriendo ownership a la Smart Account: 0x..."** —
  si en cambio ves "OJO: no se transfirió el ownership...", falta algo del
  Paso 4 (revisá `contracts/.env`, no solo `backend/.env`, porque Hardhat
  lee de ahí).
- Las direcciones quedan en `contracts/deployments/fuji.json` (no hace
  falta copiarlas a mano a ningún lado).

**Verificación:** abrí `https://testnet.snowtrace.io/address/<scoreRegistry>`
con la dirección que imprimió — tiene que existir el contrato y mostrar la
tx de deploy.

## Paso 6 — Levantar el backend en modo Fuji

```bash
npm run dev:api
```

En otra terminal, listá entidades reales de la DB sembrada:

```bash
curl -s http://localhost:4000/api/entidades | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
JSON.parse(d).slice(0,10).forEach(e=>console.log(e.id, e.nombre, e.tipo));
});"
```

## Paso 7 — Prueba manual: disparar un crédito real

```bash
curl -X POST http://localhost:4000/api/agente/evaluar-credito \
  -H "Content-Type: application/json" \
  -d '{"deudorId": <id de una persona>, "acreedorId": <id de un comercio>, "montoSolicitado": 20000}'
```

La respuesta trae un `tx_hash` real. Pegalo en
`https://testnet.snowtrace.io/tx/<tx_hash>` y confirmá que la transacción
está confirmada y emitió el evento correspondiente (`InstrumentoGenerado` o
`ScoreRegistrado`).

**La prueba clave del "gasless":** anotá el balance AVAX de la wallet
operadora antes de este paso y después
(`https://testnet.snowtrace.io/address/<tu wallet>`) — tiene que ser
exactamente igual. Si bajó, el paymaster no está patrocinando de verdad.

## Paso 8 — Prueba con código (automática, hace el Paso 7 por vos)

Con `backend/.env` completo (Paso 4) y el deploy hecho (Paso 5):

```bash
node --env-file=backend/.env backend/scripts/verificar-gasless-fuji.js
```

Manda una tx patrocinada (`registrarScore`), imprime el `tx_hash` con link a
Snowtrace, y compara el balance AVAX antes/después — si detecta que gastó
gas propio, termina con error (exit code 1) en vez de solo avisar.

## Paso 9 — Verificación visual en el frontend

```bash
npm run dev
```

Entrá a `http://localhost:3000`, andá al perfil de la entidad que usaste en
el Paso 7, y confirmá que la tarjeta "Verificado on-chain" dice
**"Avalanche Fuji (testnet)"** (no "modo demo"), con un botón
"Ver en Snowtrace →" que lleva a un link real.

---

## Al terminar

Si los 10 pasos salen bien, la Tarea 14 del plan original queda cerrada de
verdad (no solo el código — la puesta en marcha real). Marcá sus checkboxes
en `docs/superpowers/plans/2026-08-01-avalanche-gasless.md` vos mismo una
vez confirmado, ya que requiere que hayas ejecutado cada paso con tus
propias credenciales.
