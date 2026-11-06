import { encodeFunctionData, parseEventLogs, type Address, type Hex } from 'viem'
import {
  ADDR,
  FIXTURE_BTC_ATOMS,
  FIXTURE_USDC_ATOMS_PER_BTC,
  NATIVE_PER_USDC_ATOM,
  POOL_KEY,
  artifact,
  balances,
  erc20Abi,
  fmt,
  getRecord,
  loadState,
  publicAddress,
  quoterAbi,
  runStep,
  setRecord,
  type Balances,
  type PublicClient,
} from './common'

const BUY_USDC_ATOMS = 200_000n // 0.20 USDC gross buy
const FRICTION_BPS = 300n
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b

async function quote(pc: PublicClient, zeroForOne: boolean, amountIn: bigint): Promise<bigint> {
  const { result } = await pc.simulateContract({
    address: ADDR.quoter,
    abi: quoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [{ poolKey: POOL_KEY, zeroForOne, exactAmount: amountIn, hookData: '0x' }],
  })
  return result[0]
}

interface LegResult {
  quoteOut: string
  fixtureOut: string
  floor: string
  minOut: string
  actualOut: string
  swappedEventOut: string
  txHash: Hex
}

async function swapLeg(pc: PublicClient, venue: Address, buy: boolean, amountIn: bigint): Promise<LegResult> {
  const trader = publicAddress('trader')
  const art = artifact('V4SpotVenue')
  const key = buy ? 'buy' : 'sell'
  const done = getRecord<LegResult>(`trade.${key}`)
  if (done) return done

  interface Plan {
    quoteOut: string
    fixtureOut: string
    floor: string
    minOut: string
  }
  // The plan is recorded before anything is sent so a resumed run reports the original quote, not a post-trade one.
  let plan = getRecord<Plan>(`trade.${key}.plan`)
  if (!plan) {
    const quoteOut = await quote(pc, buy, amountIn)
    // Independent fixture value of the input (100,000 USDC per cirBTC), less the 300 bps total budget.
    const fixtureOut = buy
      ? (amountIn * FIXTURE_BTC_ATOMS) / FIXTURE_USDC_ATOMS_PER_BTC
      : (amountIn * FIXTURE_USDC_ATOMS_PER_BTC) / FIXTURE_BTC_ATOMS
    const floor = ceilDiv(fixtureOut * (10_000n - FRICTION_BPS), 10_000n)
    if (quoteOut < floor) throw new Error(`STOP: ${key} quote ${quoteOut} is below the fixture floor ${floor}; friction exceeds 300 bps. Nothing sent.`)
    const minOut = quoteOut > floor ? quoteOut : floor // the stricter of the two
    plan = { quoteOut: quoteOut.toString(), fixtureOut: fixtureOut.toString(), floor: floor.toString(), minOut: minOut.toString() }
    setRecord(`trade.${key}.plan`, plan)
  }
  console.log(key, { amountIn: amountIn.toString(), ...plan })
  const minOut = BigInt(plan.minOut)

  const token = buy ? ADDR.usdc : ADDR.cirBtc
  const allowance = await pc.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [trader, venue] })
  if (allowance < amountIn && loadState().steps[`trade.${key}`]?.status !== 'success') {
    await runStep(pc, {
      step: `trade.approve.${key}`,
      label: `trader approves the smoke venue for exactly ${amountIn} ${buy ? 'USDC' : 'cirBTC'} atoms`,
      role: 'trader',
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [venue, amountIn] }),
    })
  }
  const deadline = (await pc.getBlock()).timestamp + 120n
  const step = await runStep(pc, {
    step: `trade.${key}`,
    label: `smoke venue ${buy ? 'buyCirBtc' : 'sellCirBtc'} exact input ${amountIn}`,
    role: 'trader',
    to: venue,
    data: encodeFunctionData({ abi: art.abi, functionName: buy ? 'buyCirBtc' : 'sellCirBtc', args: [amountIn, minOut, deadline] }),
  })
  const receipt = await pc.getTransactionReceipt({ hash: step.txHash })
  const ev = parseEventLogs({ abi: art.abi, logs: receipt.logs, eventName: 'Swapped' }).filter((l) => l.address.toLowerCase() === venue.toLowerCase())
  if (ev.length !== 1) throw new Error('expected exactly one Swapped event')
  const swappedOut = (ev[0]?.args as { amountOut: bigint }).amountOut
  // Balances at exact blocks around the swap transaction.
  const before = await balances(pc, trader, receipt.blockNumber - 1n)
  const after = await balances(pc, trader, receipt.blockNumber)
  // USDC is the gas token, so the trader's USDC balance also moves by the transaction's gas. Verify the USDC leg on the
  // native (18-decimal) balance with gas added back; verify the cirBTC leg directly.
  const gasWei = BigInt(step.gasCostWei ?? '0')
  const gained = buy ? after.cirBtc - before.cirBtc : swappedOut
  if (buy) {
    if (gained !== swappedOut) throw new Error(`cirBTC gain ${gained} differs from the event ${swappedOut}`)
    const usdcPaidWei = before.nativeWei - after.nativeWei - gasWei
    if (usdcPaidWei !== amountIn * NATIVE_PER_USDC_ATOM) throw new Error(`native USDC paid ${usdcPaidWei} differs from the exact input`)
  } else {
    const spent = before.cirBtc - after.cirBtc
    if (spent !== amountIn) throw new Error(`cirBTC spent ${spent} differs from the exact input ${amountIn}`)
    const usdcGainWei = after.nativeWei - before.nativeWei + gasWei
    if (usdcGainWei !== swappedOut * NATIVE_PER_USDC_ATOM) throw new Error(`native USDC gained ${usdcGainWei} differs from the event ${swappedOut}`)
  }
  if (swappedOut < minOut) throw new Error('output below minOut (should have reverted)')
  const quoteOut = BigInt(plan.quoteOut)
  const fixtureOut = BigInt(plan.fixtureOut)
  const floor = BigInt(plan.floor)
  const result: LegResult = {
    quoteOut: quoteOut.toString(),
    fixtureOut: fixtureOut.toString(),
    floor: floor.toString(),
    minOut: minOut.toString(),
    actualOut: gained.toString(),
    swappedEventOut: swappedOut.toString(),
    txHash: step.txHash,
  }
  setRecord(`trade.${key}`, result)
  return result
}

