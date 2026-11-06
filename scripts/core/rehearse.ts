/** Live rehearsal flows on Arc Testnet: flow 1 (open, repay, release), flow 2 (open, move, rebalance), FIFO claim. */
import type { Address, Hex } from 'viem'

import { ADDR, publicAddress } from '../smoke/common'
import { chainClient, getCoreRecord, loadCore, runTx, setCoreRecord } from './journal'
import {
  ART,
  SMOKE_VENUE,
  addrs,
  chainNow,
  data,
  engineEventsOf,
  erc20ApproveData,
  head,
  jsonLine,
  jsonSafe,
  param,
  pool,
  quoteBuy,
  quoteSell,
  rd,
  snap,
} from './lib'

const E = 100_000n
const DEBT = 100_383n // 100,000 principal + 383 markup
const REF = 100_000n * 1_000_000n

type Obj = Record<string, unknown>
const vs = (vault: Address, block?: bigint) => rd<Obj>(vault, ART.vault.abi, 'vaultState', [], block)

async function world(block: bigint): Promise<Obj> {
  const a = addrs()
  const out: Obj = {}
  for (const [k, who] of [['deployer', publicAddress('deployer')], ['trader', publicAddress('trader')], ['keeper', publicAddress('keeper')], ['engine', a.engine], ['vault', a.vault], ['venue', a.venue], ['smokeVenue', SMOKE_VENUE]] as Array<[string, Address]>) {
    out[k] = await snap(who, block)
  }
  out.vaultState = await vs(a.vault, block)
  return out
}

async function once<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const have = getCoreRecord<T>(key)
  if (have !== undefined) return have
  const v = await compute()
  setCoreRecord(key, jsonSafe(v))
  return v
}

async function openPosition(tag: string, minReferenceBps: number): Promise<{ id: bigint; txHash: Hex; block: bigint; atoms: bigint }> {
  const a = addrs()
  const done = getCoreRecord<{ id: string; txHash: Hex; block: string; position: Obj }>(tag + '.opened')
  if (done) {
    // resumed after the open was recorded: the journal must show it confirmed, and the chain must agree
    const st = loadCore().steps[tag + '.open']
    const receipt = await chainClient().getTransactionReceipt({ hash: done.txHash })
    if (st?.phase !== 'confirmed' || receipt.status !== 'success') throw new Error(tag + ': recorded open is not confirmed on chain')
    return { id: BigInt(done.id), txHash: done.txHash, block: BigInt(done.block), atoms: BigInt(String(done.position.collateral)) }
  }
  const termsHash = await rd<Hex>(a.engine, ART.engine.abi, 'termsHash')
  const px = await rd<readonly [bigint, bigint, boolean]>(a.guard, ART.guard.abi, 'read')
  if (!px[2] || px[0] !== REF) throw new Error(`${tag}: the reference must be fresh at 100,000 for this open (got ${px[0]})`)
  const pl = await pool()
  const dev = ((pl.priceMicroPerBtc > REF ? pl.priceMicroPerBtc - REF : REF - pl.priceMicroPerBtc) * 10_000n) / REF
  if (dev > 200n) throw new Error(`${tag}: pool is ${dev} bps from the reference; restore it first`)
  const p = await param(tag + '.open', async () => {
    const quote = await quoteBuy(2n * E)
    const minAtoms = (((2n * E * 100_000_000n) / REF) * 9_700n) / 10_000n // oracle minimum, independent
    // initial coverage from the ACTUAL DEX quote, independent arithmetic
    const markup = (E * 1_000n * 1_209_600n) / (10_000n * 31_536_000n)
    const bps = (((quote * REF) / 100_000_000n) * 10_000n) / (E + markup)
    if (quote < minAtoms || bps < BigInt(minReferenceBps)) throw new Error(`${tag}: quote ${quote} atoms gives ${bps} bps; below the bound`)
    return { quote: quote.toString(), deadline: ((await chainNow()) + 900n).toString(), coverageBpsAtQuote: bps.toString() }
  })
  await once(tag + '.before', async () => world(await head()))
  await runTx({ step: tag + '.approve', label: `trader approve engine ${E} (exact)`, role: 'trader', to: ADDR.usdc, data: erc20ApproveData(a.engine, E) })
  const rec = await runTx({
    step: tag + '.open',
    label: 'engine.open(E=100000)',
    role: 'trader',
    to: a.engine,
    data: data(ART.engine.abi, 'open', [E, BigInt(p.quote), BigInt(p.deadline), termsHash]),
  })
  const ev = await engineEventsOf(rec.txHash, a.engine)
  const opened = ev.find((e) => e.name === 'Opened')
  if (!opened) throw new Error('no Opened event')
  const id = BigInt(opened.args.id ?? '0')
  const block = BigInt(rec.blockNumber ?? '0')
  const position = await rd<Obj>(a.engine, ART.engine.abi, 'getPosition', [id], block)
  setCoreRecord(tag + '.opened', jsonSafe({ id, txHash: rec.txHash, block, events: ev, position, after: await world(block), gasCostWei: rec.gasCostWei }))
  jsonLine(tag + ' opened', { id, events: ev.map((e) => e.name), collateral: position.collateral, markup0: position.markup0 })
  return { id, txHash: rec.txHash, block, atoms: BigInt(String(position.collateral)) }
}

