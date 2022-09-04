import chai, { expect } from 'chai'
import { constants, Contract, ethers, utils, Wallet } from 'ethers'
import { AddressZero, MaxUint256 } from 'ethers/constants'
import { BigNumber, bigNumberify, Interface } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'

import { expandTo18Decimals, mineBlock, MINIMUM_LIQUIDITY } from './shared/utilities'
import { magicornswapFixture } from './shared/fixtures'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('MagicornSwapRelayer', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet, wallet2] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet])

  let token0: Contract
  let token1: Contract
  let weth: Contract
  let wethPartner: Contract
  let wethPair: Contract
  let magicornswapPair: Contract
  let magicornswapFactory: Contract
  let magicornswapRouter: Contract
  let uniPair: Contract
  let uniFactory: Contract
  let uniRouter: Contract
  let oracleCreator: Contract
  let magicornRelayer: Contract
  let tokenPair: Contract
  let owner: String

  async function addLiquidity(amount0: BigNumber = defaultAmountA, amount1: BigNumber = defaultAmountB) {
    if (!amount0.isZero()) await token0.transfer(magicornswapPair.address, amount0)
    if (!amount1.isZero()) await token1.transfer(magicornswapPair.address, amount1)
    await magicornswapPair.mint(magicornRelayer.address, overrides)
  }

  const defaultAmountA = expandTo18Decimals(1)
  const defaultAmountB = expandTo18Decimals(4)
  const expectedLiquidity = expandTo18Decimals(2)
  const defaultPriceTolerance = 10000 // 1%
  const defaultMinReserve = expandTo18Decimals(2)
  const defaultMaxWindowTime = 300 // 5 Minutes

  beforeEach('deploy fixture', async function() {
    const fixture = await loadFixture(magicornswapFixture)
    token0 = fixture.token0
    token1 = fixture.token1
    weth = fixture.WETH
    wethPartner = fixture.WETHPartner
    wethPair = fixture.WETHPair
    magicornswapPair = fixture.pair
    magicornswapFactory = fixture.magicornswapFactory
    magicornswapRouter = fixture.magicornswapRouter
    uniPair = fixture.uniPair
    uniFactory = fixture.uniFactory
    uniRouter = fixture.uniRouter
    oracleCreator = fixture.oracleCreator
    magicornRelayer = fixture.magicornRelayer
  })

  beforeEach('fund the relayer contract to spend ERC20s and ETH', async () => {
    await token0.transfer(magicornRelayer.address, expandTo18Decimals(999))
    await token1.transfer(magicornRelayer.address, expandTo18Decimals(999))
    await wethPartner.transfer(magicornRelayer.address, expandTo18Decimals(999))
    await wallet.sendTransaction({
      to: magicornRelayer.address,
      value: utils.parseEther('999')
    })
    owner = await magicornRelayer.owner()
  })

  // 1/1/2020 @ 12:00 am UTC
  // cannot be 0 because that instructs ganache to set it to current timestamp
  // cannot be 86400 because then timestamp 0 is a valid historical observation
  const startTime = 1577836800
  const defaultDeadline = 1577836800 + 86400 // 24 hours

  // must come before adding liquidity to pairs for correct cumulative price computations
  // cannot use 0 because that resets to current timestamp
  beforeEach(`set start time to ${startTime}`, () => mineBlock(provider, startTime))

  describe('Liquidity provision', () => {
    it('requires correct order input', async () => {
      await expect(
        magicornRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          token0.address
        )
      ).to.be.revertedWith('MagicornSwapRelayer: INVALID_FACTORY')

      const magicornRelayerFromWallet2 = magicornRelayer.connect(wallet2)
      await expect(
        magicornRelayerFromWallet2.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      ).to.be.revertedWith('MagicornSwapRelayer: CALLER_NOT_OWNER')

      await expect(
        magicornRelayer.orderLiquidityProvision(
          token1.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      ).to.be.revertedWith('MagicornSwapRelayer: INVALID_PAIR')

      await expect(
        magicornRelayer.orderLiquidityProvision(
          token1.address,
          token0.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      ).to.be.revertedWith('MagicornSwapRelayer: INVALID_TOKEN_ORDER')

      await expect(
        magicornRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          0,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      ).to.be.revertedWith('MagicornSwapRelayer: INVALID_TOKEN_AMOUNT')

      await expect(
        magicornRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          1000000000,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      ).to.be.revertedWith('MagicornSwapRelayer: INVALID_TOLERANCE')

      await expect(
        magicornRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          1577836800,
          magicornswapFactory.address
        )
      ).to.be.revertedWith('MagicornSwapRelayer: DEADLINE_REACHED')
    })

    it('provides initial liquidity immediately with ERC20/ERC20 pair', async () => {
      await expect(
        magicornRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          0,
          0,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      )
        .to.emit(magicornRelayer, 'NewOrder')
        .withArgs(0, 1)
        .to.emit(magicornswapPair, 'Transfer')
        .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
        .to.emit(magicornswapPair, 'Transfer')
        .withArgs(AddressZero, magicornRelayer.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(magicornswapPair, 'Sync')
        .withArgs(defaultAmountA, defaultAmountB)
        .to.emit(magicornswapPair, 'Mint')
        .withArgs(magicornswapRouter.address, defaultAmountA, defaultAmountB)
        .to.emit(magicornRelayer, 'ExecutedOrder')
        .withArgs(0)

      expect(await magicornswapPair.balanceOf(magicornRelayer.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    })

    it('provides initial liquidity with ERC20/ERC20 pair after Uniswap price observation', async () => {
      await token0.transfer(uniPair.address, expandTo18Decimals(10))
      await token1.transfer(uniPair.address, expandTo18Decimals(40))
      await uniPair.mint(wallet.address, overrides)

      await mineBlock(provider, startTime + 10)
      await expect(
        magicornRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(magicornRelayer, 'NewOrder')
        .withArgs(0, 1)

      await magicornRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await magicornRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)
      await expect(magicornRelayer.executeOrder(0))
        .to.emit(magicornRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(magicornswapPair, 'Transfer')
        .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
        .to.emit(magicornswapPair, 'Transfer')
        .withArgs(AddressZero, magicornRelayer.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(magicornswapPair, 'Sync')
        .withArgs(defaultAmountA, defaultAmountB)
        .to.emit(magicornswapPair, 'Mint')
        .withArgs(magicornswapRouter.address, defaultAmountA, defaultAmountB)

      expect(await magicornswapPair.balanceOf(magicornRelayer.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    })

    it('provides initial liquidity immediately with ETH/ERC20 pair', async () => {
      await expect(
        magicornRelayer.orderLiquidityProvision(
          AddressZero,
          wethPartner.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          0,
          0,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address,
          { ...overrides, value: defaultAmountA }
        )
      )
        .to.emit(magicornRelayer, 'NewOrder')
        .withArgs(0, 1)
        .to.emit(wethPair, 'Transfer')
        .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
        .to.emit(wethPair, 'Transfer')
        .withArgs(AddressZero, magicornRelayer.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(wethPair, 'Sync')
        .withArgs(defaultAmountB, defaultAmountA)
        .to.emit(wethPair, 'Mint')
        .withArgs(magicornswapRouter.address, defaultAmountB, defaultAmountA)
        .to.emit(magicornRelayer, 'ExecutedOrder')
        .withArgs(0)

      expect(await wethPair.balanceOf(magicornRelayer.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    })

    it('provides liquidity with ERC20/ERC20 pair after price observation', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      await mineBlock(provider, startTime + 10)
      await expect(
        magicornRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      )
        .to.emit(magicornRelayer, 'NewOrder')
        .withArgs(0, 1)

      await magicornRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await magicornRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)
      await expect(magicornRelayer.executeOrder(0))
        .to.emit(magicornswapPair, 'Transfer')
        .withArgs(AddressZero, magicornRelayer.address, expectedLiquidity)
        .to.emit(magicornswapPair, 'Sync')
        .withArgs(defaultAmountA.add(expandTo18Decimals(10)), defaultAmountB.add(expandTo18Decimals(40)))
        .to.emit(magicornswapPair, 'Mint')
        .withArgs(magicornswapRouter.address, defaultAmountA, defaultAmountB)
        .to.emit(magicornRelayer, 'ExecutedOrder')
        .withArgs(0)

      expect(await magicornswapPair.balanceOf(magicornRelayer.address)).to.eq(expandTo18Decimals(22).sub(MINIMUM_LIQUIDITY))
    })

    it('provides liquidity with ETH/ERC20 pair after price observation', async () => {
      await weth.deposit({ ...overrides, value: expandTo18Decimals(10) })
      await weth.transfer(wethPair.address, expandTo18Decimals(10))
      await wethPartner.transfer(wethPair.address, expandTo18Decimals(40))
      await wethPair.mint(wallet.address)
      const liquidityBalance = await wethPair.balanceOf(magicornRelayer.address)

      await expect(
        magicornRelayer.orderLiquidityProvision(
          AddressZero,
          wethPartner.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address,
          { ...overrides, value: defaultAmountA }
        )
      )
        .to.emit(magicornRelayer, 'NewOrder')
        .withArgs(0, 1)

      await mineBlock(provider, startTime + 10)
      await magicornRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await magicornRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)
      await expect(magicornRelayer.executeOrder(0))
        .to.emit(magicornRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(wethPair, 'Transfer')
        .withArgs(AddressZero, magicornRelayer.address, expectedLiquidity)
        .to.emit(wethPair, 'Sync')
        .withArgs(defaultAmountB.add(expandTo18Decimals(40)), defaultAmountA.add(expandTo18Decimals(10)))
        .to.emit(wethPair, 'Mint')
        .withArgs(magicornswapRouter.address, defaultAmountB, defaultAmountA)

      expect(await wethPair.balanceOf(magicornRelayer.address)).to.eq(expectedLiquidity.add(liquidityBalance))
    })

    it('withdraws an order after expiration', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      const startBalance0 = await token0.balanceOf(owner)
      const startBalance1 = await token1.balanceOf(owner)

      await expect(
        magicornRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          0,
          0,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      )
        .to.emit(magicornRelayer, 'NewOrder')
        .withArgs(0, 1)

      await mineBlock(provider, startTime + 10)
      await magicornRelayer.updateOracle(0)
      await expect(magicornRelayer.withdrawExpiredOrder(0)).to.be.revertedWith('MagicornSwapRelayer: DEADLINE_NOT_REACHED')
      await mineBlock(provider, defaultDeadline + 500)
      await magicornRelayer.withdrawExpiredOrder(0)
      expect(await token0.balanceOf(owner)).to.eq(startBalance0.add(defaultAmountA))
      expect(await token1.balanceOf(owner)).to.eq(startBalance1.add(defaultAmountB))
    })
  })

  describe('Liquidity removal', () => {
    it('requires correct order input', async () => {
      const liquidityAmount = expandTo18Decimals(1)

      await expect(
        magicornRelayer.orderLiquidityRemoval(
          token0.address,
          token1.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          token0.address
        )
      ).to.be.revertedWith('MagicornSwapRelayer: INVALID_FACTORY')

      const magicornRelayerFromWallet2 = magicornRelayer.connect(wallet2)
      await expect(
        magicornRelayerFromWallet2.orderLiquidityRemoval(
          token0.address,
          token1.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      ).to.be.revertedWith('MagicornSwapRelayer: CALLER_NOT_OWNER')

      await expect(
        magicornRelayer.orderLiquidityRemoval(
          token1.address,
          token1.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      ).to.be.revertedWith('MagicornSwapRelayer: INVALID_PAIR')

      await expect(
        magicornRelayer.orderLiquidityRemoval(
          token1.address,
          token0.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      ).to.be.revertedWith('MagicornSwapRelayer: INVALID_TOKEN_ORDER')

      await expect(
        magicornRelayer.orderLiquidityRemoval(
          token0.address,
          token1.address,
          liquidityAmount,
          0,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      ).to.be.revertedWith('MagicornSwapRelayer: INVALID_LIQUIDITY_AMOUNT')

      await expect(
        magicornRelayer.orderLiquidityRemoval(
          token0.address,
          token1.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          1000000000,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      ).to.be.revertedWith('MagicornSwapRelayer: INVALID_TOLERANCE')

      await expect(
        magicornRelayer.orderLiquidityRemoval(
          token0.address,
          token1.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          startTime - 1200,
          magicornswapFactory.address
        )
      ).to.be.revertedWith('MagicornSwapRelayer: DEADLINE_REACHED')
    })

    it('removes liquidity with ERC20/ERC20 pair after price observation', async () => {
      await addLiquidity(expandTo18Decimals(2), expandTo18Decimals(8))
      await mineBlock(provider, startTime + 20)
      await expect(
        magicornRelayer.orderLiquidityRemoval(
          token0.address,
          token1.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          10,
          10,
          0,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      )
        .to.emit(magicornRelayer, 'NewOrder')
        .withArgs(0, 2)

      await magicornRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await magicornRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)
      await expect(await magicornswapPair.balanceOf(magicornRelayer.address)).to.eq(expandTo18Decimals(4).sub(MINIMUM_LIQUIDITY))

      await expect(magicornRelayer.executeOrder(0))
        .to.emit(magicornRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(magicornswapPair, 'Transfer')
        .withArgs(magicornRelayer.address, magicornswapPair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(magicornswapPair, 'Transfer')
        .withArgs(magicornswapPair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(token0, 'Transfer')
        .withArgs(magicornswapPair.address, magicornRelayer.address, expandTo18Decimals(1).sub(500))
        .to.emit(token1, 'Transfer')
        .withArgs(magicornswapPair.address, magicornRelayer.address, expandTo18Decimals(4).sub(2000))
        .to.emit(magicornswapPair, 'Sync')
        .withArgs(expandTo18Decimals(1).add(500), expandTo18Decimals(4).add(2000))
        .to.emit(magicornswapPair, 'Burn')
        .withArgs(
          magicornswapRouter.address,
          expandTo18Decimals(1).sub(500),
          expandTo18Decimals(4).sub(2000),
          magicornRelayer.address
        )

      await expect(await magicornswapPair.balanceOf(magicornRelayer.address)).to.eq(expandTo18Decimals(2))
    })

    it('removes liquidity with ETH/ERC20 pair after price observation', async () => {
      await weth.deposit({ ...overrides, value: expandTo18Decimals(10) })
      await weth.transfer(wethPair.address, expandTo18Decimals(10))
      await wethPartner.transfer(wethPair.address, expandTo18Decimals(40))
      await wethPair.mint(magicornRelayer.address)
      await mineBlock(provider, startTime + 100)

      await expect(
        magicornRelayer.orderLiquidityRemoval(
          AddressZero,
          wethPartner.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          10,
          10,
          0,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      )
        .to.emit(magicornRelayer, 'NewOrder')
        .withArgs(0, 2)

      await magicornRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await magicornRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)

      expect(await wethPair.balanceOf(magicornRelayer.address)).to.eq(expandTo18Decimals(20).sub(1000))
      await expect(magicornRelayer.executeOrder(0))
        .to.emit(magicornRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(wethPair, 'Transfer')
        .withArgs(magicornRelayer.address, wethPair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(wethPair, 'Transfer')
        .withArgs(wethPair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(wethPartner, 'Transfer')
        .withArgs(wethPair.address, magicornRelayer.address, expandTo18Decimals(4).sub(2000))
        .to.emit(weth, 'Transfer')
        .withArgs(wethPair.address, magicornRelayer.address, expandTo18Decimals(1).sub(500))
        .to.emit(wethPair, 'Sync')
        .withArgs(expandTo18Decimals(36).add(2000), expandTo18Decimals(9).add(500))
        .to.emit(wethPair, 'Burn')
        .withArgs(
          magicornswapRouter.address,
          expandTo18Decimals(4).sub(2000),
          expandTo18Decimals(1).sub(500),
          magicornRelayer.address
        )

      expect(await wethPair.balanceOf(magicornRelayer.address)).to.eq(expandTo18Decimals(18))
    })
  })

  describe('Oracle price calulation', () => {
    it('reverts oracle update if minReserve is not reached', async () => {
      await expect(
        magicornRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      )
        .to.emit(magicornRelayer, 'NewOrder')
        .withArgs(0, 1)

      await expect(magicornRelayer.updateOracle(0)).to.be.revertedWith('MagicornSwapRelayer: RESERVE_TO_LOW')
    })

    it('updates price oracle', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      await expect(
        magicornRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      )
        .to.emit(magicornRelayer, 'NewOrder')
        .withArgs(0, 1)

      await magicornRelayer.updateOracle(0)
      await expect(magicornRelayer.updateOracle(0)).to.be.revertedWith('OracleCreator: PERIOD_NOT_ELAPSED')
      await mineBlock(provider, startTime + 350)
      await magicornRelayer.updateOracle(0)
    })

    it('consumes 168339 to update the price oracle', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      await mineBlock(provider, startTime + 10)
      await expect(
        magicornRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          magicornswapFactory.address
        )
      )
        .to.emit(magicornRelayer, 'NewOrder')
        .withArgs(0, 1)

      let tx = await magicornRelayer.updateOracle(0)
      let receipt = await provider.getTransactionReceipt(tx.hash)
      expect(receipt.gasUsed).to.eq(bigNumberify('168339'))
    })

    it('provides the liquidity with the correct price based on uniswap price', async () => {
      let timestamp = startTime

      /* MagicornSwap price of 1:4 */
      await token0.transfer(magicornswapPair.address, expandTo18Decimals(100))
      await token1.transfer(magicornswapPair.address, expandTo18Decimals(400))
      await magicornswapPair.mint(wallet.address, overrides)
      await mineBlock(provider, (timestamp += 100))

      /* Uniswap starting price of 1:2 */
      await token0.transfer(uniPair.address, expandTo18Decimals(100))
      await token1.transfer(uniPair.address, expandTo18Decimals(200))
      await uniPair.mint(wallet.address, overrides)
      await mineBlock(provider, (timestamp += 100))

      await expect(
        magicornRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(magicornRelayer, 'NewOrder')
        .withArgs(0, 1)

      await magicornRelayer.updateOracle(0)
      await mineBlock(provider, (timestamp += 30))

      // Uniswap move price ratio to 1:5
      await token0.transfer(uniPair.address, expandTo18Decimals(200))
      await token1.transfer(uniPair.address, expandTo18Decimals(1300))
      await uniPair.mint(wallet.address, overrides)
      await mineBlock(provider, (timestamp += 150))
      await magicornRelayer.updateOracle(0)

      // Uniswap price should be more then four
      expect(await oracleCreator.consult(0, token0.address, 100)).to.eq(451)

      await expect(magicornRelayer.executeOrder(0))
        .to.emit(magicornRelayer, 'ExecutedOrder')
        .withArgs(0)

      expect(await magicornswapPair.balanceOf(magicornRelayer.address)).to.eq(bigNumberify('1988826815642458100'))
    }).retries(3)

    it('should let the owner transfer ownership', async () => {
      const oldOwner = await magicornRelayer.owner()
      const newOwner = token0.address
      await expect(magicornRelayer.transferOwnership(newOwner))
        .to.emit(magicornRelayer, 'OwnershipTransferred')
        .withArgs(oldOwner, newOwner)
      expect(await magicornRelayer.owner()).to.be.equal(newOwner)
    })
  })
})
