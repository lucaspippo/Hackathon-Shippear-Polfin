# On-chain real en Avalanche (Fuji + mainnet) con gas patrocinado por 0xgasless — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deployar de verdad los tres contratos de PolFin en Avalanche Fuji (testnet) y Avalanche C-Chain (mainnet), y hacer que las tres tools on-chain del agente (`generarInstrumento`, `registrarScoreOnChain`, `ejecutarPagoStablecoin`) manden transacciones reales con el gas patrocinado por 0xgasless, en vez de que la wallet operadora lo pague.

**Architecture:** La wallet operadora (una por red — Fuji "falsa", mainnet real) deja de firmar transacciones EOA directas y pasa a ser el signer de una Smart Account de 0xgasless (ERC-4337) que manda las tres llamadas patrocinadas. Los contratos se deployan igual que hoy y les transferimos el `Ownable` a esa Smart Account justo después del deploy. `POLFIN_CHAIN_MODE` gana un tercer valor real (`avalanche`, junto al `fuji` que ya existía) — los dos comparten el mismo código, solo cambian las variables de entorno sufijadas por red.

**Tech Stack:** Node 22 (backend, ESM), Hardhat + ethers.js v6 + OpenZeppelin (contracts, CommonJS), Next.js/React/TypeScript (frontend), SDK de 0xgasless (paquete a confirmar en la Tarea 6).

## Global Constraints

- No hay test suite de backend/frontend en este repo — la verificación de esas partes es manual (comandos `node --input-type=module -e` para smoke checks, no se introduce un framework de testing nuevo).
- Los tests Hardhat existentes (`contracts/test/*.test.js`) deben seguir pasando después de cualquier cambio a `hardhat.config.js` o `deploy.js`.
- Nunca pegar una private key real en un mensaje de chat, commit, o archivo trackeado por git — solo en `.env` (gitignoreado).
- `POLFIN_CHAIN_MODE=mock` (default) no debe requerir ninguna de las variables nuevas — su comportamiento actual queda intacto.
- Un error real de chain (revert, rechazo del paymaster, timeout de RPC) se propaga como excepción real — nunca hay fallback silencioso a datos mock cuando el modo es `fuji` o `avalanche`.
- El deploy contra `avalanche` (mainnet) gasta AVAX real — la Tarea 15 requiere OK explícito del usuario antes de ejecutarse; la Tarea 14 (`fuji`) no, por ser testnet gratuito.
- Nombres e identificadores en español (Argentina), consistente con el resto del repo.

---

### Task 1: Bootstrap del paquete `contracts/`

**Files:** ninguno se crea/modifica — solo se instalan dependencias ya declaradas en `contracts/package.json`.

**Interfaces:** ninguna (tarea de verificación pura).

- [ ] **Step 1: Instalar dependencias**

Run: `npm run contracts:install` (desde la raíz del repo)
Expected: instala sin errores. `contracts/node_modules/` queda creado (gitignoreado).

- [ ] **Step 2: Compilar**

Run: `npm run contracts:compile`
Expected: `Compiled 3 Solidity files successfully` (o similar), sin errores.

- [ ] **Step 3: Correr los tests existentes**

Run: `npm run contracts:test`
Expected: los tests de `EPagare.test.js`, `MockUSDC.test.js`, `ScoreRegistry.test.js` pasan (PASS), sin fallos.

- [ ] **Step 4: Confirmar que no hay cambios para commitear**

Run: `git status`
Expected: `contracts/node_modules/`, `contracts/artifacts/`, `contracts/cache/` no aparecen (ya gitignoreados). Si `contracts/package-lock.json` cambió, es la única excepción — en ese caso sí commitear solo ese archivo con `git add contracts/package-lock.json && git commit -m "chore(contracts): actualizar lockfile"`. Si no cambió nada, no hay commit para esta tarea.

---

### Task 2: Helper compartido de redes (`backend/src/chain/redes.js`)

**Files:**
- Create: `backend/src/chain/redes.js`

**Interfaces:**
- Produces: `REDES` (objeto `{ fuji: {label, explorerBase}, avalanche: {label, explorerBase} }`), `esRedReal(red: string): boolean`, `redLabel(red: string): string`, `explorerUrl(red: string, tipo: 'tx'|'address'|'nft', valor: string|null): string|null` — usados por `tools.js` (Tarea 9) y `server.js` (Tarea 10).

- [ ] **Step 1: Escribir el archivo**

```js
// backend/src/chain/redes.js
//
// Tabla única de "qué significa cada red real" — la usan tools.js (para
// devolver el link del explorador junto con cada tx) y server.js (para
// recomputar el mismo link a partir de una fila de la DB). Antes esta lógica
// estaba duplicada en 4 componentes del frontend con "testnet.snowtrace.io"
// hardcodeado; ahora vive en un solo lugar del backend.

export const REDES = {
  fuji: {
    label: 'Avalanche Fuji (testnet)',
    explorerBase: 'https://testnet.snowtrace.io',
  },
  avalanche: {
    label: 'Avalanche C-Chain',
    explorerBase: 'https://snowtrace.io',
  },
};

export function esRedReal(red) {
  return red === 'fuji' || red === 'avalanche';
}

export function redLabel(red) {
  return REDES[red]?.label ?? 'Avalanche (modo demo)';
}

export function explorerUrl(red, tipo, valor) {
  const cfg = REDES[red];
  if (!cfg || !valor) return null;
  return `${cfg.explorerBase}/${tipo}/${valor}`;
}
```

- [ ] **Step 2: Smoke check**

Run (desde la raíz del repo):
```bash
node --input-type=module -e "
import { explorerUrl, redLabel, esRedReal } from './backend/src/chain/redes.js';
const casos = [
  [explorerUrl('fuji','tx','0xabc'), 'https://testnet.snowtrace.io/tx/0xabc'],
  [explorerUrl('avalanche','address','0xdef'), 'https://snowtrace.io/address/0xdef'],
  [explorerUrl('mock','tx','0xabc'), null],
  [explorerUrl('fuji','tx',null), null],
  [esRedReal('fuji'), true],
  [esRedReal('avalanche'), true],
  [esRedReal('mock'), false],
  [redLabel('avalanche'), 'Avalanche C-Chain'],
  [redLabel('mock'), 'Avalanche (modo demo)'],
];
let fallos = 0;
for (const [got, want] of casos) {
  if (got !== want) { console.error('FALLO:', got, '!==', want); fallos++; }
}
console.log(fallos === 0 ? 'OK redes.js' : \`\${fallos} fallo(s)\`);
process.exit(fallos === 0 ? 0 : 1);
"
```
Expected: `OK redes.js`, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add backend/src/chain/redes.js
git commit -m "feat(backend): helper de redes/explorer URLs compartido"
```

---

### Task 3: Hardhat — red `avalanche` + env vars por sufijo + scripts npm

**Files:**
- Modify: `contracts/hardhat.config.js`
- Modify: `contracts/package.json`
- Modify: `package.json` (raíz)

**Interfaces:**
- Produces: red `avalanche` en Hardhat (chainId 43114), scripts `contracts:deploy:avalanche` (raíz) / `deploy:avalanche` (`contracts/`).

- [ ] **Step 1: Actualizar `contracts/hardhat.config.js`**

Reemplazar todo el archivo:

```js
require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      evmVersion: 'cancun',
    },
  },
  networks: {
    fuji: {
      url: process.env.POLFIN_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc',
      chainId: 43113,
      accounts: process.env.POLFIN_OPERATOR_PRIVATE_KEY_FUJI ? [process.env.POLFIN_OPERATOR_PRIVATE_KEY_FUJI] : [],
    },
    avalanche: {
      url: process.env.POLFIN_AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
      chainId: 43114,
      accounts: process.env.POLFIN_OPERATOR_PRIVATE_KEY_AVALANCHE ? [process.env.POLFIN_OPERATOR_PRIVATE_KEY_AVALANCHE] : [],
    },
  },
};
```

(Nota: `POLFIN_OPERATOR_PRIVATE_KEY_FUJI`/`_AVALANCHE` reemplazan a `POLFIN_OPERATOR_PRIVATE_KEY` sin sufijo — ya reflejado en `contracts/.env.example`.)

- [ ] **Step 2: Agregar el script `deploy:avalanche` en `contracts/package.json`**

En el bloque `"scripts"`, agregar la línea (después de `"deploy:fuji"`):
```json
    "deploy:avalanche": "hardhat run scripts/deploy.js --network avalanche"
