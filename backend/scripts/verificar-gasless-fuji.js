// backend/scripts/verificar-gasless-fuji.js
//
// Verificación end-to-end real contra Avalanche Fuji: manda UNA tx patrocinada
// por 0xgasless (el mismo camino que usan generarInstrumento/registrarScoreOnChain/
// ejecutarPagoStablecoin — ver src/chain/onchain.js) y confirma que:
//   1. La tx se confirma on-chain con un tx_hash real (visible en Snowtrace).
//   2. La wallet operadora NO gastó AVAX propio — el paymaster pagó el gas.
//
// No es parte del test suite (este repo no tiene uno — ver CLAUDE.md) ni se
// corre en CI: requiere credenciales reales de Fuji + 0xgasless, así que es
// un script de verificación manual, en la línea de los smoke checks del plan
// docs/superpowers/plans/2026-08-01-avalanche-gasless.md.
//
// Requisitos antes de correrlo:
//   1. contracts/deployments/fuji.json debe existir → correr primero:
//      npm run contracts:deploy:fuji
//   2. backend/.env con:
//      POLFIN_CHAIN_MODE=fuji
//      POLFIN_FUJI_RPC_URL=...
//      POLFIN_OPERATOR_PRIVATE_KEY_FUJI=...   (wallet descartable, fondeada por el faucet)
//      POLFIN_0XGASLESS_BUNDLER_URL_FUJI=...
//      POLFIN_0XGASLESS_PAYMASTER_URL_FUJI=...
//
// Uso (desde la raíz del repo):
//   node --env-file=backend/.env backend/scripts/verificar-gasless-fuji.js

import { obtenerWalletOperador, obtenerRedActiva } from '../src/chain/provider.js';
import { escribirScoreOnChain } from '../src/chain/onchain.js';
import { explorerUrl } from '../src/chain/redes.js';

const red = obtenerRedActiva();
if (red !== 'fuji') {
  console.error(`POLFIN_CHAIN_MODE=${red} — este script es solo para Fuji. Seteá POLFIN_CHAIN_MODE=fuji.`);
  process.exit(1);
}

const wallet = obtenerWalletOperador();
const balanceAntes = await wallet.provider.getBalance(wallet.address);
console.log(`Wallet operadora: ${wallet.address}`);
console.log(`Balance AVAX antes: ${balanceAntes} wei`);

// entidadId de prueba: no necesita existir en la DB seedeada, el contrato no
// lo valida (ver contracts/contracts/ScoreRegistry.sol) — solo probamos que
// la tx patrocinada se confirma on-chain.
const entidadIdPrueba = 999999n;
const scorePrueba = 500;

console.log(`\nMandando registrarScore(${entidadIdPrueba}, ${scorePrueba}) patrocinado por el paymaster...`);
const { tx_hash } = await escribirScoreOnChain(entidadIdPrueba, scorePrueba);
console.log(`tx_hash: ${tx_hash}`);
console.log(`Ver en Snowtrace: ${explorerUrl('fuji', 'tx', tx_hash)}`);

const balanceDespues = await wallet.provider.getBalance(wallet.address);
console.log(`\nBalance AVAX después: ${balanceDespues} wei`);

if (balanceDespues === balanceAntes) {
  console.log('\nOK — el gas lo pagó el paymaster de 0xgasless. La wallet operadora no gastó AVAX propio.');
} else {
  const gastado = balanceAntes - balanceDespues;
  console.error(`\nFALLO — la wallet operadora gastó ${gastado} wei de AVAX propio. El patrocinio no está funcionando como se espera.`);
  process.exit(1);
}