export async function flow1(): Promise<void> {
  const a = addrs()
  const o = await openPosition('f1', 19_000)
  if (o.atoms === 0n) throw new Error('no collateral')
  const debt = (await rd<readonly [bigint, bigint, bigint]>(a.engine, ART.engine.abi, 'debtOf', [o.id]))[2]
  if (debt !== DEBT) throw new Error(`unexpected debt ${debt}`)
  await runTx({ step: 'f1.approveRepay', label: 'trader approve engine 100383 (exact)', role: 'trader', to: ADDR.usdc, data: erc20ApproveData(a.engine, DEBT) })
  const rec = await runTx({ step: 'f1.repay', label: 'engine.repayAndRelease(id, 100383)', role: 'trader', to: a.engine, data: data(ART.engine.abi, 'repayAndRelease', [o.id, DEBT]) })
  const block = BigInt(rec.blockNumber ?? '0')
  const ev = await engineEventsOf(rec.txHash, a.engine)
  const after = await world(block)
  const state = after.vaultState as Obj
  const checks = {
    lpIdleIncrease: BigInt(String(state.depositorIdleCash)) === 1_000_000n + 294n,
    managerCash89: BigInt(String(state.managerCash)) === 89n,
    outstandingZero: BigInt(String(state.outstandingPrincipal)) === 0n,
    liveZero: BigInt(String(state.livePositions)) === 0n,
    btcReturnedToTrader: BigInt(String((after.trader as Obj).cirBtc)) === BigInt(String((await once('f1.before', async () => world(0n)) as { trader: Obj }).trader.cirBtc)) + o.atoms,
    engineBtcZero: String((after.engine as Obj).cirBtc) === '0',
    engineUsdcZero: String((after.engine as Obj).usdc) === '0',
  }
  setCoreRecord('f1.released', jsonSafe({ txHash: rec.txHash, block, events: ev, after, checks, gasCostWei: rec.gasCostWei }))
  jsonLine('flow1', { events: ev.map((e) => e.name), checks })
  if (!Object.values(checks).every(Boolean)) throw new Error('flow 1 verification failed: ' + JSON.stringify(checks))
}

/** Put the released BTC back into the pool through the smoke venue (trader EOA), with a real quote and an independent floor. */
export async function prep2(): Promise<void> {
  const rel = getCoreRecord<{ after: Obj }>('f1.released')
  const opened = getCoreRecord<{ position: Obj }>('f1.opened')
  if (!rel || !opened) throw new Error('run flow1 first')
  const atoms = BigInt(String(opened.position.collateral))
  const sellParams = await param('prep2.sell', async () => {
    const quote = await quoteSell(atoms)
    const floor = (atoms * 1_000n * 9_700n + 9_999n) / 10_000n // 100,000 fixture, 300 bps budget
    if (quote < floor) throw new Error(`restore quote ${quote} below the independent floor ${floor}`)
    return { quote: quote.toString(), minOut: quote.toString(), floor: floor.toString(), deadline: ((await chainNow()) + 900n).toString() }
  })
  await runTx({ step: 'prep2.approve', label: `trader approve smoke venue ${atoms} cirBTC atoms (exact)`, role: 'trader', to: ADDR.cirBtc, data: erc20ApproveData(SMOKE_VENUE, atoms) })
  const rec = await runTx({ step: 'prep2.sell', label: 'smoke venue: sell released BTC back to the pool', role: 'trader', to: SMOKE_VENUE, data: data(ART.venue.abi, 'sellCirBtc', [atoms, BigInt(sellParams.minOut), BigInt(sellParams.deadline)]) })
  const block = BigInt(rec.blockNumber ?? '0')
  const pl = await pool(block)
  setCoreRecord('prep2.done', jsonSafe({ txHash: rec.txHash, block, atoms, quote: sellParams.quote, poolAfter: pl }))
  jsonLine('prep2', { poolUsdcPerBtcMicro: pl.priceMicroPerBtc })
}

