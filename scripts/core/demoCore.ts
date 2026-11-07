/**
 * Core of the `demo` operator CLI: pure planning + journaled flows over an injectable Env (tests use a fake chain; the live Env is in demoLive.ts).
 * Rules: plans are persisted (exact calldata, amounts, deadline) BEFORE signing and reused byte-for-byte on resume; budgets are cumulative across
 * restarts (they include confirmed AND reserved/pending attempts); nothing here ever signs for the browser wallet.
 */
import { getAddress, type Address, type Hex } from 'viem'

import { Stop, type CoreStep, type Plan, type Store } from './journal'
import { buyUsdcNeeded, cashout, devBps, minOutBuy, minOutSell, restoreSellAtoms } from './profitMath'
import * as U from './demoUnits'

export const EPISODE_ID = 'recording-20261107'
export const PREFIX = 'demo20261107'
export const P80 = 80_000n * 1_000_000n
export const P100 = 100_000n * 1_000_000n
export const BROWSER_TRADER = '0xAA46220DfD751f915d9c802412eDaBC0aB69dEcC'
export const LIMITS = {
  maxRestoreSats: 5_000n,
  maxBuyMicro: 4_000_000n, // across ALL prepare + rise market buys
  maxBuyTxs: 2,
  gasBudgetWei: 2n * 10n ** 17n, // 0.2 USDC, deployer + trader steps
  processGasBudgetWei: 5n * 10n ** 16n, // 0.05 USDC, keeper `process` steps
  signerReserveMicro: 2_000_000n, // every signer keeps >= 2 USDC for gas
  nearBps: 50n, // "near target" for verification
  noopBps: 25n, // restore not needed inside this band
  driftBand: [60_000n * 1_000_000n, 120_000n * 1_000_000n] as const, // outside this the pool is not ours to restore
  expiryMarginSec: 3_600n,
  deadlineSec: 900n,
}
const RESERVE_CUSHION = 125n // percent: a persisted gas reservation is the live estimate x1.2 x fee, plus a 25% cushion for fee drift
const cs = (a: string): string => getAddress(a)
const EQUITY = 100_000n
const MARKUP = 383n
const DEBT = EQUITY + MARKUP

export class Cancelled extends Error {}

// ------------------------------------------------------------------------------------------------ types
export interface Bal { native: bigint; usdc: bigint; btc: bigint }
export interface PosV { id: bigint; trader: string; status: number; openedAt: bigint; principal0: bigint; principal: bigint; markup0: bigint; markup: bigint; collateral: bigint }
export interface Snapshot {
  block: bigint
  time: bigint
  pool: { price: bigint; sqrt: bigint; liquidity: bigint }
  oracle: { price: bigint; observedAt: bigint; expiresAt: bigint; fresh: boolean }
  positions: PosV[]
  vault: { queueHead: bigint; queueTail: bigint; idle: bigint; headroom: bigint; perAccountCap: bigint; blockersFinancing: string[]; blockersDeposit: string[]; fundingPaused: boolean; queueRequests: number }
  operator: Bal
  deployer: Bal
  keeper: Bal
  browser: Bal
}
export interface Addrs { guard: Address; vault: Address; engine: Address; smokeVenue: Address; usdc: Address; btc: Address; operator: Address; deployer: Address; keeper: Address }
export interface Enc {
  approve(token: Address, spender: Address, amount: bigint): Hex
  sell(atoms: bigint, minOut: bigint, deadline: bigint): Hex
  buy(usdc: bigint, minOut: bigint, deadline: bigint): Hex
  guardUpdate(price: bigint, ts: bigint): Hex
  process(max: bigint): Hex
}
export interface Env {
  a: Addrs
  enc: Enc
  store: Store
  flags: { yes: boolean; replan: boolean }
  snapshot(): Promise<Snapshot>
  quoteBuy(usdc: bigint): Promise<bigint>
  quoteSell(sats: bigint): Promise<bigint>
  /** Live gas estimate and fee cap for a transaction that is valid RIGHT NOW (never called for a swap before its approval confirmed). */
  gasQuote(role: 'trader' | 'deployer' | 'keeper', to: Address, data: Hex): Promise<{ gas: bigint; maxFeePerGas: bigint }>
  simulate(role: 'trader' | 'deployer' | 'keeper', to: Address, data: Hex): Promise<void>
  run(plan: Plan, bound: { maxGasWei: bigint }): Promise<CoreStep>
  confirm(prompt: string, expected: string): Promise<boolean>
  cancelled(): boolean
  out(line: string): void
}

type Kind = 'approve' | 'sell' | 'buy' | 'guard' | 'process'
export interface PlanRec {
  step: string
  kind: Kind
  role: 'trader' | 'deployer' | 'keeper'
  to: Address
  data: Hex
  label: string
  usdcMicro: string // market-buy spend reserved by this plan (0 otherwise)
  sats: string
  minOut: string
  deadline: string // unix seconds baked into `data` (0 when none)
  amount: string // exact token amount an approval covers (the swap that follows is derived from THIS, never recomputed)
  side: 'btc' | 'usdc' | 'none' // token of that amount
  maxGasWei: string
  abandoned?: boolean
}
const PLANS = 'demo.plans'
const PREP = 'demo.prepare'
const RISE = 'demo.rise'
type PlanMap = Record<string, PlanRec>

// ------------------------------------------------------------------------------------------------ store helpers + ledger
export const getRec = <T>(store: Store, key: string): T | undefined => store.load().records[key] as T | undefined
function setRecs(store: Store, patch: Record<string, unknown>): void {
  const s = store.load()
  for (const [k, v] of Object.entries(patch)) s.records[k] = v
  store.save(s)
}
const plansOf = (store: Store): PlanMap => (getRec<PlanMap>(store, PLANS) ?? {})

