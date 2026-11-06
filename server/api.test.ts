import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, encodeEventTopics, type Address } from 'viem'

import { marginVaultAbi } from '../src/contracts/abis.js'
import type { RawLog, Reader } from './chain.js'
import { ACTIVITY_MAX_ROWS, ACTIVITY_RANGE, ACTIVITY_WINDOWS, activityHandler, configHandler, decodeCursor, encodeCursor, positionsHandler, vaultHandler } from './handlers/chainApi.js'
import { core } from './manifest.js'

const OWNER = '0xbcA3D93DE6932535A117588744557537694A3e6c'
const HEAD = 71_050_000n

const state = {
  depositorIdleCash: 840877n, outstandingPrincipal: 59388n, commitments: 0n, pendingGrossCash: 0n, nav: 900265n, totalShares: 900000n,
  managerCash: 89n, primaryReserve: 4000n, tailReserve: 6000n, pilotBackstop: 0n, claimableWithdrawals: 0n, primaryTarget: 4000n, tailTarget: 6000n,
  queueHead: 1n, queueTail: 1n, livePositions: 1n, pendingOpens: 0n, activeRequests: 0n, financingCeiling: 1000000n, perAccountCap: 100000n, fundingPaused: false,
  engine: core().engine,
}
const position = { trader: OWNER, status: 1, openedAt: 1000n, maturesAt: 2000n, principal0: 100000n, principal: 59388n, markup0: 383n, markup: 383n, collateral: 143n, collected: 0n, lpAllocation: 0n, termsHash: '0x' + '11'.repeat(32) }

function mockReader(overrides: Partial<Reader> = {}, logCalls: Array<[bigint, bigint]> = []): Reader {
  return {
    getBlockNumber: async () => HEAD,
    getBlock: async ({ blockNumber }) => ({ number: blockNumber, timestamp: 1_793_000_000n + blockNumber }),
    readContract: async ({ functionName }) => {
      switch (functionName) {
        case 'vaultState': return state
        case 'MANDATE_HASH': return '0x' + '22'.repeat(32)
        case 'financingHeadroom': return 30000n
        case 'isFullyBacked': return true
        case 'termsHash': return core().termsHash
        case 'read': return [80_000_000_000n, 1_793_970_799n, true]
        case 'maxAge': return 86400n
        case 'activeIds': return [2n]
        case 'getPosition': return position
        case 'positionValue': return [110968n, true]
        case 'coverageBps': return 19139n
        case 'quoteRebalance': return [{ eligible: false, isPartial: false, sellAtoms: 0n, minUsdc: 0n }, true]
        case 'sharesOf': return 900000n
        case 'lockedShares': return 0n
        case 'claimable': return 0n
        default: throw new Error('unexpected read ' + functionName)
      }
    },
    getLogs: async ({ fromBlock, toBlock }) => {
      logCalls.push([fromBlock, toBlock])
      return []
    },
    ...overrides,
  }
}

interface VaultBody {
  chainId: number
  observedBlock: string
  manifestPolicyHash: string
  navPerShareE6: string
  vault: { nav: string; fundingPaused: boolean }
  account: { shares: string }
}

const get = (path: string) => new Request('http://local' + path)
const noCache = { cacheMs: 0 }

test('vault: integer strings only, chain id, observed block and policy hash', async () => {
  const res = await vaultHandler(get('/api/vault?owner=' + OWNER), { reader: mockReader(), ...noCache })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') ?? '', /application\/json/)
  const body = (await res.json()) as VaultBody
  assert.equal(body.chainId, 5042002)
  assert.equal(body.observedBlock, HEAD.toString())
  assert.equal(body.manifestPolicyHash, core().termsHash)
  assert.equal(body.vault.nav, '900265')
  assert.equal(body.vault.fundingPaused, false)
  assert.equal(body.account.shares, '900000')
  assert.equal(body.navPerShareE6, '1000294')
  // no JSON number may carry an amount: every uint is a string
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'number') assert.ok(['chainId', 'windows', 'maxBlocksPerWindow', 'livePositions', 'logIndex'].includes(path.split('.').pop() ?? ''), 'number at ' + path)
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path + '.' + k)
  }
  walk(body, 'root')
})

