import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  parseAbiParameters,
  parseEventLogs,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import {
  ADDR,
  erc20TransferAbi,
  FIXTURE_BTC_ATOMS,
  FIXTURE_USDC_ATOMS_PER_BTC,
  NATIVE_PER_USDC_ATOM,
  POOL_ID,
  POOL_KEY,
  TICK_LOWER,
  TICK_UPPER,
  artifact,
  balances,
  erc20Abi,
  fmt,
  getRecord,
  loadState,
  permit2Abi,
  posmAbi,
  publicAddress,
  runStep,
  setRecord,
  stateViewAbi,
  type PublicClient,
} from './common'

const SEED_MATH_ADDR: Address = '0x0000000000000000000000000000000000005eed'
const SEED_USDC_ATOMS = 10_000_000n // 10 USDC
const SEED_BTC_ATOMS_CAP = 10_000n // 0.0001 cirBTC
const DEPLOYER_USDC_RESERVE_WEI = 2n * 10n ** 18n // keep at least 2 USDC for later vault/reserve funding

// ------------------------------------------------------------------ read-only helpers

export async function seedMath<T>(pc: PublicClient, fn: string, args: readonly unknown[]): Promise<T> {
  const a = artifact('SeedMath')
  const data = encodeFunctionData({ abi: a.abi, functionName: fn, args })
  const res = await pc.call({ to: SEED_MATH_ADDR, data, stateOverride: [{ address: SEED_MATH_ADDR, code: a.deployedBytecode.object }] })
  if (!res.data) throw new Error('SeedMath returned no data')
  return decodeFunctionResult({ abi: a.abi, functionName: fn, data: res.data }) as T
}

export async function poolState(pc: PublicClient) {
  const [slot0, liquidity] = await Promise.all([
    pc.readContract({ address: ADDR.stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [POOL_ID] }),
    pc.readContract({ address: ADDR.stateView, abi: stateViewAbi, functionName: 'getLiquidity', args: [POOL_ID] }),
  ])
  return { sqrtPriceX96: slot0[0], tick: slot0[1], protocolFee: slot0[2], lpFee: slot0[3], liquidity }
}

/** Identity and wiring checks. Throws before anything is signed if the deployment is not what we expect. */
export async function preflight(pc: PublicClient) {
  for (const [name, address] of Object.entries(ADDR)) {
    const code = await pc.getCode({ address: address })
    if (!code || code === '0x') throw new Error(`No code at ${name} ${address}`)
  }
  for (const [name, address, abi] of [
    ['positionManager', ADDR.positionManager, posmAbi],
    ['stateView', ADDR.stateView, stateViewAbi],
  ] as const) {
    const pm = await pc.readContract({ address, abi, functionName: 'poolManager' })
    if ((pm as string).toLowerCase() !== ADDR.poolManager.toLowerCase()) throw new Error(`${name}.poolManager() mismatch`)
  }
}

// ------------------------------------------------------------------ seeding

interface PositionRecord {
  tokenId: string
  liquidity: string
  tickLower: number
  tickUpper: number
  deposited0Atoms: string
  deposited1Atoms: string
  mintTx: Hex
  owner: Address
}

