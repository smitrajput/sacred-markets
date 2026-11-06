import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keccak256, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { makeRunner, Stop, type ChainLike, type CoreState, type Plan, type RunDeps, type Store } from './journal'

// Test-only throwaway keys (not wallets anyone uses). No network and no live failure injection: everything is mocked.
const A = privateKeyToAccount(('0x' + '11'.repeat(32)) as Hex)
const B = privateKeyToAccount(('0x' + '22'.repeat(32)) as Hex)
const DEST: Address = '0x00000000000000000000000000000000000000aa'
const plan: Plan = { step: 'k.1.rebalance.2', label: 'test', role: 'keeper', to: DEST, data: '0x1234' }

type Rcpt = { status: 'success' | 'reverted'; blockNumber: bigint; gasUsed: bigint; effectiveGasPrice: bigint; contractAddress: null }

function setup(over: { signer?: typeof A; latest?: number; pending?: number; autoMine?: boolean } = {}) {
  let state: CoreState = { schemaVersion: 1, chainId: 5042002, steps: {}, records: {} }
  const store: Store = { load: () => structuredClone(state), save: (s) => { state = structuredClone(s) } }
  const chain = {
    sent: [] as Hex[],
    receipts: new Map<Hex, Rcpt>(),
    latest: over.latest ?? 7,
    pending: over.pending ?? over.latest ?? 7,
    autoMine: over.autoMine ?? true,
    crashOnSend: false,
    checkedWriteAhead: false,
  }
  const mock: ChainLike = {
    assertChain: async () => {},
    getReceipt: async (h) => chain.receipts.get(h),
    waitReceipt: async (h) => {
      const r = chain.receipts.get(h)
      if (!r) throw new Error('timeout')
      return r
    },
    nonce: async (_a, tag) => (tag === 'latest' ? chain.latest : chain.pending),
    call: async () => {},
    estimateGas: async () => 100_000n,
    fees: async () => ({ maxFeePerGas: 40_000_000_000n, maxPriorityFeePerGas: 1n }),
    balance: async () => 10n * 10n ** 18n,
    send: async (ser) => {
      if (chain.crashOnSend) throw new Error('process died before broadcast')
      // write-ahead: the hash of the exact bytes being sent is already in the journal
      const rec = Object.values(state.steps).find((s) => s.txHash === keccak256(ser))
      chain.checkedWriteAhead = !!rec
      chain.sent.push(ser)
      if (chain.autoMine) chain.receipts.set(keccak256(ser), { status: 'success', blockNumber: 100n, gasUsed: 50_000n, effectiveGasPrice: 20_000_000_000n, contractAddress: null })
      return keccak256(ser)
    },
    readReached: async () => {},
  }
  let signer = over.signer ?? A
  const deps: RunDeps = { store, chain: mock, signer: () => signer }
  return { deps, chain, store, setSigner: (s: typeof A) => { signer = s }, run: makeRunner(deps), state: () => state }
}

test('write-ahead: intent, nonce and hash are journaled before broadcast; success needs a re-read receipt', async () => {
  const t = setup()
  const rec = await t.run(plan)
  assert.equal(rec.phase, 'confirmed')
  assert.equal(rec.nonce, 7)
  assert.equal(t.chain.checkedWriteAhead, true)
  assert.equal(rec.calldataHash, keccak256(plan.data))
  assert.ok(!JSON.stringify(t.state()).includes('0x02'), 'no raw signed transaction is persisted')
})

test('confirmed resume: no resend, receipt re-read; a disagreeing chain stops the run', async () => {
  const t = setup()
  const first = await t.run(plan)
  const again = await t.run(plan)
  assert.equal(again.txHash, first.txHash)
  assert.equal(t.chain.sent.length, 1, 'nothing was sent again')
  t.chain.receipts.clear()
  await assert.rejects(t.run(plan), (e: Error) => e instanceof Stop && /chain disagrees/.test(e.message))
})

test('unknown nonce advance: the saved nonce was consumed by something else -> STOP, no resend', async () => {
  const t = setup({ autoMine: false })
  t.chain.crashOnSend = true
  await assert.rejects(t.run(plan), /process died/)
  t.chain.crashOnSend = false
  t.chain.latest = 8 // another transaction consumed nonce 7
  t.chain.pending = 8
  await assert.rejects(t.run(plan), (e: Error) => e instanceof Stop && /consumed on chain/.test(e.message))
  assert.equal(t.chain.sent.length, 0)
})

test('pending ambiguity: a pending tx at the signer blocks new steps; a lagging nonce stops resume; a pending saved tx is awaited, never resent', async () => {
  const t = setup({ latest: 7, pending: 8 })
  await assert.rejects(t.run(plan), (e: Error) => e instanceof Stop && /pending transaction/.test(e.message))

  const u = setup({ autoMine: false })
  u.chain.crashOnSend = true
  await assert.rejects(u.run(plan), /process died/)
  u.chain.crashOnSend = false
  u.chain.latest = 6 // chain nonce BELOW the saved nonce: nonsense, stop
  u.chain.pending = 6
  await assert.rejects(u.run(plan), (e: Error) => e instanceof Stop && /does not match the saved nonce/.test(e.message))

  const v = setup({ autoMine: false })
  v.chain.crashOnSend = true
  await assert.rejects(v.run(plan), /process died/)
  v.chain.crashOnSend = false
  v.chain.pending = 8 // the node holds it pending
  await assert.rejects(v.run(plan), (e: Error) => e instanceof Stop && /no receipt/.test(e.message))
  assert.equal(v.chain.sent.length, 0, 'a pending transaction is waited for, not resent')
})

test('identical-hash resend: only the identical bytes are retransmitted when latest == pending == saved nonce', async () => {
  const t = setup({ autoMine: false })
  t.chain.crashOnSend = true
  await assert.rejects(t.run(plan), /process died/)
  const saved = t.state().steps[plan.step]
  assert.equal(saved.phase, 'signed')
  t.chain.crashOnSend = false
  t.chain.autoMine = true
  const rec = await t.run(plan)
  assert.equal(rec.phase, 'confirmed')
  assert.equal(t.chain.sent.length, 1)
  assert.equal(keccak256(t.chain.sent[0]), saved.txHash, 'the retransmitted bytes hash to the journaled hash')
})

test('resume requires the same destination, calldata and the actual loaded signer', async () => {
  const t = setup()
  await t.run(plan)
  await assert.rejects(t.run({ ...plan, to: '0x00000000000000000000000000000000000000bb' }), /different destination, calldata or signer/)
  await assert.rejects(t.run({ ...plan, data: '0x9999' }), /different destination, calldata or signer/)
  t.setSigner(B)
  await assert.rejects(t.run(plan), /different destination, calldata or signer/)
  t.setSigner(A)
  assert.equal((await t.run(plan)).phase, 'confirmed')
})

test('durable keeper ids: a later legitimate action never reuses an old confirmed step', async () => {
  const t = setup()
  await t.run(plan)
  const next = await t.run({ ...plan, step: 'k.2.rebalance.2' })
  assert.equal(next.nonce, 7, 'new step reads the live nonce (mock unchanged)')
  assert.equal(t.chain.sent.length, 2, 'the second action is a real new transaction')
})
