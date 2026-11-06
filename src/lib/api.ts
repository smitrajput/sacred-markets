import { useQuery, useQueryClient, type Query, type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export interface ApiErrorBody {
  error: { code: string; message: string; hint: string }
}
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint: string,
  ) {
    super(message)
  }
}

export interface Envelope {
  chainId: number
  observedBlock: string
  observedAt: string
  manifestPolicyHash: string
}
type S = string
export interface VaultState {
  depositorIdleCash: S
  outstandingPrincipal: S
  commitments: S
  pendingGrossCash: S
  nav: S
  totalShares: S
  managerCash: S
  primaryReserve: S
  tailReserve: S
  pilotBackstop: S
  claimableWithdrawals: S
  primaryTarget: S
  tailTarget: S
  queueHead: S
  queueTail: S
  livePositions: S
  pendingOpens: S
  activeRequests: S
  financingCeiling: S
  perAccountCap: S
  fundingPaused: boolean
}
export interface OracleInfo {
  priceMicroUsdcPerBtc: S
  observedAt: S
  fresh: boolean
  maxAgeSeconds: S
  expiresAt: S
}
export interface VaultResponse extends Envelope {
  vault: VaultState
  mandateHash: string
  financingHeadroom: S
  fullyBacked: boolean
  navPerShareE6: S
  queue: Array<{ id: S; owner: string; shares: S }>
  account: { owner: string; shares: S; lockedShares: S; claimable: S } | null
  oracle: OracleInfo
  livePositions: number
  blockers: { deposit: string[]; financing: string[] }
}
export interface PositionRow {
  id: S
  trader: string
  status: number
  openedAt: S
  maturesAt: S
  principal0: S
  principal: S
  markup0: S
  markup: S
  debt: S
  collateral: S
  collected: S
  termsHash: string
  netCollateralValue: S
  priceFresh: boolean
  coverageBps: S
  rebalance: { eligible: boolean; partial: boolean; sellAtoms: S; minUsdc: S }
  matured: boolean
  impaired: boolean
}
export interface PositionsResponse extends Envelope {
  owner: string
  positions: PositionRow[]
  activeTotal: number
  oracle: OracleInfo
}
export interface ConfigResponse extends Envelope {
  network: { name: string; explorer: string }
  contracts: { vault: string; engine: string; guard: string; venue: string; usdc: string; cirBtc: string }
  deployBlock: S
  deployments: Record<string, { address: string; deployTxHash: string; deployBlock: number; codeHash: string }>
  uniswap: { quoter: string; poolId: string; fee: number; tickSpacing: number }
  policy: Record<string, number | string>
  termsHashMatchesChain: boolean
  gasReserveAtoms: S
  keeper: { status: string; detail: string }
  oracle: { kind: string; note: string }
}
export interface ActivityRow {
  key: string
  event: string
  contract: 'vault' | 'engine'
  contractAddress: string
  txHash: string
  blockNumber: S
  logIndex: number
  timestamp: S
  args: Record<string, string>
}
export interface ActivityResponse extends Envelope {
  range: { fromBlock: S; toBlock: S }
  events: ActivityRow[]
  truncated: boolean
  nextCursor: S | null
  explorer: string
}

export async function getJson<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { headers: { accept: 'application/json' } })
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the Sacred API.', 'Check your connection and retry.')
  }
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) {
    throw new ApiError(res.status, 'not_json', 'The API did not return JSON.', 'The read API may be unavailable on this host.')
  }
  const body = (await res.json()) as T | ApiErrorBody
  if (!res.ok) {
    const e = (body as ApiErrorBody).error
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? 'Request failed.', e?.hint ?? 'Retry shortly.')
  }
  return body as T
}

export function useApi<T>(key: unknown[], path: string | null, intervalMs = 15_000) {
  return useQuery({ queryKey: ['api', ...key], queryFn: () => getJson<T>(path!), enabled: path !== null, refetchInterval: intervalMs, staleTime: 5_000, retry: 1 })
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const isReceiptQuery = (q: Query) => q.queryKey[0] === 'api' && (q.queryKey[1] === 'vault' || q.queryKey[1] === 'positions')
function observedBlock(q: Query): bigint {
  try {
    return BigInt((q.state.data as { observedBlock?: string } | undefined)?.observedBlock ?? '-1')
  } catch {
    return -1n
  }
}

/**
 * Authoritative refresh after a confirmed receipt. Success means EVERY active vault/positions query (owner and public
 * variants alike) is in status "success" with observedBlock >= the receipt block; a refetch error that TanStack swallows, or a
 * query still showing an older block, counts as "not refreshed". With no such query on screen (e.g. the Activity tab) the
 * ownerless vault endpoint is checked instead. Bounded: attempts x delay. Balances, allowances, config, activity and quotes are
 * refreshed too, but none of them can create a barrier (their wait is capped and their result is not required).
 */
export async function authoritativeRefresh(
  qc: QueryClient,
  receiptBlock: bigint | undefined,
  opts: { attempts?: number; delayMs?: number; otherMs?: number; fetchVault?: () => Promise<Envelope> } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? 12
  const delayMs = opts.delayMs ?? 1500
  const fetchVault = opts.fetchVault ?? (() => getJson<Envelope>('/api/vault'))
  let done = false
  for (let i = 0; i < attempts && !done; i++) {
    const active = qc.getQueryCache().findAll({ type: 'active', predicate: isReceiptQuery })
    if (active.length === 0) {
      try {
        const v = await fetchVault()
        done = receiptBlock === undefined || BigInt(v.observedBlock) >= receiptBlock
      } catch {
        done = false
      }
    } else {
      await qc.refetchQueries({ type: 'active', predicate: isReceiptQuery }, { throwOnError: false })
      const now = qc.getQueryCache().findAll({ type: 'active', predicate: isReceiptQuery })
      done = now.every((q) => q.state.status === 'success' && (receiptBlock === undefined || observedBlock(q) >= receiptBlock))
    }
    if (!done && i < attempts - 1) await sleep(delayMs)
  }
  const others = qc.invalidateQueries({ predicate: (q) => !isReceiptQuery(q) })
  await Promise.race([others.catch(() => undefined), sleep(opts.otherMs ?? 4000)])
  return done
}

export function useRefreshAfter() {
  const qc = useQueryClient()
  return useCallback((receiptBlock: bigint | undefined) => authoritativeRefresh(qc, receiptBlock), [qc])
}
