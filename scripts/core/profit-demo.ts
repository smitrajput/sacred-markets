/**
 * Bounded operator for the "real profit" demo. Arc Testnet only. Default is a READ-ONLY plan; nothing is signed or sent without --broadcast.
 *
 *   bun scripts/core/profit-demo.ts prepare                       # plan / simulate
 *   bun scripts/core/profit-demo.ts prepare --broadcast
 *   bun scripts/core/profit-demo.ts raise --position 4            # plan / simulate (founder-confirmed id)
 *   bun scripts/core/profit-demo.ts raise --position 4 --broadcast
 *
 * Wallets: the dedicated trader is the "external market wallet" (the existing smoke venue is bound to it); the dedicated deployer is the
 * guard's price admin. The founder's browser wallet is only ever READ here. There is no automatic open and no automatic ownerClose.
 * Hard limits: restore <= 1000 cirBTC atoms, market buys <= 4,000,000 micro-USDC over <= 2 transactions, operator gas <= 0.2 USDC, 2 USDC reserve.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { erc20Abi, getAddress, type Address, type Hex } from 'viem'

import { ART, SMOKE_VENUE, addrs, chainNow, data, erc20ApproveData, head, paramBig, pool, quoteBuy, quoteSell, rd, snap, jsonLine } from './lib'
import { Stop, getCoreRecord, liveChain, loadCore, runTx, setCoreRecord } from './journal'
import { buyUsdcNeeded, cashout, devBps, minOutBuy, minOutSell, restoreSellAtoms } from './profitMath'
import { ADDR, ROOT, assertArcChain, publicAddress, publicClient } from '../smoke/common'

const PREFIX = 'profit20261106'
const EVIDENCE = join(ROOT, 'deployments', 'profit-demo.json')
const BROWSER_TRADER: Address = getAddress('0xAA46220DfD751f915d9c802412eDaBC0aB69dEcC')
const P80 = 80_000n * 1_000_000n
const P100 = 100_000n * 1_000_000n
const MAX_RESTORE_ATOMS = 1_000n
const MAX_BUY_USDC = 4_000_000n
const MAX_BUYS = 2
const GAS_BUDGET_WEI = 2n * 10n ** 17n // 0.2 USDC across every step with this prefix
const NATIVE_PER_ATOM = 1_000_000_000_000n
const DEADLINE_SECONDS = 900n
const ORIGINAL_EQUITY = 100_000n
const OPEN_GAS = 820_421n // independent fork measurements, used only for the conservative estimate
const CLOSE_GAS = 406_552n
const OVERHEAD_GAS = 150_000n

interface Evidence {
  schemaVersion: 1
  prefix: string
  chainId: number
  dryRuns?: Record<string, unknown>
  prepare?: Record<string, unknown> & { completed?: boolean; preparedAtTimestamp?: string; preparedAtBlock?: string; afterPriceMicro?: string; wiringKey?: string }
  raise?: Record<string, unknown> & { completed?: boolean }
}
const loadEv = (): Evidence => {
  try {
    return JSON.parse(readFileSync(EVIDENCE, 'utf8')) as Evidence
  } catch {
    return { schemaVersion: 1, prefix: PREFIX, chainId: 5042002 }
  }
}
function saveEv(e: Evidence): void {
  const tmp = EVIDENCE + '.tmp'
  writeFileSync(tmp, JSON.stringify(e, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n')
  renameSync(tmp, EVIDENCE)
}

const args = process.argv.slice(2)
const cmd = args[0]
const broadcast = args.includes('--broadcast')
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const say = (label: string, x: unknown): void => jsonLine(`${broadcast ? 'LIVE' : 'DRY'} ${label}`, x)
const bps = (x: bigint): string => `${x >= 0n ? '+' : ''}${x} bps`

/** Gas already spent by every journal step with our prefix (both wallets), in wei. */
function gasSpentWei(): bigint {
  return Object.entries(loadCore().steps)
    .filter(([k]) => k.startsWith(PREFIX + '.'))
    .reduce((a, [, s]) => a + BigInt(s.gasCostWei ?? '0'), 0n)
}

/**
 * Deadline for a step. If the step is already in the journal (possibly sent) its persisted deadline is reused so the calldata stays byte-identical;
 * an unsent step gets a fresh deadline (persisted only when broadcasting, never by a dry run).
 */