```

- [ ] **Step 3: Agregar el script `contracts:deploy:avalanche` en el `package.json` de la raíz**

En el bloque `"scripts"`, agregar (después de `"contracts:deploy:fuji"`):
```json
    "contracts:deploy:avalanche": "npm --prefix contracts run deploy:avalanche"
```

- [ ] **Step 4: Verificar que sigue compilando y testeando**

Run: `npm run contracts:compile && npm run contracts:test`
Expected: mismo resultado que en la Tarea 1, Step 2/3 (cambiar la red en config no afecta compile/test, que corren contra la red local de Hardhat).

- [ ] **Step 5: Commit**

```bash
git add contracts/hardhat.config.js contracts/package.json package.json
git commit -m "feat(contracts): agregar red avalanche mainnet + env vars por sufijo"
```

---

### Task 4: `contracts/scripts/deploy.js` — actualizar el mensaje final

**Files:**
- Modify: `contracts/scripts/deploy.js:36-39`

**Interfaces:**
- Sin cambio de interfaz — el script sigue escribiendo `contracts/deployments/{network}.json` (esto YA lo hace hoy, no hay que agregarlo).

- [ ] **Step 1: Reemplazar el bloque final**

En `contracts/scripts/deploy.js`, reemplazar las líneas 36-39:

```js
  console.log('\nAgregá esto a backend/.env:');
  console.log(`POLFIN_SCORE_REGISTRY_ADDRESS=${direcciones.scoreRegistry}`);
  console.log(`POLFIN_EPAGARE_ADDRESS=${direcciones.ePagare}`);
  console.log(`POLFIN_MOCK_USDC_ADDRESS=${direcciones.mockUsdc}`);
```

por:

```js
  console.log(`\nDirecciones escritas en contracts/deployments/${hre.network.name}.json`);
  console.log('El backend las lee de ahí directo — no hace falta pegarlas en ningún .env.');
```

- [ ] **Step 2: Smoke test contra la red local de Hardhat (sin credenciales reales)**

Run: `npx hardhat run scripts/deploy.js --network hardhat` (desde `contracts/`)
Expected: deploya los 3 contratos contra la red efímera en memoria de Hardhat, imprime las direcciones y el nuevo mensaje, y escribe `contracts/deployments/hardhat.json` (gitignoreado, se puede borrar después).

- [ ] **Step 3: Commit**

```bash
git add contracts/scripts/deploy.js
git commit -m "chore(contracts): actualizar mensaje de deploy (direcciones vía deployments/*.json)"
```

---

### Task 5: Backend lee configuración por red (`provider.js` + `contracts.js`)

**Files:**
- Modify: `backend/src/chain/provider.js`
- Modify: `backend/src/chain/contracts.js`

**Interfaces:**
- Consumes: `contracts/deployments/{red}.json` (escrito por la Tarea 4/8), `process.env.POLFIN_CHAIN_MODE`.
- Produces: `obtenerRedActiva(): 'fuji'|'avalanche'` (lanza si `POLFIN_CHAIN_MODE` no es una red real), `obtenerWalletOperador(): ethers.Wallet` (sin cambio de firma) — usados por `gasless.js` (Tarea 6) y `contracts.js`. `obtenerScoreRegistry()`, `obtenerEPagare()`, `obtenerMockUSDC()` (sin cambio de firma) — usados por `onchain.js` (Tarea 7).

- [ ] **Step 1: Reescribir `backend/src/chain/provider.js`**

```js
// backend/src/chain/provider.js
import { ethers } from 'ethers';

let wallet = null;

function redDesdeModo() {
  const modo = (process.env.POLFIN_CHAIN_MODE || 'mock').toLowerCase();
  return modo === 'fuji' || modo === 'avalanche' ? modo : null;
}

// Red real activa según POLFIN_CHAIN_MODE ('fuji' | 'avalanche'). Lanza si el
// modo es 'mock' — llamar solo desde código que ya sabe que está en modo real.
export function obtenerRedActiva() {
  const red = redDesdeModo();
  if (!red) throw new Error('POLFIN_CHAIN_MODE debe ser "fuji" o "avalanche" para operar on-chain');
  return red;
}

export function obtenerWalletOperador() {
  if (wallet) return wallet;
  const red = obtenerRedActiva();
  const sufijo = red.toUpperCase();
  const rpcUrl = process.env[`POLFIN_${sufijo}_RPC_URL`];
  const privateKey = process.env[`POLFIN_OPERATOR_PRIVATE_KEY_${sufijo}`];
  if (!rpcUrl || !privateKey) {
    throw new Error(`POLFIN_${sufijo}_RPC_URL y POLFIN_OPERATOR_PRIVATE_KEY_${sufijo} son obligatorias en POLFIN_CHAIN_MODE=${red}`);
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  wallet = new ethers.Wallet(privateKey, provider);
  return wallet;
}
```

- [ ] **Step 2: Reescribir `backend/src/chain/contracts.js`**

```js
// backend/src/chain/contracts.js
import { ethers } from 'ethers';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { obtenerWalletOperador, obtenerRedActiva } from './provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ABI_SCORE_REGISTRY = [
  'function registrarScore(uint256 entidadId, uint256 score) external',
  'event ScoreRegistrado(uint256 indexed entidadId, uint256 score, uint256 timestamp)',
];

const ABI_EPAGARE = [
  'function generarInstrumento(uint256 deudorId, uint256 acreedorId, uint256 monto, uint256 tasaTnaBps, uint256 plazoDias, uint256 fechaVencimiento) external returns (uint256 tokenId)',
  'event InstrumentoGenerado(uint256 indexed tokenId, uint256 indexed deudorId, uint256 indexed acreedorId, uint256 monto)',
];

const ABI_MOCK_USDC = [
  'function mint(address to, uint256 amount) external',
];

let cache = null;

function leerDeployments() {
  const red = obtenerRedActiva();
  if (cache?.red === red) return cache.datos;
  const ruta = join(__dirname, '..', '..', '..', 'contracts', 'deployments', `${red}.json`);
  let datos;
  try {
    datos = JSON.parse(readFileSync(ruta, 'utf8'));
  } catch {
    throw new Error(`falta contracts/deployments/${red}.json — correr "npm run contracts:deploy:${red}" primero`);
  }
  cache = { red, datos };
  return datos;
}

export function obtenerScoreRegistry() {
  return new ethers.Contract(leerDeployments().scoreRegistry, ABI_SCORE_REGISTRY, obtenerWalletOperador());
}

export function obtenerEPagare() {
  return new ethers.Contract(leerDeployments().ePagare, ABI_EPAGARE, obtenerWalletOperador());
}

export function obtenerMockUSDC() {
  return new ethers.Contract(leerDeployments().mockUsdc, ABI_MOCK_USDC, obtenerWalletOperador());
}
```

- [ ] **Step 3: Smoke check — confirmar que falla con el mensaje correcto sin config**

```bash
node --input-type=module -e "
process.env.POLFIN_CHAIN_MODE = 'fuji';
const { obtenerWalletOperador } = await import('./backend/src/chain/provider.js');
try {
  obtenerWalletOperador();
  console.error('FALLO: debería haber lanzado error sin POLFIN_FUJI_RPC_URL/POLFIN_OPERATOR_PRIVATE_KEY_FUJI');
  process.exit(1);
} catch (e) {
  console.log('OK, error esperado:', e.message);
}
"
```
Expected: imprime `OK, error esperado: POLFIN_FUJI_RPC_URL y POLFIN_OPERATOR_PRIVATE_KEY_FUJI son obligatorias en POLFIN_CHAIN_MODE=fuji`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/chain/provider.js backend/src/chain/contracts.js
git commit -m "feat(backend): wallet y direcciones de contrato por red activa"
```

---

### Task 6: Investigar el SDK de 0xgasless + `backend/src/chain/gasless.js`

**Nota:** esta tarea empieza con una investigación real — la API pública de `docs.0xgasless.com` devolvió 403 a fetches automatizados durante el diseño, así que la forma exacta del SDK (nombre del paquete, nombres de método) no está confirmada. El Step 1 es obligatorio y concreto: instalar el paquete y leer su propio README/tipos antes de escribir una sola línea de `gasless.js`. Los steps siguientes dan un esqueleto de partida a ajustar contra lo que encuentres — no lo tomes como API confirmada.

**Files:**
- Modify: `backend/package.json` (nueva dependencia)
- Create: `backend/src/chain/gasless.js`

**Interfaces:**
- Consumes: `obtenerWalletOperador()`, `obtenerRedActiva()` de `provider.js` (Tarea 5).
- Produces: `enviarSponsored({ to: string, data: string, value?: bigint }): Promise<{ tx_hash: string, receipt: object|null }>` — lo consume `onchain.js` (Tarea 7).

