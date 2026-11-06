import { contractStatuses, NETWORK } from '../manifest.js'
import { resolveRpcUrl, rpcBatch, type Env, type FetchLike } from '../rpc.js'
import { json } from '../http.js'

const CHAIN_KEY = 'Arc_Testnet'

export interface HealthDeps {
  env?: Env
  fetchImpl?: FetchLike
  now?: () => Date
  clock?: () => number
}

type RpcStatus =
  | { status: 'reachable'; chainId: number; chainIdMatches: boolean; latestBlock: number; latencyMs: number }
  | { status: 'unreachable'; reason: string; latencyMs: number }

async function checkRpc(deps: Required<Pick<HealthDeps, 'clock'>> & HealthDeps): Promise<RpcStatus> {
  const env = deps.env ?? process.env
  const started = deps.clock()
  try {
    const url = resolveRpcUrl(CHAIN_KEY, NETWORK.chainId, env)
    const [chainIdHex, blockHex] = await rpcBatch(
      url,
      [{ method: 'eth_chainId' }, { method: 'eth_blockNumber' }],
      { fetchImpl: deps.fetchImpl },
    )
    const chainId = Number(BigInt(String(chainIdHex)))
    return {
      status: 'reachable',
      chainId,
      chainIdMatches: chainId === NETWORK.chainId,
      latestBlock: Number(BigInt(String(blockHex))),
      latencyMs: Math.round(deps.clock() - started),
    }
  } catch (error) {
    return {
      status: 'unreachable',
      reason: error instanceof Error && /^rpc_/.test(error.message) ? error.message : 'rpc_failed',
      latencyMs: Math.round(deps.clock() - started),
    }
  }
}

/**
 * GET /api/health. Read-only. Reports the API itself, the chain RPC, which Sacred contracts exist (from the public
 * manifest) and honest keeper status. It exposes no secret, no RPC URL and no signing capability.
 * HTTP 200 means the API function is serving; `status` says whether its dependencies look healthy.
 */
export async function healthHandler(_request: Request, deps: HealthDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env
  const clock = deps.clock ?? (() => performance.now())
  const now = deps.now ?? (() => new Date())
  const rpc = await checkRpc({ ...deps, clock })
  const healthy = rpc.status === 'reachable' && rpc.chainIdMatches

  return json({
    status: healthy ? 'ok' : 'degraded',
    service: 'sacred-api',
    time: now().toISOString(),
    mode: 'read-only',
    signing: 'none',
    chain: { name: NETWORK.name, chainId: NETWORK.chainId, rpc },
    contracts: { source: 'deployments/arc-testnet.json', statuses: contractStatuses() },
    scheduler: {
      status: 'unavailable',
      kind: 'external',
      detail:
        'The keeper is a separately run operator process, not part of this serverless deployment. Nothing is scheduled here; wallet actions remain permissionless.',
    },
    deployment: {
      host: env.VERCEL ? 'vercel' : 'local',
      environment: env.VERCEL_ENV ?? 'development',
      region: env.VERCEL_REGION ?? null,
      commit: env.VERCEL_GIT_COMMIT_SHA ? env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null,
    },
  })
}
