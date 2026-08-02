// contracts/scripts/deploy.js
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');
const { obtenerDireccionSmartAccount } = require('./lib/smartAccount');

async function main() {
  const [operador] = await hre.ethers.getSigners();
  console.log('Deployando con operador:', operador.address);

  // gasLimit fijo: varios RPCs públicos de Fuji devuelven "state not
  // available for pending block" al estimar gas automáticamente (ethers
  // consulta contra el bloque "pending", que esos nodos no exponen). Pasar
  // un gasLimit explícito evita esa estimación. 6M es generoso para estos
  // tres contratos simples — en testnet el costo no importa.
  const GAS_LIMIT_DEPLOY = 6_000_000n;

  const ScoreRegistry = await hre.ethers.getContractFactory('ScoreRegistry');
  const scoreRegistry = await ScoreRegistry.deploy({ gasLimit: GAS_LIMIT_DEPLOY });
  await scoreRegistry.waitForDeployment();

  const EPagare = await hre.ethers.getContractFactory('EPagare');
  const ePagare = await EPagare.deploy({ gasLimit: GAS_LIMIT_DEPLOY });
  await ePagare.waitForDeployment();

  const MockUSDC = await hre.ethers.getContractFactory('MockUSDC');
  const mockUsdc = await MockUSDC.deploy({ gasLimit: GAS_LIMIT_DEPLOY });
  await mockUsdc.waitForDeployment();

  const RPC_ENV = { fuji: 'POLFIN_FUJI_RPC_URL', avalanche: 'POLFIN_AVALANCHE_RPC_URL' };
  const CHAIN_ID = { fuji: 43113, avalanche: 43114 };
  const sufijo = hre.network.name.toUpperCase();
  const bundlerUrl = process.env[`POLFIN_0XGASLESS_BUNDLER_URL_${sufijo}`];
  const paymasterUrl = process.env[`POLFIN_0XGASLESS_PAYMASTER_URL_${sufijo}`];
  let smartAccountAddress = null;
  if (bundlerUrl && paymasterUrl && CHAIN_ID[hre.network.name]) {
    // La resolución de la Smart Account (y no el deploy en sí) es lo que
    // puede fallar por causas ajenas a este script — ej. 0xgasless no tiene
    // su contrato factory deployado en esta red (confirmado: pasa en Fuji
    // hoy, no en mainnet). Si falla, no tumbamos todo el deploy: seguimos
    // con los contratos owned por la EOA operadora, igual que si el
    // bundler/paymaster no estuvieran configurados.
    try {
      smartAccountAddress = await obtenerDireccionSmartAccount({
        signer: operador, chainId: CHAIN_ID[hre.network.name], bundlerUrl, paymasterUrl,
        rpcUrl: process.env[RPC_ENV[hre.network.name]],
      });
      console.log('Transfiriendo ownership a la Smart Account:', smartAccountAddress);
      const GAS_LIMIT_TRANSFER = 200_000n;
      await (await scoreRegistry.transferOwnership(smartAccountAddress, { gasLimit: GAS_LIMIT_TRANSFER })).wait();
      await (await ePagare.transferOwnership(smartAccountAddress, { gasLimit: GAS_LIMIT_TRANSFER })).wait();
      await (await mockUsdc.transferOwnership(smartAccountAddress, { gasLimit: GAS_LIMIT_TRANSFER })).wait();
    } catch (e) {
      smartAccountAddress = null;
      console.log(`\nOJO: falló la resolución/transferencia a la Smart Account (${e.message}). Los contratos quedan owned por la EOA operadora — seguí sin el gasless por ahora.`);
    }
  } else {
    console.log(`\nOJO: no se transfirió el ownership a ninguna Smart Account (faltan POLFIN_0XGASLESS_BUNDLER_URL_${sufijo}/POLFIN_0XGASLESS_PAYMASTER_URL_${sufijo}, o la red no es fuji/avalanche). Los contratos quedan owned por la EOA operadora.`);
  }

  const direcciones = {
    network: hre.network.name,
    operador: operador.address,
    smartAccount: smartAccountAddress,
    scoreRegistry: await scoreRegistry.getAddress(),
    ePagare: await ePagare.getAddress(),
    mockUsdc: await mockUsdc.getAddress(),
    deployedAt: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${hre.network.name}.json`), JSON.stringify(direcciones, null, 2));

  console.log(JSON.stringify(direcciones, null, 2));
  console.log(`\nDirecciones escritas en contracts/deployments/${hre.network.name}.json`);
  console.log('El backend las lee de ahí directo — no hace falta pegarlas en ningún .env.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