async function deadlineFor(key: string, step: string): Promise<bigint> {
  const full = `${PREFIX}.${key}`
  if (loadCore().steps[`${PREFIX}.${step}`]) {
    const kept = getCoreRecord<string>(`param.${full}`)
    if (kept === undefined) throw new Stop(`the in-flight step ${step} has no persisted deadline; refusing to guess`)
    return BigInt(kept)
  }
  const d = ((await chainNow()) + DEADLINE_SECONDS).toString()
  if (broadcast) setCoreRecord(`param.${full}`, d)
  return BigInt(d)
}

/** Journal + send one transaction (broadcast) or simulate it (dry run). One at a time; exact approvals only. */
async function tx(step: string, label: string, role: 'trader' | 'deployer', to: Address, calldata: Hex, valueUsdcAtoms = 0n, simulateOnly = false) {
  const account = publicAddress(role)
  const chain = liveChain()
  const [gas, fees] = await Promise.all([chain.estimateGas({ account, to, data: calldata }), chain.fees()])
  const worst = (gas * 12n * fees.maxFeePerGas) / 10n
  if (gasSpentWei() + worst > GAS_BUDGET_WEI) throw new Stop(`operator gas budget (0.2 USDC) would be exceeded by ${step}`)
  if (!broadcast) {
    if (!simulateOnly) return { simulated: false, gas, worst }
    await chain.call({ account, to, data: calldata }) // throws on revert
    return { simulated: true, gas, worst }
  }
  const rec = await runTx({ step: `${PREFIX}.${step}`, label, role, to, data: calldata, valueSpendWei: valueUsdcAtoms * NATIVE_PER_ATOM })
  if (rec.phase !== 'confirmed') throw new Stop(`${step} did not confirm`)
  return rec
}

async function preflight() {
  const pc = publicClient()
  await assertArcChain(pc)
  const A = addrs()
  const deployer = publicAddress('deployer')
  const trader = publicAddress('trader')
  if (getAddress(trader) === BROWSER_TRADER || getAddress(deployer) === BROWSER_TRADER) throw new Stop('the browser wallet must never be an operator account')
  const [usdcDec, btcDec, venueEngine, admin, wired] = await Promise.all([
    rd<number>(ADDR.usdc, erc20Abi, 'decimals'),
    rd<number>(ADDR.cirBtc, erc20Abi, 'decimals'),
    rd<Address>(SMOKE_VENUE, ART.venue.abi, 'engine'),
    rd<Address>(A.guard, ART.guard.abi, 'priceAdmin'),
    rd<boolean>(A.engine, ART.engine.abi, 'isWired'),
  ])
  if (usdcDec !== 6 || btcDec !== 8) throw new Stop(`unexpected token decimals ${usdcDec}/${btcDec}`)
  if (getAddress(venueEngine) !== getAddress(trader)) throw new Stop('the smoke venue is not bound to the dedicated trader')
  if (getAddress(admin) !== getAddress(deployer)) throw new Stop('the guard price admin is not the dedicated deployer')
  if (!wired) throw new Stop('the engine is not wired to the production venue and vault')
  const wiringKey = [A.vault, A.engine, A.guard, A.venue].map((a) => a.toLowerCase()).join(',')
  return { A, deployer, trader, wiringKey }
}

const readGuard = async (guard: Address) => {
  const [price, ts, fresh] = await rd<readonly [bigint, bigint, boolean]>(guard, ART.guard.abi, 'read')
  return { price, ts, fresh }
}