const TARGET = 80_000n * 1_000_000n
function deviation(a: bigint, b: bigint): bigint {
  return ((a > b ? a - b : b - a) * 10_000n) / b
}

function isqrt(n: bigint): bigint {
  if (n < 2n) return n
  let x = n
  let y = (x + 1n) / 2n
  while (y < x) {
    x = y
    y = (x + n / x) / 2n
  }
  return x
}

export async function flow2(): Promise<void> {
  const a = addrs()
  const o = await openPosition('f2', 19_000)
  const pos = await rd<Obj>(a.engine, ART.engine.abi, 'getPosition', [o.id], o.block)
  const collateral = BigInt(String(pos.collateral))
  const coverage0 = await rd<bigint>(a.engine, ART.engine.abi, 'coverageBps', [o.id], o.block)

  // 1. move the pool to ~80,000 USDC per BTC (absolute target) by selling part of the trader's cirBTC reserve through the
  // smoke venue. The first sale (sized from the post-open spot, which the open itself had raised ~4%) landed at ~83.3k, so
  // a second, smaller sale corrects the remainder; each sale uses a real quote and an independent floor.
  let plAfter = await pool()
  let dev80 = deviation(plAfter.priceMicroPerBtc, TARGET)
  for (const tag of ['f2.move', 'f2.move2']) {
    if (dev80 <= 250n && !loadCore().steps[tag + 'Sell']) break
    const move = await param(tag, async () => {
      const pl = await pool()
      const sqrt1 = isqrt(((100_000_000n) << 192n) / TARGET) // token1/token0 = 1e8 / target price
      if (sqrt1 <= pl.sqrtPriceX96) throw new Error('pool is already at or below the target; nothing to sell')
      const net = (pl.liquidity * (sqrt1 - pl.sqrtPriceX96)) / (1n << 96n)
      const atoms = (net * 1_000_000n) / 997_000n + 2n // gross of the 0.30% fee, rounded up
      const quote = await quoteSell(atoms)
      const floor = atoms * 776n // independent: 80,000 USDC per BTC less 300 bps, per atom (micro-USDC)
      if (quote < floor) throw new Error(`move quote ${quote} below the independent floor ${floor}`)
      const bal = BigInt(String((await snap(publicAddress('trader'), await head())).cirBtc))
      if (bal < atoms) throw new Error(`trader reserve ${bal} atoms is below the ${atoms} needed`)
      return { atoms: atoms.toString(), quote: quote.toString(), floor: floor.toString(), deadline: ((await chainNow()) + 900n).toString() }
    })
    await runTx({ step: tag + 'Approve', label: `trader approve smoke venue ${move.atoms} cirBTC atoms (exact)`, role: 'trader', to: ADDR.cirBtc, data: erc20ApproveData(SMOKE_VENUE, BigInt(move.atoms)) })
    const mv = await runTx({ step: tag + 'Sell', label: 'smoke venue: sell trader reserve to move the pool', role: 'trader', to: SMOKE_VENUE, data: data(ART.venue.abi, 'sellCirBtc', [BigInt(move.atoms), BigInt(move.quote), BigInt(move.deadline)]) })
    plAfter = await pool(BigInt(mv.blockNumber ?? '0'))
    dev80 = deviation(plAfter.priceMicroPerBtc, TARGET)
    setCoreRecord(tag + '.landed', jsonSafe({ txHash: mv.txHash, pool: plAfter, deviationFrom80kBps: dev80 }))
    jsonLine(tag, { spot: plAfter.priceMicroPerBtc, deviationBps: dev80 })
  }
  if (dev80 > 250n) throw new Error(`pool landed ${dev80} bps from 80,000 (spot ${plAfter.priceMicroPerBtc}); stopping with a consistent honest state`)

  // 2. the operator separately sets the reference to 80,000 and the coverage must be in the 155-160% band
  const debt = (await rd<readonly [bigint, bigint, bigint]>(a.engine, ART.engine.abi, 'debtOf', [o.id]))[2]
  const ref = 80_000n * 1_000_000n
  const cov80 = (((collateral * ref) / 100_000_000n) * 10_000n) / debt
  if (cov80 < 15_500n || cov80 > 16_000n) throw new Error(`coverage at 80,000 would be ${cov80} bps, outside the 155-160% band`)
  const observedAt = BigInt(await param('f2.observedAt', async () => ((await chainNow()) - 3n).toString()))
  await runTx({ step: 'f2.oracle', label: 'DemoPriceGuard.update(80000 USDC per BTC)', role: 'deployer', to: a.guard, data: data(ART.guard.abi, 'update', [ref, observedAt]) })

  // 3. the keeper asks the engine for its plan, simulates and sends the permissionless rebalance
  const [plan, fresh] = await rd<[Obj, boolean]>(a.engine, ART.engine.abi, 'quoteRebalance', [o.id, 0n])
  if (!fresh || !plan.eligible || !plan.isPartial) throw new Error('plan is not an eligible partial: ' + JSON.stringify(jsonSafe(plan)))
  const rb = await param('f2.rebalance', async () => ({ minUsdc: String(plan.minUsdc), deadline: ((await chainNow()) + 900n).toString() }))
  const rec = await runTx({ step: 'f2.rebalance', label: 'engine.rebalance(id) by the keeper', role: 'keeper', to: a.engine, data: data(ART.engine.abi, 'rebalance', [o.id, BigInt(rb.minUsdc), BigInt(rb.deadline)]) })
  const block = BigInt(rec.blockNumber ?? '0')
  const ev = await engineEventsOf(rec.txHash, a.engine)
  const reb = ev.find((e) => e.name === 'Rebalanced')
  const after = await rd<Obj>(a.engine, ART.engine.abi, 'getPosition', [o.id], block)
  const debtAfter = BigInt(String(after.principal)) + BigInt(String(after.markup))
  const valueAfter = (BigInt(String(after.collateral)) * ref) / 100_000_000n
  const checks = {
    quantityIsEnginePlan: BigInt(String(after.collateral)) === collateral - BigInt(String(plan.sellAtoms)),
    proceedsMeetFloor: BigInt(reb?.args.proceeds ?? '0') >= BigInt(String(plan.minUsdc)),
    principalAtLeastDust: BigInt(String(after.principal)) >= 10_000n,
    coverageAtLeast190Strict: valueAfter * 10_000n >= debtAfter * 19_000n,
    toleranceUsed: reb?.args.toleranceUsed ?? 'missing',
    stillActive: String(after.status) === '1',
    vaultOutstandingMatches: BigInt(String((await vs(a.vault, block)).outstandingPrincipal)) === BigInt(String(after.principal)),
  }
  setCoreRecord('f2.rebalanced', jsonSafe({ id: o.id, plan, txHash: rec.txHash, block, events: ev, positionAfter: after, coverageBpsAfter: (valueAfter * 10_000n) / debtAfter, coverageBpsBefore: cov80, coverageBpsAtOpen: coverage0, checks, after: await world(block), gasCostWei: rec.gasCostWei }))
  jsonLine('flow2', { plan, checks })
  if (!checks.quantityIsEnginePlan || !checks.proceedsMeetFloor || !checks.principalAtLeastDust || !checks.stillActive || !checks.vaultOutstandingMatches) throw new Error('flow 2 verification failed')
}

