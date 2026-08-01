require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      evmVersion: 'cancun',
    },
  },
  networks: {
    fuji: {
      url: process.env.POLFIN_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc',
      chainId: 43113,
      accounts: process.env.POLFIN_OPERATOR_PRIVATE_KEY ? [process.env.POLFIN_OPERATOR_PRIVATE_KEY] : [],
    },
  },
};
