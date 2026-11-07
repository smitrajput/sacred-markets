import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Address, Hex } from 'viem'

import { parseArgs } from './demoArgs'
import { BROWSER_TRADER, Cancelled, LIMITS, checkFinalPrereqs, P100, P80, PREFIX, getRec, ledger, positionsSafeAt, prepareCmd, processCmd, readiness, riseCmd, type Env, type PosV, type Snapshot } from './demoCore'
import { acquireLock, boundedChain, liveEnv } from './demoLive'
import { FINAL_PATH, LEGACY_PATH, LOCK_PATH, PROFILES } from './demoProfiles'
import { Stop, fileStore, type ChainLike, type CoreState, type Plan, type Store } from './journal'
import { sqrtForPrice } from './profitMath'
import * as U from './demoUnits'

const A = { guard: '0x0000000000000000000000000000000000000001', vault: '0x0000000000000000000000000000000000000002', engine: '0x0000000000000000000000000000000000000003', smokeVenue: '0x0000000000000000000000000000000000000004', usdc: '0x0000000000000000000000000000000000000005', btc: '0x0000000000000000000000000000000000000006', operator: '0x0000000000000000000000000000000000000007', deployer: '0x0000000000000000000000000000000000000008', keeper: '0x0000000000000000000000000000000000000009' } as const satisfies Record<string, Address>
const bal = { native: 20n * 10n ** 18n, usdc: 20_000_000n, btc: 8_000n }
const T0 = 1_800_000_000n
const hex = (o: unknown): Hex => `0x${Buffer.from(JSON.stringify(o, (_k, v: unknown) => (typeof v === 'bigint' ? `n${v}` : v))).toString('hex')}`
const unhex = (h: Hex): Record<string, string> => JSON.parse(Buffer.from(h.slice(2), 'hex').toString()) as Record<string, string>
const num = (s: string): bigint => BigInt(s.replace(/^n/, ''))

function memStore(): Store & { saves: number; state: CoreState } {
  const st = { saves: 0, state: { schemaVersion: 1, chainId: 5042002, steps: {}, records: {} } as CoreState, load() { return structuredClone(this.state) }, save(s: CoreState) { this.saves++; this.state = structuredClone(s) } }
  return st
}

interface World { gas?: bigint; fee?: bigint; price: bigint; liquidity: bigint; oracle: { price: bigint; fresh: boolean }; positions: PosV[]; queue: number; vaultBlockers: string[]; staleAfterGuard: boolean; failOn?: string; cancelled: boolean; swapTo?: bigint }
const newWorld = (over: Partial<World> = {}): World => ({ price: 83_000n * 1_000_000n, liquidity: 884_452n, oracle: { price: P100, fresh: true }, positions: [], queue: 0, vaultBlockers: [], staleAfterGuard: false, cancelled: false, ...over })
const pos = (over: Partial<PosV> = {}): PosV => ({ id: 5n, trader: BROWSER_TRADER, status: 1, openedAt: T0 + 100n, principal0: 100_000n, principal: 100_000n, markup0: 383n, markup: 383n, collateral: 247n, ...over })

function fakeEnv(w: World, store = memStore(), flags = { yes: true, replan: false }) {
  const executed: string[] = []
  const runCalls: { plan: Plan; bound: { maxGasWei: bigint } }[] = []
  const out: string[] = []
  const snapshot = (): Snapshot => ({
    block: 1n, time: T0 + BigInt(executed.length) * 10n,
    pool: { price: w.price, sqrt: sqrtForPrice(w.price), liquidity: w.liquidity },
    oracle: { price: w.oracle.price, observedAt: T0, expiresAt: T0 + 86_400n, fresh: w.oracle.fresh },
    positions: w.positions,
    vault: { queueHead: 0n, queueTail: BigInt(w.queue), idle: 10_000_000n, headroom: 2_000_000n, perAccountCap: 100_000n, blockersFinancing: w.vaultBlockers, blockersDeposit: w.vaultBlockers, fundingPaused: false, queueRequests: w.queue },
    operator: bal, deployer: bal, keeper: bal, browser: { native: bal.native, usdc: 5_000_000n, btc: 0n },
  })
  const env: Env = {
    episodeId: 'recording-20261107',
    a: A, store, flags,
    enc: { approve: (_t, _s, amount) => hex({ k: 'approve', amount }), sell: (a, m, d) => hex({ k: 'sell', a, m, d }), buy: (u, m, d) => hex({ k: 'buy', u, m, d }), guardUpdate: (p, ts) => hex({ k: 'guard', p, ts }), process: (m) => hex({ k: 'process', m }) },
    snapshot: () => Promise.resolve(snapshot()),
    quoteBuy: (u) => Promise.resolve(((u * 10n ** 8n) / w.price) * 99n / 100n),
    quoteSell: (s) => Promise.resolve((((s * w.price) / 10n ** 8n) * 99n) / 100n),
    gasQuote: () => Promise.resolve({ gas: w.gas ?? 100_000n, maxFeePerGas: w.fee ?? 25_000_000_000n }),
    simulate: () => Promise.resolve(),
    run: (plan: Plan, bound: { maxGasWei: bigint }) => {
      runCalls.push({ plan, bound })
      const s = store.load()
      const have = s.steps[plan.step]
      if (have) {
        assert.equal(have.calldataHash, plan.data, 'a saved step must be resumed with byte-identical calldata')
        if (have.phase !== 'confirmed') { // the shared journal finalizes a signed/broadcast step from its receipt; the on-chain effect already happened
          have.phase = 'confirmed'
          have.gasCostWei = '1000000000000000'
          s.steps[plan.step] = have
          store.save(s)
        }
        return Promise.resolve(have)
      }
      if (w.failOn === plan.step) {
        w.failOn = undefined
        return Promise.reject(new Error('simulated crash before the send'))
      }
      const d = unhex(plan.data)
      if (d.k === 'sell') w.price = w.swapTo ?? P80
      if (d.k === 'buy') w.price = w.swapTo ?? (plan.step.includes('prepare') ? P80 : P100 + 200_000_000n)
      if (d.k === 'guard') w.oracle = { price: num(d.p), fresh: !w.staleAfterGuard }
      executed.push(plan.step)
      const rec = { step: plan.step, label: plan.label, role: plan.role, signer: A.deployer, chainId: 5042002, nonce: executed.length, calldataHash: plan.data, gas: '1', maxFeePerGas: '1', maxPriorityFeePerGas: '0', txHash: `0x${String(executed.length).padStart(64, '0')}`, phase: 'confirmed', gasCostWei: '1000000000000000' } as unknown as CoreState['steps'][string]
      s.steps[plan.step] = rec
      store.save(s)
      return Promise.resolve(rec)
    },
    confirm: () => Promise.resolve(true),
    cancelled: () => w.cancelled,
    out: (l) => out.push(l),
  }
  return { env, executed, out, store, w, runCalls }
}
const prepared = (store: Store, readyAt = T0) => {
  const s = store.load()
  s.records['demo.prepare'] = { ready: true, readyAtTimestamp: readyAt.toString(), readyAtBlock: '1', poolPrice: P80.toString() }
  store.save(s)
}

