import { test } from 'node:test'
import assert from 'node:assert/strict'

import { handleRequest, routes } from './routes.js'
import { healthHandler } from './handlers/health.js'
import { resolveRpcUrl, type FetchLike } from './rpc.js'

interface Health {
  status: string
  time: string
  mode: string
  signing: string
  chain: { chainId: number; rpc: { status: string; chainIdMatches: boolean; latestBlock: number } }
  contracts: { statuses: Record<string, string> }
  scheduler: { status: string; kind: string }
  deployment: Record<string, string | null>
}

const SECRET_TOKEN = 'tok_super_secret_value'
const SECRET_URL_PART = 'private-rpc.example'

function rpcFetch(chainIdHex: string, blockHex: string): FetchLike {
  return async (_url, init) => {
    const calls = JSON.parse(String(init?.body)) as Array<{ id: number; method: string }>
    return new Response(
      JSON.stringify(calls.map((c) => ({ jsonrpc: '2.0', id: c.id, result: c.method === 'eth_chainId' ? chainIdHex : blockHex }))),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
}

const baseEnv = { RPC_URL_Arc_Testnet: `https://${SECRET_URL_PART}/key/${SECRET_TOKEN}` }
const fixedNow = () => new Date('2026-11-06T12:00:00.000Z')

test('healthy: reachable RPC on the right chain reports ok with the real block number', async () => {
  const res = await healthHandler(new Request('http://x/api/health'), {
    env: baseEnv,
    fetchImpl: rpcFetch('0x4cef52', '0x43bd2c4'),
    now: fixedNow,
  })
  assert.equal(res.status, 200)
  const body = (await res.json()) as Health
  assert.equal(body.status, 'ok')
  assert.equal(body.chain.chainId, 5042002)
  assert.equal(body.chain.rpc.status, 'reachable')
  assert.equal(body.chain.rpc.chainIdMatches, true)
  assert.equal(body.chain.rpc.latestBlock, 0x43bd2c4)
  assert.equal(body.time, '2026-11-06T12:00:00.000Z')
  assert.equal(body.mode, 'read-only')
  assert.equal(body.signing, 'none')
})

test('wrong chain id is degraded, not ok', async () => {
  const res = await healthHandler(new Request('http://x/health'), { env: baseEnv, fetchImpl: rpcFetch('0x1', '0x10') })
  const body = (await res.json()) as Health
  assert.equal(body.status, 'degraded')
  assert.equal(body.chain.rpc.chainIdMatches, false)
})

test('unreachable RPC is degraded and the error never leaks the URL or token', async () => {
  const failing: FetchLike = async () => {
    throw new Error(`connect ECONNREFUSED https://${SECRET_URL_PART}/key/${SECRET_TOKEN}`)
  }
  const res = await healthHandler(new Request('http://x/health'), { env: baseEnv, fetchImpl: failing })
  assert.equal(res.status, 200)
  const text = await res.text()
  assert.match(text, /"status": "degraded"/)
  assert.match(text, /"reason": "rpc_unreachable"/)
  assert.ok(!text.includes(SECRET_TOKEN) && !text.includes(SECRET_URL_PART))
})

test('response never contains environment secrets', async () => {
  const env = { ...baseEnv, RPC_PROXY_TOKEN: 'proxy_secret_abc', RPC_PROXY_BASE_URL: 'https://proxy.example', CIRCLE_API_KEY: 'circle_secret' }
  const res = await healthHandler(new Request('http://x/health'), { env, fetchImpl: rpcFetch('0x4cef52', '0x1') })
  const text = await res.text()
  for (const secret of [SECRET_TOKEN, 'proxy_secret_abc', 'circle_secret', 'proxy.example']) assert.ok(!text.includes(secret), secret)
})

test('contracts and scheduler are reported honestly', async () => {
  const res = await healthHandler(new Request('http://x/health'), { env: baseEnv, fetchImpl: rpcFetch('0x4cef52', '0x1') })
  const body = (await res.json()) as Health
  assert.deepEqual(body.contracts.statuses, { usdcEarn: 'deployed', cirBtcSpotFinancing: 'deployed', demoPriceGuard: 'deployed', productionVenue: 'deployed' })
  assert.equal(body.scheduler.status, 'unavailable')
  assert.equal(body.scheduler.kind, 'external')
})

test('deployment block reflects the Vercel environment', async () => {
  const env = { ...baseEnv, VERCEL: '1', VERCEL_ENV: 'production', VERCEL_REGION: 'iad1', VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890' }
  const body = (await (await healthHandler(new Request('http://x/health'), { env, fetchImpl: rpcFetch('0x4cef52', '0x1') })).json()) as Health
  assert.deepEqual(body.deployment, { host: 'vercel', environment: 'production', region: 'iad1', commit: 'abcdef1' })
})

test('router: only GET and HEAD are routable; HEAD has no body; unknown paths 404', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await handleRequest(new Request('http://x/api/health', { method }))
    assert.equal(res.status, 405, method)
    assert.equal(res.headers.get('allow'), 'GET, HEAD')
  }
  assert.equal((await handleRequest(new Request('http://x/api/nope'))).status, 404)
  assert.equal((await handleRequest(new Request('http://x/api/sign'))).status, 404)
  assert.deepEqual(Object.keys(routes).sort(), ['/api/activity', '/api/config', '/api/health', '/api/positions', '/api/vault', '/health'])
})

test('RPC URL resolution order: override, then proxy, then public facts', () => {
  assert.equal(resolveRpcUrl('Arc_Testnet', 5042002, { RPC_URL_Arc_Testnet: 'https://override' }), 'https://override')
  assert.equal(
    resolveRpcUrl('Arc_Testnet', 5042002, { RPC_PROXY_BASE_URL: 'https://p', RPC_PROXY_TOKEN: 't', RPC_PROXY_CHAINS: 'Base_Sepolia,Arc_Testnet' }),
    'https://p/api/rpc/Arc_Testnet?_rpc_token=t',
  )
  assert.equal(resolveRpcUrl('Arc_Testnet', 5042002, { RPC_PROXY_BASE_URL: 'https://p', RPC_PROXY_TOKEN: 't', RPC_PROXY_CHAINS: 'Base_Sepolia' }), 'https://rpc.testnet.arc.io')
  assert.equal(resolveRpcUrl('Arc_Testnet', 5042002, {}), 'https://rpc.testnet.arc.io')
})
