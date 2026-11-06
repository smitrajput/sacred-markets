import { requireChain } from '../src/onchain-facts.js'

export type Env = Record<string, string | undefined>

/**
 * Resolve the JSON-RPC endpoint for a chain.
 * Order: per-chain override `RPC_URL_<chainKey>` (set this in the host's secret store for a deployed API),
 * then Arc Studio's sandbox proxy when it covers the chain, then the public RPC from the generated facts.
 * The returned URL may embed a token: never log it or put it in a response.
 */
export function resolveRpcUrl(chainKey: string, chainId: number, env: Env = process.env): string {
  const override = env['RPC_URL_' + chainKey]
  if (override) return override
  const proxyChains = (env.RPC_PROXY_CHAINS ?? '').split(',')
  if (env.RPC_PROXY_BASE_URL && env.RPC_PROXY_TOKEN && proxyChains.includes(chainKey)) {
    return `${env.RPC_PROXY_BASE_URL}/api/rpc/${chainKey}?_rpc_token=${env.RPC_PROXY_TOKEN}`
  }
  const url = requireChain(chainId).rpcUrls[0]
  if (!url) throw new Error('No RPC URL known for chain ' + chainId)
  return url
}

export type RpcCall = { method: string; params?: unknown[] }
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** One JSON-RPC batch request (counts as a single request upstream). Errors never contain the URL. */
export async function rpcBatch(
  url: string,
  calls: readonly RpcCall[],
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<unknown[]> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params ?? [] }))
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 4000),
    })
  } catch (error) {
    throw new Error(error instanceof Error && error.name === 'TimeoutError' ? 'rpc_timeout' : 'rpc_unreachable')
  }
  if (!response.ok) throw new Error('rpc_http_' + response.status)
  const payload: unknown = await response.json().catch(() => null)
  if (!Array.isArray(payload)) throw new Error('rpc_bad_response')
  const byId = new Map<number, { result?: unknown; error?: unknown }>()
  for (const item of payload as Array<{ id: number; result?: unknown; error?: unknown }>) byId.set(item.id, item)
  return calls.map((_, i) => {
    const item = byId.get(i + 1)
    if (!item || item.error !== undefined) throw new Error('rpc_error')
    return item.result
  })
}
