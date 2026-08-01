# On-chain provider-supplier chain on Avalanche Fuji — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three `PROMPT 4` stub tools in `backend/src/agente/tools.js` (`generarInstrumento`, `registrarScoreOnChain`, `ejecutarPagoStablecoin`) with real transactions against Avalanche Fuji testnet, behind a `POLFIN_CHAIN_MODE` toggle that defaults to today's mock behavior.

**Architecture:** A new `contracts/` Hardhat package holds three Solidity contracts (`ScoreRegistry`, `EPagare` ERC-721, `MockUSDC`), all owned by a single PolFin operator wallet. A new `backend/src/chain/` module wraps `ethers.js` calls to those contracts. `tools.js` branches on `POLFIN_CHAIN_MODE` (`mock` default / `fuji`) and, since real chain calls are async, the whole credit pipeline call chain (`tools.js` → `pipelineCredito.js` → `agente.js`/`agenteProactivo.js` → `server.js` routes) becomes `async`/`await` end to end.

**Tech Stack:** Hardhat + OpenZeppelin Contracts v5 (Solidity), ethers.js v6 (both `contracts/` and `backend/`), existing Node/Express/SQLite backend, existing Next.js frontend.

**Reference spec:** `docs/superpowers/specs/2026-08-01-onchain-fuji-design.md`

## Global Constraints

- Node 22.5+ (already required by this repo for `node:sqlite`).
- Single PolFin operator wallet signs everything — no per-entity wallets. `deudorId`/`acreedorId`/`entidadId` are stored as plain `uint256` data inside contracts, never as addresses.
- Own mock ERC20 (`MockUSDC`, 6 decimals) — never a third-party testnet USDC.
- e-Pagaré is an ERC-721 NFT (`EPagare.sol`), always minted to the operator wallet.
- Hardhat toolchain (not Foundry) for the new `contracts/` package.
- `POLFIN_CHAIN_MODE` defaults to `mock` — the existing deterministic stub behavior must be unchanged when it's unset.
- No silent fallback from a failed real-mode chain call to fabricated mock data — a chain error is a real thrown error.
- New identifiers follow the existing Spanish-language convention (`deudor`, `acreedor`, `escribirScoreOnChain`, etc.) — see root `CLAUDE.md`.
- This repo has no backend/frontend test suite today and this plan doesn't add one — only the new Solidity contracts get automated tests (Hardhat/Chai). Backend/frontend changes are verified manually against the deterministic seeded dataset (seed `20260801`, reference date `2026-08-01`), the same way the rest of this repo is verified (see README "Cómo verificar que los datos quedaron bien").
- Never commit a private key or `.env` file. `contracts/deployments/`, `contracts/artifacts/`, `contracts/cache/` are build output — gitignored, not committed.

---

### Task 1: Scaffold the `contracts/` Hardhat package

**Files:**
- Create: `contracts/package.json`
- Create: `contracts/hardhat.config.js`
- Modify: `.gitignore`
- Modify: `package.json` (root)

**Interfaces:**
- Produces: an installable `contracts/` npm package with `compile`, `test`, `deploy:fuji` scripts, and a `fuji` Hardhat network reading `POLFIN_FUJI_RPC_URL` / `POLFIN_OPERATOR_PRIVATE_KEY` from the environment. Tasks 2–5 write into `contracts/contracts/`, `contracts/test/`, `contracts/scripts/`.

- [ ] **Step 1: Write `contracts/package.json`**

```json
{
  "name": "polfin-contracts",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "compile": "hardhat compile",
    "test": "hardhat test",
    "deploy:fuji": "hardhat run scripts/deploy.js --network fuji"
  },
  "devDependencies": {
    "@nomicfoundation/hardhat-toolbox": "^5.0.0",
    "dotenv": "^16.4.5",
    "hardhat": "^2.22.0"
  },
  "dependencies": {
    "@openzeppelin/contracts": "^5.0.0"
  }
}
```

- [ ] **Step 2: Write `contracts/hardhat.config.js`**

```js
require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: '0.8.24',
  networks: {
    fuji: {
      url: process.env.POLFIN_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc',
      chainId: 43113,
      accounts: process.env.POLFIN_OPERATOR_PRIVATE_KEY ? [process.env.POLFIN_OPERATOR_PRIVATE_KEY] : [],
    },
  },
};
```

- [ ] **Step 3: Add contracts build output to `.gitignore`**

Append to `.gitignore` (after the existing `# misc` section):

```
# contracts (Hardhat build output — see contracts/ package)
contracts/artifacts/
contracts/cache/
contracts/deployments/
```

- [ ] **Step 4: Wire root `package.json` scripts**

In `package.json`, add these entries to `"scripts"` (alongside the existing `seed`/`dev`/`dev:api`/`dev:web`):

```json
    "contracts:install": "npm --prefix contracts install",
    "contracts:compile": "npm --prefix contracts run compile",
    "contracts:test": "npm --prefix contracts test",
    "contracts:deploy:fuji": "npm --prefix contracts run deploy:fuji"
```

- [ ] **Step 5: Install and verify**

Run: `npm run contracts:install`
Expected: installs cleanly, creates `contracts/node_modules/` and `contracts/package-lock.json`.

Run: `npm run contracts:compile`
Expected: `Nothing to compile` (no `.sol` files yet) — confirms Hardhat itself is wired correctly before any contract code exists.

- [ ] **Step 6: Commit**

```bash
git add contracts/package.json contracts/hardhat.config.js contracts/package-lock.json .gitignore package.json
git commit -m "Scaffold contracts/ Hardhat package for Avalanche Fuji integration"
```

---

### Task 2: `ScoreRegistry.sol` — the reputation registry contract

**Files:**
- Create: `contracts/contracts/ScoreRegistry.sol`
- Test: `contracts/test/ScoreRegistry.test.js`

**Interfaces:**
- Produces: contract `ScoreRegistry` — `registrarScore(uint256 entidadId, uint256 score) external onlyOwner`, public mapping getter `scores(uint256) view returns (uint256 valor, uint256 timestamp)`, event `ScoreRegistrado(uint256 indexed entidadId, uint256 score, uint256 timestamp)`. Consumed by Task 6 (`backend/src/chain/contracts.js`) and Task 5 (deploy script).

- [ ] **Step 1: Write the failing test**

```js
// contracts/test/ScoreRegistry.test.js
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { anyValue } = require('@nomicfoundation/hardhat-chai-matchers/withArgs');

describe('ScoreRegistry', function () {
  async function deploy() {
    const [owner, otro] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('ScoreRegistry');
    const registry = await Factory.deploy();
    await registry.waitForDeployment();
    return { registry, owner, otro };
  }

  it('el owner puede registrar un score y queda guardado', async function () {
    const { registry } = await deploy();
    await registry.registrarScore(14, 966);
    const s = await registry.scores(14);
    expect(s.valor).to.equal(966n);
  });

  it('emite ScoreRegistrado con entidadId y score correctos', async function () {
    const { registry } = await deploy();
    await expect(registry.registrarScore(14, 966))
      .to.emit(registry, 'ScoreRegistrado')
      .withArgs(14, 966, anyValue);
  });

  it('rechaza un score fuera de rango 0-1000', async function () {
    const { registry } = await deploy();
    await expect(registry.registrarScore(14, 1001)).to.be.revertedWith('score fuera de rango 0-1000');
  });

  it('una cuenta que no es owner no puede registrar score', async function () {
    const { registry, otro } = await deploy();
    await expect(registry.connect(otro).registrarScore(14, 500))
      .to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run contracts:test`
Expected: FAIL — `ScoreRegistry` artifact not found (no contract source exists yet).

- [ ] **Step 3: Write the contract**