/**
 * Cumulative budgets across restarts. Confirmed gas is actual; a step already signed counts at its SIGNED gas x fee cap; a persisted plan
 * that was never signed counts at its reservation. Abandoned (never signed) plans are released. `excluding` skips one plan (to avoid counting it twice).
 */
export function ledger(store: Store, excluding?: string) {
  const s = store.load()
  const plans = Object.values((s.records[PLANS] ?? {}) as PlanMap).filter((p) => !p.abandoned && p.step !== excluding)
  let buyMicro = 0n
  let buyTxs = 0
  let gasWei = 0n
  let processGasWei = 0n
  for (const p of plans) {
    const j = s.steps[p.step]
    const g = j ? (j.gasCostWei ? BigInt(j.gasCostWei) : BigInt(j.gas) * BigInt(j.maxFeePerGas)) : BigInt(p.maxGasWei)
    if (p.kind === 'process') processGasWei += g
    else gasWei += g
    if (p.kind === 'buy') {
      buyMicro += BigInt(p.usdcMicro)
      buyTxs += 1
    }
  }
  return { buyMicro, buyTxs, gasWei, processGasWei }
}

/** Persist the exact plan BEFORE signing; reuse a saved plan byte-for-byte; enforce cumulative budgets; honour cancellation before any write. */
type Built = Omit<PlanRec, 'step' | 'maxGasWei' | 'amount' | 'side'> & { amount?: string; side?: 'btc' | 'usdc' }

/** The newest non-abandoned saved plan for a step name (replans get a ~rN suffix). */
export function livePlan(store: Store, name: string): PlanRec | undefined {
  const base = `${PREFIX}.${name}`
  const map = plansOf(store)
  return Object.keys(map).filter((k) => (k === base || k.startsWith(base + '~r')) && !map[k].abandoned).map((k) => map[k]).pop()
}

async function step(env: Env, name: string, build?: () => Built | Promise<Built>): Promise<CoreStep> {
  const base = `${PREFIX}.${name}`
  const s = env.store.load()
  const map = plansOf(env.store)
  const keys = Object.keys(map).filter((k) => k === base || k.startsWith(base + '~r'))
  const liveKey = keys.filter((k) => !map[k].abandoned).pop()
  let rec = liveKey ? map[liveKey] : undefined
  const processKind = (k?: Kind) => k === 'process'
  const limitFor = (k: Kind) => (processKind(k) ? LIMITS.processGasBudgetWei : LIMITS.gasBudgetWei)
  const usedFor = (k: Kind, excluding?: string) => (processKind(k) ? ledger(env.store, excluding).processGasWei : ledger(env.store, excluding).gasWei)
  if (rec) {
    const sent = !!s.steps[rec.step]
    const now = (await env.snapshot()).time
    if (!sent && rec.deadline !== '0' && BigInt(rec.deadline) < now) {
      if (!env.flags.replan) throw new Stop(`the saved ${name} plan expired before it was ever signed (deadline ${U.utc(BigInt(rec.deadline))}). Nothing was sent for it. Re-run with --replan to replace this one unsent plan; budgets are not reset.`)
      rec.abandoned = true
      map[rec.step] = rec
      setRecs(env.store, { [PLANS]: map })
      rec = undefined
    } else if (!sent) {
      // A saved, never-signed plan is re-bounded against the LIVE estimate before anything is signed.
      const q = await env.gasQuote(rec.role, rec.to, rec.data)
      const worst = (q.gas * 12n * q.maxFeePerGas) / 10n
      if (worst > BigInt(rec.maxGasWei)) throw new Stop(`gas or fees jumped above this step's persisted reservation (${U.native(worst)} now vs ${U.native(BigInt(rec.maxGasWei))}); nothing was signed. Retry later; budgets are unchanged.`)
      if (usedFor(rec.kind, rec.step) + worst > limitFor(rec.kind)) throw new Stop(`budget: operator gas would exceed ${U.native(limitFor(rec.kind))}; nothing was signed`)
    }
  }
  if (!rec) {
    if (!build) throw new Stop(`internal: no saved plan for ${name}`)
    if (env.cancelled()) throw new Cancelled()
    const b = await build()
    const full = keys.length === 0 ? base : `${base}~r${keys.length}`
    const q = await env.gasQuote(b.role, b.to, b.data) // fails closed: no estimate, no plan
    const worst = (q.gas * 12n * q.maxFeePerGas) / 10n
    const maxGasWei = (worst * RESERVE_CUSHION) / 100n
    const L = ledger(env.store)
    if (b.kind === 'buy') {
      if (L.buyTxs + 1 > LIMITS.maxBuyTxs) throw new Stop(`budget: at most ${LIMITS.maxBuyTxs} market-buy transactions per episode (already used or reserved: ${L.buyTxs})`)
      if (L.buyMicro + BigInt(b.usdcMicro) > LIMITS.maxBuyMicro) throw new Stop(`budget: market buys would reach ${U.usdc(L.buyMicro + BigInt(b.usdcMicro))}, above the ${U.usdc(LIMITS.maxBuyMicro)} limit (already used or reserved: ${U.usdc(L.buyMicro)})`)
    }
    const gasLimit = limitFor(b.kind)
    const gasUsed = usedFor(b.kind)
    if (gasUsed + maxGasWei > gasLimit) throw new Stop(`budget: operator gas would exceed ${U.native(gasLimit)} (used or reserved: ${U.native(gasUsed)}, this step ${U.native(maxGasWei)})`)
    rec = { step: full, kind: b.kind, role: b.role, to: b.to, data: b.data, label: b.label, usdcMicro: b.usdcMicro, sats: b.sats, minOut: b.minOut, deadline: b.deadline, amount: b.amount ?? '0', side: b.side ?? 'none', maxGasWei: maxGasWei.toString() }
    map[full] = rec
    setRecs(env.store, { [PLANS]: map }) // persisted BEFORE signing
  }
  if (env.cancelled() && !env.store.load().steps[rec.step]) throw new Cancelled()
  const valueSpendWei = rec.kind === 'buy' ? BigInt(rec.usdcMicro) * 10n ** 12n : 0n // the swap input participates in the 2 USDC reserve check
  const done = await env.run({ step: rec.step, label: rec.label, role: rec.role, to: rec.to, data: rec.data, valueSpendWei }, { maxGasWei: BigInt(rec.maxGasWei) })
  env.out(`  receipt · ${rec.label} · ${U.explorerTx(done.txHash)}`)
  return done
}