test('arguments: strict, no accidental runs', () => {
  assert.equal(parseArgs([]).cmd, 'help')
  assert.equal(parseArgs(['--help']).cmd, 'help')
  assert.deepEqual(parseArgs(['rise', '5', '--plan']), { cmd: 'rise', id: 5n, plan: true, yes: false, replan: false })
  for (const bad of [['rise'], ['rise', 'abc'], ['rise', '05'], ['rise', '-1'], ['rise', '1.5'], ['rise', '5', '6'], ['status', '--yes'], ['prepare', '7'], ['prepare', '--plan', '--yes'], ['nope'], ['process', '--replan']]) assert.throws(() => parseArgs(bad), Error, JSON.stringify(bad))
})

test('units never round a small debt to zero', () => {
  assert.equal(U.usdc(383n), '0.000383 USDC')
  assert.equal(U.btc(247n), '0.00000247 cirBTC')
  assert.equal(U.price(80_000n * 1_000_000n), '80,000.00 USDC per cirBTC')
})

test('--plan never signs, never writes, never loads a signer', async () => {
  const f = fakeEnv(newWorld())
  await prepareCmd(f.env, { planOnly: true })
  assert.equal(f.executed.length, 0)
  assert.equal((f.store).saves, 0)
  assert.ok(f.out.join('\n').includes('PREPARE PLAN'))
  prepared(f.store)
  const saves = (f.store).saves
  const g = fakeEnv(newWorld({ price: P80, oracle: { price: P80, fresh: true }, positions: [pos()] }), f.store)
  await riseCmd(g.env, 5n, { planOnly: true })
  assert.equal(g.executed.length, 0)
  assert.equal((f.store).saves, saves)
})

test('prepare: restore, THEN reference, THEN verified READY; a rerun is a status, not a duplicate', async () => {
  const f = fakeEnv(newWorld({ oracle: { price: P100, fresh: true } }))
  await prepareCmd(f.env, { planOnly: false })
  assert.deepEqual(f.executed, [`${PREFIX}.prepare.restore.approve`, `${PREFIX}.prepare.restore.swap`, `${PREFIX}.prepare.guard80`])
  const swap = unhex(f.store.load().steps[`${PREFIX}.prepare.restore.swap`].calldataHash)
  assert.equal(swap.k, 'sell')
  assert.ok(num(swap.a) > 0n && num(swap.a) <= LIMITS.maxRestoreSats && num(swap.m) > 0n, 'bounded sell with a non-zero minimum')
  assert.equal(getRec<{ ready: boolean }>(f.store, 'demo.prepare')?.ready, true)
  const n = f.executed.length
  await prepareCmd(f.env, { planOnly: false })
  assert.equal(f.executed.length, n)
  assert.match(f.out.join('\n'), /already complete/)
})

test('prepare: pool below target uses a small exact USDC buy and counts it in the budget', async () => {
  const f = fakeEnv(newWorld({ price: 76_000n * 1_000_000n, oracle: { price: P80, fresh: true } }))
  await prepareCmd(f.env, { planOnly: false })
  assert.equal(unhex(f.store.load().steps[`${PREFIX}.prepare.restore.swap`].calldataHash).k, 'buy')
  assert.equal(ledger(f.store).buyTxs, 1)
  assert.ok(ledger(f.store).buyMicro > 0n && ledger(f.store).buyMicro <= LIMITS.maxBuyMicro)
})