export async function runTrade(pc: PublicClient): Promise<void> {
  const trader = publicAddress('trader')
  const venue = getRecord<{ address: Address }>('venue')?.address
  if (!venue) throw new Error('smoke venue not deployed yet: run "venue" first')
  if (getRecord('trade.complete')) {
    console.log('trade: already complete')
    return
  }
  if (!getRecord('trade.before')) {
    setRecord('trade.before', { trader: fmt(await balances(pc, trader)), venue: fmt(await balances(pc, venue)), poolManager: fmt(await balances(pc, ADDR.poolManager)) })
  }
  const buy = await swapLeg(pc, venue, true, BUY_USDC_ATOMS)
  const sell = await swapLeg(pc, venue, false, BigInt(buy.actualOut))

  const afterTrader: Balances = await balances(pc, trader)
  const before = getRecord<{ trader: ReturnType<typeof fmt> }>('trade.before')
  if (!before) throw new Error('missing trade.before')
  const steps = loadState().steps
  const tradeSteps = ['trade.approve.buy', 'trade.buy', 'trade.approve.sell', 'trade.sell']
  const gasWei = tradeSteps.reduce((acc, s) => acc + BigInt(steps[s]?.gasCostWei ?? '0'), 0n)
  const usdcNetAtoms = BigInt(sell.actualOut) - BUY_USDC_ATOMS // negative: round-trip cost in USDC atoms
  const nativeDelta = afterTrader.nativeWei - BigInt(before.trader.nativeWei)
  const expectedNative = usdcNetAtoms * 1_000_000_000_000n - gasWei
  const venueAfter = await balances(pc, venue)
  const result = {
    buy,
    sell,
    traderAfter: fmt(afterTrader),
    venueAfter: fmt(venueAfter),
    roundTripUsdcNetAtoms: usdcNetAtoms.toString(),
    tradeGasWei: gasWei.toString(),
    nativeDeltaWei: nativeDelta.toString(),
    expectedNativeDeltaWei: expectedNative.toString(),
    nativeAccountingExact: nativeDelta === expectedNative,
    traderCirBtcUnchanged: afterTrader.cirBtc === BigInt((before.trader as { cirBtcAtoms: string }).cirBtcAtoms),
    venueHoldsNothing: venueAfter.usdc === 0n && venueAfter.cirBtc === 0n,
  }
  if (!result.nativeAccountingExact || !result.venueHoldsNothing || !result.traderCirBtcUnchanged) throw new Error('accounting mismatch: ' + JSON.stringify(result))
  setRecord('trade.complete', result)
  console.log('trade: complete', result)
}