// ------------------------------------------------------------------------------------------------ pure checks
export interface Check { name: string; ok: boolean; detail: string }

export function purchaseCheck(quoteAtoms: bigint, refPrice: bigint) {
  const gross = EQUITY * 2n
  const referenceAtoms = (gross * 10n ** 8n) / refPrice
  const referenceFloor = (referenceAtoms * 9700n) / 10_000n
  const coverageBps = (((quoteAtoms * refPrice) / 10n ** 8n) * 10_000n) / DEBT
  return { quoteAtoms, referenceAtoms, referenceFloor, coverageBps, ok: quoteAtoms >= referenceFloor && quoteAtoms > 0n && coverageBps >= 19_000n }
}

/** Existing positions at a candidate reference: refuse if any would become impaired or reach rebalance eligibility (<= 160%). */
export function positionsSafeAt(positions: PosV[], ref: bigint): string[] {
  const issues: string[] = []
  for (const p of positions) {
    if (p.status !== 1) continue
    const debt = p.principal + p.markup
    const value = (p.collateral * ref) / 10n ** 8n
    const net = (value * 9700n) / 10_000n
    if (net < p.principal) issues.push(`position ${p.id} would be impaired at ${U.price(ref)}`)
    else if (debt > 0n && (value * 10_000n) / debt <= 16_000n) issues.push(`position ${p.id} would be eligible for a coverage rebalance at ${U.price(ref)}`)
  }
  return issues
}

export function readiness(s: Snapshot, purchaseQuote: bigint): Check[] {
  const dev = devBps(s.pool.price, P80)
  const pc = purchaseCheck(purchaseQuote, P80)
  const exposure = s.positions.filter((p) => p.status === 1 && p.trader.toLowerCase() === BROWSER_TRADER.toLowerCase()).reduce((a, p) => a + p.principal, 0n)
  const headroom = s.vault.perAccountCap > exposure ? s.vault.perAccountCap - exposure : 0n
  const unsafe = positionsSafeAt(s.positions, P80)
  const abs = dev < 0n ? -dev : dev
  return [
    { name: 'pool near 80,000', ok: abs <= LIMITS.nearBps, detail: `${U.price(s.pool.price)} (${U.pct(dev)} vs 80,000)` },
    { name: 'reference fresh at 80,000', ok: s.oracle.fresh && s.oracle.price === P80 && s.oracle.expiresAt >= s.time + LIMITS.expiryMarginSec, detail: `${U.price(s.oracle.price)}, ${s.oracle.fresh ? 'fresh' : 'STALE'}, expires ${U.utc(s.oracle.expiresAt)}` },
    { name: '0.20 USDC acquisition quote at the planned 80,000 reference', ok: pc.ok, detail: `${pc.quoteAtoms} sats (floor ${pc.referenceFloor}), coverage ${U.ratio(pc.coverageBps)} (needs 190.00%)${s.oracle.price === P80 ? '' : `; the live reference is still ${U.price(s.oracle.price)}`}` },
    { name: 'vault accepts financing', ok: s.vault.blockersFinancing.length === 0 && s.vault.queueHead === s.vault.queueTail, detail: s.vault.blockersFinancing.length ? s.vault.blockersFinancing.join(', ') : s.vault.queueHead === s.vault.queueTail ? 'open, queue empty' : 'withdrawal queue not empty' },
    { name: 'vault cash and headroom', ok: s.vault.idle >= 2n * EQUITY && s.vault.headroom >= EQUITY, detail: `idle ${U.usdc(s.vault.idle)}, can finance ${U.usdc(s.vault.headroom)}` },
    { name: 'browser account headroom', ok: headroom >= EQUITY, detail: `${U.usdc(headroom)} left under the ${U.usdc(s.vault.perAccountCap)} cap` },
    { name: 'browser wallet funds', ok: s.browser.usdc >= EQUITY + 100_000n, detail: `${U.usdc(s.browser.usdc)} (needs the 0.10 contribution plus 0.10 gas reserve)` },
    { name: 'existing positions safe at 80,000', ok: unsafe.length === 0, detail: unsafe.length ? unsafe.join('; ') : `${s.positions.filter((p) => p.status === 1).length} live position(s) stay healthy` },
  ]
}

export function validateRiseTarget(p: PosV | undefined, id: bigint, readyAt: bigint): void {
  if (!p) throw new Stop(`position ${id} is not live (closed, never opened, or wrong ID). Nothing to raise for.`)
  if (p.status !== 1) throw new Stop(`position ${id} is not Active`)
  if (p.trader.toLowerCase() !== BROWSER_TRADER.toLowerCase()) throw new Stop(`position ${id} is not owned by the browser trader ${U.short(BROWSER_TRADER)}`)
  if (p.principal !== p.principal0 || p.markup !== p.markup0) throw new Stop(`position ${id} was partially repaid; this episode needs the untouched opening position`)
  if (p.principal !== EQUITY || p.markup !== MARKUP) throw new Stop(`position ${id} is ${U.usdc(p.principal)} principal / ${U.usdc(p.markup)} markup; this episode needs ${U.usdc(EQUITY)} / ${U.usdc(MARKUP)}`)
  if (p.collateral <= 0n) throw new Stop(`position ${id} holds no collateral`)
  if (p.openedAt <= readyAt) throw new Stop(`position ${id} was opened before prepare finished (${U.utc(p.openedAt)}); it cannot be this episode's target`)
}