test('prepare is NOT marked ready when live verification fails (stale reference after the update)', async () => {
  const f = fakeEnv(newWorld(), memStore())
  f.w.staleAfterGuard = true
  await assert.rejects(prepareCmd(f.env, { planOnly: false }), /verification failed/)
  assert.equal(getRec<{ ready?: boolean }>(f.store, 'demo.prepare')?.ready, undefined)
  const stale = readiness(fakeEnv(newWorld({ price: P80, oracle: { price: P80, fresh: false } })).env.a ? { ...(await fakeEnv(newWorld({ price: P80, oracle: { price: P80, fresh: false } })).env.snapshot()) } : ({} as Snapshot), 247n)
  assert.equal(stale.find((c) => c.name.startsWith('reference'))?.ok, false)
})

test('prepare refuses unsafe states: impaired/rebalance-eligible positions, out-of-band pool, oversized restore, drained wallets', async () => {
  assert.equal(positionsSafeAt([pos({ collateral: 150n })], P80).length, 1) // 150 sats at 80k: 120,000 value -> 119% coverage -> impaired
  assert.equal(positionsSafeAt([pos({ collateral: 190n })], P80).length, 1) // ~151% -> rebalance eligible
  assert.equal(positionsSafeAt([pos({ collateral: 247n })], P80).length, 0)
  await assert.rejects(prepareCmd(fakeEnv(newWorld({ positions: [pos({ collateral: 150n })] })).env, { planOnly: true }), /refusing to prepare/)
  await assert.rejects(prepareCmd(fakeEnv(newWorld({ price: 200_000n * 1_000_000n })).env, { planOnly: true }), /outside/)
  await assert.rejects(prepareCmd(fakeEnv(newWorld({ price: 119_000n * 1_000_000n, liquidity: 50_000_000n })).env, { planOnly: true }), /above the .* limit/)
})

const riseSetup = (over: Partial<World> = {}, p: Partial<PosV> = {}) => {
  const store = memStore()
  prepared(store, T0)
  return fakeEnv(newWorld({ price: P80, oracle: { price: P80, fresh: true }, positions: [pos(p)], ...over }), store)
}

test('rise refuses: unprepared, wrong id, wrong owner, closed, partial, wrong size, no collateral, pre-prepare, other binding', async () => {
  await assert.rejects(riseCmd(fakeEnv(newWorld({ positions: [pos()] })).env, 5n, { planOnly: true }), /prepare is not complete/)
  for (const [id, p, re] of [
    [9n, {}, /not live/],
    [5n, { trader: '0x1111111111111111111111111111111111111111' }, /not owned by the browser/],
    [5n, { status: 2 }, /not Active/],
    [5n, { principal: 60_000n }, /partially repaid/],
    [5n, { principal0: 200_000n, principal: 200_000n }, /needs 0\.100000 USDC/],
    [5n, { collateral: 0n }, /no collateral/],
    [5n, { openedAt: T0 - 5n }, /before prepare finished/],
  ] as const) await assert.rejects(riseCmd(riseSetup({}, p).env, id, { planOnly: true }), re)
  const f = riseSetup()
  const s = f.store.load()
  s.records['demo.rise'] = { positionId: '7', beforePrice: '1', preparedBaseline: '1' }
  f.store.save(s)
  await assert.rejects(riseCmd(f.env, 5n, { planOnly: true }), /already bound to position 7/)
})

test('rise: bounded buy, verified pool, THEN the reference; results are unrealized estimates; a rerun spends nothing', async () => {
  const f = riseSetup()
  await riseCmd(f.env, 5n, { planOnly: false })
  assert.deepEqual(f.executed, [`${PREFIX}.rise.5.buy1.approve`, `${PREFIX}.rise.5.buy1`, `${PREFIX}.rise.5.guard100`])
  assert.ok(ledger(f.store).buyMicro <= LIMITS.maxBuyMicro && ledger(f.store).buyTxs === 1)
  assert.match(f.out.join('\n'), /unrealized until the owner closes/)
  assert.match(f.out.join('\n'), /Sell collateral and close \(owner\)/)
  const again = fakeEnv(f.w, f.store)
  await riseCmd(again.env, 5n, { planOnly: false })
  assert.equal(again.executed.length, 0)
  assert.match(again.out.join('\n'), /already complete/)
})

