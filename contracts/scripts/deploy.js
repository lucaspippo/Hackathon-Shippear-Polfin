// contracts/scripts/deploy.js
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');
const { obtenerDireccionSmartAccount } = require('./lib/smartAccount');

async function main() {
  const [operador] = await hre.ethers.getSigners();
  console.log('Deployando con operador:', operador.address);

  const ScoreRegistry = await hre.ethers.getContractFactory('ScoreRegistry');
  const scoreRegistry = await ScoreRegistry.deploy();
  await scoreRegistry.waitForDeployment();

  const EPagare = await hre.ethers.getContractFactory('EPagare');
  const ePagare = await EPagare.deploy();
  await ePagare.waitForDeployment();

  const MockUSDC = await hre.ethers.getContractFactory('MockUSDC');
  const mockUsdc = await MockUSDC.deploy();
  await mockUsdc.waitForDeployment();

  const RPC_ENV = { fuji: 'POLFIN_FUJI_RPC_URL', avalanche: 'POLFIN_AVALANCHE_RPC_URL' };
  const CHAIN_ID = { fuji: 43113, avalanche: 43114 };
  const sufijo = hre.network.name.toUpperCase();
  const bundlerUrl = process.env[`POLFIN_0XGASLESS_BUNDLER_URL_${sufijo}`];
  const paymasterUrl = process.env[`POLFIN_0XGASLESS_PAYMASTER_URL_${sufijo}`];
  let smartAccountAddress = null;
  if (bundlerUrl && paymasterUrl && CHAIN_ID[hre.network.name]) {
    smartAccountAddress = await obtenerDireccionSmartAccount({
      signer: operador, chainId: CHAIN_ID[hre.network.name], bundlerUrl, paymasterUrl,
      rpcUrl: process.env[RPC_ENV[hre.network.name]],
    });
    console.log('Transfiriendo ownership a la Smart Account:', smartAccountAddress);
    await (await scoreRegistry.transferOwnership(smartAccountAddress)).wait();
    await (await ePagare.transferOwnership(smartAccountAddress)).wait();
    await (await mockUsdc.transferOwnership(smartAccountAddress)).wait();
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
