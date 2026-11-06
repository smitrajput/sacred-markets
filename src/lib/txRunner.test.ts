import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Abi, Address, Hex } from 'viem'

import { clearIntent, createIntentStore, readIntent, writeIntent, type KV } from './intent'
import { ARC_CHAIN_ID, recover, retryRefresh, runAction, singleFlight, stateFromIntent, type ActionPlan, type ActionState, type Replacement, type RunnerDeps, type WaitResult } from './txRunner'

const T: Address = '0x00000000000000000000000000000000000000a1'
const S: Address = '0x00000000000000000000000000000000000000b2'
const plan: ActionPlan = { label: 'deposit', approvals: [{ token: T, spender: S, amount: 100n }], call: { address: S, abi: [] as Abi, functionName: 'deposit', args: [100n] } }
const H = (n: number) => ('0x' + n.toString(16).padStart(64, '0')) as Hex
const ok = (replacement?: Replacement): WaitResult => ({ status: 'success', blockNumber: 77n, replacement })

function deps(over: Partial<RunnerDeps> = {}) {
  const log: string[] = []
  const persisted: Array<{ kind: string; hash: Hex; block?: bigint } | null> = []
  let allowance = 0n
  const d: RunnerDeps = {
    chainId: async () => ARC_CHAIN_ID,
    switchChain: async () => { log.push('switch') },
    allowance: async () => { log.push('allowance'); return allowance },
    approve: async (a) => { log.push('approve:' + a.amount); allowance = a.amount; return H(1) },
    simulate: async () => { log.push('simulate'); return { req: 1 } },
    send: async () => { log.push('send'); return H(2) },
    wait: async () => ok(),
    receipt: async () => undefined,
    refresh: async (b) => { log.push('refresh:' + b); return true },
    persist: (i) => { persisted.push(i) },
    ...over,
  }
  return { d, log, persisted, states: [] as ActionState[] }
}
const run = async (t: ReturnType<typeof deps>, p = plan) => runAction(t.d, p, (s) => t.states.push(s))
const sends = (t: ReturnType<typeof deps>) => t.log.filter((x) => x === 'send').length
const rejected = () => Object.assign(new Error('User rejected the request.'), { code: 4001 })

test('happy path: fresh allowance, exact approval, simulate, sign, receipt, then a refresh before success', async () => {
  const t = deps()
  const r = await run(t)
  assert.equal(r.phase, 'success')
  assert.equal(r.receiptBlock, 77n)
  assert.deepEqual(t.log, ['allowance', 'approve:100', 'allowance', 'simulate', 'send', 'refresh:77'])
  assert.deepEqual(t.states.map((s) => s.phase), ['allowance', 'approve-sign', 'approve-pending', 'simulating', 'sign', 'pending', 'refreshing', 'success'])
  assert.deepEqual(t.persisted.map((p) => p?.kind ?? null), ['approval', null, 'action', 'refresh', null], 'recorded at send, kept as a refresh record after the receipt, cleared only when the refresh succeeds')
})

test('no approval when the allowance is already sufficient (read fresh, not cached)', async () => {
  const t = deps({ allowance: async () => 100n })
  assert.equal((await run(t)).phase, 'success')
  assert.ok(!t.states.some((s) => s.phase === 'approve-sign'))
})

test('wrong network is switched first; a declined switch is a recoverable error', async () => {
  let chain = 1
  assert.equal((await run(deps({ chainId: async () => chain, switchChain: async () => { chain = ARC_CHAIN_ID } }))).phase, 'success')
  const no = deps({ chainId: async () => 1, switchChain: async () => { throw rejected() } })
  const r = await run(no)
  assert.equal(r.errorKind, 'rejected')
  assert.equal(sends(no), 0)
})