- [ ] **Step 1: Investigar el paquete real**

```bash
npm --prefix backend view @0xgasless/smart-account 2>&1 | head -40
```

Si no existe (404), probar variantes:
```bash
npm --prefix backend view @0xgasless/agentkit 2>&1 | head -40
npm --prefix backend search 0xgasless
```

Con el nombre correcto confirmado, instalarlo:
```bash
npm --prefix backend install <paquete-confirmado>
```

Y leer su documentación real ya instalada (no la web, que devuelve 403):
```bash
cat backend/node_modules/<paquete-confirmado>/README.md
```
y sus tipos TypeScript si los tiene (buscar `.d.ts` dentro de `backend/node_modules/<paquete-confirmado>/`).

De esa lectura, anotar (en un comentario al principio de `gasless.js`, Step 2):
1. El import exacto (`import { X } from '<paquete>'`).
2. La función/clase para envolver la wallet operadora (`obtenerWalletOperador()`, un `ethers.Wallet`) en una Smart Account, y qué config pide (chainId, apiKey, rpcUrl, bundlerUrl, paymasterUrl…).
3. El método para mandar una transacción patrocinada dado `{to, data, value}`, y qué devuelve (¿hash solo, o receipt completo con `.logs`?).
4. Si existe una forma de calcular la dirección de la Smart Account ANTES de que tenga ninguna transacción propia on-chain (dirección "counterfactual") — la necesita la Tarea 8.

- [ ] **Step 2: Escribir `backend/src/chain/gasless.js`**

Usar como punto de partida (AJUSTAR nombres de import/método según lo confirmado en el Step 1 — quedan marcados abajo):

```js
// backend/src/chain/gasless.js
//
// Envuelve la wallet operadora en una Smart Account de 0xgasless (ERC-4337)
// para mandar las tres llamadas on-chain con el gas patrocinado por el
// paymaster, en vez de que la wallet lo pague de su bolsillo.
//
// Investigación real del SDK (Tarea 6, Step 1):
//   - paquete: <COMPLETAR>
//   - función de wrap: <COMPLETAR>
//   - método de envío: <COMPLETAR>
//   - devuelve receipt con logs: <COMPLETAR sí/no>
import { obtenerWalletOperador, obtenerRedActiva } from './provider.js';

const CHAIN_ID = { fuji: 43113, avalanche: 43114 };

const cuentas = {};

async function obtenerSmartAccount() {
  const red = obtenerRedActiva();
  if (cuentas[red]) return cuentas[red];

  const sufijo = red.toUpperCase();
  const apiKey = process.env[`POLFIN_0XGASLESS_API_KEY_${sufijo}`];
  if (!apiKey) {
    throw new Error(`falta POLFIN_0XGASLESS_API_KEY_${sufijo} en POLFIN_CHAIN_MODE=${red}`);
  }

  // AJUSTAR: import y forma del config según el Step 1.
  const { createSmartAccountClient } = await import('@0xgasless/smart-account');
  const cuenta = await createSmartAccountClient({
    signer: obtenerWalletOperador(),
    chainId: CHAIN_ID[red],
    apiKey,
  });
  cuentas[red] = cuenta;
  return cuenta;
}

// Manda `data` (calldata ya codificado) a `to`, patrocinado por el paymaster
// de la red activa. Devuelve el hash y, si está disponible, el receipt
// completo (lo necesita mintearInstrumentoOnChain para leer el evento).
export async function enviarSponsored({ to, data, value = 0n }) {
  const cuenta = await obtenerSmartAccount();
  // AJUSTAR: nombre del método de envío según el Step 1.
  const resultado = await cuenta.sendTransaction({ to, data, value });
  const tx_hash = resultado.transactionHash ?? resultado.hash ?? resultado;
  let receipt = resultado.receipt ?? null;
  if (!receipt) {
    // Si el SDK no devuelve el receipt completo, lo pedimos nosotros por hash.
    receipt = await obtenerWalletOperador().provider.getTransactionReceipt(tx_hash);
  }
  return { tx_hash, receipt };
}

// Dirección de la Smart Account de la red dada — la usa contracts/scripts/deploy.js
// (vía su propia copia en contracts/scripts/lib/smartAccount.js, Tarea 8) para
// transferirle el ownership de los tres contratos justo después de deployarlos.
export async function obtenerDireccionSmartAccount() {
  const cuenta = await obtenerSmartAccount();
  // AJUSTAR: nombre del método según el Step 1.
  return cuenta.getAddress();
}
```

- [ ] **Step 3: Confirmar manualmente que import y config no explotan al cargar**

```bash
node --input-type=module -e "
process.env.POLFIN_CHAIN_MODE = 'fuji';
const g = await import('./backend/src/chain/gasless.js');
console.log('exports:', Object.keys(g));
"
```
Expected: imprime `exports: [ 'enviarSponsored', 'obtenerDireccionSmartAccount' ]` sin tirar error de import (el error de "falta API key" recién aparece al llamar a las funciones, no al importar el módulo — si explota acá, revisar el nombre del paquete/import del Step 1).

Nota: la verificación de que `enviarSponsored` manda de verdad una transacción patrocinada (no solo que el módulo carga) queda diferida a la Tarea 14 (deploy + smoke test real en Fuji) — no hay forma de probar contra el bundler/paymaster real sin credenciales y sin gastar una llamada real.

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/chain/gasless.js
git commit -m "feat(backend): integrar Smart Account de 0xgasless para gas patrocinado"
```

---

### Task 7: `backend/src/chain/onchain.js` — mandar las 3 llamadas vía `gasless.js`

**Files:**
- Modify: `backend/src/chain/onchain.js`

**Interfaces:**
- Consumes: `enviarSponsored({to, data, value})` (Tarea 6), `obtenerScoreRegistry()`/`obtenerEPagare()`/`obtenerMockUSDC()` (Tarea 5) — usa `.interface.encodeFunctionData(...)` y `.getAddress()` de estos, ya no llama a los métodos del contrato directo.
- Produces: `escribirScoreOnChain(entidadId, score): Promise<{tx_hash}>`, `mintearInstrumentoOnChain({...}): Promise<{contrato_address, tx_hash, token_id}>`, `liquidarPagoStablecoinOnChain({monto, destino}): Promise<{tx_hash}>` — misma firma que hoy, las consume `tools.js` (Tarea 9) sin cambios en el call site.

- [ ] **Step 1: Reescribir el archivo completo**

```js
// backend/src/chain/onchain.js
import { ethers } from 'ethers';
import { obtenerScoreRegistry, obtenerEPagare, obtenerMockUSDC } from './contracts.js';
import { enviarSponsored } from './gasless.js';

export async function escribirScoreOnChain(entidadId, score) {
  const registry = obtenerScoreRegistry();
  const data = registry.interface.encodeFunctionData('registrarScore', [entidadId, score]);
  const { tx_hash } = await enviarSponsored({ to: await registry.getAddress(), data });
  return { tx_hash };
}

export async function mintearInstrumentoOnChain({ deudorId, acreedorId, monto, tasaTna, plazoDias, fechaVencimiento }) {
  const ePagare = obtenerEPagare();
  const tasaTnaBps = Math.round(tasaTna * 100);
  const fechaVencimientoUnix = Math.floor(new Date(`${fechaVencimiento}T00:00:00Z`).getTime() / 1000);
  const data = ePagare.interface.encodeFunctionData('generarInstrumento', [
    deudorId, acreedorId, monto, tasaTnaBps, plazoDias, fechaVencimientoUnix,
  ]);
  const direccion = await ePagare.getAddress();
  const { tx_hash, receipt } = await enviarSponsored({ to: direccion, data });
  const evento = (receipt?.logs ?? [])
    .map((log) => {
      try { return ePagare.interface.parseLog(log); } catch { return null; }
    })
    .find((e) => e?.name === 'InstrumentoGenerado');
  return {
    contrato_address: direccion,
    tx_hash,
    token_id: evento ? Number(evento.args.tokenId) : null,
  };
}

