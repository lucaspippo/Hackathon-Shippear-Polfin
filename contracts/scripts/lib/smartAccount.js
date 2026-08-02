// contracts/scripts/lib/smartAccount.js
//
// Calcula la dirección de la Smart Account de 0xgasless para el operador que
// está deployando, para poder transferirle el ownership de los tres
// contratos justo después del deploy. Misma config confirmada en la Tarea 6
// (backend/src/chain/gasless.js): bundlerUrl/paymasterUrl, no apiKey suelta.
async function obtenerDireccionSmartAccount({ signer, chainId, bundlerUrl, paymasterUrl, rpcUrl }) {
  const { createSmartAccountClient } = await import('@0xgasless/smart-account');
  const cuenta = await createSmartAccountClient({ signer, chainId, bundlerUrl, paymasterUrl, rpcUrl });
  return cuenta.getAddress();
}

module.exports = { obtenerDireccionSmartAccount };