test('wallet rejection at the approval, and a reverting simulation, stop before anything is signed', async () => {
  const a = deps({ approve: async () => { throw rejected() } })
  assert.equal((await run(a)).errorKind, 'rejected')
  assert.ok(!a.log.includes('simulate'))
  const b = deps({ simulate: async () => { throw Object.assign(new Error('x'), { cause: { data: { errorName: 'FundingIsPaused' } } }) } })
  const r = await run(b)
  assert.equal(r.errorKind, 'simulation')
  assert.match(r.message ?? '', /FundingIsPaused/)
  assert.equal(sends(b), 0)
})

test('action receipt timeout: the main hash is retained, the state is "unconfirmed" (not an unsent failure), recovery never resends', async () => {
  const t = deps({ wait: async (h) => { if (h === H(2)) throw Object.assign(new Error('x'), { name: 'WaitForTransactionReceiptTimeoutError' }); return ok() } })
  const r = await run(t)
  assert.equal(r.phase, 'unconfirmed')
  assert.equal(r.unresolved, 'action')
  assert.equal(r.hash, H(2))
  assert.equal(r.approvalHash, H(1))
  assert.deepEqual(t.persisted[t.persisted.length - 1], { kind: 'action', hash: H(2) }, 'the intent record stays until resolved')
  // recovery while still pending: nothing resolved, nothing sent
  const still = await recover(t.d, r, (s) => t.states.push(s))
  assert.equal(still.phase, 'unconfirmed')
  assert.equal(still.hash, H(2))
  // recovery once mined: confirmed, refreshed, intent cleared
  const mined = deps({ receipt: async () => ok() })
  const done = await recover(mined.d, r, (s) => mined.states.push(s))
  assert.equal(done.phase, 'success')
  assert.equal(done.hash, H(2))
  assert.equal(sends(t), 1, 'exactly one send, ever')
  assert.equal(sends(mined), 0, 'recovery looked the transaction up and did not call send')
  assert.equal(mined.persisted[mined.persisted.length - 1], null)
})

test('approval timeout is its own case: approvalHash retained, no main hash, the action is never sent', async () => {
  const t = deps({ wait: async () => { throw Object.assign(new Error('x'), { name: 'WaitForTransactionReceiptTimeoutError' }) } })
  const r = await run(t)
  assert.equal(r.phase, 'unconfirmed')
  assert.equal(r.unresolved, 'approval')
  assert.equal(r.approvalHash, H(1))
  assert.equal(r.hash, undefined)
  assert.equal(sends(t), 0)
  const mined = deps({ receipt: async () => ok() })
  const done = await recover(mined.d, r, (s) => mined.states.push(s))
  assert.equal(done.phase, 'idle')
  assert.match(done.message ?? '', /approved twice|nothing is approved twice/i)
  assert.equal(sends(mined), 0)
})

test('an on-chain revert keeps the hash; recovery finds a reverted transaction without resending', async () => {
  const t = deps({ wait: async (h) => (h === H(1) ? ok() : { status: 'reverted', blockNumber: 2n }) })
  const r = await run(t)
  assert.equal(r.errorKind, 'reverted')
  assert.equal(r.hash, H(2))
  const timedOut = deps({ wait: async (h) => { if (h === H(2)) throw new Error('rpc down'); return ok() }, receipt: async () => ({ status: 'reverted', blockNumber: 3n }) })
  const u = await run(timedOut)
  const rec = await recover(timedOut.d, u, () => {})
  assert.equal(rec.errorKind, 'reverted')
  assert.equal(sends(timedOut), 1)
})

for (const where of ['approval', 'action'] as const) {
  test(`replacement on the ${where} path: repriced counts as the intended success, replaced and cancelled do not (even with a successful receipt)`, async () => {
    const waitWith = (rep?: Replacement) => async (h: Hex): Promise<WaitResult> => ((where === 'approval') === (h === H(1)) ? ok(rep) : ok())
    const repriced = deps({ wait: waitWith({ kind: 'repriced', hash: H(9) }) })
    const a = await run(repriced)
    assert.equal(a.phase, 'success')
    if (where === 'action') assert.equal(a.hash, H(9), 'the repriced transaction is the intended one')

    for (const kind of ['replaced', 'cancelled'] as const) {
      const t = deps({ wait: waitWith({ kind, hash: H(9) }) })
      const r = await run(t)
      assert.equal(r.phase, 'error')
      assert.equal(r.errorKind, kind)
      assert.match(r.message ?? '', /NOT confirmed/)
      assert.ok(t.log.some((l) => l.startsWith('refresh:')), 'chain state is refreshed')
      if (where === 'approval') {
        assert.equal(sends(t), 0, 'the approval sequence stops: the action is not sent')
        assert.ok(!t.log.includes('simulate'))
      }
      assert.equal(t.persisted[t.persisted.length - 1], null)
    }
  })
}