export async function liquidarPagoStablecoinOnChain({ monto, destino }) {
  const usdc = obtenerMockUSDC();
  const unidades = ethers.parseUnits(String(monto), 6);
  const data = usdc.interface.encodeFunctionData('mint', [destino, unidades]);
  const { tx_hash } = await enviarSponsored({ to: await usdc.getAddress(), data });
  return { tx_hash };
}
```

- [ ] **Step 2: Smoke check — el módulo importa sin errores**

```bash
node --input-type=module -e "
const o = await import('./backend/src/chain/onchain.js');
console.log('exports:', Object.keys(o));
"
```
Expected: `exports: [ 'escribirScoreOnChain', 'liquidarPagoStablecoinOnChain', 'mintearInstrumentoOnChain' ]`.

(La verificación end-to-end real —que de verdad mintea y lee el evento— queda para la Tarea 14, igual que en la Tarea 6.)

- [ ] **Step 3: Commit**

```bash
git add backend/src/chain/onchain.js
git commit -m "refactor(backend): las 3 llamadas on-chain van patrocinadas vía gasless.js"
```

---

### Task 8: `contracts/scripts/deploy.js` — transferir ownership a la Smart Account

**Files:**
- Modify: `contracts/package.json` (nueva dependencia)
- Create: `contracts/scripts/lib/smartAccount.js`
- Modify: `contracts/scripts/deploy.js`

**Interfaces:**
- Consumes: mismo paquete de 0xgasless confirmado en la Tarea 6, Step 1 (acá instalado en `contracts/`, paquete npm distinto pero mismo nombre — `contracts/` y `backend/` son paquetes separados sin workspaces, así que la dependencia se declara en los dos `package.json`).
- Produces: `obtenerDireccionSmartAccount({signer, chainId, apiKey}): Promise<string>` — lo consume `deploy.js` en este mismo task.

- [ ] **Step 1: Instalar el mismo paquete de 0xgasless en `contracts/`**

```bash
npm --prefix contracts install <mismo-paquete-confirmado-en-tarea-6>
```

- [ ] **Step 2: Crear `contracts/scripts/lib/smartAccount.js`**

```js
// contracts/scripts/lib/smartAccount.js
//
// Calcula la dirección de la Smart Account de 0xgasless para el operador que
// está deployando, para poder transferirle el ownership de los tres
// contratos justo después del deploy. Misma salvedad que
// backend/src/chain/gasless.js (Tarea 6): AJUSTAR nombres de import/método
// contra lo que confirmaste ahí — es el mismo paquete, mismo SDK.
async function obtenerDireccionSmartAccount({ signer, chainId, apiKey }) {
  const { createSmartAccountClient } = await import('<mismo-paquete-confirmado-en-tarea-6>');
  const cuenta = await createSmartAccountClient({ signer, chainId, apiKey });
  return cuenta.getAddress();
}

module.exports = { obtenerDireccionSmartAccount };
```

- [ ] **Step 3: Modificar `contracts/scripts/deploy.js`**

Agregar el import al principio (después de los `require` existentes):
```js
const { obtenerDireccionSmartAccount } = require('./lib/smartAccount');
```

Reemplazar el bloque que arma `direcciones` (el que quedó de la Tarea 4) por:

```js
  const CHAIN_ID = { fuji: 43113, avalanche: 43114 };
  const sufijo = hre.network.name.toUpperCase();
  const apiKey = process.env[`POLFIN_0XGASLESS_API_KEY_${sufijo}`];
  let smartAccountAddress = null;
  if (apiKey && CHAIN_ID[hre.network.name]) {
    smartAccountAddress = await obtenerDireccionSmartAccount({
      signer: operador, chainId: CHAIN_ID[hre.network.name], apiKey,
    });
    console.log('Transfiriendo ownership a la Smart Account:', smartAccountAddress);
    await (await scoreRegistry.transferOwnership(smartAccountAddress)).wait();
    await (await ePagare.transferOwnership(smartAccountAddress)).wait();
    await (await mockUsdc.transferOwnership(smartAccountAddress)).wait();
  } else {
    console.log(`\nOJO: no se transfirió el ownership a ninguna Smart Account (falta POLFIN_0XGASLESS_API_KEY_${sufijo} o la red no es fuji/avalanche). Los contratos quedan owned por la EOA operadora.`);
  }

  const direcciones = {
    network: hre.network.name,
    operador: operador.address,
    smartAccount: smartAccountAddress,
    scoreRegistry: await scoreRegistry.getAddress(),
    ePagare: await ePagare.getAddress(),
    mockUsdc: await mockUsdc.getAddress(),
    deployedAt: new Date().toISOString(),
  };
