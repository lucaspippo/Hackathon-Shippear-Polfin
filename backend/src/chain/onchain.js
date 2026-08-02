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