// ------------------------------------------------------------------------------------------------ prepare
async function prepare(): Promise<void> {
  const { A, trader, wiringKey } = await preflight()
  const ev = loadEv()
  if (ev.prepare?.completed) throw new Stop('prepare is already complete; it is never replayed (see deployments/profit-demo.json)')
  const g = await readGuard(A.guard)
  if (g.price !== P80 || !g.fresh) throw new Stop(`the reference must be a fresh 80000 USDC/BTC (is ${g.price}, fresh=${g.fresh})`)
  const pl0 = await pool()
  const dev0 = devBps(pl0.priceMicroPerBtc, P80)
  if (dev0 > 500n || dev0 < -500n) throw new Stop(`the pool has moved ${bps(dev0)} from 80000; it must be within 5% before preparing`)
  if (dev0 < -25n) throw new Stop(`the pool is ${bps(dev0)} BELOW the target; a buy-side restore is not part of this script`)
  const blockBefore = await head()
  const operatorBefore = await snap(trader, blockBefore)
  const browserStart = await snap(BROWSER_TRADER, blockBefore)

  const swap = dev0 <= 25n ? { gross: 0n, net: 0n } : restoreSellAtoms(pl0.sqrtPriceX96, pl0.liquidity, P80)
  const atoms = swap.gross
  if (atoms > MAX_RESTORE_ATOMS) throw new Stop(`restore needs ${atoms} cirBTC atoms; the limit is ${MAX_RESTORE_ATOMS}`)
  if (atoms > BigInt(operatorBefore.cirBtc)) throw new Stop('the dedicated trader does not hold enough cirBTC for the restore')
  const quote = atoms > 0n ? await quoteSell(atoms) : 0n
  const minOut = atoms > 0n ? minOutSell(atoms, quote, P80) : 0n
  const plan = {
    pool: { priceMicroPerBtc: pl0.priceMicroPerBtc, deviationFrom80k: bps(dev0), liquidity: pl0.liquidity, tick: pl0.tick },
    restore: { atomsGross: atoms, quoteUsdcMicro: quote, minOutUsdcMicro: minOut, via: 'existing smoke venue (dedicated trader)', approvals: 'exact, once' },
    guard: { price: g.price, timestamp: g.ts, fresh: g.fresh },
    browserTraderStartingNativeWei: browserStart.nativeWei,
    operatorTrader: operatorBefore,
  }
  say('prepare plan', plan)

  const deadline = (await deadlineFor('prepare.deadline', 'prepare.sell')).toString()
  if (atoms > 0n) {
    const approve = erc20ApproveData(SMOKE_VENUE, atoms)
    const sell = data(ART.venue.abi, 'sellCirBtc', [atoms, minOut, BigInt(deadline)])
    const approveSim = await tx('prepare.approve', 'approve exact cirBTC to the smoke venue', 'trader', ADDR.cirBtc, approve, 0n, true)
    say(broadcast ? 'approval confirmed' : 'approve tx simulated (the swap itself is simulated by the journal after the approval confirms)', { gas: 'gas' in approveSim ? approveSim.gas : null })
    if (broadcast) {
      await tx('prepare.sell', `sell ${atoms} cirBTC to restore the pool toward 80000`, 'trader', SMOKE_VENUE, sell)
    }
  }
  if (!broadcast) {
    say('buy-quote check on the CURRENT pool (re-checked on the restored pool when broadcasting)', await purchaseCheck())
    ev.dryRuns = { ...ev.dryRuns, prepare: { at: new Date().toISOString(), plan } }
    saveEv(ev)
    return
  }
  const blockAfter = await head()
  const pl1 = await pool()
  const check = await purchaseCheck()
  const after = await snap(trader, blockAfter)
  const steps = Object.fromEntries(Object.entries(loadCore().steps).filter(([k]) => k.startsWith(`${PREFIX}.prepare.`)).map(([k, s]) => [k, { txHash: s.txHash, block: s.blockNumber, gasUsed: s.gasUsed, gasCostWei: s.gasCostWei }]))
  const ts = (await publicClient().getBlock({ blockNumber: blockAfter })).timestamp
  ev.prepare = { completed: true, wiringKey, preparedAtBlock: blockAfter.toString(), preparedAtTimestamp: ts.toString(), afterPriceMicro: pl1.priceMicroPerBtc.toString(), poolBefore: pl0.priceMicroPerBtc.toString(), poolAfter: { priceMicroPerBtc: pl1.priceMicroPerBtc, deviationFrom80k: bps(devBps(pl1.priceMicroPerBtc, P80)), liquidity: pl1.liquidity }, restoreAtoms: atoms, quote, minOut, steps, operatorBefore, operatorAfter: after, browserTraderStartingNativeWei: browserStart.nativeWei, purchaseCheck: check }
  saveEv(ev)
  say('prepare complete', ev.prepare)
  if (!check.ok) throw new Stop('prepare finished, but the .20 purchase quote does NOT meet the 190% / 3% floor rules on the restored pool; do not open yet')
  console.log('Pool restored. The founder may now open the 0.10 USDC contribution on the public app. Nothing opens automatically.')
}

