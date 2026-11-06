import { isAddress, getAddress, type Address } from 'viem'

import { makeReader, type Reader } from '../chain.js'
import { apiError, json } from '../http.js'
import { core } from '../manifest.js'
import type { Env } from '../rpc.js'

export interface ApiDeps {
  reader?: Reader
  env?: Env
  /** Cache lifetime override in ms (tests pass 0). */
  cacheMs?: number
  /** Prefix for cache keys (tests use a unique one so they cannot see each other's entries). */
  cacheNs?: string
}

const cache = new Map<string, { at: number; value: unknown }>()
/** Ephemeral per-instance cache; serverless instances may start empty and that is fine. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  const now = Date.now()
  if (ttlMs > 0 && hit && now - hit.at < ttlMs) return hit.value as T
  const value = await fn()
  if (ttlMs > 0) {
    if (cache.size > 300) cache.clear()
    cache.set(key, { at: now, value })
  }
  return value
}

export function readerFor(deps: ApiDeps): Reader {
  return deps.reader ?? makeReader(deps.env)
}

export interface Observed {
  number: bigint
  timestamp: bigint
}
export async function observe(c: Reader): Promise<Observed> {
  const number = await c.getBlockNumber()
  const b = await c.getBlock({ blockNumber: number })
  return { number, timestamp: b.timestamp }
}

export function envelope(obs: Observed, data: Record<string, unknown>) {
  return {
    chainId: 5042002,
    observedBlock: obs.number,
    observedAt: obs.timestamp,
    manifestPolicyHash: core().termsHash,
    ...data,
  }
}

export function parseOwner(url: URL, required: boolean): { owner?: Address; error?: Response } {
  const raw = url.searchParams.get('owner')
  if (raw === null || raw === '') {
    return required ? { error: apiError(400, 'owner_required', 'owner is required', 'Pass ?owner=<0x address>.') } : {}
  }
  if (!isAddress(raw, { strict: false })) return { error: apiError(400, 'invalid_owner', 'owner is not a valid address', 'Use a 0x-prefixed 20-byte address.') }
  return { owner: getAddress(raw.toLowerCase()) }
}

/** Runs a handler body and converts any upstream failure into an actionable 503 (never an empty 200). */
export async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown'
    const safe = detail.replace(/https?:\/\/\S+/g, '<url>').slice(0, 160)
    return apiError(503, 'chain_read_failed', 'The chain could not be read right now.', `Retry in a few seconds. (${safe})`)
  }
}

export { json }

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