// ------------------------------------------------------------------------------------------------ status / prepare
const explorerReceipt = (hash: string): string => U.explorerTx(hash)

export async function statusCmd(env: Env): Promise<void> {
  const s = await env.snapshot()
  const q = await env.quoteBuy(2n * EQUITY).catch(() => 0n)
  const o = (line: string): void => env.out(line)
  const led = ledger(env.store)
  const prep = getRec<{ ready?: boolean; readyAtTimestamp?: string }>(env.store, PREP)
  const rise = getRec<{ positionId?: string; done?: boolean }>(env.store, RISE)
  o(`Sacred demo · episode ${EPISODE_ID} · Arc Testnet (5042002) · block ${s.block}`)
  o(`Pool spot      ${U.price(s.pool.price)}  (${U.pct(devBps(s.pool.price, P80))} vs 80,000 · ${U.pct(devBps(s.pool.price, P100))} vs 100,000)`)
  o(`Reference      ${U.price(s.oracle.price)}  ${s.oracle.fresh ? 'fresh' : 'STALE'}  expires ${U.utc(s.oracle.expiresAt)} (testnet operator fixture)`)
  o(`Vault          idle ${U.usdc(s.vault.idle)} · can finance ${U.usdc(s.vault.headroom)} · queue ${s.vault.queueRequests} request(s) · ${s.vault.blockersFinancing.length ? 'blocked: ' + s.vault.blockersFinancing.join(', ') : 'financing open'}`)
  o(`Browser wallet ${U.short(BROWSER_TRADER)}  ${U.usdc(s.browser.usdc)}`)
  for (const p of s.positions) o(`Position ${p.id}    ${p.status === 1 ? 'active' : 'status ' + p.status} · owner ${U.short(p.trader)} · debt ${U.usdc(p.principal + p.markup)} · pledged ${U.btc(p.collateral)}`)
  o(`Operators      market ${U.usdc(s.operator.usdc)} + ${U.btc(s.operator.btc)} · deployer ${U.native(s.deployer.native)} · keeper ${U.native(s.keeper.native)} (gas reserve kept: ${U.usdc(LIMITS.signerReserveMicro)})`)
  o(`Budgets used   buys ${U.usdc(led.buyMicro)} of ${U.usdc(LIMITS.maxBuyMicro)} (${led.buyTxs}/${LIMITS.maxBuyTxs} tx) · gas ${U.native(led.gasWei)} of ${U.native(LIMITS.gasBudgetWei)} · keeper process gas ${U.native(led.processGasWei)} of ${U.native(LIMITS.processGasBudgetWei)}`)
  o(`Episode        prepare ${prep?.ready ? 'COMPLETE ' + U.utc(BigInt(prep.readyAtTimestamp ?? '0')) : 'not complete'} · rise ${rise?.done ? 'complete (position ' + rise.positionId + ')' : rise?.positionId ? 'in progress (position ' + rise.positionId + ')' : 'not started'}`)
  const needBuy = LIMITS.maxBuyMicro - led.buyMicro
  const reserve = LIMITS.signerReserveMicro
  const gasOk = (w: bigint) => w >= reserve * 10n ** 12n + 10n ** 15n
  o(`Funding        market wallet needs up to ${U.usdc(needBuy)} for buys + ${U.usdc(reserve)} gas reserve (has ${U.usdc(s.operator.usdc)}): ${s.operator.usdc >= needBuy + reserve ? 'ok' : 'INSUFFICIENT, add testnet USDC by hand'}`)
  o(`               restore sell is capped at ${U.btc(LIMITS.maxRestoreSats)} (market wallet holds ${U.btc(s.operator.btc)}) · deployer gas ${gasOk(s.deployer.native) ? 'ok' : 'BELOW RESERVE'} · keeper gas ${gasOk(s.keeper.native) ? 'ok' : 'BELOW RESERVE'}`)
  const checks = readiness(s, q)
  o('Readiness for the browser open:')
  for (const c of checks) o(`  [${c.ok ? 'ok' : '--'}] ${c.name}: ${c.detail}`)
  const ready = checks.every((c) => c.ok) && !!prep?.ready
  o(ready ? 'READY: the founder may open the 0.10 USDC position in the app.' : prep?.ready ? 'Prepare was completed earlier but live conditions have drifted (see above). Nothing runs automatically.' : 'NOT READY: run `bun run demo prepare --plan`, then `bun run demo prepare`.')
}

interface PreparePlan {
  restore: { kind: 'none' } | { kind: 'sell'; sats: bigint; quote: bigint; minOut: bigint } | { kind: 'buy'; usdc: bigint; quote: bigint; minOut: bigint }
}

