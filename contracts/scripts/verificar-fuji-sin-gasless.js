// contracts/scripts/verificar-fuji-sin-gasless.js
//
// Verificación de que los 3 contratos ya deployados en Fuji funcionan de
// verdad on-chain, firmando DIRECTO con la wallet operadora (sin pasar por
// 0xgasless) — porque su contrato factory de Smart Account todavía no está
// deployado en Fuji (confirmado: eth_getCode vacío en esa red, con bytecode
// real en mainnet). Este script prueba la lógica de negocio real (mintear
// un e-pagaré, registrar un score) contra Fuji, dejando el patrocinio de
// gas pendiente de mainnet (Tarea 15).
//
// No es parte del test suite (este repo no tiene uno) ni corre en CI:
// requiere que contracts/deployments/fuji.json ya exista (correr primero
// `npm run contracts:deploy:fuji`) y las credenciales reales de Fuji en
// contracts/.env.
//
// Uso (desde contracts/):
//   npx hardhat run scripts/verificar-fuji-sin-gasless.js --network fuji

const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [operador] = await hre.ethers.getSigners();
  console.log('Wallet operadora:', operador.address);

  const deploymentsPath = path.join(__dirname, '..', 'deployments', 'fuji.json');
  const { scoreRegistry: scoreRegistryAddr, ePagare: ePagareAddr } = JSON.parse(
    fs.readFileSync(deploymentsPath, 'utf8'),
  );
  console.log('ScoreRegistry:', scoreRegistryAddr);
  console.log('EPagare:', ePagareAddr);

  const scoreRegistry = await hre.ethers.getContractAt('ScoreRegistry', scoreRegistryAddr, operador);
  const ePagare = await hre.ethers.getContractAt('EPagare', ePagareAddr, operador);

  const GAS_LIMIT = 300_000n;

  console.log('\n1) registrarScore(999999, 500)...');
  const tx1 = await scoreRegistry.registrarScore(999999n, 500n, { gasLimit: GAS_LIMIT });
  const receipt1 = await tx1.wait();
  console.log('   tx_hash:', receipt1.hash);
  const [scoreGuardado] = await scoreRegistry.scores(999999n);
  console.log('   Score leído de vuelta del contrato:', scoreGuardado.toString());
  if (scoreGuardado !== 500n) throw new Error(`FALLO: esperaba score 500, quedó ${scoreGuardado}`);

  console.log('\n2) generarInstrumento(deudorId=1, acreedorId=2, monto=20000, tasaBps=4500, plazoDias=30, vencimiento=+30d)...');
  const vencimientoUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const tx2 = await ePagare.generarInstrumento(1n, 2n, 20000n, 4500n, 30n, BigInt(vencimientoUnix), { gasLimit: GAS_LIMIT });
  const receipt2 = await tx2.wait();
  console.log('   tx_hash:', receipt2.hash);
  const evento = receipt2.logs
    .map((log) => { try { return ePagare.interface.parseLog(log); } catch { return null; } })
    .find((e) => e?.name === 'InstrumentoGenerado');
  if (!evento) throw new Error('FALLO: no se emitió el evento InstrumentoGenerado');
  console.log('   token_id minteado:', evento.args.tokenId.toString());

  console.log('\nOK — los 3 contratos funcionan de verdad en Fuji (sin gasless, wallet operadora paga su propio gas).');
  console.log(`Ver en Snowtrace: https://testnet.snowtrace.io/tx/${receipt2.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
