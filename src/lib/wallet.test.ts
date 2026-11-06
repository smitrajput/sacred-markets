import { test } from 'node:test'
import assert from 'node:assert/strict'
import { erc20Abi } from 'viem'
import { connect, disconnect } from 'wagmi/actions'

import { newCtl, testConfig, type WalletCtl } from './walletTestKit'
import { recover, retryRefresh, runAction, stateFromIntent, type ActionPlan, type ActionState } from './txRunner'
import { makeRunnerDeps, resolveSigner } from './wallet'

// Real Wagmi core (connect / switchChain / getConnectorClient) over a deterministic scripted wallet. No real wallet, no network.
const SPENDER = '0x00000000000000000000000000000000000000b2' as const
const plan: ActionPlan = { label: 'deposit', approvals: [], call: { address: SPENDER, abi: erc20Abi, functionName: 'transfer', args: [SPENDER, 1n] } }
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const prompts = (c: WalletCtl) => c.log.filter((l) => l.startsWith('PROMPT')).length

async function setup(over: Partial<WalletCtl> = {}) {
  const ctl = newCtl(over)
  const config = testConfig(ctl)
  await connect(config, { connector: config.connectors[0] })
  // Stop right after the wallet prompt: nothing is sent anywhere and no success is faked.
  const extras = { refresh: async () => true, persist: () => {} }
  const deps = { ...makeRunnerDeps(config, ctl.account, extras), wait: (): Promise<never> => Promise.reject(new Error('test stops after the wallet prompt')) }
  const states: ActionState[] = []
  return { ctl, config, deps, states, run: () => runAction(deps, plan, (s) => states.push(s)) }
}

test('connected wallet whose signing client is still initialising: waits, validates, prompts once (never "Connect a wallet first")', async () => {
  const t = await setup({ providerDelayMs: 150 })
  const r = await t.run()
  assert.equal(prompts(t.ctl), 1, 'the wallet prompt was requested')
  assert.ok(!/Connect a wallet first/i.test(r.message ?? ''))
  assert.equal(r.phase, 'unconfirmed', 'the hash is retained once the wallet signed')
})

test('wrong network: the wallet is switched to Arc and the SAME flow signs on the refreshed client', async () => {
  const t = await setup({ chainId: 1 })
  const r = await t.run()
  assert.ok(t.ctl.log.includes('switch:5042002'))
  assert.equal(t.ctl.chainId, 5042002)
  assert.equal(prompts(t.ctl), 1)
  assert.equal(r.phase, 'unconfirmed')
})

test('a declined network switch is a rejection, nothing is signed', async () => {
  const t = await setup({ chainId: 1, switchError: 'User rejected the request.' })
  const r = await t.run()
  assert.equal(r.errorKind, 'rejected')
  assert.equal(prompts(t.ctl), 0)
})

test('connector initialisation failure says what failed, not "not connected"', async () => {
  const t = await setup()
  t.ctl.providerError = 'provider init failed'
  const r = await t.run()
  assert.equal(r.phase, 'error')
  assert.match(r.message ?? '', /connected, but its signing client could not be initialised \(provider init failed\)/)
  assert.doesNotMatch(r.message ?? '', /Connect a wallet first|not connected/i)
  assert.equal(prompts(t.ctl), 0)
})

test('disconnect during preparation aborts before any signature', async () => {
  const t = await setup({ providerDelayMs: 200 })
  const running = t.run()
  await sleep(60)
  await disconnect(t.config)
  const r = await running
  assert.equal(r.phase, 'error')
  assert.match(r.message ?? '', /disconnected|not connected/i)
  assert.equal(prompts(t.ctl), 0)
})

test('account change during preparation aborts before any signature', async () => {
  const t = await setup({ providerDelayMs: 200 })
  const running = t.run()
  await sleep(60)
  t.ctl.account = '0x1111111111111111111111111111111111111111'
  t.ctl.emitChange?.({ accounts: [t.ctl.account] })
  const r = await running
  assert.equal(r.phase, 'error')
  assert.match(r.message ?? '', /account changed/i)
  assert.equal(prompts(t.ctl), 0)
})

test('a truly disconnected account gets the connect message (and only that case does)', async () => {
  const ctl = newCtl()
  const config = testConfig(ctl)
  await assert.rejects(resolveSigner(config, ctl.account), /not connected/i)
})

test('recovery and refresh never resolve a signing client or touch the wallet', async () => {
  const t = await setup()
  t.ctl.providerError = 'would fail if asked' // any attempt to get a signing client would throw and show up in the log
  const pending = stateFromIntent({ id: 'deposit', kind: 'action', hash: `0x${'cd'.repeat(32)}` }, 'deposit')
  const still = await recover(t.deps, pending, () => {})
  assert.equal(still.phase, 'unconfirmed', 'no receipt yet: reported, not an error')
  const refreshed = await retryRefresh(t.deps, { phase: 'refresh-failed', hash: `0x${'cd'.repeat(32)}`, receiptBlock: 5n }, () => {})
  assert.equal(refreshed.phase, 'success')
  assert.ok(!t.ctl.log.includes('getProvider') || t.ctl.log.filter((l) => l === 'getProvider').length <= 1, 'only the initial connect asked the connector for its provider')
  assert.equal(prompts(t.ctl), 0)
})
