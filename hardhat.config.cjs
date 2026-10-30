// Compilación y pruebas del contrato en una blockchain local. Uso: npm run contrato:test
require('@nomicfoundation/hardhat-toolbox');

module.exports = {
  solidity: { version: '0.8.28', settings: { optimizer: { enabled: true, runs: 200 } } },
  paths: { sources: './contracts', tests: './tests/chain', cache: './.hardhat/cache', artifacts: './.hardhat/artifacts' },
  networks: {
    // Con HH_INTERVAL=1 el nodo local mina un bloque por segundo, como una red real.
    hardhat: process.env.HH_INTERVAL ? { mining: { auto: true, interval: 1000 } } : {},
    // Se completa con variables de entorno al desplegar. Ver README.
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
};