test('positions: owner is required and validated; only the owner positions are returned', async () => {
  assert.equal((await positionsHandler(get('/api/positions?owner=0x123'), { reader: mockReader() })).status, 400)
  const everyone = (await (await positionsHandler(get('/api/positions'), { reader: mockReader(), ...noCache })).json()) as { owner: unknown; positions: unknown[] }
  assert.equal(everyone.owner, null, 'no owner: the public bounded list of live positions for the keeper panel')
  assert.equal(everyone.positions.length, 1)
  const res = await positionsHandler(get('/api/positions?owner=' + OWNER), { reader: mockReader(), ...noCache })
  const body = (await res.json()) as { positions: Array<{ debt: string; coverageBps: string }> }
  assert.equal(body.positions.length, 1)
  assert.equal(body.positions[0].debt, '59771')
  assert.equal(body.positions[0].coverageBps, '19139')
  const other = await positionsHandler(get('/api/positions?owner=0x0000000000000000000000000000000000000001'), { reader: mockReader(), ...noCache })
  assert.equal(((await other.json()) as { positions: unknown[] }).positions.length, 0)
})

test('invalid vault owner and invalid activity cursors are rejected with 400', async () => {
  assert.equal((await vaultHandler(get('/api/vault?owner=nope'), { reader: mockReader() })).status, 400)
  assert.equal((await activityHandler(get('/api/activity?cursor=abc'), { reader: mockReader() })).status, 400)
  assert.equal((await activityHandler(get('/api/activity?cursor=1234567'), { reader: mockReader() })).status, 400)
  assert.equal((await activityHandler(get('/api/activity?cursor=' + encodeCursor(HEAD + 5n, 0)), { reader: mockReader() })).status, 400)
  assert.equal((await activityHandler(get('/api/activity?cursor=' + encodeCursor(1n, 0)), { reader: mockReader() })).status, 400)
})

test('RPC failure returns an actionable 503, never an empty 200, and leaks no URL', async () => {
  const failing = mockReader({ getBlockNumber: async () => { throw new Error('fetch failed https://private-rpc.example/key123') } })
  for (const handler of [vaultHandler, configHandler, activityHandler]) {
    const res = await handler(get('/api/x'), { reader: failing, ...noCache })
    assert.equal(res.status, 503)
    const text = await res.text()
    assert.match(text, /chain_read_failed/)
    assert.doesNotMatch(text, /private-rpc|key123/)
    assert.ok(res.headers.get('retry-after'))
  }
})


// ---- activity pagination fixtures -------------------------------------------------------------------------------
const OWNER_ADDR: Address = OWNER
const claimedTopics = encodeEventTopics({ abi: marginVaultAbi, eventName: 'Claimed', args: { owner: OWNER_ADDR } }) as unknown as readonly `0x${string}`[]
const mkLog = (block: bigint, logIndex: number, amount: bigint, tx = 1): RawLog => ({
  address: core().vault,
  data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
  topics: claimedTopics,
  blockNumber: block,
  logIndex,
  transactionHash: ('0x' + (tx + Number(block) % 7).toString(16).padStart(64, '0')) as `0x${string}`,
})
function fixtureReader(logs: RawLog[], head: bigint, calls: Array<[bigint, bigint]> = []): Reader {
  return mockReader({
    getBlockNumber: async () => head,
    getLogs: async ({ fromBlock, toBlock }) => {
      calls.push([fromBlock, toBlock])
      return logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock)
    },
  })
}
type Page = { events: Array<{ key: string; args: { amount: string } }>; nextCursor: string | null; truncated: boolean }
async function collect(reader: Reader, ns: string, maxPages = 40): Promise<Page['events']> {
  const all: Page['events'] = []
  let cursor: string | null = ''
  for (let i = 0; cursor !== null; i++) {
    assert.ok(i < maxPages, 'pagination must terminate')
    const res = await activityHandler(get('/api/activity' + (cursor ? '?cursor=' + cursor : '')), { reader, cacheNs: ns })
    assert.equal(res.status, 200)
    const page = (await res.json()) as Page
    assert.ok(page.events.length <= ACTIVITY_MAX_ROWS)
    all.push(...page.events)
    cursor = page.nextCursor
  }
  return all
}
const D = core().deployBlock