test('crash between the approval and the buy: the plan was persisted BEFORE signing and resume reuses it byte-for-byte', async () => {
  const f = riseSetup()
  f.w.failOn = `${PREFIX}.rise.5.buy1`
  await assert.rejects(riseCmd(f.env, 5n, { planOnly: false }), /simulated crash/)
  const plans = getRec<Record<string, { data: Hex; amount: string }>>(f.store, 'demo.plans')!
  const approve = plans[`${PREFIX}.rise.5.buy1.approve`]
  const savedBuy = plans[`${PREFIX}.rise.5.buy1`]
  assert.ok(approve && savedBuy, 'both plans were persisted before the crash; nothing was signed for the buy')
  assert.equal(f.store.load().steps[`${PREFIX}.rise.5.buy1`], undefined)
  f.w.price = P80 - 1_000_000_000n // the market moved while we were down: a recomputed plan would differ
  const g = fakeEnv(f.w, f.store)
  await riseCmd(g.env, 5n, { planOnly: false })
  assert.equal(f.store.load().steps[`${PREFIX}.rise.5.buy1`].calldataHash, savedBuy.data, 'identical saved calldata')
  assert.equal(num(unhex(savedBuy.data).u), BigInt(approve.amount), 'the buy spends exactly what was approved')
  assert.ok(!g.executed.includes(`${PREFIX}.rise.5.buy1.approve`), 'no second approval')
  assert.equal(ledger(f.store).buyTxs, 1)
})

test('guard-only resume after the buys: no new buy, no recomputed spend', async () => {
  const f = riseSetup()
  f.w.failOn = `${PREFIX}.rise.5.guard100`
  await assert.rejects(riseCmd(f.env, 5n, { planOnly: false }), /simulated crash/)
  const spent = ledger(f.store).buyMicro
  const g = fakeEnv(f.w, f.store)
  await riseCmd(g.env, 5n, { planOnly: false })
  assert.deepEqual(g.executed, [`${PREFIX}.rise.5.guard100`])
  assert.equal(ledger(f.store).buyMicro, spent)
  assert.equal(f.w.oracle.price, P100)
})

test('budgets are cumulative across restarts: buys, buy count and gas', async () => {
  const f = riseSetup()
  const s = f.store.load()
  s.records['demo.plans'] = { [`${PREFIX}.prepare.restore.swap`]: { step: `${PREFIX}.prepare.restore.swap`, kind: 'buy', role: 'trader', to: A.smokeVenue, data: '0x', label: 'x', usdcMicro: '3000000', sats: '0', minOut: '1', deadline: '0', amount: '0', side: 'none', maxGasWei: '1000' } }
  s.steps[`${PREFIX}.prepare.restore.swap`] = { phase: 'confirmed', gasCostWei: '1000' } as never
  f.store.save(s)
  await assert.rejects(riseCmd(f.env, 5n, { planOnly: false }), /budget|buy budget is left/)
  const g = riseSetup()
  const s2 = g.store.load()
  s2.records['demo.plans'] = { [`${PREFIX}.prepare.restore.approve`]: { step: `${PREFIX}.prepare.restore.approve`, kind: 'approve', role: 'trader', to: A.btc, data: '0x', label: 'x', usdcMicro: '0', sats: '0', minOut: '0', deadline: '0', amount: '1', side: 'btc', maxGasWei: '1' } }
  s2.steps[`${PREFIX}.prepare.restore.approve`] = { phase: 'confirmed', gasCostWei: (199n * 10n ** 15n).toString() } as never
  g.store.save(s2)
  await assert.rejects(riseCmd(g.env, 5n, { planOnly: false }), /gas would exceed/)
})

test('an expired, never-signed swap plan blocks with instructions; --replan replaces only that one and keeps the budget', async () => {
  const f = riseSetup()
  f.w.failOn = `${PREFIX}.rise.5.buy1`
  await assert.rejects(riseCmd(f.env, 5n, { planOnly: false }), /simulated crash/)
  const s = f.store.load()
  const plans = s.records['demo.plans'] as Record<string, { deadline: string }>
  plans[`${PREFIX}.rise.5.buy1`].deadline = '1' // the buy plan expired while it was never signed (the approval is confirmed)
  f.store.save(s)
  const before = ledger(f.store)
  assert.equal(before.buyTxs, 1)
  await assert.rejects(riseCmd(fakeEnv(f.w, f.store).env, 5n, { planOnly: false }), /--replan/)
  await riseCmd(fakeEnv(f.w, f.store, { yes: true, replan: true }).env, 5n, { planOnly: false })
  const keys = Object.keys(f.store.load().records['demo.plans'] as object)
  assert.ok(keys.some((k) => k.endsWith('buy1~r1')) && getRec<{ done?: boolean }>(f.store, 'demo.rise')?.done === true)
  assert.equal(ledger(f.store).buyTxs, 1, 'the abandoned, never-signed reservation was released; exactly one buy counts')
})

test('cancellation before signing writes nothing and signs nothing', async () => {
  const f = fakeEnv(newWorld(), memStore())
  f.w.cancelled = true
  await assert.rejects(prepareCmd(f.env, { planOnly: false }), Cancelled)
  assert.equal(f.executed.length, 0)
  assert.equal((f.store).saves, 0)
})

test('lock: exclusive, and a leftover lock fails closed with instructions instead of being cleared', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-lock-'))
  const path = join(dir, 'x.lock')
  const release = acquireLock(path)
  assert.throws(() => acquireLock(path), (e: Error) => e instanceof Stop && /remove the file yourself/.test(e.message))
  release()
  assert.equal(existsSync(path), false)
  writeFileSync(path, '{"pid":999999,"at":"stale"}')
  assert.throws(() => acquireLock(path), /never cleared automatically/)
  assert.equal(existsSync(path), true)
})