export async function fifo(): Promise<void> {
  const a = addrs()
  const dep = publicAddress('deployer')
  const SHARES = 100_000n
  const before = await once('fifo.before', async () => ({ vaultState: await vs(a.vault), deployerClaimable: await rd<bigint>(a.vault, ART.vault.abi, 'claimable', [dep]), deployerShares: await rd<bigint>(a.vault, ART.vault.abi, 'sharesOf', [dep]) }))
  const rq = await runTx({ step: 'fifo.request', label: 'deployer requestWithdraw(100000 shares)', role: 'deployer', to: a.vault, data: data(ART.vault.abi, 'requestWithdraw', [SHARES]) })
  const afterReq = { vaultState: await vs(a.vault, BigInt(rq.blockNumber ?? '0')), locked: await rd<bigint>(a.vault, ART.vault.abi, 'lockedShares', [dep], BigInt(rq.blockNumber ?? '0')) }
  const pr = await runTx({ step: 'fifo.process', label: 'keeper processWithdrawals(1) (permissionless)', role: 'keeper', to: a.vault, data: data(ART.vault.abi, 'processWithdrawals', [1n]) })
  const pb = BigInt(pr.blockNumber ?? '0')
  const afterProc = { vaultState: await vs(a.vault, pb), claimable: await rd<bigint>(a.vault, ART.vault.abi, 'claimable', [dep], pb), shares: await rd<bigint>(a.vault, ART.vault.abi, 'sharesOf', [dep], pb) }
  const before2 = await once('fifo.beforeClaim', async () => ({ deployer: await snap(dep, pb), vaultState: afterProc.vaultState }))
  const cl = await runTx({ step: 'fifo.claim', label: 'deployer claim()', role: 'deployer', to: a.vault, data: data(ART.vault.abi, 'claim', []) })
  const cb = BigInt(cl.blockNumber ?? '0')
  const afterClaim = { vaultState: await vs(a.vault, cb), deployer: await snap(dep, cb), claimable: await rd<bigint>(a.vault, ART.vault.abi, 'claimable', [dep], cb) }
  const b = before.vaultState
  const s1 = afterReq.vaultState
  const s2 = afterProc.vaultState
  const s3 = afterClaim.vaultState
  const payout = BigInt(String(afterProc.claimable))
  const checks = {
    requestBurnsNothing: String(s1.totalShares) === String(b.totalShares) && BigInt(String(afterReq.locked)) === SHARES,
    fillBurnsShares: BigInt(String(s2.totalShares)) === BigInt(String(b.totalShares)) - SHARES,
    payoutIsReservedSeparately: BigInt(String(s2.claimableWithdrawals)) === payout && payout > 0n,
    navDebitedOnceAtFill: BigInt(String(b.nav)) - BigInt(String(s2.nav)) === payout,
    claimDoesNotDebitNavAgain: String(s3.nav) === String(s2.nav) && String(s3.totalShares) === String(s2.totalShares),
    claimZeroed: String(afterClaim.claimable) === '0' && String(s3.claimableWithdrawals) === '0',
    positionStillLive: BigInt(String(s3.livePositions)) >= 1n,
    sharesRemain: BigInt(String(s3.totalShares)) > 0n,
  }
  setCoreRecord('fifo.done', jsonSafe({ before, afterReq, afterProc, before2, afterClaim, payout, checks, txs: { request: rq.txHash, process: pr.txHash, claim: cl.txHash } }))
  jsonLine('fifo', { payout, checks })
  if (!Object.values(checks).every(Boolean)) throw new Error('FIFO verification failed: ' + JSON.stringify(checks))
}