test('activity cursor is opaque, round-trips and rejects garbage', () => {
  const c = encodeCursor(71_034_000n, 17)
  assert.deepEqual(decodeCursor(c), { block: 71_034_000n, logIndex: 17 })
  for (const bad of ['', 'abc', '!!!!', Buffer.from('{"b":"x","l":1}').toString('base64url'), Buffer.from('{"b":"5","l":-1}').toString('base64url')]) assert.equal(decodeCursor(bad), null)
})

test('activity: 150 events spread over many blocks are paged with no omission, no duplicate, and it terminates', async () => {
  const logs: RawLog[] = []
  for (let i = 0; i < 150; i++) logs.push(mkLog(D + BigInt(i * 7), i % 3, BigInt(i + 1), 1 + i))
  const events = await collect(fixtureReader(logs, D + 2500n), 'spread')
  const amounts = events.map((e) => e.args.amount)
  assert.equal(amounts.length, 150)
  assert.equal(new Set(events.map((e) => e.key)).size, 150, 'no duplicates')
  assert.deepEqual([...amounts].map(Number).sort((a, b) => a - b), Array.from({ length: 150 }, (_, i) => i + 1), 'no omissions')
})

test('activity: 241 distinct events in ONE block are all returned across pages (cursor carries the logIndex)', async () => {
  const logs: RawLog[] = []
  for (let i = 0; i < 241; i++) logs.push(mkLog(D + 40n, i, BigInt(i + 1), 9))
  const calls: Array<[bigint, bigint]> = []
  const first = await activityHandler(get('/api/activity'), { reader: fixtureReader(logs, D + 100n, calls), cacheNs: 'oneblock0' })
  const p1 = (await first.json()) as Page
  assert.equal(p1.events.length, 120)
  assert.equal(p1.truncated, true)
  assert.ok(p1.nextCursor, 'truncated pages always continue, even though the scan already reached the deployment block')
  const events = await collect(fixtureReader(logs, D + 100n), 'oneblock')
  assert.equal(events.length, 241)
  assert.equal(new Set(events.map((e) => e.key)).size, 241)
  assert.deepEqual(events.map((e) => Number(e.args.amount)).sort((a, b) => a - b), Array.from({ length: 241 }, (_, i) => i + 1))
})

test('activity: windows are 1000-block aligned, <=8 per page, <=1000 blocks per RPC call; head moves reuse completed windows', async () => {
  const head = D + 9_500n
  const logs = [mkLog(D + 5n, 0, 1n), mkLog(D + 4_000n, 1, 2n)]
  const calls: Array<[bigint, bigint]> = []
  const reader = fixtureReader(logs, head, calls)
  await activityHandler(get('/api/activity'), { reader, cacheNs: 'reuse' })
  assert.ok(calls.length <= ACTIVITY_WINDOWS)
  for (const [lo, hi] of calls) {
    assert.ok(hi - lo + 1n <= BigInt(ACTIVITY_RANGE), 'range <= 1000 blocks')
    assert.ok(lo >= D)
    assert.ok(lo % BigInt(ACTIVITY_RANGE) === 0n || lo === D, 'windows start on fixed boundaries')
  }
  const firstCalls = calls.length
  // head advances by a few blocks inside the same aligned window: only the changing tail is fetched again
  const moved = fixtureReader(logs, head + 3n, calls)
  await activityHandler(get('/api/activity'), { reader: moved, cacheNs: 'reuse' })
  assert.equal(calls.length - firstCalls, 1, 'completed windows are reused; only the tail window is refetched')
  const tail = calls[calls.length - 1]
  assert.equal(tail[1], head + 3n)
})