test('process: empty queue is a no-op; a queue is one bounded keeper call with its own gas budget', async () => {
  const a = fakeEnv(newWorld())
  await processCmd(a.env, { planOnly: false })
  assert.equal(a.executed.length, 0)
  const b = fakeEnv(newWorld({ queue: 2 }))
  await processCmd(b.env, { planOnly: false })
  assert.deepEqual(b.executed, [`${PREFIX}.process.1`])
  assert.ok(ledger(b.store).processGasWei > 0n && ledger(b.store).gasWei === 0n)
})

// ============================================================================================ review fixes: real persisted states
const signedStep = (store: Store, step: string, over: Record<string, unknown> = {}) => {
  const s = store.load()
  const data = (s.records['demo.plans'] as Record<string, { data: Hex }>)[step].data
  s.steps[step] = { label: 'x', role: 'trader', signer: A.operator, chainId: 5042002, nonce: 3, to: A.smokeVenue, calldataHash: data, gas: '200000', maxFeePerGas: '30000000000', maxPriorityFeePerGas: '0', txHash: `0x${'ab'.repeat(32)}`, phase: 'broadcast', ...over } as never
  store.save(s)
}

test('gas bounds: a fee/gas jump above the persisted reservation stops BEFORE any signer, journal step or broadcast', async () => {
  const f = riseSetup()
  f.w.failOn = `${PREFIX}.rise.5.buy1`
  await assert.rejects(riseCmd(f.env, 5n, { planOnly: false }), /simulated crash/)
  const calls = f.runCalls.length
  f.w.fee = 400_000_000_000n // 16x: the saved, never-signed buy plan no longer fits its own reservation
  const g = fakeEnv(f.w, f.store)
  await assert.rejects(riseCmd(g.env, 5n, { planOnly: false }), /jumped above/)
  assert.ok(g.runCalls.every((c) => !c.plan.step.endsWith('buy1')), 'the runner was never invoked for the over-budget buy (confirmed steps are only re-verified)')
  assert.equal(f.store.load().steps[`${PREFIX}.rise.5.buy1`], undefined)
  assert.ok(calls >= 2)
})

test('gas bounds: a new step that cannot fit the cumulative budget is never persisted or signed; a swap carries its USDC into the reserve check', async () => {
  const bad = riseSetup({ fee: 2_000_000_000_000n })
  await assert.rejects(riseCmd(bad.env, 5n, { planOnly: false }), /budget: operator gas would exceed/)
  assert.equal(bad.runCalls.length, 0)
  assert.equal(getRec(bad.store, 'demo.plans'), undefined)
  const ok = riseSetup()
  await riseCmd(ok.env, 5n, { planOnly: false })
  const buy = ok.runCalls.find((c) => c.plan.step.endsWith('buy1'))!
  assert.ok(buy.plan.valueSpendWei! > 1_000_000n * 10n ** 12n, 'the buy spend (USDC x 1e12 wei) participates in the native reserve check')
  assert.equal(ok.runCalls.find((c) => c.plan.step.endsWith('approve'))!.plan.valueSpendWei, 0n)
  assert.ok(ok.runCalls.every((c) => c.bound.maxGasWei > 0n))
})

test('pending gas counts at the SIGNED gas x fee, not the obsolete reservation', () => {
  const f = riseSetup()
  const s = f.store.load()
  s.records['demo.plans'] = { [`${PREFIX}.x`]: { step: `${PREFIX}.x`, kind: 'buy', role: 'trader', to: A.smokeVenue, data: '0x', label: 'x', usdcMicro: '1', sats: '0', minOut: '1', deadline: '0', amount: '0', side: 'none', maxGasWei: '1' } }
  s.steps[`${PREFIX}.x`] = { phase: 'broadcast', gas: '200000', maxFeePerGas: '30000000000' } as never
  f.store.save(s)
  assert.equal(ledger(f.store).gasWei, 200_000n * 30_000_000_000n)
  assert.equal(ledger(f.store, `${PREFIX}.x`).gasWei, 0n, 'excluding a plan never double counts it')
})

test('rise: a saved buy larger than 2 USDC replays byte-for-byte even though the remaining budget is now smaller; --plan shows the intent and signs nothing', async () => {
  const f = riseSetup()
  f.w.failOn = `${PREFIX}.rise.5.buy1`
  await assert.rejects(riseCmd(f.env, 5n, { planOnly: false }), /simulated crash/)
  const plans = getRec<Record<string, { data: Hex; usdcMicro: string }>>(f.store, 'demo.plans')!
  const saved = plans[`${PREFIX}.rise.5.buy1`]
  assert.ok(BigInt(saved.usdcMicro) > 2_000_000n)
  const saves = (f.store).saves
  const p = fakeEnv(f.w, f.store)
  await riseCmd(p.env, 5n, { planOnly: true })
  assert.equal(p.runCalls.length, 0)
  assert.equal((f.store).saves, saves)
  assert.match(p.out.join('\n'), /saved: market buy/)
  signedStep(f.store, `${PREFIX}.rise.5.buy1.approve`, { phase: 'confirmed', blockNumber: '1', gasCostWei: '1' })
  const g = fakeEnv(f.w, f.store)
  await riseCmd(g.env, 5n, { planOnly: false })
  assert.equal(f.store.load().steps[`${PREFIX}.rise.5.buy1`].calldataHash, saved.data)
  assert.equal(ledger(f.store).buyMicro, BigInt(saved.usdcMicro), 'counted once')
  assert.ok(g.out.join('\n').includes('https://explorer.testnet.arc.io/tx/'), 'each receipt prints an explorer link')
})

