import { Wallet, Contract } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './utilities'

import MagicornSwapFactory from '@magicorn/core/build/MagicornSwapFactory.json'
import IMagicornSwapPair from '@magicorn/core/build/IMagicornSwapPair.json'

import ERC20 from '../../build/ERC20.json'
import WETH9 from '../../build/WETH9.json'
import MagicornSwapRouter from '../../build/MagicornSwapRouter.json'
import RouterEventEmitter from '../../build/RouterEventEmitter.json'
import MagicornSwapRelayer from '../../build/MagicornSwapRelayer.json'
import OracleCreator from '../../build/OracleCreator.json'


const overrides = {
  gasLimit: 9999999
}

interface MagicornSwapFixture {
  token0: Contract
  token1: Contract
  WETH: Contract
  WETHPartner: Contract
  magicornswapFactory: Contract
  routerEventEmitter: Contract
  router: Contract
  pair: Contract
  WETHPair: Contract
  magicornswapPair: Contract
  magicornswapRouter: Contract
  uniFactory: Contract
  uniRouter: Contract
  uniPair: Contract
  oracleCreator: Contract
  magicornRelayer: Contract
}

export async function magicornswapFixture(provider: Web3Provider, [wallet]: Wallet[]): Promise<MagicornSwapFixture> {
  // deploy tokens
  const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const WETH = await deployContract(wallet, WETH9)
  const WETHPartner = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])

  // deploy MagicornSwapFactory
  const magicornswapFactory = await deployContract(wallet, MagicornSwapFactory, [wallet.address])

  // deploy router
  const router = await deployContract(wallet, MagicornSwapRouter, [magicornswapFactory.address, WETH.address], overrides)
  const magicornswapRouter = await deployContract(wallet, MagicornSwapRouter, [magicornswapFactory.address, WETH.address], overrides)
  const uniRouter = await deployContract(wallet, MagicornSwapRouter, [magicornswapFactory.address, WETH.address], overrides)

  // event emitter for testing
  const routerEventEmitter = await deployContract(wallet, RouterEventEmitter, [])

  // initialize MagicornSwapFactory
  await magicornswapFactory.createPair(tokenA.address, tokenB.address)
  const pairAddress = await magicornswapFactory.getPair(tokenA.address, tokenB.address)
  const pair = new Contract(pairAddress, JSON.stringify(IMagicornSwapPair.abi), provider).connect(wallet)
  const magicornswapPair = new Contract(pairAddress, JSON.stringify(IMagicornSwapPair.abi), provider).connect(wallet)

  const token0Address = await pair.token0()
  const token0 = tokenA.address === token0Address ? tokenA : tokenB
  const token1 = tokenA.address === token0Address ? tokenB : tokenA

  await magicornswapFactory.createPair(WETH.address, WETHPartner.address)
  const WETHPairAddress = await magicornswapFactory.getPair(WETH.address, WETHPartner.address)
  const WETHPair = new Contract(WETHPairAddress, JSON.stringify(IMagicornSwapPair.abi), provider).connect(wallet)

  // deploy UniswapFactory
  const uniFactory = await deployContract(wallet, MagicornSwapFactory, [wallet.address])

  // initialize MagicornSwapFactory
  await uniFactory.createPair(tokenA.address, tokenB.address)
  const uniPairAddress = await uniFactory.getPair(tokenA.address, tokenB.address)
  const uniPair = new Contract(uniPairAddress, JSON.stringify(IMagicornSwapPair.abi), provider).connect(wallet)

  // deploy oracleCreator
  const oracleCreator = await deployContract(wallet, OracleCreator)

  const magicornRelayer = await deployContract(
    wallet,
    MagicornSwapRelayer,
    [wallet.address, magicornswapFactory.address, magicornswapRouter.address, uniFactory.address, uniRouter.address, WETH.address, oracleCreator.address],
    overrides
  )

  return {
    token0,
    token1,
    WETH,
    WETHPartner,
    magicornswapFactory,
    routerEventEmitter,
    router,
    pair,
    WETHPair,
    magicornswapPair,
    magicornswapRouter,
    uniFactory,
    uniRouter,
    uniPair,
    oracleCreator,
    magicornRelayer
  }
}