```solidity
// contracts/contracts/ScoreRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Registro de reputación crediticia de PolFin
contract ScoreRegistry is Ownable {
    struct Score {
        uint256 valor;
        uint256 timestamp;
    }

    mapping(uint256 => Score) public scores;

    event ScoreRegistrado(uint256 indexed entidadId, uint256 score, uint256 timestamp);

    constructor() Ownable(msg.sender) {}

    function registrarScore(uint256 entidadId, uint256 score) external onlyOwner {
        require(score <= 1000, "score fuera de rango 0-1000");
        scores[entidadId] = Score(score, block.timestamp);
        emit ScoreRegistrado(entidadId, score, block.timestamp);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run contracts:test`
Expected: all 4 `ScoreRegistry` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/contracts/ScoreRegistry.sol contracts/test/ScoreRegistry.test.js
git commit -m "Add ScoreRegistry contract (on-chain reputation registry)"
```

---

### Task 3: `EPagare.sol` — the tokenized credit instrument (ERC-721)

**Files:**
- Create: `contracts/contracts/EPagare.sol`
- Test: `contracts/test/EPagare.test.js`

**Interfaces:**
- Produces: contract `EPagare` (ERC-721) — `generarInstrumento(uint256 deudorId, uint256 acreedorId, uint256 monto, uint256 tasaTnaBps, uint256 plazoDias, uint256 fechaVencimiento) external onlyOwner returns (uint256 tokenId)`, `marcarPagado(uint256 tokenId) external onlyOwner` (defined for future use, not called by any task in this plan), public mapping getter `pagares(uint256) view returns (uint256 deudorId, uint256 acreedorId, uint256 monto, uint256 tasaTnaBps, uint256 plazoDias, uint256 fechaVencimiento, uint8 estado)`, event `InstrumentoGenerado(uint256 indexed tokenId, uint256 indexed deudorId, uint256 indexed acreedorId, uint256 monto)`. Consumed by Task 6/7.

- [ ] **Step 1: Write the failing test**

```js
// contracts/test/EPagare.test.js
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('EPagare', function () {
  async function deploy() {
    const [owner, otro] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('EPagare');
    const ePagare = await Factory.deploy();
    await ePagare.waitForDeployment();
    return { ePagare, owner, otro };
  }

  function vencUnix(diasDesdeAhora) {
    return Math.floor(Date.now() / 1000) + diasDesdeAhora * 24 * 60 * 60;
  }

  it('el owner puede mintear un instrumento con estado Activo', async function () {
    const { ePagare, owner } = await deploy();
    const tx = await ePagare.generarInstrumento(14, 7, 180000, 4550, 90, vencUnix(90));
    await tx.wait();
    const p = await ePagare.pagares(1);
    expect(p.deudorId).to.equal(14n);
    expect(p.acreedorId).to.equal(7n);
    expect(p.monto).to.equal(180000n);
    expect(p.estado).to.equal(0n); // Estado.Activo
    expect(await ePagare.ownerOf(1)).to.equal(owner.address);
  });

  it('emite InstrumentoGenerado con tokenId, deudorId, acreedorId y monto', async function () {
    const { ePagare } = await deploy();
    await expect(ePagare.generarInstrumento(14, 7, 180000, 4550, 90, vencUnix(90)))
      .to.emit(ePagare, 'InstrumentoGenerado')
      .withArgs(1, 14, 7, 180000);
  });

  it('mintea tokenIds incrementales para instrumentos sucesivos', async function () {
    const { ePagare } = await deploy();
    await (await ePagare.generarInstrumento(14, 7, 180000, 4550, 90, vencUnix(90))).wait();
    await (await ePagare.generarInstrumento(3, 9, 50000, 3000, 30, vencUnix(30))).wait();
    expect(await ePagare.ownerOf(2)).to.not.equal(ethers.ZeroAddress);
    const p2 = await ePagare.pagares(2);
    expect(p2.deudorId).to.equal(3n);
  });

  it('marcarPagado cambia el estado a Pagado', async function () {
    const { ePagare } = await deploy();
    await (await ePagare.generarInstrumento(14, 7, 180000, 4550, 90, vencUnix(90))).wait();
    await ePagare.marcarPagado(1);
    const p = await ePagare.pagares(1);
    expect(p.estado).to.equal(1n); // Estado.Pagado
  });

  it('una cuenta que no es owner no puede mintear', async function () {
    const { ePagare, otro } = await deploy();
    await expect(ePagare.connect(otro).generarInstrumento(14, 7, 180000, 4550, 90, vencUnix(90)))
      .to.be.revertedWithCustomError(ePagare, 'OwnableUnauthorizedAccount');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run contracts:test`
Expected: `EPagare` tests FAIL — artifact not found.

- [ ] **Step 3: Write the contract**

```solidity
// contracts/contracts/EPagare.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title e-Pagaré tokenizado de PolFin (RWA)
contract EPagare is ERC721, Ownable {
    enum Estado { Activo, Pagado, Vencido }

    struct Pagare {
        uint256 deudorId;
        uint256 acreedorId;
        uint256 monto;
        uint256 tasaTnaBps;
        uint256 plazoDias;
        uint256 fechaVencimiento;
        Estado estado;
    }

    uint256 private _proximoTokenId = 1;
    mapping(uint256 => Pagare) public pagares;

    event InstrumentoGenerado(uint256 indexed tokenId, uint256 indexed deudorId, uint256 indexed acreedorId, uint256 monto);
    event InstrumentoPagado(uint256 indexed tokenId);

    constructor() ERC721("PolFin e-Pagare", "PFPAG") Ownable(msg.sender) {}

    function generarInstrumento(
        uint256 deudorId,
        uint256 acreedorId,
        uint256 monto,
        uint256 tasaTnaBps,
        uint256 plazoDias,
        uint256 fechaVencimiento
    ) external onlyOwner returns (uint256 tokenId) {
        tokenId = _proximoTokenId++;
        pagares[tokenId] = Pagare(deudorId, acreedorId, monto, tasaTnaBps, plazoDias, fechaVencimiento, Estado.Activo);
        _safeMint(msg.sender, tokenId);
        emit InstrumentoGenerado(tokenId, deudorId, acreedorId, monto);
    }

    function marcarPagado(uint256 tokenId) external onlyOwner {
        require(_ownerOf(tokenId) != address(0), "instrumento inexistente");
        pagares[tokenId].estado = Estado.Pagado;
        emit InstrumentoPagado(tokenId);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run contracts:test`
Expected: all `EPagare` tests PASS (plus the `ScoreRegistry` tests from Task 2, still passing).

- [ ] **Step 5: Commit**

```bash
git add contracts/contracts/EPagare.sol contracts/test/EPagare.test.js
git commit -m "Add EPagare ERC-721 contract (tokenized credit instrument)"
```

---

### Task 4: `MockUSDC.sol` — PolFin-controlled test stablecoin

**Files:**
- Create: `contracts/contracts/MockUSDC.sol`
- Test: `contracts/test/MockUSDC.test.js`

**Interfaces:**
- Produces: contract `MockUSDC` (ERC-20, 6 decimals) — `mint(address to, uint256 amount) external onlyOwner`. Consumed by Task 6/7.

- [ ] **Step 1: Write the failing test**

```js
// contracts/test/MockUSDC.test.js
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('MockUSDC', function () {
  async function deploy() {
    const [owner, destino] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('MockUSDC');
    const usdc = await Factory.deploy();
    await usdc.waitForDeployment();
    return { usdc, owner, destino };
  }

  it('tiene 6 decimales', async function () {
    const { usdc } = await deploy();
    expect(await usdc.decimals()).to.equal(6);
  });

  it('el owner puede mintear a cualquier destino', async function () {
    const { usdc, destino } = await deploy();
    await usdc.mint(destino.address, 150_000_000n); // 150.000000 pfUSDC
    expect(await usdc.balanceOf(destino.address)).to.equal(150_000_000n);
  });

  it('una cuenta que no es owner no puede mintear', async function () {
    const { usdc, destino } = await deploy();
    await expect(usdc.connect(destino).mint(destino.address, 1_000_000n))
      .to.be.revertedWithCustomError(usdc, 'OwnableUnauthorizedAccount');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run contracts:test`
Expected: `MockUSDC` tests FAIL — artifact not found.

- [ ] **Step 3: Write the contract**

```solidity
// contracts/contracts/MockUSDC.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title USDC de prueba controlado por PolFin (testnet Fuji)
contract MockUSDC is ERC20, Ownable {
    constructor() ERC20("PolFin Mock USDC", "pfUSDC") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run contracts:test`
Expected: all `MockUSDC` tests PASS (plus all tests from Tasks 2–3, still passing — full suite green).

- [ ] **Step 5: Commit**

```bash
git add contracts/contracts/MockUSDC.sol contracts/test/MockUSDC.test.js
git commit -m "Add MockUSDC contract (PolFin-controlled test stablecoin)"
```

---

### Task 5: Deploy script + operator wallet setup on Fuji

**⚠️ HUMAN ACTION REQUIRED in this task:** generating a private key and funding it from a testnet faucet are things an autonomous agent must not do unattended — the private key must be handled by the person running this plan, and faucets are typically CAPTCHA/login-gated. If you are an agent executing this plan, do Steps 1–2 yourself (they're just running a script), then **stop and hand Steps 3–5 to the human** before continuing to Task 6.

**Files:**
- Create: `contracts/scripts/deploy.js`

**Interfaces:**
- Produces: `contracts/deployments/fuji.json` (gitignored — local artifact) containing the three deployed contract addresses. Consumed by Task 6 via the `POLFIN_*_ADDRESS` env vars it prints.

- [ ] **Step 1: Write the deploy script**

```js
// contracts/scripts/deploy.js
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [operador] = await hre.ethers.getSigners();
  console.log('Deployando con operador:', operador.address);

  const ScoreRegistry = await hre.ethers.getContractFactory('ScoreRegistry');
  const scoreRegistry = await ScoreRegistry.deploy();
  await scoreRegistry.waitForDeployment();

  const EPagare = await hre.ethers.getContractFactory('EPagare');
  const ePagare = await EPagare.deploy();
  await ePagare.waitForDeployment();

  const MockUSDC = await hre.ethers.getContractFactory('MockUSDC');
  const mockUsdc = await MockUSDC.deploy();
  await mockUsdc.waitForDeployment();

  const direcciones = {
    network: hre.network.name,
    operador: operador.address,
    scoreRegistry: await scoreRegistry.getAddress(),
    ePagare: await ePagare.getAddress(),
    mockUsdc: await mockUsdc.getAddress(),
    deployedAt: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${hre.network.name}.json`), JSON.stringify(direcciones, null, 2));

  console.log(JSON.stringify(direcciones, null, 2));
  console.log('\nAgregá esto a backend/.env:');
  console.log(`POLFIN_SCORE_REGISTRY_ADDRESS=${direcciones.scoreRegistry}`);
  console.log(`POLFIN_EPAGARE_ADDRESS=${direcciones.ePagare}`);
  console.log(`POLFIN_MOCK_USDC_ADDRESS=${direcciones.mockUsdc}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Generate an operator wallet**

Run (from the repo root — the subshell keeps the working directory unchanged):

```bash
(cd contracts && node -e "const { ethers } = require('ethers'); const w = ethers.Wallet.createRandom(); console.log('address:', w.address); console.log('privateKey:', w.privateKey);")
```

This prints a fresh address and private key. **Do not commit either value.**

- [ ] **Step 3 (HUMAN): Fund the wallet from a Fuji faucet**

Go to the official Avalanche Fuji faucet (e.g. `https://core.app/tools/testnet-faucet/`) and request testnet AVAX for the address printed in Step 2. Confirm the balance landed by checking `https://testnet.snowtrace.io/address/<the address>` before continuing — the deploy in Step 5 needs gas.

- [ ] **Step 4 (HUMAN): Set environment variables**

Create `backend/.env` (gitignored) and `contracts/.env` (gitignored) — both need the same three values so Hardhat (deploy) and the backend (runtime calls) sign with the same operator wallet:

```
POLFIN_FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
POLFIN_OPERATOR_PRIVATE_KEY=<private key from Step 2>
```

Leave `POLFIN_CHAIN_MODE` unset (or `mock`) in `backend/.env` for now — Task 7 is what makes that variable meaningful. It gets flipped to `fuji` only once Task 7/8 are done and you're ready to test the real path end-to-end.

- [ ] **Step 5 (HUMAN or agent, once wallet is funded): Deploy and verify**

Run: `npm run contracts:deploy:fuji`
Expected: prints the three deployed addresses and writes `contracts/deployments/fuji.json`.

Copy the three printed `POLFIN_*_ADDRESS` lines into `backend/.env`.

Verify on the explorer: open `https://testnet.snowtrace.io/address/<scoreRegistry address>` and confirm a "Contract Creation" transaction shows up (same for the other two addresses).

- [ ] **Step 6: Commit (code only — never the .env files)**

```bash
git add contracts/scripts/deploy.js
git commit -m "Add Fuji deploy script for ScoreRegistry, EPagare, and MockUSDC"
```

---

### Task 6: Backend `chain/` module — ethers.js wiring

**Files:**
- Create: `backend/src/chain/provider.js`
- Create: `backend/src/chain/contracts.js`
- Create: `backend/src/chain/onchain.js`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `POLFIN_FUJI_RPC_URL`, `POLFIN_OPERATOR_PRIVATE_KEY`, `POLFIN_SCORE_REGISTRY_ADDRESS`, `POLFIN_EPAGARE_ADDRESS`, `POLFIN_MOCK_USDC_ADDRESS` env vars (set in Task 5).
- Produces (consumed by Task 7's `tools.js`):
  - `async function escribirScoreOnChain(entidadId: number, score: number): Promise<{ tx_hash: string }>`
  - `async function mintearInstrumentoOnChain({ deudorId, acreedorId, monto, tasaTna, plazoDias, fechaVencimiento }): Promise<{ contrato_address: string, tx_hash: string, token_id: number | null }>` — `fechaVencimiento` is a `'YYYY-MM-DD'` string, `tasaTna` is a percentage float (e.g. `45.5`).
  - `async function liquidarPagoStablecoinOnChain({ monto, destino }): Promise<{ tx_hash: string }>` — `monto` is a USDC float amount, `destino` a `0x...` address string.

There is no automated test for this module (no backend test framework in this repo — see Global Constraints); it's verified indirectly by Task 7's manual end-to-end check once `POLFIN_CHAIN_MODE=fuji` is set.

- [ ] **Step 1: Add `ethers` to the backend**

In `backend/package.json`, add to `"dependencies"`:

```json
    "ethers": "^6.13.4"
```

Run: `npm --prefix backend install`
Expected: installs cleanly.

- [ ] **Step 2: Write `backend/src/chain/provider.js`**

```js
// backend/src/chain/provider.js
import { ethers } from 'ethers';

let wallet = null;

export function obtenerWalletOperador() {
  if (wallet) return wallet;
  const rpcUrl = process.env.POLFIN_FUJI_RPC_URL;
  const privateKey = process.env.POLFIN_OPERATOR_PRIVATE_KEY;
  if (!rpcUrl || !privateKey) {
    throw new Error('POLFIN_FUJI_RPC_URL y POLFIN_OPERATOR_PRIVATE_KEY son obligatorias en POLFIN_CHAIN_MODE=fuji');
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  wallet = new ethers.Wallet(privateKey, provider);
  return wallet;
}
```

- [ ] **Step 3: Write `backend/src/chain/contracts.js`**

```js
// backend/src/chain/contracts.js
import { ethers } from 'ethers';
import { obtenerWalletOperador } from './provider.js';

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

function direccion(envVar) {
  const addr = process.env[envVar];
  if (!addr) {
    throw new Error(`falta ${envVar} — correr "npm run contracts:deploy:fuji" y copiar la address a backend/.env`);
  }
  return addr;
}

export function obtenerScoreRegistry() {
  return new ethers.Contract(direccion('POLFIN_SCORE_REGISTRY_ADDRESS'), ABI_SCORE_REGISTRY, obtenerWalletOperador());
}

export function obtenerEPagare() {
  return new ethers.Contract(direccion('POLFIN_EPAGARE_ADDRESS'), ABI_EPAGARE, obtenerWalletOperador());
}

export function obtenerMockUSDC() {
  return new ethers.Contract(direccion('POLFIN_MOCK_USDC_ADDRESS'), ABI_MOCK_USDC, obtenerWalletOperador());
}
```

- [ ] **Step 4: Write `backend/src/chain/onchain.js`**

```js
// backend/src/chain/onchain.js
import { ethers } from 'ethers';
import { obtenerScoreRegistry, obtenerEPagare, obtenerMockUSDC } from './contracts.js';

export async function escribirScoreOnChain(entidadId, score) {
  const registry = obtenerScoreRegistry();
  const txResp = await registry.registrarScore(entidadId, score);
  const receipt = await txResp.wait();
  return { tx_hash: receipt.hash };
}

export async function mintearInstrumentoOnChain({ deudorId, acreedorId, monto, tasaTna, plazoDias, fechaVencimiento }) {
  const ePagare = obtenerEPagare();
  const tasaTnaBps = Math.round(tasaTna * 100);
  const fechaVencimientoUnix = Math.floor(new Date(`${fechaVencimiento}T00:00:00Z`).getTime() / 1000);
  const txResp = await ePagare.generarInstrumento(deudorId, acreedorId, monto, tasaTnaBps, plazoDias, fechaVencimientoUnix);
  const receipt = await txResp.wait();
  const evento = receipt.logs
    .map((log) => {
      try { return ePagare.interface.parseLog(log); } catch { return null; }
    })
    .find((e) => e?.name === 'InstrumentoGenerado');
  return {
    contrato_address: await ePagare.getAddress(),
    tx_hash: receipt.hash,
    token_id: evento ? Number(evento.args.tokenId) : null,
  };
}

export async function liquidarPagoStablecoinOnChain({ monto, destino }) {
  const usdc = obtenerMockUSDC();
  const unidades = ethers.parseUnits(String(monto), 6);
  const txResp = await usdc.mint(destino, unidades);
  const receipt = await txResp.wait();
  return { tx_hash: receipt.hash };
}
```

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/chain/provider.js backend/src/chain/contracts.js backend/src/chain/onchain.js
git commit -m "Add backend chain/ module: ethers.js wiring for Fuji contracts"
```

---

### Task 7: `tools.js` — branch on `POLFIN_CHAIN_MODE`, persist real on-chain data

**Files:**
- Modify: `backend/src/db.js` (migration: add `token_id` column to `instrumentos`)
- Modify: `backend/src/agente/tools.js`

**Interfaces:**
- Consumes: `escribirScoreOnChain`, `mintearInstrumentoOnChain`, `liquidarPagoStablecoinOnChain` from Task 6's `backend/src/chain/onchain.js`.
- Produces: `export async function ejecutarTool(db, nombre, input, ctx = {})` (was sync — this is the breaking-change interface Task 8 depends on). The `generarInstrumento` tool result now includes a `token_id` field (was previously absent).

- [ ] **Step 1: Add the `token_id` column migration**

In `backend/src/db.js`, right after the existing migration block (find this exact code — it's immediately after `CREATE TABLE` statements, near the end of the schema-setup function):

```js
  try {
    db.exec(`ALTER TABLE instrumentos ADD COLUMN aceptado_at TEXT`);
  } catch { /* la columna ya existe */ }
```

Add immediately after it:

```js
  // Migración: id del NFT minteado en el contrato EPagare (Prompt 4, Fuji).
  // NULL para instrumentos creados en POLFIN_CHAIN_MODE=mock.
  try {
    db.exec(`ALTER TABLE instrumentos ADD COLUMN token_id INTEGER`);
  } catch { /* la columna ya existe */ }
```

- [ ] **Step 2: Regenerate the DB to pick up the migration**

Run: `npm run seed`
Expected: completes without error, prints the usual per-deudor table. (This applies the `ALTER TABLE` to the fresh `backend/data/polfin.db`.)

- [ ] **Step 3: Update imports and add the mode helper in `tools.js`**

Find (top of file):

```js
import { randomBytes } from 'node:crypto';
import { calcularScore } from '../scoring.js';
```

Replace with:

```js
import { randomBytes } from 'node:crypto';
import { calcularScore } from '../scoring.js';
import { escribirScoreOnChain, mintearInstrumentoOnChain, liquidarPagoStablecoinOnChain } from '../chain/onchain.js';

const modoChain = () => (process.env.POLFIN_CHAIN_MODE || 'mock').toLowerCase();
```

- [ ] **Step 4: Make `ejecutarTool` async**

Find:

```js
export function ejecutarTool(db, nombre, input, ctx = {}) {
```

Replace with:

```js
export async function ejecutarTool(db, nombre, input, ctx = {}) {
```

- [ ] **Step 5: Rewrite the `generarInstrumento` case**

Find the entire case (from the `// ======================= STUB ON-CHAIN (PROMPT 4) =======================` comment block through the closing `}` of the case):

```js
    case 'generarInstrumento': {
      // ======================= STUB ON-CHAIN (PROMPT 4) =======================
      // HOY: registra el e-pagaré en la DB y devuelve dirección + tx hash MOCK.
      // PROMPT 4: acá va el deploy REAL del contrato de instrumento de crédito
      // en Avalanche Fuji (Solidity + ethers.js): desplegar el contrato con
      // (deudor, acreedor, monto, tasa, vencimiento) y guardar la dirección y
      // el tx hash reales que devuelva la red. El resto del sistema NO cambia.
      // ========================================================================
      const venc = new Date(Date.now() + input.plazoDias * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      const contrato = mockAddress();
      const tx = mockHash();
      const r = db.prepare(`
        INSERT INTO instrumentos
          (solicitud_id, deudor_id, acreedor_id, monto, tasa_tna, plazo_dias,
           fecha_vencimiento, contrato_address, tx_hash, red)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'fuji-mock')
      `).run(ctx.solicitudId ?? null, input.deudorId, input.acreedorId, input.monto,
        input.tasaTna, input.plazoDias, venc, contrato, tx);
      return {
        instrumento_id: Number(r.lastInsertRowid),
        tipo: 'e-pagare',
        monto: input.monto,
        tasa_tna: input.tasaTna,
        plazo_dias: input.plazoDias,
        fecha_vencimiento: venc,
        contrato_address: contrato,
        tx_hash: tx,
        red: 'fuji-mock',
        nota: 'MOCK: en el Prompt 4 esto es un smart contract real en Avalanche Fuji',
      };
    }
```

Replace with:

```js
    case 'generarInstrumento': {
      // POLFIN_CHAIN_MODE=fuji: mintea un NFT real en el contrato EPagare.
      // POLFIN_CHAIN_MODE=mock (default): mismo comportamiento que siempre.
      const venc = new Date(Date.now() + input.plazoDias * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      const red = modoChain() === 'fuji' ? 'fuji' : 'fuji-mock';
      let contrato, tx, tokenId = null;
      if (modoChain() === 'fuji') {
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
        nota: red === 'fuji'
          ? 'NFT del e-pagaré minteado en Avalanche Fuji (testnet)'
          : 'MOCK: seteá POLFIN_CHAIN_MODE=fuji con los contratos deployados para el mint real',
      };
    }
```

- [ ] **Step 6: Rewrite the `registrarScoreOnChain` case**

Find:

```js
    case 'registrarScoreOnChain': {
      // ======================= STUB ON-CHAIN (PROMPT 4) =======================
      // HOY: registra en DB con tx hash MOCK.
      // PROMPT 4: acá va la escritura REAL en el contrato de scoring registry
      // en Fuji (mapping entidadId → score + timestamp + hash de evidencia).
      // ========================================================================
      const tx = mockHash();
      db.prepare(`
        INSERT INTO scores_onchain (entidad_id, score, tx_hash, red)
        VALUES (?, ?, ?, 'fuji-mock')
      `).run(input.entidadId, input.score, tx);
      return {
        entidad_id: input.entidadId, score: input.score, tx_hash: tx, red: 'fuji-mock',
        nota: 'MOCK: en el Prompt 4 esto escribe en el scoring registry real de Fuji',
      };
    }
```

Replace with:

```js
    case 'registrarScoreOnChain': {
      const red = modoChain() === 'fuji' ? 'fuji' : 'fuji-mock';
      const tx = modoChain() === 'fuji'
        ? (await escribirScoreOnChain(input.entidadId, input.score)).tx_hash
        : mockHash();
      db.prepare(`
        INSERT INTO scores_onchain (entidad_id, score, tx_hash, red)
        VALUES (?, ?, ?, ?)
      `).run(input.entidadId, input.score, tx, red);
      return {
        entidad_id: input.entidadId, score: input.score, tx_hash: tx, red,
        nota: red === 'fuji'
          ? 'Score escrito en el ScoreRegistry real de Avalanche Fuji (testnet)'
          : 'MOCK: seteá POLFIN_CHAIN_MODE=fuji con los contratos deployados para la escritura real',
      };
    }
```

- [ ] **Step 7: Rewrite the `ejecutarPagoStablecoin` case**

Find:

```js
    case 'ejecutarPagoStablecoin': {
      // ======================= STUB ON-CHAIN (PROMPT 4) =======================
      // PROMPT 4: transferencia real de USDC de prueba en Fuji (ethers.js).
      // Esta tool SIEMPRE requiere aprobación humana (ver policy.js), así que
      // en el flujo normal llega acá solo después de un OK explícito del dueño.
      // ========================================================================
      return {
        monto_usdc: input.monto, destino: input.destino,
        tx_hash: mockHash(), red: 'fuji-mock',
        nota: 'MOCK: en el Prompt 4 esto liquida USDC de prueba en Fuji',
      };
    }
```

Replace with:

```js
    case 'ejecutarPagoStablecoin': {
      // Esta tool SIEMPRE requiere aprobación humana (ver policy.js), así que
      // en el flujo normal llega acá solo después de un OK explícito del dueño.
      const red = modoChain() === 'fuji' ? 'fuji' : 'fuji-mock';
      const tx = modoChain() === 'fuji'
        ? (await liquidarPagoStablecoinOnChain({ monto: input.monto, destino: input.destino })).tx_hash
        : mockHash();
      return {
        monto_usdc: input.monto, destino: input.destino,
        tx_hash: tx, red,
        nota: red === 'fuji'
          ? 'USDC de prueba (pfUSDC) minteado y liquidado en Avalanche Fuji (testnet)'
          : 'MOCK: seteá POLFIN_CHAIN_MODE=fuji con los contratos deployados para la liquidación real',
      };
    }
```

- [ ] **Step 8: Manual regression check in mock mode (no chain calls made yet)**

Run: `npm run seed` (if not already done in Step 2), then `npm run dev:api` in one terminal.

In another terminal:

```bash
curl -s -X POST http://localhost:4000/api/agente/evaluar-credito \
  -H 'Content-Type: application/json' \
  -d '{"deudor_id": 14, "acreedor_id": 7, "monto": 180000}'
```

Expected: JSON response with `"estado": "aprobada"`, `"score": 966`, `"instrumento": { ..., "red": "fuji-mock", "token_id": null, ... }`, `"score_onchain": { ..., "red": "fuji-mock", ... }` — i.e. identical shape/values to the README's already-verified "Marcela + $180k en el corralón → aprobada y ejecutada (score 966)" scenario, now with the added (null) `token_id` field. This confirms the branching logic didn't change mock-mode behavior. (Note: `ejecutarTool` is `async` as of Step 4 in this task but nothing awaits it yet outside this module — that's Task 8. This curl call will actually fail until Task 8 is done, because `paso()` in `pipelineCredito.js` calls `ejecutarTool` without `await` and gets a pending `Promise` instead of a result object. **Do this verification after Task 8, not now** — see Task 8 Step 9 for the real checkpoint. Skip this step here and proceed to commit.)

- [ ] **Step 9: Commit**

```bash
git add backend/src/db.js backend/src/agente/tools.js
git commit -m "Branch on-chain tools by POLFIN_CHAIN_MODE, persist real tx data"
```

---

### Task 8: Propagate `async`/`await` through the pipeline

**Files:**
- Modify: `backend/src/agente/pipelineCredito.js`
- Modify: `backend/src/agente/agente.js`
- Modify: `backend/src/agente/agenteProactivo.js`
- Modify: `backend/src/server.js`

**Interfaces:**
- Consumes: `ejecutarTool` is now `async` (Task 7).
- Produces: `correrPipeline`, `reanudarPipeline`, `evaluarCredito`, `aprobarSolicitud`, `rechazarSolicitud`, `ciclarMonitoreo` are all now `async` and must be `await`ed by every caller — this is the interface every one of this task's own edits must respect internally, and what Task 9 (frontend, unaffected — it only calls the already-`async`-safe HTTP routes) can now assume is correctly wired end-to-end.

- [ ] **Step 1: `pipelineCredito.js` — make `paso` async**

Find:

```js
function paso(db, auditar, nombre, input, ctx) {
  const pol = evaluarPolicy(nombre, input);
  auditar('policy', { tool: nombre, params: input, permitido: pol.permitido, motivo: pol.motivo });
  if (!pol.permitido) {
    const bloqueo = { bloqueado: true, motivo: pol.motivo, requiere_aprobacion: pol.requiere_aprobacion };
    auditar('tool_call', { tool: nombre, params: input, resultado: bloqueo });
    return bloqueo;
  }
  const resultado = ejecutarTool(db, nombre, input, ctx);
  auditar('tool_call', { tool: nombre, params: input, resultado });
  return resultado;
}
```

Replace with:

```js
async function paso(db, auditar, nombre, input, ctx) {
  const pol = evaluarPolicy(nombre, input);
  auditar('policy', { tool: nombre, params: input, permitido: pol.permitido, motivo: pol.motivo });
  if (!pol.permitido) {
    const bloqueo = { bloqueado: true, motivo: pol.motivo, requiere_aprobacion: pol.requiere_aprobacion };
    auditar('tool_call', { tool: nombre, params: input, resultado: bloqueo });
    return bloqueo;
  }
  const resultado = await ejecutarTool(db, nombre, input, ctx);
  auditar('tool_call', { tool: nombre, params: input, resultado });
  return resultado;
}
```

- [ ] **Step 2: `pipelineCredito.js` — make `correrPipeline` async and await every `paso`/`ejecutarTool` call**

Find:

```js
export function correrPipeline(db, { deudorId, acreedorId, monto, solicitudId, corridaId, origen = 'directa' }) {
```

Replace with:

```js
export async function correrPipeline(db, { deudorId, acreedorId, monto, solicitudId, corridaId, origen = 'directa' }) {
```

Find:

```js
  datos.historial = paso(db, auditar, 'getHistorialCliente', { entidadId: deudorId }, ctx);
  datos.scoring = paso(db, auditar, 'calcularScoring', { entidadId: deudorId }, ctx);
```

Replace with:

```js
  datos.historial = await paso(db, auditar, 'getHistorialCliente', { entidadId: deudorId }, ctx);
  datos.scoring = await paso(db, auditar, 'calcularScoring', { entidadId: deudorId }, ctx);
```

Find:

```js
  datos.macro = paso(db, auditar, 'consultarMacro', {}, ctx);
  datos.condiciones = paso(db, auditar, 'decidirCondiciones', { entidadId: deudorId, montoSolicitado: monto }, ctx);
```

Replace with:

```js
  datos.macro = await paso(db, auditar, 'consultarMacro', {}, ctx);
  datos.condiciones = await paso(db, auditar, 'decidirCondiciones', { entidadId: deudorId, montoSolicitado: monto }, ctx);
```

Find:

```js
  if (datos.condiciones.rechazar || !datos.condiciones.dentro_del_limite) {
    paso(db, auditar, 'notificarDueno', {
```

Replace with:

```js
  if (datos.condiciones.rechazar || !datos.condiciones.dentro_del_limite) {
    await paso(db, auditar, 'notificarDueno', {
```

Find:

```js
    ejecutarTool(db, 'notificarDueno', {
      mensaje: `APROBACIÓN REQUERIDA: crédito de $${monto.toLocaleString('es-AR')} para ${datos.scoring.entidad.nombre} (score ${datos.condiciones.score}, ${datos.condiciones.condiciones.riesgo}). Condiciones sugeridas: tasa ${datos.condiciones.condiciones.tasa_sugerida_tna}% TNA, hasta ${datos.condiciones.condiciones.plazo_max_dias} días. Supera el límite autónomo del agente: falta tu OK.`,
      tipo: 'aprobacion_requerida',
    }, ctx);
```

Replace with:

```js
    await ejecutarTool(db, 'notificarDueno', {
      mensaje: `APROBACIÓN REQUERIDA: crédito de $${monto.toLocaleString('es-AR')} para ${datos.scoring.entidad.nombre} (score ${datos.condiciones.score}, ${datos.condiciones.condiciones.riesgo}). Condiciones sugeridas: tasa ${datos.condiciones.condiciones.tasa_sugerida_tna}% TNA, hasta ${datos.condiciones.condiciones.plazo_max_dias} días. Supera el límite autónomo del agente: falta tu OK.`,
      tipo: 'aprobacion_requerida',
    }, ctx);
```

Find:

```js
  datos.instrumento = paso(db, auditar, 'generarInstrumento', inputInstrumento, ctx);
  datos.onchain = paso(db, auditar, 'registrarScoreOnChain', { entidadId: deudorId, score: datos.condiciones.score }, ctx);
```

Replace with:

```js
  datos.instrumento = await paso(db, auditar, 'generarInstrumento', inputInstrumento, ctx);
  datos.onchain = await paso(db, auditar, 'registrarScoreOnChain', { entidadId: deudorId, score: datos.condiciones.score }, ctx);
```

- [ ] **Step 3: `pipelineCredito.js` — make `reanudarPipeline` async and await its `ejecutarTool` calls**

Find:

```js
export function reanudarPipeline(db, solicitudId, decision) {
```

Replace with:

```js
export async function reanudarPipeline(db, solicitudId, decision) {
```

Find:

```js
  datos.instrumento = ejecutarTool(db, 'generarInstrumento', input, { solicitudId });
  auditar('tool_call', { tool: 'generarInstrumento', params: input, resultado: datos.instrumento });
  datos.onchain = ejecutarTool(db, 'registrarScoreOnChain', { entidadId: sol.deudor_id, score: cond.score }, { solicitudId });
```

Replace with:

```js
  datos.instrumento = await ejecutarTool(db, 'generarInstrumento', input, { solicitudId });
  auditar('tool_call', { tool: 'generarInstrumento', params: input, resultado: datos.instrumento });
  datos.onchain = await ejecutarTool(db, 'registrarScoreOnChain', { entidadId: sol.deudor_id, score: cond.score }, { solicitudId });
```

`cerrar()` (the last function in the file) makes no `ejecutarTool` calls — leave it as-is; a sync function can be called and returned directly from an async one.

- [ ] **Step 4: `agente.js` — make `evaluarCredito`, `aprobarSolicitud`, `rechazarSolicitud` async**

Find:

```js
export function evaluarCredito(db, { deudorId, acreedorId, monto, contexto = '', origen = 'directa' }) {
```

Replace with:

```js
export async function evaluarCredito(db, { deudorId, acreedorId, monto, contexto = '', origen = 'directa' }) {
```

Find:

```js
  const r = correrPipeline(db, { deudorId, acreedorId, monto, solicitudId, corridaId, origen });
```

Replace with:

```js
  const r = await correrPipeline(db, { deudorId, acreedorId, monto, solicitudId, corridaId, origen });
```

Find:

```js
export function aprobarSolicitud(db, solicitudId) {
  const r = reanudarPipeline(db, solicitudId, 'aprobar');
```

Replace with:

```js
export async function aprobarSolicitud(db, solicitudId) {
  const r = await reanudarPipeline(db, solicitudId, 'aprobar');
```

Find:

```js
export function rechazarSolicitud(db, solicitudId) {
  const r = reanudarPipeline(db, solicitudId, 'rechazar');
```

Replace with:

```js
export async function rechazarSolicitud(db, solicitudId) {
  const r = await reanudarPipeline(db, solicitudId, 'rechazar');
```

- [ ] **Step 5: `agente.js` — await `evaluarCredito` inside `conversar` (already `async`)**

Find:

```js
  // MEDIO: exactamente el mismo pipeline determinístico (sin LLM).
  const resultado = evaluarCredito(db, {
```

Replace with:

```js
  // MEDIO: exactamente el mismo pipeline determinístico (sin LLM).
  const resultado = await evaluarCredito(db, {
```

- [ ] **Step 6: `agenteProactivo.js` — make `ciclarMonitoreo` async and await its calls**

Find:

```js
export function ciclarMonitoreo(db, { ventanaVencimiento } = {}) {
```

Replace with:

```js
export async function ciclarMonitoreo(db, { ventanaVencimiento } = {}) {
```

Find (inside the ampliación loop):

```js
    // MISMO pipeline del Prompt A, origen proactivo → gate SIEMPRE.
    const r = evaluarCredito(db, {
```

Replace with:

```js
    // MISMO pipeline del Prompt A, origen proactivo → gate SIEMPRE.
    const r = await evaluarCredito(db, {
```

Find (riesgo de atraso loop):

```js
    // no mueve plata → Ángela lo entrega directo (allowlist libre)
    ejecutarTool(db, 'notificarDueno', { mensaje: `COBRO ANTES DE QUE ESCALE: ${detalle}`, tipo: 'info' });
```

Replace with:

```js
    // no mueve plata → Ángela lo entrega directo (allowlist libre)
    await ejecutarTool(db, 'notificarDueno', { mensaje: `COBRO ANTES DE QUE ESCALE: ${detalle}`, tipo: 'info' });
```

Find (vencimientos loop):

```js
    ejecutarTool(db, 'notificarDueno', { mensaje: `VENCIMIENTO: ${detalle}`, tipo: 'info' });
```

Replace with:

```js
    await ejecutarTool(db, 'notificarDueno', { mensaje: `VENCIMIENTO: ${detalle}`, tipo: 'info' });
```

- [ ] **Step 7: `agenteProactivo.js` — await `ciclarMonitoreo` inside the `setInterval` callback**

Find:

```js
  const timer = setInterval(() => {
    try {
      const r = ciclarMonitoreo(db);
      if (r.total_nuevas > 0) console.log(`[monitor] Ángela detectó ${r.total_nuevas} situación(es) nueva(s)`);
    } catch (e) {
      console.error('[monitor] error en el ciclo:', e.message);
    }
  }, seg * 1000);
```

Replace with:

```js
  const timer = setInterval(async () => {
    try {
      const r = await ciclarMonitoreo(db);
      if (r.total_nuevas > 0) console.log(`[monitor] Ángela detectó ${r.total_nuevas} situación(es) nueva(s)`);
    } catch (e) {
      console.error('[monitor] error en el ciclo:', e.message);
    }
  }, seg * 1000);
```

- [ ] **Step 8: `server.js` — make the 4 affected route handlers async**

Find:

```js
app.post('/api/agente/evaluar-credito', (req, res) => {
  try {
    const { deudor_id, acreedor_id, monto, contexto } = req.body || {};
    const resultado = evaluarCredito(db, {
      deudorId: Number(deudor_id),
      acreedorId: Number(acreedor_id),
      monto: Number(monto),
      contexto,
    });
    res.json(resultado);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});
```

Replace with:

```js
app.post('/api/agente/evaluar-credito', async (req, res) => {
  try {
    const { deudor_id, acreedor_id, monto, contexto } = req.body || {};
    const resultado = await evaluarCredito(db, {
      deudorId: Number(deudor_id),
      acreedorId: Number(acreedor_id),
      monto: Number(monto),
      contexto,
    });
    res.json(resultado);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});
```

Find:

```js
app.post('/api/agente/monitorear', (req, res) => {
  try {
    res.json(ciclarMonitoreo(db, { ventanaVencimiento: req.body?.ventana_vencimiento }));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});
```

Replace with:

```js
app.post('/api/agente/monitorear', async (req, res) => {
  try {
    res.json(await ciclarMonitoreo(db, { ventanaVencimiento: req.body?.ventana_vencimiento }));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});
```

Find:

```js
app.post('/api/solicitudes/:id/aprobar', (req, res) => {
  try { res.json(aprobarSolicitud(db, Number(req.params.id))); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});
app.post('/api/solicitudes/:id/rechazar', (req, res) => {
  try { res.json(rechazarSolicitud(db, Number(req.params.id))); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});
```

Replace with:

```js
app.post('/api/solicitudes/:id/aprobar', async (req, res) => {
  try { res.json(await aprobarSolicitud(db, Number(req.params.id))); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});
app.post('/api/solicitudes/:id/rechazar', async (req, res) => {
  try { res.json(await rechazarSolicitud(db, Number(req.params.id))); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});
```

(`/api/agente/conversar` is already `async` and already `await`s `conversar()` — no change needed there.)

- [ ] **Step 9: Manual end-to-end regression check (mock mode — this is the real checkpoint for Task 7 Step 8 too)**

Run: `npm run seed`, then `npm run dev:api` in one terminal (leave `POLFIN_CHAIN_MODE` unset).

In another terminal, the auto-approved path (Marcela, id 14, buying at Corralón, id 7):

```bash
curl -s -X POST http://localhost:4000/api/agente/evaluar-credito \
  -H 'Content-Type: application/json' \
  -d '{"deudor_id": 14, "acreedor_id": 7, "monto": 180000}'
```

Expected: `"estado": "aprobada"`, `"score": 966`, `"instrumento"` present with `"red": "fuji-mock"` and `"token_id": null`, `"score_onchain"` present with `"red": "fuji-mock"`. This exercises `correrPipeline`'s `EJECUTANDO` branch (`paso → ejecutarTool` await chain from Task 8 Step 2, hitting the rewritten cases from Task 7).

Then the pending-approval path — first check Marcela's actual credit limit so the next request is guaranteed to land in `PENDIENTE_APROBACION` (above the $500.000 autonomous limit but within her limit):

```bash
curl -s http://localhost:4000/api/score/14
```

Note the `limite_sugerido_pesos` in the response, then request an amount between $500.001 and that limit:

```bash
curl -s -X POST http://localhost:4000/api/agente/evaluar-credito \
  -H 'Content-Type: application/json' \
  -d '{"deudor_id": 14, "acreedor_id": 7, "monto": 600000}'
```

Expected: `"estado": "pendiente_aprobacion"`, no `"instrumento"` yet. Note the `"solicitud_id"` from the response, then approve it:

```bash
curl -s -X POST http://localhost:4000/api/solicitudes/<solicitud_id>/aprobar
```

Expected: `"estado": "aprobada"`, `"instrumento"` now present with `"red": "fuji-mock"`. This exercises `reanudarPipeline`'s await chain from Task 8 Step 3.

Finally, trigger a monitor cycle:

```bash
curl -s -X POST http://localhost:4000/api/agente/monitorear
```

Expected: `200` with a JSON body containing `"detecciones_nuevas"` (possibly empty array — that's fine, the point is no error). This exercises `ciclarMonitoreo`'s await chain from Task 8 Steps 6–7.

If all three checks pass with `POLFIN_CHAIN_MODE` unset, the async refactor preserved existing behavior exactly.

- [ ] **Step 10: Commit**

```bash
git add backend/src/agente/pipelineCredito.js backend/src/agente/agente.js backend/src/agente/agenteProactivo.js backend/src/server.js
git commit -m "Propagate async/await through the credit pipeline for real chain calls"
```

---

### Task 9: Frontend — link to Snowtrace for real on-chain data

**Files:**
- Modify: `frontend/lib/api.ts` (add `token_id` to the `Instrumento` type)
- Modify: `frontend/components/documento.tsx`
- Modify: `frontend/components/aprobaciones.tsx`

**Interfaces:**
- Consumes: `Instrumento.red`, `Instrumento.contrato_address`, `Instrumento.tx_hash`, `Instrumento.token_id` from the existing `GET /api/instrumentos/:id` response (Task 7 already made the backend return real values for these when `red === 'fuji'`).

- [ ] **Step 1: Add `token_id` to the `Instrumento` type**

In `frontend/lib/api.ts`, find:

```ts
export type Instrumento = {
  id: number; deudor_id: number; acreedor_id: number; monto: number;
  tasa_tna: number; plazo_dias: number; fecha_vencimiento: string;
  estado: "activo" | "pagado" | "vencido";
  contrato_address: string; tx_hash: string; red: string;
  aceptado: number; aceptado_at: string | null; created_at: string;
  deudor_nombre: string; deudor_tipo?: string; deudor_ciudad?: string;
  acreedor_nombre: string; acreedor_rubro?: string; acreedor_ciudad?: string;
};
```

Replace with:

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

- [ ] **Step 2: Link to Snowtrace in `documento.tsx`**

In `frontend/components/documento.tsx`, find:

```tsx
        <div className="mt-5 rounded-xl border border-linea bg-ink/50 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-tenue">Registro on-chain</div>
          <div className="mt-1.5 grid grid-cols-1 gap-1 text-[11.5px]">
            <div className="flex justify-between gap-3"><span className="text-tenue">Red</span><span className="num text-tinta">Avalanche {i.red === "fuji-mock" ? "Fuji (testnet · mock)" : i.red}</span></div>
            <div className="flex justify-between gap-3"><span className="shrink-0 text-tenue">Contrato</span><span className="num truncate text-tinta">{i.contrato_address}</span></div>
            <div className="flex justify-between gap-3"><span className="shrink-0 text-tenue">Tx hash</span><span className="num truncate text-tinta">{i.tx_hash}</span></div>
          </div>
        </div>
```

Replace with:

```tsx
        <div className="mt-5 rounded-xl border border-linea bg-ink/50 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-tenue">Registro on-chain</div>
          <div className="mt-1.5 grid grid-cols-1 gap-1 text-[11.5px]">
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
          </div>
        </div>
```

- [ ] **Step 3: Link to Snowtrace in `aprobaciones.tsx`**

In `frontend/components/aprobaciones.tsx`, find:

```ts
type Resuelta = { estado: string; instrumento?: { contrato_address: string; fecha_vencimiento: string } };
```

Replace with:

```ts
type Resuelta = { estado: string; instrumento?: { contrato_address: string; fecha_vencimiento: string; tx_hash: string; red: string } };
```

Find:

```tsx
                  {resuelta.estado === "aprobada" ? (
                    <>e-Pagaré emitido{resuelta.instrumento ? <> (vence {resuelta.instrumento.fecha_vencimiento}, contrato <span className="num">{resuelta.instrumento.contrato_address.slice(0, 14)}…</span>)</> : ""}. Solicitud en <span className="font-semibold text-okk">COMPLETADO</span>.
                    {" "}<button onClick={() => irA("pagos")} className="font-medium text-brand hover:underline">Ver en Pagos →</button></>
                  ) : (
```

Replace with:

```tsx
                  {resuelta.estado === "aprobada" ? (
                    <>e-Pagaré emitido{resuelta.instrumento ? (
                      <> (vence {resuelta.instrumento.fecha_vencimiento}, contrato{" "}
                        {resuelta.instrumento.red === "fuji" ? (
                          <a href={`https://testnet.snowtrace.io/address/${resuelta.instrumento.contrato_address}`} target="_blank" rel="noopener noreferrer"
                            className="num text-brand hover:underline">{resuelta.instrumento.contrato_address.slice(0, 14)}…</a>
                        ) : (
                          <span className="num">{resuelta.instrumento.contrato_address.slice(0, 14)}…</span>
                        )})</>
                    ) : ""}. Solicitud en <span className="font-semibold text-okk">COMPLETADO</span>.
                    {" "}<button onClick={() => irA("pagos")} className="font-medium text-brand hover:underline">Ver en Pagos →</button></>
                  ) : (
```

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev` (from repo root — starts both API and frontend).

In the UI: pick a role, trigger a credit evaluation that gets auto-approved (or approve a pending one from Aprobaciones), then open the resulting e-pagaré document. With `POLFIN_CHAIN_MODE` unset (mock), confirm the contract address and tx hash render as plain text (no link) — since `red` is `"fuji-mock"`. This confirms the conditional doesn't regress the existing mock-mode display.

(A real Fuji-mode check — confirming the link actually opens a live Snowtrace page — depends on Task 5's deployed contracts and `POLFIN_CHAIN_MODE=fuji` being set; do that once Task 5's human steps are complete.)

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api.ts frontend/components/documento.tsx frontend/components/aprobaciones.tsx
git commit -m "Link contract address/tx hash to Snowtrace when red is fuji"
```

---

### Task 10: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md` (root)

**Interfaces:** None — documentation only.

- [ ] **Step 1: Update `CLAUDE.md`'s env var list**

Find:

```
### Key env vars

`LLM_MODE`, `ANTHROPIC_API_KEY`, `POLFIN_FALLBACKS`,
`POLFIN_LIMITE_AUTONOMO`, `POLFIN_MONITOR_INTERVAL`, `POLFIN_VENC_VENTANA`,
`POLFIN_API_PORT` (backend, default 4000), `NEXT_PUBLIC_API_URL` (frontend →
backend base URL).
```

Replace with:

```
### Key env vars

`LLM_MODE`, `ANTHROPIC_API_KEY`, `POLFIN_FALLBACKS`,
`POLFIN_LIMITE_AUTONOMO`, `POLFIN_MONITOR_INTERVAL`, `POLFIN_VENC_VENTANA`,
`POLFIN_API_PORT` (backend, default 4000), `NEXT_PUBLIC_API_URL` (frontend →
backend base URL), `POLFIN_CHAIN_MODE` (`mock` default | `fuji`),
`POLFIN_OPERATOR_PRIVATE_KEY`, `POLFIN_FUJI_RPC_URL`,
`POLFIN_SCORE_REGISTRY_ADDRESS`, `POLFIN_EPAGARE_ADDRESS`,
`POLFIN_MOCK_USDC_ADDRESS` (all four only required when
`POLFIN_CHAIN_MODE=fuji` — see `contracts/README` deploy flow).
```

- [ ] **Step 2: Update `README.md`'s structure diagram and "Próximos pasos"**

Find:

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

Replace with:

```
polfin/
├── backend/    Node + Express + SQLite (node:sqlite, sin deps nativas)
│   ├── src/db.js      esquema (entidades multi-rol + transacciones + macro)
│   ├── src/seed.js    generador de datos sintéticos argentinos (seedeado)
│   ├── src/scoring.js motor de scoring 0–1000 (determinístico y explicable)
│   ├── src/scores-report.js  reporte por consola (npm run scores)
│   ├── src/agente/    el agente (Prompt 3)
│   │   ├── agente.js       loop percibe→decide→ejecuta + human-in-the-loop
│   │   ├── tools.js        registro de tools (schema Anthropic), branch mock/fuji
│   │   ├── policy.js       policy engine (límites, allowlist, auditoría)
│   │   └── llm/            LLMProvider: mock.js | anthropic.js (por LLM_MODE)
│   ├── src/chain/     ethers.js — wallet, contratos, llamadas Fuji (Prompt 4)
│   ├── src/server.js  API REST
│   └── data/polfin.db la DB generada (gitignoreada, se regenera)
├── contracts/  Hardhat — ScoreRegistry, EPagare (ERC-721), MockUSDC (Fuji)
└── frontend/   Next.js + React + Tailwind + shadcn/ui
```

Find:

```
## Próximos pasos (secuencia del doc maestro)

3. Agente (tools + loop + policy engine) → 4. On-chain (Fuji: scoring registry +
instrumento RWA) → 5. Vistas → 6. Cerebro/grafo → 7. Modo demo.
```

Replace with:

```
## Próximos pasos (secuencia del doc maestro)

3. Agente (tools + loop + policy engine) → 4. On-chain (Fuji: scoring
registry + instrumento RWA) ✅ contratos reales deployados detrás de
`POLFIN_CHAIN_MODE=fuji`, ver `contracts/` → 5. Vistas → 6. Cerebro/grafo →
7. Modo demo.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "Document POLFIN_CHAIN_MODE and the contracts/ package"
```

---

## Post-plan: switching the demo to real Fuji mode

Once all 10 tasks are done and Task 5's human steps (wallet funded, contracts deployed, addresses in `backend/.env`) are complete, flip `backend/.env`'s `POLFIN_CHAIN_MODE` to `fuji` and re-run the Task 8 Step 9 curl sequence. Each call now takes several seconds (real Fuji block time) instead of being instant, and the `red` fields in the responses read `"fuji"` instead of `"fuji-mock"` — click through the printed `contrato_address`/`tx_hash` on `testnet.snowtrace.io` to confirm they're real. This isn't a plan task with its own checkbox because it depends entirely on the human-gated Task 5 steps being complete first.