test('refresh: confirmed-but-refreshing blocks duplicate starts; an unavailable API ends as refresh-failed with the receipt kept; refresh-only recovery works', async () => {
  let release: (v: boolean) => void = () => {}
  const gate = new Promise<boolean>((r) => { release = r })
  const t = deps({ refresh: () => gate })
  const start = singleFlight(() => run(t))
  const first = start()
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(t.states[t.states.length - 1]?.phase, 'refreshing', 'the UI shows confirmed-but-refreshing')
  const sendsBefore = sends(t)
  await start() // duplicate start during the refresh is ignored
  assert.equal(sends(t), sendsBefore)
  release(false) // the API never caught up within its bounded wait
  await first
  const failed = t.states[t.states.length - 1]
  assert.equal(failed.phase, 'refresh-failed')
  assert.equal(failed.hash, H(2), 'the receipt link is retained')
  assert.equal(failed.receiptBlock, 77n)
  assert.match(failed.message ?? '', /confirmed/)
  assert.notEqual(failed.errorKind, 'reverted')
  // refresh-only recovery: the transaction is never touched
  const sendsAfter = sends(t)
  t.d.refresh = async () => true
  const rec = await retryRefresh(t.d, failed, (s) => t.states.push(s))
  assert.equal(rec.phase, 'success')
  assert.equal(sends(t), sendsAfter)
  // a refresh that throws is also "refresh-failed", not a failed transaction
  const thrown = deps({ refresh: async () => { throw new Error('api down') } })
  assert.equal((await run(thrown)).phase, 'refresh-failed')
})

test('unresolved-intent record is per chain+account and survives a remount', () => {
  const store = new Map<string, string>()
  const kv: KV = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) }
  assert.equal(readIntent(kv, ARC_CHAIN_ID, T), null)
  writeIntent(kv, ARC_CHAIN_ID, T, { id: 'deposit', kind: 'action', hash: H(2), label: 'deposit', at: 1 })
  assert.equal(readIntent(kv, ARC_CHAIN_ID, T)?.hash, H(2), 'a remounted component finds the unresolved transaction')
  assert.equal(readIntent(kv, ARC_CHAIN_ID, S), null, 'other accounts are unaffected')
  assert.equal(readIntent(kv, 1, T), null, 'other chains are unaffected')
  clearIntent(kv, ARC_CHAIN_ID, T)
  assert.equal(readIntent(kv, ARC_CHAIN_ID, T), null)
  store.set('sacred.intent.5042002.' + T.toLowerCase(), '{"hash":"nope"}')
  assert.equal(readIntent(kv, ARC_CHAIN_ID, T), null, 'a corrupt record is ignored, not trusted')
})