```

- [ ] **Step 4: Smoke test contra la red local de Hardhat (sin API key — debe saltear la transferencia)**

Run: `npx hardhat run scripts/deploy.js --network hardhat` (desde `contracts/`)
Expected: imprime el mensaje "OJO: no se transfirió..." (no hay `POLFIN_0XGASLESS_API_KEY_HARDHAT`), y `contracts/deployments/hardhat.json` tiene `"smartAccount": null`.

- [ ] **Step 5: Commit**

```bash
git add contracts/package.json contracts/package-lock.json contracts/scripts/lib/smartAccount.js contracts/scripts/deploy.js
git commit -m "feat(contracts): transferir ownership a la Smart Account de 0xgasless al deployar"
```

---

### Task 9: `backend/src/agente/tools.js` — red `mock` + campos de explorer en los 3 returns

**Files:**
- Modify: `backend/src/agente/tools.js`

**Interfaces:**
- Consumes: `esRedReal`, `redLabel`, `explorerUrl` de `redes.js` (Tarea 2).
- Produces: los returns de `generarInstrumento`, `registrarScoreOnChain`, `ejecutarPagoStablecoin` ganan los campos `red_label: string`, `explorer_url: string|null`, y (solo `generarInstrumento`) `tx_explorer_url: string|null`, `nft_explorer_url: string|null` — los consume `server.js` (Tarea 10, indirectamente vía el pipeline) y el frontend (Tarea 12).

- [ ] **Step 1: Agregar el import y el helper de red**

En `backend/src/agente/tools.js`, después de la línea `import { escribirScoreOnChain, mintearInstrumentoOnChain, liquidarPagoStablecoinOnChain } from '../chain/onchain.js';` (línea 15), agregar:

```js
import { esRedReal, redLabel, explorerUrl } from '../chain/redes.js';
```

Reemplazar la línea 17:
```js
const modoChain = () => (process.env.POLFIN_CHAIN_MODE || 'mock').toLowerCase();
```
por:
```js
const modoChain = () => (process.env.POLFIN_CHAIN_MODE || 'mock').toLowerCase();
const redActual = () => {
  const modo = modoChain();
  return esRedReal(modo) ? modo : 'mock';
};
```

- [ ] **Step 2: Reescribir el caso `generarInstrumento`**

Reemplazar el bloque completo del `case 'generarInstrumento':` (líneas 196-237) por:

```js
    case 'generarInstrumento': {
      // POLFIN_CHAIN_MODE=fuji|avalanche: mintea un NFT real (patrocinado) en
      // el contrato EPagare de esa red. POLFIN_CHAIN_MODE=mock (default):
      // mismo comportamiento simulado que siempre.
      const venc = new Date(Date.now() + input.plazoDias * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      const red = redActual();
      let contrato, tx, tokenId = null;
      if (red !== 'mock') {
        const resultadoChain = await mintearInstrumentoOnChain({
          deudorId: input.deudorId, acreedorId: input.acreedorId, monto: input.monto,
          tasaTna: input.tasaTna, plazoDias: input.plazoDias, fechaVencimiento: venc,
        });
        contrato = resultadoChain.contrato_address;
        tx = resultadoChain.tx_hash;
        tokenId = resultadoChain.token_id;
      } else {
        contrato = mockAddress();
        tx = mockHash();
      }
      const r = db.prepare(`
        INSERT INTO instrumentos
          (solicitud_id, deudor_id, acreedor_id, monto, tasa_tna, plazo_dias,
           fecha_vencimiento, contrato_address, tx_hash, red, token_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(ctx.solicitudId ?? null, input.deudorId, input.acreedorId, input.monto,
        input.tasaTna, input.plazoDias, venc, contrato, tx, red, tokenId);
      return {
        instrumento_id: Number(r.lastInsertRowid),
        tipo: 'e-pagare',
        monto: input.monto,
        tasa_tna: input.tasaTna,
        plazo_dias: input.plazoDias,
        fecha_vencimiento: venc,
        contrato_address: contrato,
        tx_hash: tx,
        token_id: tokenId,
        red,
        red_label: redLabel(red),
        explorer_url: explorerUrl(red, 'address', contrato),
        tx_explorer_url: explorerUrl(red, 'tx', tx),
        nft_explorer_url: tokenId != null ? explorerUrl(red, 'nft', `${contrato}/${tokenId}`) : null,
        nota: red !== 'mock'
          ? `NFT del e-pagaré minteado en ${redLabel(red)}`
          : 'MOCK: seteá POLFIN_CHAIN_MODE=fuji o avalanche con los contratos deployados para el mint real',
      };
    }
```

- [ ] **Step 3: Reescribir el caso `registrarScoreOnChain`**

Reemplazar el bloque completo del `case 'registrarScoreOnChain':` (líneas 239-254) por:

```js
    case 'registrarScoreOnChain': {
      const red = redActual();
      const tx = red !== 'mock'
        ? (await escribirScoreOnChain(input.entidadId, input.score)).tx_hash
        : mockHash();
      db.prepare(`
        INSERT INTO scores_onchain (entidad_id, score, tx_hash, red)
        VALUES (?, ?, ?, ?)
      `).run(input.entidadId, input.score, tx, red);
      return {
        entidad_id: input.entidadId, score: input.score, tx_hash: tx, red,
        red_label: redLabel(red),
        explorer_url: explorerUrl(red, 'tx', tx),
        nota: red !== 'mock'
          ? `Score escrito en el ScoreRegistry real de ${redLabel(red)}`
          : 'MOCK: seteá POLFIN_CHAIN_MODE=fuji o avalanche con los contratos deployados para la escritura real',
      };
    }
```

- [ ] **Step 4: Reescribir el caso `ejecutarPagoStablecoin`**

Reemplazar el bloque completo del `case 'ejecutarPagoStablecoin':` (líneas 256-270) por:

```js
    case 'ejecutarPagoStablecoin': {
      // Esta tool SIEMPRE requiere aprobación humana (ver policy.js), así que
      // en el flujo normal llega acá solo después de un OK explícito del dueño.
      const red = redActual();
      const tx = red !== 'mock'
        ? (await liquidarPagoStablecoinOnChain({ monto: input.monto, destino: input.destino })).tx_hash
        : mockHash();
      return {
        monto_usdc: input.monto, destino: input.destino,
        tx_hash: tx, red,
        red_label: redLabel(red),
        explorer_url: explorerUrl(red, 'tx', tx),
        nota: red !== 'mock'
          ? `USDC de prueba (pfUSDC) minteado y liquidado en ${redLabel(red)}`
          : 'MOCK: seteá POLFIN_CHAIN_MODE=fuji o avalanche con los contratos deployados para la liquidación real',
      };
    }
```

- [ ] **Step 5: Smoke check en modo mock (sin ninguna credencial)**

```bash
node --input-type=module -e "
process.env.POLFIN_CHAIN_MODE = 'mock';
const { DatabaseSync } = await import('node:sqlite');
const { ejecutarTool } = await import('./backend/src/agente/tools.js');
// DB descartable en memoria solo para probar el shape del return, no hace
// falta el schema completo: generarInstrumento hace un INSERT real.
"
```

*(Nota para quien implemente: si armar una DB descartable en memoria acá resulta más fricción que valor, alcanza con levantar el backend en modo mock (`npm run dev:api` con `POLFIN_CHAIN_MODE=mock` o sin setear la variable) y pegarle a `POST /api/agente/evaluar-credito` con un crédito de prueba contra la DB seedeada — confirmar en la respuesta que `instrumento.red === 'mock'`, `instrumento.red_label` y `instrumento.explorer_url === null` están presentes.)*

- [ ] **Step 6: Commit**

```bash
git add backend/src/agente/tools.js
git commit -m "feat(agente): red 'mock' (antes 'fuji-mock') + explorer_url en las 3 tools on-chain"
```

---

### Task 10: `backend/src/server.js` — usar el helper de redes en los 3 endpoints

**Files:**
- Modify: `backend/src/server.js:404-447` (`GET /api/onchain/score/:id`)
- Modify: `backend/src/server.js:489-519` (`GET /api/instrumentos`, `GET /api/instrumentos/:id`)

**Interfaces:**
- Consumes: `esRedReal`, `redLabel`, `explorerUrl` de `redes.js` (Tarea 2).
- Produces: `/api/onchain/score/:id` gana `red_label`; `/api/instrumentos` y `/api/instrumentos/:id` ganan `red_label`, `explorer_url`, `tx_explorer_url`, `nft_explorer_url` en cada fila — los consume el frontend (Tarea 12).

- [ ] **Step 1: Agregar el import**

Cerca de los otros imports al principio de `server.js` (buscar el import de `ejecutarTool` o `calcularScore` para ubicar el bloque de imports), agregar:

```js
import { esRedReal, redLabel, explorerUrl } from './chain/redes.js';
```

- [ ] **Step 2: Actualizar `GET /api/onchain/score/:id`**

Reemplazar las líneas 427-443:

```js
    const chainMode = (process.env.POLFIN_CHAIN_MODE || 'mock').toLowerCase();
    const esFuji = rec?.red === 'fuji';
    const contrato = esFuji ? (process.env.POLFIN_SCORE_REGISTRY_ADDRESS || null) : null;
    res.json({
      entidad: { id: ent.id, nombre: ent.nombre, tipo: ent.tipo, rol_cadena: ent.rol_cadena, rubro: ent.rubro, ciudad: ent.ciudad },
      registrado: !!rec,
      chain_mode: chainMode,
      red: rec?.red ?? (chainMode === 'fuji' ? 'fuji' : 'fuji-mock'),
      es_real: esFuji,
      score: rec?.score ?? null,
      tx_hash: rec?.tx_hash ?? null,
      contrato_address: contrato,
      timestamp: rec?.created_at ?? null,
      // En fuji, el QR/enlace va al explorador real; en mock, el frontend arma
      // la URL a su propia vista /verificar/:id (registro honesto, no inventado).
      explorer_url: esFuji && rec?.tx_hash ? `https://testnet.snowtrace.io/tx/${rec.tx_hash}` : null,
    });
```

por:

```js
    const chainMode = (process.env.POLFIN_CHAIN_MODE || 'mock').toLowerCase();
    const red = rec?.red ?? (esRedReal(chainMode) ? chainMode : 'mock');
    const real = esRedReal(red);
    res.json({
      entidad: { id: ent.id, nombre: ent.nombre, tipo: ent.tipo, rol_cadena: ent.rol_cadena, rubro: ent.rubro, ciudad: ent.ciudad },
      registrado: !!rec,
      chain_mode: chainMode,
      red,
      red_label: redLabel(red),
      es_real: real,
      score: rec?.score ?? null,
      tx_hash: rec?.tx_hash ?? null,
      contrato_address: null, // ScoreRegistry no tiene una address propia por entidad — se linkea por tx.
      timestamp: rec?.created_at ?? null,
      // En modo real, el QR/enlace va al explorador; en mock, el frontend arma
      // la URL a su propia vista /verificar/:id (registro honesto, no inventado).
      explorer_url: explorerUrl(red, 'tx', rec?.tx_hash),
    });
```

(Nota: `contrato_address` en esta respuesta ya era siempre `null` salvo cuando venía de `process.env.POLFIN_SCORE_REGISTRY_ADDRESS`, que dejó de existir en la Tarea 5 — la vista de perfil/verificar no lo usa para nada crítico, solo lo muestra si está presente.)

- [ ] **Step 3: Agregar el helper de fila a `GET /api/instrumentos` y `GET /api/instrumentos/:id`**

Reemplazar las líneas 489-519:

```js
app.get('/api/instrumentos', (req, res) => {
  const { deudor, acreedor, entidad, pendientes } = req.query;
  let sql = `
    SELECT i.*, d.nombre AS deudor_nombre, d.tipo AS deudor_tipo,
           a.nombre AS acreedor_nombre, a.rubro AS acreedor_rubro
    FROM instrumentos i
    JOIN entidades d ON d.id = i.deudor_id
    JOIN entidades a ON a.id = i.acreedor_id
    WHERE 1=1`;
  const params = [];
  if (deudor) { sql += ' AND i.deudor_id = ?'; params.push(deudor); }
  if (acreedor) { sql += ' AND i.acreedor_id = ?'; params.push(acreedor); }
  if (entidad) { sql += ' AND (i.deudor_id = ? OR i.acreedor_id = ?)'; params.push(entidad, entidad); }
  if (pendientes) { sql += ' AND i.aceptado = 0'; }
  sql += ' ORDER BY i.aceptado ASC, i.id DESC';
  res.json(db.prepare(sql).all(...params));
});

// Un instrumento con todo lo necesario para renderizar el documento legible.
app.get('/api/instrumentos/:id', (req, res) => {
  const i = db.prepare(`
    SELECT i.*, d.nombre AS deudor_nombre, d.tipo AS deudor_tipo, d.ciudad AS deudor_ciudad,
           a.nombre AS acreedor_nombre, a.rubro AS acreedor_rubro, a.ciudad AS acreedor_ciudad
    FROM instrumentos i
    JOIN entidades d ON d.id = i.deudor_id
    JOIN entidades a ON a.id = i.acreedor_id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!i) return res.status(404).json({ error: 'instrumento inexistente' });
  res.json(i);
});
```

por:

```js
// Agrega los campos de explorador (red_label/explorer_url/...) calculados a
// partir de la fila de `instrumentos` — misma lógica que usa tools.js al
// generar el instrumento, para que ambos caminos (el eco inmediato del
// pipeline y esta consulta posterior) muestren exactamente lo mismo.
function conExplorer(i) {
  return {
    ...i,
    red_label: redLabel(i.red),
    explorer_url: explorerUrl(i.red, 'address', i.contrato_address),
    tx_explorer_url: explorerUrl(i.red, 'tx', i.tx_hash),
    nft_explorer_url: i.token_id != null ? explorerUrl(i.red, 'nft', `${i.contrato_address}/${i.token_id}`) : null,
  };
}

app.get('/api/instrumentos', (req, res) => {
  const { deudor, acreedor, entidad, pendientes } = req.query;
  let sql = `
    SELECT i.*, d.nombre AS deudor_nombre, d.tipo AS deudor_tipo,
           a.nombre AS acreedor_nombre, a.rubro AS acreedor_rubro
    FROM instrumentos i
    JOIN entidades d ON d.id = i.deudor_id
    JOIN entidades a ON a.id = i.acreedor_id
    WHERE 1=1`;
  const params = [];
  if (deudor) { sql += ' AND i.deudor_id = ?'; params.push(deudor); }
  if (acreedor) { sql += ' AND i.acreedor_id = ?'; params.push(acreedor); }
  if (entidad) { sql += ' AND (i.deudor_id = ? OR i.acreedor_id = ?)'; params.push(entidad, entidad); }
  if (pendientes) { sql += ' AND i.aceptado = 0'; }
  sql += ' ORDER BY i.aceptado ASC, i.id DESC';
  res.json(db.prepare(sql).all(...params).map(conExplorer));
});

// Un instrumento con todo lo necesario para renderizar el documento legible.
app.get('/api/instrumentos/:id', (req, res) => {
  const i = db.prepare(`
    SELECT i.*, d.nombre AS deudor_nombre, d.tipo AS deudor_tipo, d.ciudad AS deudor_ciudad,
           a.nombre AS acreedor_nombre, a.rubro AS acreedor_rubro, a.ciudad AS acreedor_ciudad
    FROM instrumentos i
    JOIN entidades d ON d.id = i.deudor_id
    JOIN entidades a ON a.id = i.acreedor_id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!i) return res.status(404).json({ error: 'instrumento inexistente' });
  res.json(conExplorer(i));
});
```

- [ ] **Step 4: Verificación manual con el server corriendo en modo mock**

```bash
npm run seed
npm run dev:api
```
En otra terminal:
```bash
curl -s http://localhost:4000/api/instrumentos | head -c 400
```
Expected: cada objeto trae `"red":"mock"` (después de reseedear — el seed también genera instrumentos, revisar que no haya quedado ningún `'fuji-mock'` viejo en el dataset sembrado; si `seed.js` inserta filas de `instrumentos` a mano con `'fuji-mock'` hardcodeado, ajustarlo a `'mock'` ahí también como parte de este step), `"red_label":"Avalanche (modo demo)"`, `"explorer_url":null`. Frenar el server (`Ctrl+C`) al terminar.

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.js
git commit -m "feat(backend): explorer_url/red_label en los endpoints de instrumentos y onchain/score"
```

---

### Task 11: `frontend/lib/api.ts` — actualizar tipos

**Files:**
- Modify: `frontend/lib/api.ts:62-70` (`Instrumento`)
- Modify: `frontend/lib/api.ts:133-144` (`OnchainScore`)

**Interfaces:**
- Produces: `Instrumento` con `red_label`, `explorer_url`, `tx_explorer_url`, `nft_explorer_url`; `OnchainScore` con `red_label` y `chain_mode`/`red` admitiendo `"avalanche"`. Los consumen los componentes de la Tarea 12.

- [ ] **Step 1: Actualizar el tipo `Instrumento`**

Reemplazar las líneas 62-70:

```ts
export type Instrumento = {
  id: number; deudor_id: number; acreedor_id: number; monto: number;
  tasa_tna: number; plazo_dias: number; fecha_vencimiento: string;
  estado: "activo" | "pagado" | "vencido";
  contrato_address: string; tx_hash: string; red: string; token_id: number | null;
  aceptado: number; aceptado_at: string | null; created_at: string;
  deudor_nombre: string; deudor_tipo?: string; deudor_ciudad?: string;
  acreedor_nombre: string; acreedor_rubro?: string; acreedor_ciudad?: string;
};
```

por:

```ts
export type Instrumento = {
  id: number; deudor_id: number; acreedor_id: number; monto: number;
  tasa_tna: number; plazo_dias: number; fecha_vencimiento: string;
  estado: "activo" | "pagado" | "vencido";
  contrato_address: string; tx_hash: string; red: string; token_id: number | null;
  red_label?: string;                    // "Avalanche Fuji (testnet)" | "Avalanche C-Chain" | "Avalanche (modo demo)"
  explorer_url?: string | null;          // Snowtrace del contrato, o null en modo demo
  tx_explorer_url?: string | null;       // Snowtrace de la tx, o null en modo demo
  nft_explorer_url?: string | null;      // Snowtrace del NFT, o null si no hay token_id
  aceptado: number; aceptado_at: string | null; created_at: string;
  deudor_nombre: string; deudor_tipo?: string; deudor_ciudad?: string;
  acreedor_nombre: string; acreedor_rubro?: string; acreedor_ciudad?: string;
};
```

- [ ] **Step 2: Actualizar el tipo `OnchainScore`**

Reemplazar las líneas 133-144:

```ts
export type OnchainScore = {
  entidad: { id: number; nombre: string; tipo: string; rol_cadena: string | null; rubro: string | null; ciudad: string };
  registrado: boolean;
  chain_mode: "mock" | "fuji" | string;
  red: string;                 // "fuji" | "fuji-mock"
  es_real: boolean;            // true si está escrito en Fuji real
  score: number | null;
  tx_hash: string | null;
  contrato_address: string | null;
  timestamp: string | null;
  explorer_url: string | null; // Snowtrace (fuji) o null (mock)
};
```

por:

```ts
export type OnchainScore = {
  entidad: { id: number; nombre: string; tipo: string; rol_cadena: string | null; rubro: string | null; ciudad: string };
  registrado: boolean;
  chain_mode: "mock" | "fuji" | "avalanche" | string;
  red: string;                 // "fuji" | "avalanche" | "mock"
  red_label: string;           // "Avalanche Fuji (testnet)" | "Avalanche C-Chain" | "Avalanche (modo demo)"
  es_real: boolean;            // true si está escrito en la cadena real (fuji o avalanche)
  score: number | null;
  tx_hash: string | null;
  contrato_address: string | null;
  timestamp: string | null;
  explorer_url: string | null; // Snowtrace (fuji o avalanche) o null (mock)
};
```

- [ ] **Step 3: Verificar que compila**

Run: `npm --prefix frontend run build` (o `npx tsc --noEmit` dentro de `frontend/` si preferís algo más rápido que el build completo)
Expected: falla en este punto — los componentes de la Tarea 12 todavía usan `data.es_real ? "Fuji (testnet)" : ...` y `red === "fuji"`, que siguen siendo válidos con estos tipos (no rompen), así que en realidad debería compilar igual. Si el build falla, revisar el mensaje de error antes de seguir — no debería haber ningún error de tipos en este punto porque solo agregamos campos opcionales.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(frontend): tipos para red_label/explorer_url y modo avalanche"
```

---

### Task 12: Frontend — componentes consumen los campos del backend

**Files:**
- Modify: `frontend/components/perfil.tsx:114`, `:138-140`, `:173`
- Modify: `frontend/app/verificar/[id]/page.tsx:51`, `:72`
- Modify: `frontend/components/documento.tsx:129`, `:133`, `:136`, `:193`, `:196-218`
- Modify: `frontend/components/aprobaciones.tsx:13`, `:122-128`

**Interfaces:**
- Consumes: `Instrumento.red_label/explorer_url/tx_explorer_url/nft_explorer_url` y `OnchainScore.red_label` (Tarea 11).

- [ ] **Step 1: `perfil.tsx` — reemplazar los 3 usos de `es_real`/red hardcodeada**

Línea 114, reemplazar:
```tsx
            <Pill tono="brand">Avalanche{chain?.es_real ? " Fuji" : ""}</Pill>
```
por:
```tsx
            <Pill tono="brand">{chain?.red_label ?? "Avalanche"}</Pill>
```

Líneas 138-140, reemplazar:
```tsx
            <div className="flex justify-between gap-3">
              <span className="text-tenue">Red</span>
              <span className="num text-tinta">Avalanche {chain?.es_real ? "Fuji (testnet)" : "Fuji (testnet · mock)"}</span>
            </div>
```
por:
```tsx
            <div className="flex justify-between gap-3">
              <span className="text-tenue">Red</span>
              <span className="num text-tinta">{chain?.red_label ?? "Avalanche (modo demo)"}</span>
            </div>
```

Línea 173, reemplazar:
```tsx
            {!chain?.es_real && <span className="block mt-1 text-tenue/70">(Modo demo: registro simulado. Con POLFIN_CHAIN_MODE=fuji el QR lleva a la transacción real en Snowtrace.)</span>}
```
por:
```tsx
            {!chain?.es_real && <span className="block mt-1 text-tenue/70">(Modo demo: registro simulado. Con POLFIN_CHAIN_MODE=fuji o avalanche el QR lleva a la transacción real en Snowtrace.)</span>}
```

- [ ] **Step 2: `verificar/[id]/page.tsx`**

Línea 51, reemplazar:
```tsx
                <Fila k="Red" v={`Avalanche ${data.es_real ? "Fuji (testnet)" : "Fuji (testnet · mock)"}`} />
```
por:
```tsx
                <Fila k="Red" v={data.red_label ?? "Avalanche (modo demo)"} />
```

Línea 72, reemplazar:
```tsx
                    Modo demostración: el registro es simulado pero íntegro. Con la cadena real
                    (Fuji) activada, este código lleva a la transacción verificable en Snowtrace.
```
por:
```tsx
                    Modo demostración: el registro es simulado pero íntegro. Con la cadena real
                    (Fuji o mainnet) activada, este código lleva a la transacción verificable en Snowtrace.
```

- [ ] **Step 3: `documento.tsx` — versión PDF (función `descargarPdf`)**

Línea 129, reemplazar:
```js
  const alturaChain = i.red === "fuji" && i.token_id != null ? 30 : 24;
```
por:
```js
  const alturaChain = i.token_id != null ? 30 : 24;
```

Línea 133, reemplazar:
```js
  linea(`Red: Avalanche ${i.red === "fuji-mock" ? "Fuji (testnet · mock)" : i.red}`, { size: 9, gap: 5 });
```
por:
```js
  linea(`Red: ${i.red_label ?? "Avalanche (modo demo)"}`, { size: 9, gap: 5 });
```

Línea 136, reemplazar:
```js
  if (i.red === "fuji" && i.token_id != null) linea(`NFT: token #${i.token_id}`, { size: 9, gap: 5 });
```
por:
```js
  if (i.token_id != null) linea(`NFT: token #${i.token_id}`, { size: 9, gap: 5 });
```

- [ ] **Step 4: `documento.tsx` — versión JSX (componente `EPagare`)**

Reemplazar las líneas 193-218:

```tsx
            <div className="flex justify-between gap-3"><span className="text-tenue">Red</span><span className="num text-tinta">Avalanche {i.red === "fuji-mock" ? "Fuji (testnet · mock)" : i.red}</span></div>
            <div className="flex justify-between gap-3">
              <span className="shrink-0 text-tenue">Contrato</span>
              {i.red === "fuji" ? (
                <a href={`https://testnet.snowtrace.io/address/${i.contrato_address}`} target="_blank" rel="noopener noreferrer"
                  className="num truncate text-brand hover:underline">{i.contrato_address}</a>
              ) : (
                <span className="num truncate text-tinta">{i.contrato_address}</span>
              )}
            </div>
            <div className="flex justify-between gap-3">
              <span className="shrink-0 text-tenue">Tx hash</span>
              {i.red === "fuji" ? (
                <a href={`https://testnet.snowtrace.io/tx/${i.tx_hash}`} target="_blank" rel="noopener noreferrer"
                  className="num truncate text-brand hover:underline">{i.tx_hash}</a>
              ) : (
                <span className="num truncate text-tinta">{i.tx_hash}</span>
              )}
            </div>
            {i.red === "fuji" && i.token_id != null && (
              <div className="flex justify-between gap-3">
                <span className="shrink-0 text-tenue">NFT</span>
                <a href={`https://testnet.snowtrace.io/nft/${i.contrato_address}/${i.token_id}`} target="_blank" rel="noopener noreferrer"
                  className="num truncate text-brand hover:underline">token #{i.token_id}</a>
              </div>
            )}
```

por:

```tsx
            <div className="flex justify-between gap-3"><span className="text-tenue">Red</span><span className="num text-tinta">{i.red_label ?? "Avalanche (modo demo)"}</span></div>
            <div className="flex justify-between gap-3">
              <span className="shrink-0 text-tenue">Contrato</span>
              {i.explorer_url ? (
                <a href={i.explorer_url} target="_blank" rel="noopener noreferrer"
                  className="num truncate text-brand hover:underline">{i.contrato_address}</a>
              ) : (
                <span className="num truncate text-tinta">{i.contrato_address}</span>
              )}
            </div>
            <div className="flex justify-between gap-3">
              <span className="shrink-0 text-tenue">Tx hash</span>
              {i.tx_explorer_url ? (
                <a href={i.tx_explorer_url} target="_blank" rel="noopener noreferrer"
                  className="num truncate text-brand hover:underline">{i.tx_hash}</a>
              ) : (
                <span className="num truncate text-tinta">{i.tx_hash}</span>
              )}
            </div>
            {i.nft_explorer_url && i.token_id != null && (
              <div className="flex justify-between gap-3">
                <span className="shrink-0 text-tenue">NFT</span>
                <a href={i.nft_explorer_url} target="_blank" rel="noopener noreferrer"
                  className="num truncate text-brand hover:underline">token #{i.token_id}</a>
              </div>
            )}
```

- [ ] **Step 5: `aprobaciones.tsx`**

Línea 13, reemplazar:
```tsx
type Resuelta = { estado: string; instrumento?: { instrumento_id: number; contrato_address: string; fecha_vencimiento: string; tx_hash: string; red: string } };
```
por:
```tsx
type Resuelta = { estado: string; instrumento?: { instrumento_id: number; contrato_address: string; fecha_vencimiento: string; tx_hash: string; red: string; red_label?: string; explorer_url?: string | null } };
```

Líneas 122-128, reemplazar:
```tsx
                        {resuelta.instrumento.red === "fuji" ? (
                          <a href={`https://testnet.snowtrace.io/address/${resuelta.instrumento.contrato_address}`} target="_blank" rel="noopener noreferrer"
                            className="num text-brand hover:underline">{resuelta.instrumento.contrato_address.slice(0, 14)}…</a>
                        ) : (
                          <span className="num">{resuelta.instrumento.contrato_address.slice(0, 14)}…</span>
                        )})</>
