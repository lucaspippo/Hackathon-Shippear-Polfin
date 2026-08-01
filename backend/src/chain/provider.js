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