test('confirmed main intent persists through refresh-failed; a remount restores a refresh-only blocked state; refresh-only clears it; nothing is resent', async () => {
  const t = deps({ refresh: async () => false })
  const r = await run(t)
  assert.equal(r.phase, 'refresh-failed')
  assert.deepEqual(t.persisted[t.persisted.length - 1], { kind: 'refresh', hash: H(2), block: 77n }, 'the confirmed hash and block stay recorded')
  // "remount": the component only has the stored record
  const restored = stateFromIntent({ id: 'deposit', kind: 'refresh', hash: H(2), block: '77' }, 'deposit')
  assert.equal(restored.phase, 'refresh-failed')
  assert.equal(restored.hash, H(2))
  assert.equal(restored.receiptBlock, 77n)
  const other = stateFromIntent({ id: 'deposit', kind: 'refresh', hash: H(2), block: '77' }, 'claim')
  assert.equal(other.phase, 'refresh-failed', 'another button is blocked too')
  const t2 = deps()
  const done = await retryRefresh(t2.d, restored, (s) => t2.states.push(s))
  assert.equal(done.phase, 'success')
  assert.equal(t2.persisted[t2.persisted.length - 1], null, 'cleared only after the authoritative refresh succeeded')
  assert.equal(sends(t2), 0)
  assert.equal(sends(t), 1)
  // a failing refresh-only retry keeps the record
  const t3 = deps({ refresh: async () => false })
  assert.equal((await retryRefresh(t3.d, restored, () => {})).phase, 'refresh-failed')
  assert.notEqual(t3.persisted[t3.persisted.length - 1], null)
})

test('foreign intent recovery refreshes the state before writes are enabled', async () => {
  const foreign = stateFromIntent({ id: 'claim', kind: 'action', hash: H(5) }, 'deposit')
  assert.equal(foreign.unresolved, 'foreign')
  const bad = deps({ receipt: async () => ok(), refresh: async () => false })
  const a = await recover(bad.d, foreign, () => {})
  assert.equal(a.phase, 'refresh-failed', 'still blocked: data not refreshed')
  assert.deepEqual(bad.persisted[bad.persisted.length - 1], { kind: 'refresh', hash: H(5), block: 77n })
  const good = deps({ receipt: async () => ok(), refresh: async () => true })
  const b = await recover(good.d, foreign, () => {})
  assert.equal(b.phase, 'idle')
  assert.equal(good.persisted[good.persisted.length - 1], null)
  assert.equal(sends(good), 0)
})

test('a throwing persistence adapter after send never loses the hash and never looks like an unsent failure', async () => {
  const boom = () => { throw new Error('QuotaExceededError') }
  const timeout = () => Promise.reject(Object.assign(new Error('x'), { name: 'WaitForTransactionReceiptTimeoutError' }))
  const a = deps({ persist: boom, wait: async (h) => (h === H(2) ? timeout() : ok()) })
  const r = await run(a)
  assert.equal(r.phase, 'unconfirmed')
  assert.equal(r.hash, H(2), 'the main hash is retained')
  assert.match(r.message ?? '', /duplicate-send protection lasts only until this page is reloaded/)
  assert.equal(sends(a), 1)
  const resolved = deps({ persist: boom, receipt: async () => ok() })
  assert.equal((await recover(resolved.d, r, () => {})).phase, 'success')
  assert.equal(sends(resolved), 0)

  const b = deps({ persist: boom })
  assert.equal((await run(b)).phase, 'success', 'a failing store does not break a confirmed action')

  const c = deps({ persist: boom, wait: () => timeout() })
  const rc = await run(c)
  assert.equal(rc.phase, 'unconfirmed')
  assert.equal(rc.unresolved, 'approval')
  assert.equal(rc.approvalHash, H(1))
  assert.equal(sends(c), 0)
})

test('intent store falls back to memory when sessionStorage throws, and says it is degraded', () => {
  const kv: KV = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('full') }, removeItem: () => { throw new Error('denied') } }
  const st = createIntentStore(kv)
  st.write(ARC_CHAIN_ID, T, { id: 'deposit', kind: 'refresh', hash: H(2), label: 'deposit', at: 1, block: '77' })
  assert.equal(st.degraded, true)
  assert.equal(st.read(ARC_CHAIN_ID, T)?.block, '77', 'still blocked within this page session')
  st.clear(ARC_CHAIN_ID, T)
  assert.equal(st.read(ARC_CHAIN_ID, T), null)
  const none = createIntentStore(null)
  none.write(ARC_CHAIN_ID, T, { id: 'x', kind: 'action', hash: H(3), label: 'x', at: 1 })
  assert.equal(none.read(ARC_CHAIN_ID, T)?.hash, H(3))
})