export async function planPrepare(env: Env, s: Snapshot): Promise<PreparePlan> {
  const [lo, hi] = LIMITS.driftBand
  if (s.pool.price < lo || s.pool.price > hi) throw new Stop(`the pool (${U.price(s.pool.price)}) is outside ${U.price(lo)}..${U.price(hi)}; refusing to restore it automatically`)
  const unsafe = positionsSafeAt(s.positions, P80)
  if (unsafe.length) throw new Stop(`refusing to prepare: ${unsafe.join('; ')}`)
  const dev = devBps(s.pool.price, P80)
  let restore: PreparePlan['restore'] = { kind: 'none' }
  if (dev > LIMITS.noopBps) {
    const sats = restoreSellAtoms(s.pool.sqrt, s.pool.liquidity, P80).gross
    if (sats > LIMITS.maxRestoreSats) throw new Stop(`restoring needs ${U.btc(sats)}, above the ${U.btc(LIMITS.maxRestoreSats)} limit`)
    if (sats > s.operator.btc) throw new Stop(`the market wallet holds ${U.btc(s.operator.btc)}; it needs ${U.btc(sats)}. No funding transfer is made automatically`)
    const quote = await env.quoteSell(sats)
    const minOut = minOutSell(sats, quote, P80)
    if (minOut <= 0n) throw new Stop('computed minimum output is zero; refusing')
    restore = { kind: 'sell', sats, quote, minOut }
  } else if (dev < -LIMITS.noopBps) {
    const usdcIn = buyUsdcNeeded(s.pool.sqrt, s.pool.liquidity, P80).gross
    const L = ledger(env.store)
    if (L.buyMicro + usdcIn > LIMITS.maxBuyMicro) throw new Stop(`a restoring buy of ${U.usdc(usdcIn)} would exceed the ${U.usdc(LIMITS.maxBuyMicro)} buy budget`)
    if (usdcIn + LIMITS.signerReserveMicro > s.operator.usdc) throw new Stop(`the market wallet holds ${U.usdc(s.operator.usdc)}; it needs ${U.usdc(usdcIn)} plus the 2 USDC gas reserve`)
    const quote = await env.quoteBuy(usdcIn)
    const minOut = minOutBuy(usdcIn, quote, P80)
    if (minOut <= 0n) throw new Stop('computed minimum output is zero; refusing')
    restore = { kind: 'buy', usdc: usdcIn, quote, minOut }
  }
  return { restore }
}

const gasLine = (env: Env, kind: 'operator' | 'process'): string => {
  const L = ledger(env.store)
  return kind === 'operator'
    ? `  Gas: capped at ${U.native(LIMITS.gasBudgetWei)} for the whole episode (used or reserved so far ${U.native(L.gasWei)}); every transaction is re-checked against its own live estimate before signing; each signer keeps ${U.usdc(LIMITS.signerReserveMicro)}.`
    : `  Gas: capped at ${U.native(LIMITS.processGasBudgetWei)} for keeper processing (used or reserved so far ${U.native(L.processGasWei)}); the signer keeps ${U.usdc(LIMITS.signerReserveMicro)}.`
}

/** Print what was already persisted for a group of steps, exactly as saved. Used by --plan and before resuming. */
function showSaved(env: Env, names: string[]): boolean {
  let any = false
  const j = env.store.load().steps
  for (const n of names) {
    const p = livePlan(env.store, n)
    if (!p) continue
    any = true
    const st = j[p.step]
    env.out(`  saved: ${p.label} · to ${cs(p.to)}${p.kind === 'approve' ? ` · exact approval ${p.side === 'btc' ? U.btc(BigInt(p.amount)) : U.usdc(BigInt(p.amount))}` : p.kind === 'buy' ? ` · spend ${U.usdc(BigInt(p.usdcMicro))}, minimum ${U.btc(BigInt(p.minOut))}` : p.kind === 'sell' ? ` · sell ${U.btc(BigInt(p.sats))}, minimum ${U.usdc(BigInt(p.minOut))}` : ''} · ${st ? (st.phase === 'confirmed' ? 'confirmed ' + explorerReceipt(st.txHash) : 'signed (' + st.phase + '), will be reconciled, never resent blindly') : 'not signed yet'}`)
  }
  return any
}

