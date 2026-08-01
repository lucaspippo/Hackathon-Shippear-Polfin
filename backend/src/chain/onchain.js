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