/** The browser buys 0.20 USDC (E=0.10 at 2x). Mirrors the engine's open checks on the real quote; display only. */
async function purchaseCheck() {
  const gross = 200_000n
  const quote = await quoteBuy(gross)
  const referenceAtoms = (gross * 10n ** 8n) / P80
  const referenceFloor = (referenceAtoms * 9700n) / 10_000n
  const debt = 100_383n
  const coverageBps = ((quote * P80) / 10n ** 8n * 10_000n) / debt
  return { quoteAtoms: quote, referenceAtoms, referenceFloor, coverageBps, ok: quote >= referenceFloor && coverageBps >= 19_000n }
}

// ------------------------------------------------------------------------------------------------ raise
async function raise(): Promise<void> {
  const idArg = flag('--position')
  if (!idArg || !/^\d+$/.test(idArg)) throw new Stop('raise needs an explicit founder-confirmed --position ID')
  const id = BigInt(idArg)
  const { A, trader, wiringKey } = await preflight()
  const ev = loadEv()
  const p = await rd<Record<string, unknown>>(A.engine, ART.engine.abi, 'getPosition', [id])
  const status = Number(p.status)
  if (status !== 1) throw new Stop(`position ${id} is not Active (status ${status}: 0 none, 1 active, 2 closed); there is nothing to raise for`)
  if (getAddress(p.trader as Address) !== BROWSER_TRADER) throw new Stop(`position ${id} is not owned by the browser trader`)
  if ((p.principal as bigint) !== 100_000n || (p.markup as bigint) !== 383n) throw new Stop(`position ${id} is not principal 100000 / markup 383 (is ${String(p.principal)} / ${String(p.markup)})`)
  if ((p.collateral as bigint) <= 0n) throw new Stop(`position ${id} holds no collateral`)
  if (!ev.prepare?.completed) throw new Stop('no completed prepare is recorded; run prepare --broadcast first')
  if (ev.prepare.wiringKey !== wiringKey) throw new Stop('contract provenance changed since prepare')
  if ((p.openedAt as bigint) <= BigInt(ev.prepare.preparedAtTimestamp ?? '0')) throw new Stop('the position was opened before this prepare, so its baseline is not ours')
  if (ev.raise?.completed) throw new Stop('raise is already complete (see deployments/profit-demo.json)')

  const g = await readGuard(A.guard)
  const guardAlready = !!loadCore().steps[`${PREFIX}.raise.guard`]
  if (!guardAlready && (g.price !== P80 || !g.fresh)) throw new Stop(`the guard is not the prepared fresh 80000 reference (is ${g.price}, fresh=${g.fresh})`)
  let pl = await pool()
  const base = BigInt(ev.prepare.afterPriceMicro ?? '0')
  const driftBps = devBps(pl.priceMicroPerBtc, base)
  if (!guardAlready && (driftBps < -200n || driftBps > 1000n) && devBps(pl.priceMicroPerBtc, P100) < -100n) throw new Stop(`the pool moved ${bps(driftBps)} from the prepared baseline: unexpected, not acting`)

  const operator = await snap(trader, await head())
  say('raise plan', { position: { id, trader: p.trader, principal: p.principal, markup: p.markup, collateral: p.collateral, openedAt: p.openedAt }, pool: { price: pl.priceMicroPerBtc, deviationFrom100k: bps(devBps(pl.priceMicroPerBtc, P100)), driftFromPrepared: bps(driftBps) }, operator })

  let spent = 0n
  const buys: unknown[] = []
  for (let i = 1; i <= MAX_BUYS; i++) {
    pl = await pool()
    const dev = devBps(pl.priceMicroPerBtc, P100)
    if (dev >= -50n) break // already within 0.5% of (or above) the nominal target
    if (dev > 100n) throw new Stop(`the pool is ${bps(dev)} ABOVE the target; not buying`)
    const remaining = MAX_BUY_USDC - spent
    const need = buyUsdcNeeded(pl.sqrtPriceX96, pl.liquidity, P100).gross
    const amount = need < remaining ? need : remaining
    if (amount <= 0n) throw new Stop('the 4 USDC market-buy budget is exhausted before the pool reached the target')
    if (BigInt(operator.usdc) < amount + 2_000_000n) throw new Stop('the dedicated trader lacks the USDC (keeping 2 USDC of gas)')
    const quoteAtoms = await quoteBuy(amount)
    const minOut = minOutBuy(amount, quoteAtoms, P100)
    const deadline = await deadlineFor(`raise.buy${i}.deadline`, `raise.buy${i}`)
    say(`buy ${i} plan`, { usdcMicro: amount, neededForTarget: need, quoteAtoms, minOutAtoms: minOut, deadline })
    const approve = erc20ApproveData(SMOKE_VENUE, amount)
    const buy = data(ART.venue.abi, 'buyCirBtc', [amount, minOut, deadline])
    await tx(`raise.buy${i}.approve`, 'approve exact USDC to the smoke venue', 'trader', ADDR.usdc, approve, 0n, true)
    if (!broadcast) {
      say('dry run stops here: later buys and the guard update depend on the real post-buy pool', { wouldBuy: amount, ofBudget: MAX_BUY_USDC })
      break
    }
    await tx(`raise.buy${i}`, `market buy ${amount} micro-USDC of cirBTC`, 'trader', SMOKE_VENUE, buy, amount)
    spent += amount
    buys.push({ i, usdcMicro: amount, quoteAtoms, minOutAtoms: minOut, step: loadCore().steps[`${PREFIX}.raise.buy${i}`]?.txHash })
  }
  if (!broadcast) {
    await reportCashout(id, p, A.engine, 'DRY (cashout estimated on the CURRENT pool, before any market buy)')
    return
  }

  pl = await pool()
  const devAfter = devBps(pl.priceMicroPerBtc, P100)
  if (devAfter < -100n || devAfter > 100n) throw new Stop(`the pool is ${bps(devAfter)} from 100000 (needs +/-1%); the guard is NOT updated`)
  const ts = await paramBig(`${PREFIX}.raise.guard.ts`, async () => (await chainNow()) - 2n)
  await tx('raise.guard', 'guard.update(100000 USDC/BTC) by the price admin', 'deployer', A.guard, data(ART.guard.abi, 'update', [P100, ts]))
  const gAfter = await readGuard(A.guard)
  const est = await reportCashout(id, p, A.engine, 'LIVE (estimate only; nothing is realized until the owner closes)')
  const steps = Object.fromEntries(Object.entries(loadCore().steps).filter(([k]) => k.startsWith(`${PREFIX}.raise.`)).map(([k, s]) => [k, { txHash: s.txHash, block: s.blockNumber, gasUsed: s.gasUsed, gasCostWei: s.gasCostWei }]))
  ev.raise = { completed: true, positionId: id.toString(), poolAfter: { priceMicroPerBtc: pl.priceMicroPerBtc, deviationFrom100k: bps(devAfter) }, poolIncreaseVsPrepared: bps(devBps(pl.priceMicroPerBtc, base)), buys, guardAfter: { price: gAfter.price, timestamp: gAfter.ts, fresh: gAfter.fresh }, estimate: est, steps, operatorGasSpentWei: gasSpentWei().toString() }
  saveEv(ev)
  console.log('Reference raised. The founder now uses "Sell collateral and close (owner)" in the app; no automatic close.')
}

