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
