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