test('rise: crash after the buy confirmed → guard-only resume, and a stale live reference is never reported done', async () => {
  const f = riseSetup()
  f.w.failOn = `${PREFIX}.rise.5.guard100`
  await assert.rejects(riseCmd(f.env, 5n, { planOnly: false }), /simulated crash/)
  f.w.staleAfterGuard = true
  await assert.rejects(riseCmd(fakeEnv(f.w, f.store).env, 5n, { planOnly: false }), /NOT marked done/)
  assert.equal(getRec<{ done?: boolean }>(f.store, 'demo.rise')?.done, undefined)
  assert.equal(ledger(f.store).buyTxs, 1)
})

test('rise: completed replay prints every receipt link and spends nothing; estimates are before gas with operator gas separate', async () => {
  const f = riseSetup()
  await riseCmd(f.env, 5n, { planOnly: false })
  const text = f.out.join('\n')
  assert.match(text, /estimatedTraderProfitBeforeGas/)
  assert.match(text, /operatorGasSpentThisEpisode/)
  assert.doesNotMatch(text, /gasAt25Gwei|gasAtLiveFeeCap/)
  const again = fakeEnv(f.w, f.store)
  await riseCmd(again.env, 5n, { planOnly: false })
  assert.equal(again.runCalls.length, 0)
  assert.equal(again.out.filter((l) => l.includes('/tx/0x')).length, 3)
})

test('prepare: the swap already happened on chain but its receipt was never saved → reconcile saved steps first; no second restore, then the reference', async () => {
  const f = fakeEnv(newWorld({ price: P80, oracle: { price: P100, fresh: true } }))
  // pretend an earlier run saved + signed the approval (confirmed) and the swap (broadcast, receipt missing) and the pool already moved
  const sellData = hex({ k: 'sell', a: 3_067n, m: 2_697_015n, d: T0 + 900n })
  const approveData = hex({ k: 'approve', amount: 3_067n })
  const s = f.store.load()
  const mk = (step: string, kind: string, data: Hex, extra: object) => ({ step, kind, role: 'trader', to: A.smokeVenue, data, label: kind, usdcMicro: '0', sats: '0', minOut: '0', deadline: '0', amount: '0', side: 'none', maxGasWei: '1000000000000000', ...extra })
  s.records['demo.plans'] = {
    [`${PREFIX}.prepare.restore.approve`]: mk(`${PREFIX}.prepare.restore.approve`, 'approve', approveData, { amount: '3067', side: 'btc' }),
    [`${PREFIX}.prepare.restore.swap`]: mk(`${PREFIX}.prepare.restore.swap`, 'sell', sellData, { sats: '3067', minOut: '2697015', deadline: (T0 + 900n).toString() }),
  }
  f.store.save(s)
  signedStep(f.store, `${PREFIX}.prepare.restore.approve`, { phase: 'confirmed', blockNumber: '1', gasCostWei: '1' })
  signedStep(f.store, `${PREFIX}.prepare.restore.swap`, { phase: 'broadcast' })
  await prepareCmd(f.env, { planOnly: false })
  assert.deepEqual(f.executed, [`${PREFIX}.prepare.guard80`], 'only the reference update was newly executed; the saved swap was reconciled, never replanned')
  assert.equal(Object.keys(getRec<object>(f.store, 'demo.plans')!).filter((k) => k.includes('restore.swap')).length, 1)
  assert.equal(getRec<{ ready?: boolean }>(f.store, 'demo.prepare')?.ready, true)
  assert.equal(f.store.load().steps[`${PREFIX}.prepare.restore.swap`].phase, 'confirmed')
})

test('process: a pending (signed) call is reconciled first, even when the queue is already empty; no second step is ever created', async () => {
  const f = fakeEnv(newWorld({ queue: 2 }))
  f.w.failOn = `${PREFIX}.process.1`
  await assert.rejects(processCmd(f.env, { planOnly: false }), /simulated crash/)
  signedStep(f.store, `${PREFIX}.process.1`, { role: 'keeper', to: A.vault })
  f.w.queue = 0 // the sent transaction already emptied the queue
  const g = fakeEnv(f.w, f.store)
  await processCmd(g.env, { planOnly: false })
  assert.equal(f.store.load().steps[`${PREFIX}.process.1`].phase, 'confirmed')
  assert.equal(Object.keys(getRec<object>(f.store, 'demo.plans')!).length, 1)
  const h = fakeEnv(f.w, f.store)
  await processCmd(h.env, { planOnly: false })
  assert.equal(h.runCalls.length, 0)
  assert.match(h.out.join('\n'), /queue is empty/)
})