export async function seedPool(pc: PublicClient, dryRun = false): Promise<PositionRecord | undefined> {
  await preflight(pc)
  const deployer = publicAddress('deployer')

  const done = getRecord<PositionRecord>('position')
  if (done) {
    const owner = await pc.readContract({ address: ADDR.positionManager, abi: posmAbi, functionName: 'ownerOf', args: [BigInt(done.tokenId)] })
    if (owner.toLowerCase() !== done.owner.toLowerCase()) throw new Error('recorded position NFT has a different owner now')
    console.log('seed: already done, position', done.tokenId)
    return done
  }

  // Fixture price from atoms (token1 atoms / token0 atoms), computed by the pinned Uniswap math.
  const fixtureUsdcAtoms = FIXTURE_USDC_ATOMS_PER_BTC
  const sqrtFixture = await seedMath<bigint>(pc, 'sqrtPriceFromAtoms', [fixtureUsdcAtoms, FIXTURE_BTC_ATOMS])
  const pool = await poolState(pc)

  const mintedByUs = loadState().steps['pool.initialize']?.status === 'success'
  if (pool.sqrtPriceX96 !== 0n) {
    const diff = pool.sqrtPriceX96 > sqrtFixture ? pool.sqrtPriceX96 - sqrtFixture : sqrtFixture - pool.sqrtPriceX96
    const withinOnePercent = diff * 100n <= sqrtFixture
    if (!withinOnePercent) {
      throw new Error(`STOP: pool is initialized at an inconsistent price (sqrt ${pool.sqrtPriceX96}, fixture ${sqrtFixture}). Not touching it.`)
    }
    if (pool.liquidity !== 0n && !mintedByUs) {
      throw new Error(`STOP: pool already holds liquidity (${pool.liquidity}) that this script did not seed. Not adding to it.`)
    }
  }

  const before = await balances(pc, deployer)
  const a0 = SEED_USDC_ATOMS
  const a1 = before.cirBtc < SEED_BTC_ATOMS_CAP ? before.cirBtc : SEED_BTC_ATOMS_CAP
  if (before.usdc < a0) throw new Error('deployer USDC below the seed amount')
  const startSqrt = pool.sqrtPriceX96 !== 0n ? pool.sqrtPriceX96 : sqrtFixture
  const [liquidity, need0, need1] = await seedMath<readonly [bigint, bigint, bigint]>(pc, 'seedQuote', [
    startSqrt,
    TICK_LOWER,
    TICK_UPPER,
    a0,
    a1,
  ])
  if (liquidity === 0n || need0 > a0 || need1 > a1) throw new Error(`seed math out of bounds: L=${liquidity} need0=${need0} need1=${need1}`)
  console.log('seed plan', { liquidity: liquidity.toString(), need0: need0.toString(), need1: need1.toString(), maxUsdc: a0.toString(), maxCirBtc: a1.toString() })

  if (dryRun) {
    console.log('dry run: nothing sent')
    return undefined
  }
  const seedWei = a0 * NATIVE_PER_USDC_ATOM
  const reserve = seedWei + DEPLOYER_USDC_RESERVE_WEI // every pre-mint step must leave the seed and the 2 USDC reserve

  // Exact-amount approvals: token -> Permit2, then Permit2 -> PositionManager (expires in one hour).
  for (const [token, name, amount] of [
    [ADDR.usdc, 'usdc', a0],
    [ADDR.cirBtc, 'cirBtc', a1],
  ] as const) {
    const allowance = await pc.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [deployer, ADDR.permit2] })
    if (allowance < amount) {
      await runStep(pc, {
        step: `seed.approve.${name}.permit2`,
        label: `deployer approves Permit2 for exactly ${amount} ${name} atoms`,
        role: 'deployer',
        to: token,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ADDR.permit2, amount] }),
        reserveWei: reserve,
      })
    }
    const p2 = await pc.readContract({ address: ADDR.permit2, abi: permit2Abi, functionName: 'allowance', args: [deployer, token, ADDR.positionManager] })
    const now = BigInt(Math.floor(Date.now() / 1000))
    if (p2[0] < amount || BigInt(p2[1]) <= now + 600n) {
      await runStep(pc, {
        step: `seed.approve.${name}.positionManager`,
        label: `deployer lets PositionManager pull exactly ${amount} ${name} atoms through Permit2`,
        role: 'deployer',
        to: ADDR.permit2,
        data: encodeFunctionData({ abi: permit2Abi, functionName: 'approve', args: [token, ADDR.positionManager, amount, Number(now + 3600n)] }),
        reserveWei: reserve,
      })
    }
  }

  if (pool.sqrtPriceX96 === 0n) {
    await runStep(pc, {
      step: 'pool.initialize',
      label: 'PositionManager.initializePool at the 100,000 USDC per cirBTC fixture',
      role: 'deployer',
      to: ADDR.positionManager,
      data: encodeFunctionData({ abi: posmAbi, functionName: 'initializePool', args: [POOL_KEY, sqrtFixture] }),
      reserveWei: reserve,
    })
  }

  const actions: Hex = '0x020d' // MINT_POSITION, SETTLE_PAIR
  const mint = encodeAbiParameters(
    parseAbiParameters(
      '(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, int24 tickLower, int24 tickUpper, uint256 liquidity, uint128 amount0Max, uint128 amount1Max, address owner, bytes hookData',
    ),
    [POOL_KEY, TICK_LOWER, TICK_UPPER, liquidity, a0, a1, deployer, '0x'],
  )
  const settle = encodeAbiParameters(parseAbiParameters('address currency0, address currency1'), [ADDR.usdc, ADDR.cirBtc])
  const unlockData = encodeAbiParameters(parseAbiParameters('bytes actions, bytes[] params'), [actions, [mint, settle]])
  const latest = await pc.getBlock()
  const deadline = latest.timestamp + 300n
  const mintStep = await runStep(pc, {
    step: 'seed.mint',
    label: 'PositionManager.modifyLiquidities MINT_POSITION + SETTLE_PAIR (full range)',
    role: 'deployer',
    to: ADDR.positionManager,
    data: encodeFunctionData({ abi: posmAbi, functionName: 'modifyLiquidities', args: [unlockData, deadline] }),
    valueSpendWei: seedWei,
    reserveWei: DEPLOYER_USDC_RESERVE_WEI,
  })

  const receipt = await pc.getTransactionReceipt({ hash: mintStep.txHash })
  const transfers = parseEventLogs({ abi: posmAbi, logs: receipt.logs, eventName: 'Transfer' }).filter(
    (l) => l.address.toLowerCase() === ADDR.positionManager.toLowerCase() && l.args.from === zeroAddress,
  )
  const minted = transfers[0]
  if (transfers.length !== 1 || !minted) throw new Error('expected exactly one position NFT mint in the receipt')
  const tokenId = minted.args.id
  const posLiquidity = await pc.readContract({ address: ADDR.positionManager, abi: posmAbi, functionName: 'getPositionLiquidity', args: [tokenId] })
  const after = await balances(pc, deployer)
  // Amounts the PoolManager actually received in the mint transaction (ERC-20 Transfer logs), not balance differences,
  // because the deployer's native USDC balance also pays gas.
  const received = (token: Address) =>
    parseEventLogs({ abi: erc20TransferAbi, logs: receipt.logs, eventName: 'Transfer' })
      .filter((l) => l.address.toLowerCase() === token.toLowerCase() && l.args.to.toLowerCase() === ADDR.poolManager.toLowerCase())
      .reduce((acc, l) => acc + l.args.value, 0n)
  const deposited0 = received(ADDR.usdc)
  const deposited1 = received(ADDR.cirBtc)
  if (deposited0 !== need0 || deposited1 !== need1) throw new Error(`deposited ${deposited0}/${deposited1} differs from planned ${need0}/${need1}`)
  const record: PositionRecord = {
    tokenId: tokenId.toString(),
    liquidity: posLiquidity.toString(),
    tickLower: TICK_LOWER,
    tickUpper: TICK_UPPER,
    deposited0Atoms: deposited0.toString(),
    deposited1Atoms: deposited1.toString(),
    mintTx: mintStep.txHash,
    owner: minted.args.to,
  }
  if (posLiquidity !== liquidity) throw new Error(`minted liquidity ${posLiquidity} differs from planned ${liquidity}`)
  setRecord('position', record)
  setRecord('seed.balances', { beforeDeployer: fmt(before), afterDeployer: fmt(after) })
  console.log('seed: done', record)
  return record
}

