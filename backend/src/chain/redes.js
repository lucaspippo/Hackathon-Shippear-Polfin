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
