const HDWalletProvider = require('truffle-hdwallet-provider')
const { wrapProvider } = require('arb-ethers-web3-bridge')
require('dotenv').config();

mnemonic = process.env.KEY_MNEMONIC;
infuraApiKey = process.env.KEY_INFURA_API_KEY;

module.exports = {	
  networks: {	
    rpc: {	
      network_id: '*',	
      host: 'localhost',	
      port: 8545,	
      gas: 9000000,	
      gasPrice: 10000000000 //10 Gwei	
    },	
    develop: {	
      network_id: '66',	
      host: 'localhost',	
      port: 8545,	
      gas: 9000000,	
      gasPrice: 10000000000 //10 Gwei	
    },	
    mainnet: {	
      provider: function () {	
        return new HDWalletProvider(mnemonic, `https://mainnet.infura.io/v3/${infuraApiKey}`)	
      },	
      network_id: '1',	
      gas: 9000000,	
      gasPrice: 10000000000 //10 Gwei	
    },	
    bsc: {	
      provider: function () {	
        return new HDWalletProvider(mnemonic, ``)	
      },	
      network_id: '56',	
      gas: 9000000,	
      gasPrice: 10000000000 //10 Gwei	
    },	
    polygon: {	
      provider: function () {	
        return new HDWalletProvider(mnemonic, `https://ropsten.infura.io/v3/${infuraApiKey}`)	
      },	
      network_id: '137',	
      gas: 8000000,	
      gasPrice: 10000000000 //10 Gwei	
    }
  },	
  build: {},	
  compilers: {	
    solc: {	
      version: '0.6.6',
      settings: {
        evmVersion: 'istanbul',
      }
    }
  },	
  solc: {	
    optimizer: {	
      enabled: true,	
      runs: 200	
    }
  },	
}