```
por:
```tsx
                        {resuelta.instrumento.explorer_url ? (
                          <a href={resuelta.instrumento.explorer_url} target="_blank" rel="noopener noreferrer"
                            className="num text-brand hover:underline">{resuelta.instrumento.contrato_address.slice(0, 14)}…</a>
                        ) : (
                          <span className="num">{resuelta.instrumento.contrato_address.slice(0, 14)}…</span>
                        )})</>
```

- [ ] **Step 6: Build de verificación**

Run: `npm --prefix frontend run build`
Expected: build exitoso, sin errores de TypeScript ni de lint.

- [ ] **Step 7: Verificación visual manual**

```bash
npm run seed
npm run dev
```
Abrir `http://localhost:3000`, entrar al perfil de cualquier entidad con score (ej. Marcela Benítez) y confirmar:
- La tarjeta "Verificado on-chain" muestra `Avalanche (modo demo)` (estamos en `POLFIN_CHAIN_MODE` sin setear = mock).
- El botón dice "Abrir verificación →" (no "Ver en Snowtrace") y lleva a `/verificar/:id`, que también debe mostrar "Avalanche (modo demo)".
- Abrir un e-pagaré existente (desde Aprobaciones o el perfil de un deudor) y confirmar que el bloque "Registro on-chain" muestra `Avalanche (modo demo)` y el contrato/tx NO son links clickeables (son `<span>`, no `<a>`).
Frenar el server (`Ctrl+C`) al terminar.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/perfil.tsx frontend/app/verificar/[id]/page.tsx frontend/components/documento.tsx frontend/components/aprobaciones.tsx
git commit -m "feat(frontend): consumir red_label/explorer_url del backend en vez de rederivarlos"
```

---

### Task 13: Documentación (`README.md`, `CLAUDE.md`)

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:** ninguna — solo texto.

- [ ] **Step 1: `README.md`**

Buscar la línea:
```
- On-chain (Avalanche Fuji) sigue en stubs marcados `PROMPT 4` en `tools.js`.
```
Reemplazar por:
```
- On-chain real en Avalanche Fuji (testnet) y C-Chain (mainnet), con el gas
  de las 3 tools on-chain patrocinado por 0xgasless (`POLFIN_CHAIN_MODE=fuji`
  o `avalanche`) — ver `contracts/README` para el flujo de deploy.