test('printed plan shows checksummed destinations, the exact approval and the honest gas cap', async () => {
  const f = fakeEnv(newWorld())
  f.env.a = { ...A, smokeVenue: '0x1eae39a746c49708696fba57ce4a1948ea4337e4' }
  await prepareCmd(f.env, { planOnly: true })
  const text = f.out.join('\n')
  assert.ok(text.includes('0x1eaE39A746C49708696FBA57CE4a1948eA4337E4'), 'checksummed spender/destination')
  assert.match(text, /approve exactly [0-9.]+ cirBTC/)
  assert.match(text, /Gas: capped at 0\.200000 USDC for the whole episode/)
  assert.doesNotMatch(text, /https?:\/\/(?!explorer)/, 'no RPC URL or other endpoint is printed')
})

test('status labels the 0.20 USDC quote as measured at the PLANNED 80,000 reference', async () => {
  const f = fakeEnv(newWorld({ price: P80 }))
  await (await import('./demoCore')).statusCmd(f.env)
  assert.match(f.out.join('\n'), /acquisition quote at the planned 80,000 reference/)
  assert.match(f.out.join('\n'), /the live reference is still 100,000\.00/)
})

test('lock: write commands create the .tools directory first; the lock never touches a read-only path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-dir-'))
  const path = join(dir, 'nested', '.tools', 'x.lock')
  const release = acquireLock(path)
  assert.equal(existsSync(path), true)
  release()
})

test('the injected chain wrapper caps gas x fee inside the shared runner before it can sign', async () => {
  const base = { estimateGas: () => Promise.resolve(100_000n), fees: () => Promise.resolve({ maxFeePerGas: 400_000_000_000n, maxPriorityFeePerGas: 0n }) } as unknown as ChainLike
  const tight = boundedChain(base, () => 1_000_000_000_000_000n) // 0.001 USDC
  await tight.estimateGas({ account: A.operator, data: '0x' })
  await assert.rejects(tight.fees(), /jumped above/)
  const roomy = boundedChain(base, () => 10n ** 18n)
  await roomy.estimateGas({ account: A.operator, data: '0x' })
  assert.equal((await roomy.fees()).maxFeePerGas, 400_000_000_000n)
})

// ============================================================================================ two fixed episodes
const rehearsalOk = (): { steps: Record<string, { phase: string }>; records: Record<string, unknown> } => ({
  steps: { 'demo20261107.rise.5.guard100': { phase: 'confirmed' } },
  records: { 'demo.prepare': { ready: true }, 'demo.rise': { positionId: '5', done: true } },
})
const closed5 = (over: Partial<PosV> = {}): PosV => ({ id: 5n, trader: BROWSER_TRADER, status: 2, openedAt: 1n, principal0: 100_000n, principal: 0n, markup0: 383n, markup: 0n, collateral: 0n, ...over })
const quiet = () => fakeEnv(newWorld()).env.snapshot()

test('profiles: two fixed episodes, isolated journals, ONE shared exclusive lock, no user-chosen paths', async () => {
  assert.equal(PROFILES.legacy.episodeId, 'recording-20261107')
  assert.equal(PROFILES.final.episodeId, 'final-recording-20261107')
  assert.ok(LEGACY_PATH.endsWith('deployments/demo-recording-20261107.json') && FINAL_PATH.endsWith('deployments/demo-final-recording-20261107.json'))
  assert.notEqual(PROFILES.legacy.journalPath, PROFILES.final.journalPath)
  assert.equal(Object.keys(PROFILES).length, 2)
  assert.ok(LOCK_PATH.endsWith('.tools/demo-recording-20261107.lock'))
  for (const flag of ['--journal', '--episode', '--path', '--profile', '--reset']) assert.throws(() => parseArgs(['status', flag, 'x']), Error, flag)
  const legacy = liveEnv({ yes: false, replan: false })
  const final = liveEnv({ yes: false, replan: false }, PROFILES.final)
  assert.equal(legacy.episodeId, 'recording-20261107')
  assert.equal(legacy.prereq, undefined, 'the legacy rehearsal commands are unchanged: no extra prerequisite')
  assert.equal(final.episodeId, 'final-recording-20261107')
  assert.ok(final.prereq)
  // isolation, proven on independent TEMPORARY journals (never the real deployment journals)
  const tmp = mkdtempSync(join(tmpdir(), 'demo-iso-'))
  const one = fileStore(join(tmp, 'one.json'))
  const two = fileStore(join(tmp, 'two.json'))
  const sentinel = one.load()
  sentinel.records.sentinel = 'only-in-one'
  one.save(sentinel)
  assert.equal(one.load().records.sentinel, 'only-in-one')
  assert.deepEqual(two.load().records, {}, 'a write to one journal never appears in the other')
  assert.equal(existsSync(join(tmp, 'two.json')), false, 'reading an untouched journal creates no file')
  // both entrypoints use the same lock file: while one holds it the other fails closed
  const dir = mkdtempSync(join(tmpdir(), 'demo-two-'))
  const shared = join(dir, 'shared.lock')
  const release = acquireLock(shared)
  assert.throws(() => acquireLock(shared), /another demo run holds the lock/)
  release()
})

