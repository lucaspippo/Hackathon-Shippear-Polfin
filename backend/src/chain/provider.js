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