```

- [ ] **Step 2: `CLAUDE.md` — sección "Key env vars"**

Buscar el bloque:
```
`LLM_MODE`, `ANTHROPIC_API_KEY`, `POLFIN_FALLBACKS`,
`POLFIN_LIMITE_AUTONOMO`, `POLFIN_MONITOR_INTERVAL`, `POLFIN_VENC_VENTANA`,
`POLFIN_API_PORT` (backend, default 4000), `NEXT_PUBLIC_API_URL` (frontend →
backend base URL), `POLFIN_CHAIN_MODE` (`mock` default | `fuji`),
`POLFIN_OPERATOR_PRIVATE_KEY`, `POLFIN_FUJI_RPC_URL`,
`POLFIN_SCORE_REGISTRY_ADDRESS`, `POLFIN_EPAGARE_ADDRESS`,
`POLFIN_MOCK_USDC_ADDRESS` (all four only required when
`POLFIN_CHAIN_MODE=fuji` — see `contracts/README` deploy flow).
```
Reemplazar por:
```
`LLM_MODE`, `ANTHROPIC_API_KEY`, `POLFIN_FALLBACKS`,
`POLFIN_LIMITE_AUTONOMO`, `POLFIN_MONITOR_INTERVAL`, `POLFIN_VENC_VENTANA`,
`POLFIN_API_PORT` (backend, default 4000), `NEXT_PUBLIC_API_URL` (frontend →
backend base URL), `POLFIN_CHAIN_MODE` (`mock` default | `fuji` | `avalanche`),
`POLFIN_FUJI_RPC_URL` / `POLFIN_AVALANCHE_RPC_URL`,
`POLFIN_OPERATOR_PRIVATE_KEY_FUJI` / `POLFIN_OPERATOR_PRIVATE_KEY_AVALANCHE`,
`POLFIN_0XGASLESS_API_KEY_FUJI` / `POLFIN_0XGASLESS_API_KEY_AVALANCHE` (gas
patrocinado vía la Smart Account de 0xgasless — ver
`docs/superpowers/specs/2026-08-01-avalanche-gasless-design.md`). Las
direcciones de los 3 contratos ya no van en el `.env`: se leen de
`contracts/deployments/{fuji|avalanche}.json`, generado por
`npm run contracts:deploy:fuji` / `:avalanche`.
```

- [ ] **Step 3: `CLAUDE.md` — sección "The agent", bullet de `tools.js`**

Buscar:
```
- `tools.js` is an Anthropic tool-use-schema registry. The on-chain tools
  (`generarInstrumento`, `registrarScoreOnChain`, `ejecutarPagoStablecoin`)
  are mocked stubs marked `PROMPT 4` — not yet wired to a real chain.