test('final recording prerequisites fail closed on every unmet case', async () => {
  const snap = await quiet()
  assert.deepEqual(checkFinalPrereqs({ rehearsal: rehearsalOk(), pos5: closed5(), snap }), [])
  const reasons = (over: Parameters<typeof checkFinalPrereqs>[0]) => checkFinalPrereqs(over).join(' | ')
  assert.match(reasons({ rehearsal: undefined, pos5: closed5(), snap }), /rehearsal journal does not exist/)
  const notDone = rehearsalOk(); notDone.records['demo.rise'] = { positionId: '5' }
  assert.match(reasons({ rehearsal: notDone, pos5: closed5(), snap }), /rise is not complete/)
  const wrongId = rehearsalOk(); wrongId.records['demo.rise'] = { positionId: '4', done: true }
  assert.match(reasons({ rehearsal: wrongId, pos5: closed5(), snap }), /bound to position 4, expected 5/)
  const pending = rehearsalOk(); pending.steps['demo20261107.rise.5.buy1'] = { phase: 'broadcast' }
  assert.match(reasons({ rehearsal: pending, pos5: closed5(), snap }), /unconfirmed step/)
  const noPrep = rehearsalOk(); delete (noPrep.records)['demo.prepare']
  assert.match(reasons({ rehearsal: noPrep, pos5: closed5(), snap }), /prepare was never completed/)
  assert.match(reasons({ rehearsal: rehearsalOk(), pos5: undefined, snap }), /could not be read/)
  assert.match(reasons({ rehearsal: rehearsalOk(), pos5: closed5({ trader: '0x1111111111111111111111111111111111111111' }), snap }), /not owned by the browser/)
  assert.match(reasons({ rehearsal: rehearsalOk(), pos5: closed5({ status: 1 }), snap }), /not closed/)
  assert.match(reasons({ rehearsal: rehearsalOk(), pos5: closed5({ collateral: 1n }), snap }), /still has principal, markup or collateral/)
  assert.match(reasons({ rehearsal: rehearsalOk(), pos5: closed5(), snap: { ...snap, positions: [pos({ id: 9n })] } }), /still owns an active position/)
  assert.match(reasons({ rehearsal: rehearsalOk(), pos5: closed5(), snap: { ...snap, vault: { ...snap.vault, queueTail: 2n } } }), /queue is not empty/)
})

test('final prepare: unmet prerequisites stop BEFORE any write or signature, --plan included; resume of saved steps is not blocked', async () => {
  for (const planOnly of [true, false]) {
    const f = fakeEnv(newWorld())
    f.env.prereq = () => Promise.resolve(['position 5 is not closed (status 1)'])
    await assert.rejects(prepareCmd(f.env, { planOnly }), /final recording cannot be prepared yet/)
    assert.equal(f.runCalls.length, 0)
    assert.equal((f.store).saves, 0)
    assert.doesNotMatch(f.out.join('\n'), /PREPARE PLAN/, 'no plan is shown while prerequisites fail')
  }
  // re-checked after the typed confirmation, immediately before anything is persisted
  const g = fakeEnv(newWorld(), memStore(), { yes: false, replan: false })
  let calls = 0
  g.env.prereq = () => Promise.resolve(++calls === 1 ? [] : ['the browser wallet still owns an active position'])
  await assert.rejects(prepareCmd(g.env, { planOnly: false }), /still owns an active position/)
  assert.equal(calls, 2)
  assert.equal(g.runCalls.length, 0)
  assert.equal((g.store).saves, 0)
  // satisfied prerequisites run the same planner and complete as before
  const h = fakeEnv(newWorld())
  h.env.prereq = () => Promise.resolve([])
  await prepareCmd(h.env, { planOnly: false })
  assert.equal(getRec<{ ready?: boolean }>(h.store, 'demo.prepare')?.ready, true)
  // saved steps are recovered even if the world changed (prerequisites apply to a FRESH prepare only)
  const r = fakeEnv(newWorld({ price: P80 }))
  const s = r.store.load()
  s.records['demo.plans'] = { [`${PREFIX}.prepare.guard80`]: { step: `${PREFIX}.prepare.guard80`, kind: 'guard', role: 'deployer', to: A.guard, data: hex({ k: 'guard', p: P80, ts: T0 }), label: 'guard', usdcMicro: '0', sats: '0', minOut: '0', deadline: '0', amount: '0', side: 'none', maxGasWei: '1000000000000000' } }
  r.store.save(s)
  r.env.prereq = () => Promise.reject(new Error('must not be consulted while resuming'))
  await prepareCmd(r.env, { planOnly: true })
  assert.match(r.out.join('\n'), /Existing saved intent is reconciled FIRST/)
})

test('status shows the prerequisite verdict for the final profile and stays read-only', async () => {
  const f = fakeEnv(newWorld({ price: P80 }))
  f.env.prereq = () => Promise.resolve(['the rehearsal rise is not complete'])
  await (await import('./demoCore')).statusCmd(f.env)
  assert.match(f.out.join('\n'), /Prerequisites NOT MET: the rehearsal rise is not complete/)
  assert.equal((f.store).saves, 0)
})