// ------------------------------------------------------------------ smoke venue

export async function deployAndBindVenue(pc: PublicClient): Promise<Address> {
  const deployer = publicAddress('deployer')
  const trader = publicAddress('trader')
  const art = artifact('V4SpotVenue')
  const deployData = encodeDeployData({
    abi: art.abi,
    bytecode: art.bytecode.object,
    args: [ADDR.poolManager, ADDR.usdc, ADDR.cirBtc, POOL_KEY.fee, POOL_KEY.tickSpacing, deployer],
  })
  const reserve = DEPLOYER_USDC_RESERVE_WEI
  const dep = await runStep(pc, {
    step: 'venue.deploy',
    label: 'deploy SMOKE-ONLY V4SpotVenue (deployer = binder)',
    role: 'deployer',
    data: deployData,
    reserveWei: reserve,
  })
  const venue = dep.contractAddress
  if (!venue) throw new Error('no contract address in deployment receipt')

  const code = await pc.getCode({ address: venue })
  const expectedLen = (art.deployedBytecode.object.length - 2) / 2
  if (!code || (code.length - 2) / 2 !== expectedLen) throw new Error('deployed runtime length differs from the artifact')
  const read = <T>(fn: string) => pc.readContract({ address: venue, abi: art.abi, functionName: fn }) as Promise<T>
  const [pm, usdc, btc, fee, spacing, binder] = await Promise.all([
    read<Address>('poolManager'),
    read<Address>('usdc'),
    read<Address>('cirBtc'),
    read<number>('fee'),
    read<number>('tickSpacing'),
    read<Address>('deployer'),
  ])
  if (pm.toLowerCase() !== ADDR.poolManager.toLowerCase() || usdc.toLowerCase() !== ADDR.usdc.toLowerCase() || btc.toLowerCase() !== ADDR.cirBtc.toLowerCase() || fee !== 3000 || spacing !== 60 || binder.toLowerCase() !== deployer.toLowerCase()) {
    throw new Error('deployed venue immutables do not match the intended pool')
  }

  const engineNow = await read<Address>('engine')
  if (engineNow === zeroAddress) {
    await runStep(pc, {
      step: 'venue.bindEngine',
      label: 'bind SMOKE venue engine to the trader wallet (one shot)',
      role: 'deployer',
      to: venue,
      data: encodeFunctionData({ abi: art.abi, functionName: 'bindEngine', args: [trader] }),
      reserveWei: reserve,
    })
  }
  const engine = await read<Address>('engine')
  if (engine.toLowerCase() !== trader.toLowerCase()) throw new Error('venue engine is not the trader wallet')
  setRecord('venue', { address: venue, smokeOnly: true, engine, poolManager: pm, fee, tickSpacing: spacing, binder })
  return venue
}