```
Reemplazar por:
```
- `tools.js` is an Anthropic tool-use-schema registry. The on-chain tools
  (`generarInstrumento`, `registrarScoreOnChain`, `ejecutarPagoStablecoin`)
  send real, gas-sponsored transactions (via 0xgasless) against Avalanche
  Fuji or mainnet C-Chain when `POLFIN_CHAIN_MODE` is `fuji`/`avalanche`;
  `mock` (default) keeps the old simulated behavior.
```

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: reflejar el on-chain real (Fuji+mainnet, gas patrocinado por 0xgasless)"
```

---

### Task 14: [Manual] Deploy real + smoke test en Fuji (wallet descartable)

**No es código — es la primera puesta en marcha real, con la red gratuita.**

- [ ] **Step 1:** Crear el segundo proyecto en dashboard.0xgasless.com para Fuji testnet (chainId 43113), copiar su API key a `POLFIN_0XGASLESS_API_KEY_FUJI` en `backend/.env` y `contracts/.env`.
- [ ] **Step 2:** Generar una wallet operadora descartable para Fuji (ej. `node --input-type=module -e "import {Wallet} from 'ethers'; const w = Wallet.createRandom(); console.log('address:', w.address); console.log('private key (guardala vos, no la pego yo en ningún lado):', w.privateKey);"`), fondearla con AVAX de testnet desde el faucet de Avalanche, y poner su private key en `POLFIN_OPERATOR_PRIVATE_KEY_FUJI` en ambos `.env`.
- [ ] **Step 3:** Cargar el gas tank del paymaster del proyecto Fuji en el dashboard de 0xgasless.
- [ ] **Step 4:** `npm run contracts:deploy:fuji` — confirmar que imprime la Smart Account y transfiere el ownership de los 3 contratos (no el mensaje "OJO: no se transfirió...").
- [ ] **Step 5:** Con `POLFIN_CHAIN_MODE=fuji` en `backend/.env`, levantar el backend (`npm run dev:api`) y disparar un crédito de prueba de punta a punta (UI o `POST /api/agente/evaluar-credito`).
- [ ] **Step 6:** Confirmar en `testnet.snowtrace.io` que la transacción de `generarInstrumento` es real, que el NFT se minteó, y — clave — que la wallet operadora **no gastó AVAX propio** (el gas lo pagó el paymaster).
- [ ] **Step 7:** Confirmar en el frontend que el e-pagaré generado muestra "Avalanche Fuji (testnet)" con links reales a Snowtrace.

---

### Task 15: [Manual, gated] Deploy real + smoke test en Avalanche mainnet (wallet real)

**Requiere OK explícito del usuario antes del Step 3 (gasta AVAX real).**

- [ ] **Step 1:** Copiar la API key de mainnet ya creada en el dashboard a `POLFIN_0XGASLESS_API_KEY_AVALANCHE` en ambos `.env`.
- [ ] **Step 2:** Poner la private key de la wallet operadora real (fondeada por el usuario con AVAX real) en `POLFIN_OPERATOR_PRIVATE_KEY_AVALANCHE` en ambos `.env`, y cargar el gas tank del paymaster de ese proyecto en el dashboard.
- [ ] **Step 3 (checkpoint — pedir confirmación antes de correr esto):** `npm run contracts:deploy:avalanche`.
- [ ] **Step 4:** Repetir los Steps 5-7 de la Tarea 14 pero con `POLFIN_CHAIN_MODE=avalanche` y verificando en `snowtrace.io` (sin `testnet.`).

---

## Self-Review

**Cobertura del spec:** las 5 secciones de arquitectura del spec (`contracts/`, backend `chain/`, `tools.js`/`server.js`, frontend, documentación) tienen tarea dedicada (3-4, 5-8, 9-10, 11-12, 13). Los dos flujos de verificación manual obligatorios del spec (Fuji primero, mainnet después con gate) son las Tareas 14-15. Las variables de entorno del spec están todas cubiertas por `.env.example` (ya commiteado) + Tareas 3/5/6/8.

**Placeholders:** las únicas referencias a "AJUSTAR"/nombres a confirmar están confinadas a las Tareas 6 y 8 (SDK de 0xgasless), documentadas explícitamente como spike con pasos de investigación concretos — no son placeholders de "TBD" sin instrucciones, tienen un Step 1 accionable con comandos reales.

**Consistencia de tipos:** `enviarSponsored({to, data, value}): {tx_hash, receipt}` (Tarea 6) es exactamente lo que consume `onchain.js` (Tarea 7). `red_label`/`explorer_url`/`tx_explorer_url`/`nft_explorer_url` se llaman igual en `tools.js` (Tarea 9), `server.js` (Tarea 10), `api.ts` (Tarea 11) y los componentes (Tarea 12) — verificado nombre por nombre al escribir cada tarea.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-01-avalanche-gasless.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
