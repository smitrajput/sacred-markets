import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QueryClient, QueryObserver } from '@tanstack/react-query'

import { authoritativeRefresh } from './api'

// These tests use a REAL QueryClient with active QueryObservers (no mocked refresh result).
const env = (block: number) => ({ chainId: 5042002, observedBlock: String(block), observedAt: '1', manifestPolicyHash: '0x' })
const fast = { attempts: 3, delayMs: 1, otherMs: 15, fetchVault: async () => env(77) }

function watch(qc: QueryClient, key: unknown[], fn: () => Promise<unknown>, seed?: unknown) {
  if (seed !== undefined) qc.setQueryData(key, seed)
  const obs = new QueryObserver(qc, { queryKey: key, queryFn: fn, retry: false, staleTime: 0 })
  return obs.subscribe(() => {}) // an active query, as a mounted component would hold
}

test('success needs EVERY active vault and positions query to succeed at >= the receipt block', async () => {
  const qc = new QueryClient()
  const stops = [
    watch(qc, ['api', 'vault', '0xabc'], async () => env(77), env(76)),
    watch(qc, ['api', 'positions', '0xabc'], async () => env(77), env(76)),
    watch(qc, ['api', 'positions', 'all'], async () => env(78), env(76)),
  ]
  assert.equal(await authoritativeRefresh(qc, 77n, fast), true)
  stops.forEach((u) => u())
})

test('the reproduced bug: positions status=error with displayed block 76 while the vault is at 77 -> NOT refreshed', async () => {
  const qc = new QueryClient()
  const stops = [
    watch(qc, ['api', 'vault', '0xabc'], async () => env(77), env(76)), // owner vault reaches block 77
    watch(qc, ['api', 'positions', '0xabc'], async () => { throw new Error('503') }, env(76)), // owner positions keep failing
  ]
  // the ownerless endpoint is at 77 (what the old code looked at)
  const ok = await authoritativeRefresh(qc, 77n, { ...fast, fetchVault: async () => env(77) })
  assert.equal(ok, false, 'bounded wait ends as confirmed-but-outdated')
  const positions = qc.getQueryCache().find({ queryKey: ['api', 'positions', '0xabc'] })
  assert.equal(positions?.state.status, 'error')
  stops.forEach((u) => u())
})

test('recovery: once the owner queries catch up, a refresh-only retry succeeds', async () => {
  const qc = new QueryClient()
  let block = 76
  const stops = [watch(qc, ['api', 'vault', '0xabc'], async () => env(block), env(76)), watch(qc, ['api', 'positions', '0xabc'], async () => env(block), env(76))]
  assert.equal(await authoritativeRefresh(qc, 77n, fast), false)
  block = 77
  assert.equal(await authoritativeRefresh(qc, 77n, fast), true)
  stops.forEach((u) => u())
})

test('no vault/positions query on screen (Activity tab): the API itself is checked', async () => {
  const qc = new QueryClient()
  assert.equal(await authoritativeRefresh(qc, 77n, { ...fast, fetchVault: async () => env(77) }), true)
  assert.equal(await authoritativeRefresh(qc, 78n, { ...fast, fetchVault: async () => env(77) }), false)
  assert.equal(await authoritativeRefresh(qc, 77n, { ...fast, fetchVault: async () => { throw new Error('down') } }), false)
})

test('activity and quote queries can never be a barrier, even if they hang or fail', async () => {
  const qc = new QueryClient()
  const hang = () => new Promise<never>(() => {})
  const stops = [
    watch(qc, ['api', 'vault', '0xabc'], async () => env(77), env(76)),
    watch(qc, ['api', 'activity', 'first'], hang),
    watch(qc, ['quote', '200000'], hang),
    watch(qc, ['api', 'config'], async () => { throw new Error('boom') }),
  ]
  const started = Date.now()
  assert.equal(await authoritativeRefresh(qc, 77n, fast), true)
  assert.ok(Date.now() - started < 1000, 'bounded')
  stops.forEach((u) => u())
})