export async function prepareCmd(env: Env, opts: { planOnly: boolean }): Promise<void> {
  const o = (line: string): void => env.out(line)
  if (getRec<{ ready?: boolean }>(env.store, PREP)?.ready) {
    o('Prepare is already complete for this episode; it is never repeated.')
    await statusCmd(env)
    return
  }
  const names = ['prepare.restore.approve', 'prepare.restore.swap', 'prepare.guard80']
  const s0 = await env.snapshot()
  const reserve = LIMITS.signerReserveMicro * 10n ** 12n
  const resuming = names.some((n) => livePlan(env.store, n))
  let plan: PreparePlan = { restore: { kind: 'none' } }
  o(`PREPARE PLAN  ${EPISODE_ID} · block ${s0.block} · pool ${U.price(s0.pool.price)} (${U.pct(devBps(s0.pool.price, P80))} vs 80,000)`)
  if (resuming) {
    o('  Existing saved intent is reconciled FIRST (exact bytes, no recomputation); no second restore is ever planned:')
    showSaved(env, names)
  } else {
    plan = await planPrepare(env, s0)
    if (s0.deployer.native < reserve + 10n ** 15n) throw new Stop('the deployer (price admin) is below its 2 USDC gas reserve')
    if (s0.operator.native < reserve + 10n ** 15n) throw new Stop('the market wallet is below its 2 USDC gas reserve')
    if (plan.restore.kind === 'sell') o(`  1. approve exactly ${U.btc(plan.restore.sats)}: token ${cs(env.a.btc)} → spender ${cs(env.a.smokeVenue)}; then ONE sell via ${cs(env.a.smokeVenue)}: expect ~${U.usdc(plan.restore.quote)}, minimum ${U.usdc(plan.restore.minOut)}`)
    else if (plan.restore.kind === 'buy') o(`  1. approve exactly ${U.usdc(plan.restore.usdc)}: token ${cs(env.a.usdc)} → spender ${cs(env.a.smokeVenue)}; then ONE buy via ${cs(env.a.smokeVenue)}: expect ~${U.btc(plan.restore.quote)}, minimum ${U.btc(plan.restore.minOut)}`)
    else o('  1. pool is already within 0.25% of 80,000: no market swap')
    o(`  2. AFTER the pool is verified near 80,000 and only if the reference is not already fresh at 80,000: deployer ${cs(env.a.deployer)} calls ${cs(env.a.guard)}.update(80,000)`)
    o('  3. verify: pool, reference, 0.20 USDC quote >= 190%, vault, headroom, queue, existing positions; only then mark READY')
    o('  (the swap is simulated by the journal after its approval confirms; it is not simulated here)')
  }
  o(gasLine(env, 'operator'))
  if (opts.planOnly) return
  if (!env.flags.yes && !(await env.confirm('Type PREPARE to sign these testnet transactions with the dedicated operator wallets: ', 'PREPARE'))) throw new Cancelled()

  // 1) restore: replay saved approval + swap byte-for-byte, or create them once
  const restoreWanted = plan.restore.kind !== 'none'
  if (restoreWanted || livePlan(env.store, names[0])) {
    const first = plan.restore
    await step(env, names[0], () => {
      if (first.kind === 'none') throw new Stop('internal: no restore plan')
      const toSell = first.kind === 'sell'
      const token = toSell ? env.a.btc : env.a.usdc
      const wanted = first.kind === 'sell' ? first.sats : first.usdc
      return { kind: 'approve', role: 'trader', to: token, data: env.enc.approve(token, env.a.smokeVenue, wanted), label: 'approve exact amount to the smoke venue', usdcMicro: '0', sats: '0', minOut: '0', deadline: '0', amount: wanted.toString(), side: toSell ? 'btc' : 'usdc' }
    })
    const swapSaved = !!livePlan(env.store, names[1])
    const now = await env.snapshot()
    const near = devBps(now.pool.price, P80)
    if (swapSaved || (near > LIMITS.noopBps || near < -LIMITS.noopBps)) {
      await step(env, names[1], async () => {
        const ap = livePlan(env.store, names[0])! // derived from the SAVED approval (exact amount and side)
        const amount = BigInt(ap.amount)
        const deadline = (await env.snapshot()).time + LIMITS.deadlineSec
        if (ap.side === 'btc') {
          const minOut = minOutSell(amount, await env.quoteSell(amount), P80)
          if (minOut <= 0n) throw new Stop('computed minimum output is zero; refusing')
          return { kind: 'sell', role: 'trader', to: env.a.smokeVenue, data: env.enc.sell(amount, minOut, deadline), label: `sell ${amount} sats to restore the pool toward 80,000`, usdcMicro: '0', sats: amount.toString(), minOut: minOut.toString(), deadline: deadline.toString() }
        }
        const minOut = minOutBuy(amount, await env.quoteBuy(amount), P80)
        if (minOut <= 0n) throw new Stop('computed minimum output is zero; refusing')
        return { kind: 'buy', role: 'trader', to: env.a.smokeVenue, data: env.enc.buy(amount, minOut, deadline), label: `buy ${amount} micro-USDC to restore the pool toward 80,000`, usdcMicro: amount.toString(), sats: '0', minOut: minOut.toString(), deadline: deadline.toString() }
      })
    } else o('  pool already near 80,000: the saved approval is left unused (no swap); revoke it by hand if you wish')
  }
  // 2) verify the pool BEFORE the reference moves, then the reference
  const s1 = await env.snapshot()
  const dev1 = devBps(s1.pool.price, P80)
  if ((dev1 < 0n ? -dev1 : dev1) > LIMITS.nearBps) throw new Stop(`after the restore the pool is ${U.price(s1.pool.price)} (${U.pct(dev1)}); the reference is NOT updated. Run status.`)
  const guardSaved = !!livePlan(env.store, names[2])
  const guardNeeded = guardSaved || !(s1.oracle.fresh && s1.oracle.price === P80 && s1.oracle.expiresAt >= s1.time + LIMITS.expiryMarginSec)
  if (guardNeeded) {
    const sent = !!env.store.load().steps[livePlan(env.store, names[2])?.step ?? '']
    const unsafe = positionsSafeAt(s1.positions, P80)
    if (!sent && unsafe.length) throw new Stop(`refusing to set the reference to 80,000: ${unsafe.join('; ')}`)
    await step(env, names[2], () => ({ kind: 'guard', role: 'deployer', to: env.a.guard, data: env.enc.guardUpdate(P80, s1.time - 2n), label: 'guard.update(80,000) after the verified pool', usdcMicro: '0', sats: '0', minOut: '0', deadline: '0' }))
  }
  const s2 = await env.snapshot()
  const checks = readiness(s2, await env.quoteBuy(2n * EQUITY).catch(() => 0n))
  for (const c of checks) o(`  [${c.ok ? 'ok' : '--'}] ${c.name}: ${c.detail}`)
  if (!checks.every((c) => c.ok)) throw new Stop('prepare transactions finished but live verification failed (see above); NOT marked ready')
  setRecs(env.store, { [PREP]: { ready: true, readyAtBlock: s2.block.toString(), readyAtTimestamp: s2.time.toString(), poolPrice: s2.pool.price.toString() } })
  o('READY. The founder may now open the 0.10 USDC contribution in the app. Nothing opens automatically.')
}

// ------------------------------------------------------------------------------------------------ rise
interface RiseRec { positionId: string; beforePrice: string; preparedBaseline: string; done?: boolean; result?: Record<string, string> }

