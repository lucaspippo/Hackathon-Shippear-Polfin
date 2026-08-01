// contracts/test/MockUSDC.test.js
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('MockUSDC', function () {
  async function deploy() {
    const [owner, destino] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('MockUSDC');
    const usdc = await Factory.deploy();
    await usdc.waitForDeployment();
    return { usdc, owner, destino };
  }

  it('tiene 6 decimales', async function () {
    const { usdc } = await deploy();
    expect(await usdc.decimals()).to.equal(6);
  });

  it('el owner puede mintear a cualquier destino', async function () {
    const { usdc, destino } = await deploy();
    await usdc.mint(destino.address, 150_000_000n); // 150.000000 pfUSDC
    expect(await usdc.balanceOf(destino.address)).to.equal(150_000_000n);
  });

  it('una cuenta que no es owner no puede mintear', async function () {
    const { usdc, destino } = await deploy();
    await expect(usdc.connect(destino).mint(destino.address, 1_000_000n))
      .to.be.revertedWithCustomError(usdc, 'OwnableUnauthorizedAccount');
  });
});
