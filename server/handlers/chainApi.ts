import { decodeEventLog, type Abi } from 'viem'

import { marginVaultAbi, tradeEngineAbi } from '../../src/contracts/abis.js'
import { apiError, json } from '../http.js'
import { EXPLORER, EXTERNAL, UNISWAP, core } from '../manifest.js'
import { blockers, readOracle, readPositions, readVault } from '../reads.js'
import { cached, envelope, guarded, mapLimit, observe, parseOwner, readerFor, type ApiDeps } from './common.js'

const TTL = (deps: ApiDeps, ms: number) => deps.cacheMs ?? ms

export function configHandler(_request: Request, deps: ApiDeps = {}): Promise<Response> {
  return guarded(async () => {
    const body = await cached('config', TTL(deps, 30_000), async () => {
      const c = readerFor(deps)
      const obs = await observe(c)
      const k = core()
      const engineTerms = (await c.readContract({ address: k.engine, abi: tradeEngineAbi, functionName: 'termsHash', blockNumber: obs.number })) as string
      return envelope(obs, {
        network: { name: 'Arc Testnet', explorer: EXPLORER, nativeGasDecimals: 18, usdcDecimals: 6, btcDecimals: 8 },
        contracts: { vault: k.vault, engine: k.engine, guard: k.guard, venue: k.venue, usdc: EXTERNAL.usdc.address, cirBtc: EXTERNAL.cirBTC.address },
        deployBlock: k.deployBlock,
        deployments: Object.fromEntries(Object.entries(k.entries).map(([n, e]) => [n, { address: e.address, deployTxHash: e.deployTxHash, deployBlock: e.deployBlock, codeHash: e.codeHash }])),
        uniswap: { quoter: UNISWAP.quoter, stateView: UNISWAP.stateView, poolManager: UNISWAP.poolManager, poolId: UNISWAP.pool.poolId, fee: 3000, tickSpacing: 60 },
        policy: { termSeconds: 1209600, annualMarkupBps: 1000, lpMarkupBps: 7700, triggerBps: 16000, restoreBps: 19000, initialCoverageBps: 19000, frictionBps: 300, dustAtoms: '10000', earlyRebateBps: 0 },
        termsHashMatchesChain: engineTerms.toLowerCase() === k.termsHash.toLowerCase(),
        gasReserveAtoms: '100000',
        keeper: { status: 'external_unverified', detail: 'No heartbeat is published. Manual wallet actions work without any keeper.' },
        oracle: { kind: 'testnet operator fixture', note: 'Users cannot update it. Opens and sales fail closed when stale.' },
      })
    })
    return json(body)
  })
}

export function vaultHandler(request: Request, deps: ApiDeps = {}): Promise<Response> {
  return guarded(async () => {
    const url = new URL(request.url)
    const o = parseOwner(url, false)
    if (o.error) return o.error
    const c = readerFor(deps)
    const obs = await observe(c)
    const body = await cached(`vault:${obs.number}:${o.owner ?? ''}`, TTL(deps, 5000), async () => {
      const [v, oracle, positions] = await Promise.all([readVault(c, obs.number, o.owner), readOracle(c, obs.number), readPositions(c, obs.number, obs.timestamp)])
      return { ...v, oracle, positions: positions.length, blockers: blockers(v.state, positions, oracle.fresh) }
    })
    return json(envelope(obs, { vault: body.state, mandateHash: body.mandateHash, financingHeadroom: body.financingHeadroom, fullyBacked: body.fullyBacked, navPerShareE6: body.navPerShareE6, queue: body.queue, account: body.account, oracle: body.oracle, livePositions: body.positions, blockers: body.blockers }))
  })
}

/** With ?owner= only that owner's live positions; without it, all live positions (bounded by the engine at 32) for the public keeper panel. */
export function positionsHandler(request: Request, deps: ApiDeps = {}): Promise<Response> {
  return guarded(async () => {
    const o = parseOwner(new URL(request.url), false)
    if (o.error) return o.error
    const c = readerFor(deps)
    const obs = await observe(c)
    const all = await cached(`${deps.cacheNs ?? ''}positions:${obs.number}`, TTL(deps, 5000), () => readPositions(c, obs.number, obs.timestamp))
    const oracle = await readOracle(c, obs.number)
    const owner = o.owner
    return json(envelope(obs, { owner: owner ?? null, positions: owner ? all.filter((p) => p.trader.toLowerCase() === owner.toLowerCase()) : all, activeTotal: all.length, oracle }))
  })
}

export const ACTIVITY_RANGE = 1000 // the public Arc RPC accepted 1,000-block ranges and rejected 10,000
export const ACTIVITY_WINDOWS = 8
export const ACTIVITY_MAX_ROWS = 120
export const ACTIVITY_CONCURRENCY = 2
const LOG_INDEX_MAX = 4_294_967_295
const SETTLED_AFTER_BLOCKS = 30n

const eventsAbi = [...marginVaultAbi, ...tradeEngineAbi].filter((i) => i.type === 'event') as unknown as Abi