export async function riseCmd(env: Env, id: bigint, opts: { planOnly: boolean }): Promise<void> {
  const o = (line: string): void => env.out(line)
  const prep = getRec<{ ready?: boolean; readyAtTimestamp?: string; poolPrice?: string }>(env.store, PREP)
  if (!prep?.ready) throw new Stop('prepare is not complete for this episode. Run `bun run demo prepare` first.')
  const bound = getRec<RiseRec>(env.store, RISE)
  if (bound && BigInt(bound.positionId) !== id) throw new Stop(`this episode is already bound to position ${bound.positionId}; it cannot be reused for position ${id}`)
  if (bound?.done) {
    o(`Rise for position ${id} is already complete. Reporting saved receipts only; nothing is spent again.`)
    for (const [k, v] of Object.entries(bound.result ?? {})) o(`  ${k}: ${v}`)
    for (const [k, v] of Object.entries(env.store.load().steps)) if (k.startsWith(`${PREFIX}.rise.${id}.`)) o(`  receipt · ${v.label} · ${explorerReceipt(v.txHash)}`)
    return
  }
  const s0 = await env.snapshot()
  validateRiseTarget(s0.positions.find((p) => p.id === id), id, BigInt(prep.readyAtTimestamp ?? '0')) // mandatory, before ANY replay or new purchase
  const pos = s0.positions.find((p) => p.id === id)!
  const savedNames = [1, 2].flatMap((i) => [`rise.${id}.buy${i}.approve`, `rise.${id}.buy${i}`])
  const guardName = `rise.${id}.guard100`
  const hasSaved = [...savedNames, guardName].some((n) => livePlan(env.store, n))
  const guardDone = !!env.store.load().steps[`${PREFIX}.${guardName}`]
  if (!guardDone && !hasSaved && !(s0.oracle.price === P80 && s0.oracle.fresh)) throw new Stop(`the reference is not the prepared fresh 80,000 (${U.price(s0.oracle.price)}, ${s0.oracle.fresh ? 'fresh' : 'stale'}); not acting`)
  const beforePrice = bound ? BigInt(bound.beforePrice) : s0.pool.price
  const baseline = BigInt(prep.poolPrice ?? '0')
  const dev0 = devBps(s0.pool.price, P100)
  const L = ledger(env.store)
  o(`RISE ${id}  ·  testnet market simulation (explicit, one-time; NOT automatic)`)
  o(`  position ${id}: ${U.short(pos.trader)} · debt ${U.usdc(pos.principal + pos.markup)} · pledged ${U.btc(pos.collateral)}`)
  o(`  pool now ${U.price(s0.pool.price)} (prepared baseline ${U.price(baseline)}) → target 100,000 (${U.pct(dev0)} away)`)
  if (hasSaved) {
    o('  Existing saved intent is reconciled FIRST (exact bytes, no recomputation); its spend is already counted once in the budget:')
    showSaved(env, [...savedNames, guardName])
  } else if (dev0 < -LIMITS.nearBps) {
    const left = LIMITS.maxBuyMicro - L.buyMicro
    const need = buyUsdcNeeded(s0.pool.sqrt, s0.pool.liquidity, P100).gross
    const spend = need < left ? need : left
    const q = spend > 0n ? await env.quoteBuy(spend) : 0n
    o(`  market buy: approve exactly ${U.usdc(spend)} (token ${cs(env.a.usdc)} → spender ${cs(env.a.smokeVenue)}), then buy via ${cs(env.a.smokeVenue)} from the market wallet ${cs(env.a.operator)} → ~${U.btc(q)}`)
    o(`  limits: ${U.usdc(left)} of buys and ${LIMITS.maxBuyTxs - L.buyTxs} buy tx left`)
    if (need > left) throw new Stop(`reaching 100,000 needs ${U.usdc(need)} but only ${U.usdc(left)} of the buy budget is left`)
  } else o('  pool is already near 100,000: no market buy needed')
  o(`  then: deployer ${cs(env.a.deployer)} calls ${cs(env.a.guard)}.update(100,000) only after the pool is verified`)
  o(gasLine(env, 'operator'))
  if (opts.planOnly) return
  if (!env.flags.yes && !(await env.confirm(`Type RISE ${id} to sign these testnet transactions with the dedicated operator wallets: `, `RISE ${id}`))) throw new Cancelled()
  if (!bound) setRecs(env.store, { [RISE]: { positionId: id.toString(), beforePrice: beforePrice.toString(), preparedBaseline: baseline.toString() } satisfies RiseRec })

  // 1) replay everything already saved, exactly, before ANY new purchase is considered
  for (let i = 1; i <= LIMITS.maxBuyTxs; i++) {
    if (livePlan(env.store, `rise.${id}.buy${i}.approve`) || livePlan(env.store, `rise.${id}.buy${i}`)) {
      await step(env, `rise.${id}.buy${i}.approve`)
      await step(env, `rise.${id}.buy${i}`, async () => buyFromApproval(env, id, i))
    }
  }
  // 2) only then, new purchases (if the pool is still short of the target)
  for (let i = 1; i <= LIMITS.maxBuyTxs; i++) {
    if (livePlan(env.store, `rise.${id}.buy${i}`)) continue
    const sn = await env.snapshot()
    const dev = devBps(sn.pool.price, P100)
    if (dev >= -LIMITS.nearBps) break
    if (dev > 100n) throw new Stop(`the pool is ${U.pct(dev)} above 100,000; not buying`)
    await step(env, `rise.${id}.buy${i}.approve`, () => {
      const remaining = LIMITS.maxBuyMicro - ledger(env.store).buyMicro
      const want = buyUsdcNeeded(sn.pool.sqrt, sn.pool.liquidity, P100).gross
      const amount = want < remaining ? want : remaining
      if (amount <= 0n) throw new Stop('the market-buy budget is exhausted before the pool reached 100,000')
      if (sn.operator.usdc < amount + LIMITS.signerReserveMicro) throw new Stop(`the market wallet needs ${U.usdc(amount)} plus the 2 USDC gas reserve (holds ${U.usdc(sn.operator.usdc)})`)
      return { kind: 'approve', role: 'trader', to: env.a.usdc, data: env.enc.approve(env.a.usdc, env.a.smokeVenue, amount), label: 'approve exact USDC to the smoke venue', usdcMicro: '0', sats: '0', minOut: '0', deadline: '0', amount: amount.toString(), side: 'usdc' }
    })
    await step(env, `rise.${id}.buy${i}`, async () => buyFromApproval(env, id, i))
  }
  const s1 = await env.snapshot()
  const dev1 = devBps(s1.pool.price, P100)
  if (dev1 < -100n || dev1 > 100n) throw new Stop(`the pool is ${U.price(s1.pool.price)} (${U.pct(dev1)} vs 100,000; needs +/-1%). The reference is NOT updated.`)
  await step(env, guardName, () => ({ kind: 'guard', role: 'deployer', to: env.a.guard, data: env.enc.guardUpdate(P100, s1.time - 2n), label: 'guard.update(100,000) after the verified pool', usdcMicro: '0', sats: '0', minOut: '0', deadline: '0' }))

  const s2 = await env.snapshot()
  if (s2.oracle.price !== P100 || !s2.oracle.fresh) throw new Stop(`the guard update is confirmed but the live reference reads ${U.price(s2.oracle.price)} (${s2.oracle.fresh ? 'fresh' : 'STALE'}); NOT marked done`)
  const quoteAll = await env.quoteSell(pos.collateral)
  const c = cashout(quoteAll, pos.principal + pos.markup, EQUITY)
  const gas = ledger(env.store).gasWei
  const result = {
    spotBefore: `${U.price(beforePrice)} (immediately before the first buy)`,
    spotAfter: `${U.price(s2.pool.price)} (${U.pct(devBps(s2.pool.price, beforePrice))} vs immediately before; ${U.pct(devBps(s2.pool.price, baseline))} vs the prepared baseline)`,
    reference: `${U.price(s2.oracle.price)} ${s2.oracle.fresh ? 'fresh' : 'STALE'}, expires ${U.utc(s2.oracle.expiresAt)}`,
    saleQuote: U.usdc(quoteAll),
    debt: U.usdc(pos.principal + pos.markup),
    estimatedTraderPayoutBeforeGas: U.usdc(c.payout),
    estimatedTraderProfitBeforeGas: `${c.profit >= 0n ? '+' : '-'}${U.usdc(c.profit < 0n ? -c.profit : c.profit)}`,
    operatorGasSpentThisEpisode: `${U.native(gas)} (market-maker side only; the trader's own open and close gas is separate and not included above)`,
  }
  setRecs(env.store, { [RISE]: { positionId: id.toString(), beforePrice: beforePrice.toString(), preparedBaseline: baseline.toString(), done: true, result } satisfies RiseRec })
  for (const [k, v] of Object.entries(result)) o(`  ${k}: ${v}`)
  o('This is an ESTIMATE and is unrealized until the owner closes.')
  o('Next: return to Trade → Sell collateral and close (owner).')
}

