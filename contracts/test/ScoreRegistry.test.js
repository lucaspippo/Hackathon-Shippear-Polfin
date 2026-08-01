// contracts/test/ScoreRegistry.test.js
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { anyValue } = require('@nomicfoundation/hardhat-chai-matchers/withArgs');

describe('ScoreRegistry', function () {
  async function deploy() {
    const [owner, otro] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('ScoreRegistry');
    const registry = await Factory.deploy();
    await registry.waitForDeployment();
    return { registry, owner, otro };
  }

  it('el owner puede registrar un score y queda guardado', async function () {
    const { registry } = await deploy();
    await registry.registrarScore(14, 966);
    const s = await registry.scores(14);
    expect(s.valor).to.equal(966n);
  });

  it('emite ScoreRegistrado con entidadId y score correctos', async function () {
    const { registry } = await deploy();
    await expect(registry.registrarScore(14, 966))
      .to.emit(registry, 'ScoreRegistrado')
      .withArgs(14, 966, anyValue);
  });

  it('rechaza un score fuera de rango 0-1000', async function () {
    const { registry } = await deploy();
    await expect(registry.registrarScore(14, 1001)).to.be.revertedWith('score fuera de rango 0-1000');
  });

  it('una cuenta que no es owner no puede registrar score', async function () {
    const { registry, otro } = await deploy();
    await expect(registry.connect(otro).registrarScore(14, 500))
      .to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');
  });
});
