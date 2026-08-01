// contracts/scripts/deploy.js
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

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

  const direcciones = {
    network: hre.network.name,
    operador: operador.address,
    scoreRegistry: await scoreRegistry.getAddress(),
    ePagare: await ePagare.getAddress(),
    mockUsdc: await mockUsdc.getAddress(),
    deployedAt: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${hre.network.name}.json`), JSON.stringify(direcciones, null, 2));

  console.log(JSON.stringify(direcciones, null, 2));
  console.log('\nAgregá esto a backend/.env:');
  console.log(`POLFIN_SCORE_REGISTRY_ADDRESS=${direcciones.scoreRegistry}`);
  console.log(`POLFIN_EPAGARE_ADDRESS=${direcciones.ePagare}`);
  console.log(`POLFIN_MOCK_USDC_ADDRESS=${direcciones.mockUsdc}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