/** Opaque continuation: resume strictly BEFORE (block, logIndex). */
export function encodeCursor(block: bigint, logIndex: number): string {
  return Buffer.from(JSON.stringify({ b: block.toString(), l: logIndex })).toString('base64url')
}
export function decodeCursor(raw: string): { block: bigint; logIndex: number } | null {
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(raw)) return null
  try {
    const o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { b?: unknown; l?: unknown }
    if (typeof o.b !== 'string' || !/^\d{1,12}$/.test(o.b) || typeof o.l !== 'number' || !Number.isInteger(o.l) || o.l < 0 || o.l > LOG_INDEX_MAX) return null
    return { block: BigInt(o.b), logIndex: o.l }
  } catch {
    return null
  }
}

export function activityHandler(request: Request, deps: ApiDeps = {}): Promise<Response> {
  return guarded(async () => {
    const url = new URL(request.url)
    const c = readerFor(deps)
    const k = core()
    const ns = deps.cacheNs ?? ''
    const obs = await observe(c)
    const raw = url.searchParams.get('cursor')
    let to = obs.number
    let cut: { block: bigint; logIndex: number } | null = null
    if (raw !== null && raw !== '') {
      cut = decodeCursor(raw)
      if (!cut) return apiError(400, 'invalid_cursor', 'cursor is not a valid continuation', 'Use the nextCursor value returned by this endpoint, unchanged.')
      if (cut.block < k.deployBlock || cut.block > obs.number) return apiError(400, 'cursor_out_of_range', 'cursor is outside the deployment history', `Valid blocks are ${k.deployBlock}..${obs.number}.`)
      to = cut.block
    }
    // Windows are aligned to fixed 1,000-block boundaries, so a completed window has one stable cache key no matter how far
    // the head has moved; only the window holding the head (the recent tail) changes. At most 8 windows per page.
    const W = BigInt(ACTIVITY_RANGE)
    const windows: Array<[bigint, bigint]> = []
    let hi = to
    for (let i = 0; i < ACTIVITY_WINDOWS && hi >= k.deployBlock; i++) {
      const aligned = (hi / W) * W
      const lo = aligned > k.deployBlock ? aligned : k.deployBlock
      windows.push([lo, hi])
      hi = lo - 1n
    }
    const lowest = windows[windows.length - 1][0]
    const sets = await mapLimit(windows, ACTIVITY_CONCURRENCY, ([lo, hi2]) => {
      const settled = hi2 + SETTLED_AFTER_BLOCKS < obs.number
      const key = settled ? `${ns}logs:${lo}:${hi2}` : `${ns}logs:${lo}:${hi2}:head${obs.number}`
      return cached(key, deps.cacheMs ?? (settled ? 600_000 : 8000), () => c.getLogs({ address: [k.vault, k.engine], fromBlock: lo, toBlock: hi2 }))
    })
    const seen = new Set<string>()
    const rows: Array<Record<string, unknown> & { blockNumber: bigint; logIndex: number }> = []
    for (const log of sets.flat()) {
      if (cut && !(log.blockNumber < cut.block || (log.blockNumber === cut.block && log.logIndex < cut.logIndex))) continue
      const key = `5042002:${log.transactionHash}:${log.logIndex}`
      if (seen.has(key)) continue
      seen.add(key)
      try {
        const ev = decodeEventLog({ abi: eventsAbi, data: log.data, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] })
        const args: Record<string, string> = {}
        for (const [n, v] of Object.entries((ev.args ?? {}) as Record<string, unknown>)) args[n] = String(v)
        rows.push({ key, event: ev.eventName, contract: log.address.toLowerCase() === k.engine.toLowerCase() ? 'engine' : 'vault', contractAddress: log.address, txHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex, args })
      } catch {
        // not an event of the verified ABIs: skip
      }
    }
    rows.sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1))
    const page = rows.slice(0, ACTIVITY_MAX_ROWS)
    const truncated = rows.length > page.length
    // timestamps: one lookup per distinct block of the returned page, bounded concurrency, cached
    const blocks = [...new Set(page.map((r) => r.blockNumber))]
    const times = new Map<bigint, bigint>()
    await mapLimit(blocks, 8, async (bn) => {
      times.set(bn, (await cached(`${ns}blk:${bn}`, deps.cacheMs ?? 3_600_000, () => c.getBlock({ blockNumber: bn }))).timestamp)
    })
    for (const r of page) r.timestamp = times.get(r.blockNumber)
    let nextCursor: string | null = null
    if (truncated) {
      const last = page[page.length - 1]
      nextCursor = encodeCursor(last.blockNumber, last.logIndex) // resume exclusively before the last returned row
    } else if (lowest > k.deployBlock) {
      nextCursor = encodeCursor(lowest - 1n, LOG_INDEX_MAX) // everything in the scanned windows was returned
    }
    return json(envelope(obs, { range: { fromBlock: lowest, toBlock: to, windows: windows.length, maxBlocksPerWindow: ACTIVITY_RANGE }, events: page, truncated, nextCursor, explorer: EXPLORER }))
  })
}