export async function status(): Promise<void> {
  const s = loadCore()
  jsonLine('steps', Object.fromEntries(Object.entries(s.steps).map(([k, v]) => [k, { phase: v.phase, tx: v.txHash, block: v.blockNumber, gasCostWei: v.gasCostWei }])))
  const a = getCoreRecord<Obj>('addresses')
  if (a) jsonLine('world', await world(await head()))
}

/** Operator reset: repay the exact remaining debt of an active position from the trader wallet and release its BTC. */
export async function release(): Promise<void> {
  const a = addrs()
  const id = BigInt(process.argv[3] ?? '2')
  const debt = await param('release.' + id, async () => (await rd<readonly [bigint, bigint, bigint]>(a.engine, ART.engine.abi, 'debtOf', [id]))[2].toString())
  if (BigInt(debt) === 0n) throw new Error('position has no debt (already released)')
  await runTx({ step: `release${id}.approve`, label: `trader approve engine ${debt} (exact)`, role: 'trader', to: ADDR.usdc, data: erc20ApproveData(a.engine, BigInt(debt)) })
  const rec = await runTx({ step: `release${id}.repay`, label: `engine.repayAndRelease(${id}, ${debt})`, role: 'trader', to: a.engine, data: data(ART.engine.abi, 'repayAndRelease', [id, BigInt(debt)]) })
  jsonLine('release', { id, debt, tx: rec.txHash, world: await world(BigInt(rec.blockNumber ?? '0')) })
}