/** The buy spends EXACTLY what the saved approval covers (never recomputed from the pool). */
async function buyFromApproval(env: Env, id: bigint, i: number): Promise<Built> {
  const usdcIn = BigInt(livePlan(env.store, `rise.${id}.buy${i}.approve`)!.amount)
  const minOut = minOutBuy(usdcIn, await env.quoteBuy(usdcIn), P100)
  if (minOut <= 0n) throw new Stop('computed minimum output is zero; refusing')
  const deadline = (await env.snapshot()).time + LIMITS.deadlineSec
  return { kind: 'buy', role: 'trader', to: env.a.smokeVenue, data: env.enc.buy(usdcIn, minOut, deadline), label: `market buy ${usdcIn} micro-USDC toward 100,000`, usdcMicro: usdcIn.toString(), sats: '0', minOut: minOut.toString(), deadline: deadline.toString() }
}

// ------------------------------------------------------------------------------------------------ process (optional, one-shot)
export async function processCmd(env: Env, opts: { planOnly: boolean }): Promise<void> {
  const o = (line: string): void => env.out(line)
  const plans = plansOf(env.store)
  const nums = Object.values(plans).filter((p) => p.kind === 'process' && !p.abandoned).map((p) => Number(/process\.(\d+)/.exec(p.step)?.[1] ?? 0))
  const lastN = nums.length ? Math.max(...nums) : 0
  const last = lastN ? livePlan(env.store, `process.${lastN}`) : undefined
  const lastDone = last ? env.store.load().steps[last.step]?.phase === 'confirmed' : true
  if (last && !lastDone) {
    // A previous process transaction is saved or pending: reconcile IT first (the queue may already be empty because it was sent). No new step.
    o(`PROCESS: reconciling the saved processWithdrawals(16) call to ${cs(last.to)} first (exact bytes, never a second transaction while it is pending).`)
    o(gasLine(env, 'process'))
    if (opts.planOnly) return
    if (!env.flags.yes && !(await env.confirm('Type PROCESS to reconcile the saved testnet transaction with the dedicated keeper wallet: ', 'PROCESS'))) throw new Cancelled()
    await step(env, `process.${lastN}`)
    return
  }
  const s = await env.snapshot()
  if (s.vault.queueHead === s.vault.queueTail) return o('The withdrawal queue is empty: nothing to process.')
  const blocked = s.vault.blockersDeposit.filter((b) => ['stale_price', 'unsettled_impairment', 'pending_open'].includes(b))
  if (blocked.length) return o(`Queue has ${s.vault.queueRequests} request(s) but processing is blocked right now: ${blocked.join(', ')}. No-op.`)
  const reserve = LIMITS.signerReserveMicro * 10n ** 12n
  if (s.keeper.native < reserve + 10n ** 15n) throw new Stop('the keeper wallet is below its 2 USDC gas reserve')
  const data = env.enc.process(16n)
  await env.simulate('keeper', env.a.vault, data)
  o(`PROCESS: one call by the dedicated keeper ${cs(env.a.keeper)} to ${cs(env.a.vault)}.processWithdrawals(16) for ${s.vault.queueRequests} queued request(s). One shot, no loop.`)
  o(gasLine(env, 'process'))
  if (opts.planOnly) return
  if (!env.flags.yes && !(await env.confirm('Type PROCESS to sign this testnet transaction with the dedicated keeper wallet: ', 'PROCESS'))) throw new Cancelled()
  await step(env, `process.${lastN + 1}`, () => ({ kind: 'process', role: 'keeper', to: env.a.vault, data, label: 'processWithdrawals(16)', usdcMicro: '0', sats: '0', minOut: '0', deadline: '0' }))
}