async function reportCashout(id: bigint, p: Record<string, unknown>, engine: Address, label: string) {
  const collateral = p.collateral as bigint
  const debt = (p.principal as bigint) + (p.markup as bigint)
  const quote = await quoteSell(collateral)
  const c = cashout(quote, debt, ORIGINAL_EQUITY)
  const guardFloor = (((collateral * P100) / 10n ** 8n) * 9700n) / 10_000n // the app's ownerClose minimum at a 100000 reference
  const fees = await liveChain().fees()
  const price = fees.maxFeePerGas > 25_000_000_000n ? fees.maxFeePerGas : 25_000_000_000n
  const gasMicro = ((OPEN_GAS + CLOSE_GAS + OVERHEAD_GAS) * price) / NATIVE_PER_ATOM
  const out = { id, ownerCloseGuardFloorMicro: guardFloor, cashoutQuoteMicro: quote, debtMicro: debt, estimatedPayoutMicro: c.payout, originalEquityMicro: ORIGINAL_EQUITY, estimatedProfitBeforeGasMicro: c.profit, conservativeGasMicroAt25GweiOrLive: gasMicro, estimatedProfitAfterGasMicro: c.profit - gasMicro, engine, note: 'ESTIMATE ONLY. No profit exists until ownerClose confirms.' }
  say(label, out)
  return out
}

try {
  if (cmd === 'prepare') await prepare()
  else if (cmd === 'raise') await raise()
  else throw new Stop('usage: profit-demo.ts <prepare|raise --position ID> [--broadcast]')
} catch (e) {
  const m = (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, '<url>').slice(0, 500)
  console.error(e instanceof Stop ? m : `ERROR: ${m}`)
  process.exit(e instanceof Stop ? 3 : 1)
}
