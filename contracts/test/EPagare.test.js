// contracts/test/EPagare.test.js
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('EPagare', function () {
  async function deploy() {
    const [owner, otro] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('EPagare');
    const ePagare = await Factory.deploy();
    await ePagare.waitForDeployment();
    return { ePagare, owner, otro };
  }

  function vencUnix(diasDesdeAhora) {
    return Math.floor(Date.now() / 1000) + diasDesdeAhora * 24 * 60 * 60;
  }

  it('el owner puede mintear un instrumento con estado Activo', async function () {
    const { ePagare, owner } = await deploy();
    const tx = await ePagare.generarInstrumento(14, 7, 180000, 4550, 90, vencUnix(90));
    await tx.wait();
    const p = await ePagare.pagares(1);
    expect(p.deudorId).to.equal(14n);
    expect(p.acreedorId).to.equal(7n);
    expect(p.monto).to.equal(180000n);
    expect(p.estado).to.equal(0n); // Estado.Activo
    expect(await ePagare.ownerOf(1)).to.equal(owner.address);
  });

  it('emite InstrumentoGenerado con tokenId, deudorId, acreedorId y monto', async function () {
    const { ePagare } = await deploy();
    await expect(ePagare.generarInstrumento(14, 7, 180000, 4550, 90, vencUnix(90)))
      .to.emit(ePagare, 'InstrumentoGenerado')
      .withArgs(1, 14, 7, 180000);
  });

  it('mintea tokenIds incrementales para instrumentos sucesivos', async function () {
    const { ePagare } = await deploy();
    await (await ePagare.generarInstrumento(14, 7, 180000, 4550, 90, vencUnix(90))).wait();
    await (await ePagare.generarInstrumento(3, 9, 50000, 3000, 30, vencUnix(30))).wait();
    expect(await ePagare.ownerOf(2)).to.not.equal(ethers.ZeroAddress);
    const p2 = await ePagare.pagares(2);
    expect(p2.deudorId).to.equal(3n);
  });

  it('marcarPagado cambia el estado a Pagado', async function () {
    const { ePagare } = await deploy();
    await (await ePagare.generarInstrumento(14, 7, 180000, 4550, 90, vencUnix(90))).wait();
    await ePagare.marcarPagado(1);
    const p = await ePagare.pagares(1);
    expect(p.estado).to.equal(1n); // Estado.Pagado
  });

  it('una cuenta que no es owner no puede mintear', async function () {
    const { ePagare, otro } = await deploy();
    await expect(ePagare.connect(otro).generarInstrumento(14, 7, 180000, 4550, 90, vencUnix(90)))
      .to.be.revertedWithCustomError(ePagare, 'OwnableUnauthorizedAccount');
  });
});
