import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight } from 'lucide-react'
import { useState } from 'react'

import { Card, Empty, Notice, PageHead, Skeleton, TxLink } from './ui'
import { getJson, type ActivityResponse, type ActivityRow, type ConfigResponse } from '@/lib/api'
import { explorerAddr } from '@/lib/contracts'
import { formatTime, shortAddr, shortHash, timeAgo } from '@/lib/format'
import { describeEvent } from '@/lib/text'

const CONTRACT_NAMES: Record<string, [string, string]> = {
  vault: ['Vault', 'Holds deposits and pays withdrawals'],
  engine: ['Trade engine', 'Buys, pledges and settles BTC'],
  guard: ['Price reference', 'Publishes the reference price'],
  venue: ['Swap adapter', 'Trades through the Uniswap v4 pool'],
}

const PAGE = 20

export function ActivityTab() {
  const cfg = useQuery({ queryKey: ['api', 'config'], queryFn: () => getJson<ConfigResponse>('/api/config'), staleTime: 60_000 })
  const first = useQuery({ queryKey: ['api', 'activity', 'first'], queryFn: () => getJson<ActivityResponse>('/api/activity'), refetchInterval: 20_000, retry: 1 })
  const [older, setOlder] = useState<ActivityRow[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)

  const next = cursor === undefined ? (first.data?.nextCursor ?? null) : cursor
  const rows = new Map<string, ActivityRow>()
  for (const r of [...(first.data?.events ?? []), ...older]) rows.set(r.key, r) // dedupe by chain/tx/logIndex

  async function loadOlder() {
    if (!next || loading) return
    setLoading(true)
    setLoadErr(null)
    try {
      const page = await getJson<ActivityResponse>(`/api/activity?cursor=${next}`)
      setOlder((o) => [...o, ...page.events])
      setCursor(page.nextCursor)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Earlier activity could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  const list = [...rows.values()].sort((a, b) => (BigInt(b.blockNumber) === BigInt(a.blockNumber) ? b.logIndex - a.logIndex : BigInt(b.blockNumber) > BigInt(a.blockNumber) ? 1 : -1))
  return (
    <>
      <PageHead eyebrow="Activity" title="Every transaction, on the record">
        Deposits, purchases, repayments and withdrawals as they settle on Arc. Each entry links to its transaction.
      </PageHead>
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-10 items-start">
        <div className="lg:col-span-8 min-w-0">
          <Card title="Recent activity" aside={first.data ? `Block ${Number(first.data.observedBlock).toLocaleString('en-US')}` : null}>
            {first.isLoading ? (
              <div className="space-y-4">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-11" />
                ))}
              </div>
            ) : null}
            {first.error ? <Notice tone="error">{first.error instanceof Error ? first.error.message : 'Activity is unavailable.'} Retrying automatically.</Notice> : null}
            {first.data && list.length === 0 ? <Empty title="Nothing recent">{next ? 'There has been no activity in the last hour. Earlier entries can be loaded below.' : 'Activity appears here as it happens.'}</Empty> : null}
            {list.length > 0 ? (
              <ol className="divide-y divide-rule -my-1">
                {list.slice(0, shown).map((e) => {
                  const d = describeEvent(e)
                  const t = BigInt(e.timestamp)
                  return (
                    <li key={e.key} className="py-3.5 grid gap-x-6 gap-y-1 sm:grid-cols-[1fr_auto] sm:items-baseline">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-ink break-words">{d.title}</p>
                        <p className="text-sm text-ink-2 break-words">{d.detail}</p>
                      </div>
                      <p className="text-xs text-ink-3 num flex items-center gap-3 sm:justify-end whitespace-nowrap">
                        <time dateTime={new Date(Number(t) * 1000).toISOString()} title={formatTime(t)}>
                          {timeAgo(t)}
                        </time>
                        <span className="font-mono">
                          <TxLink hash={e.txHash}>{shortHash(e.txHash)}</TxLink>
                        </span>
                      </p>
                    </li>
                  )
                })}
              </ol>
            ) : null}
            {loadErr ? (
              <div className="mt-5">
                <Notice tone="error">{loadErr}</Notice>
              </div>
            ) : null}
            {first.data && (list.length > shown || next) ? (
              <div className="mt-5 pt-5 border-t border-rule flex items-center justify-between gap-4">
                <button type="button" onClick={() => (list.length > shown ? setShown((n) => n + PAGE) : void loadOlder().then(() => setShown((n) => n + PAGE)))} disabled={loading} className="btn-secondary w-full sm:w-auto">
                  {loading ? 'Loading' : 'Show earlier activity'}
                </button>
                <p className="hidden sm:block text-xs text-ink-3 num">
                  Showing {Math.min(shown, list.length)} of {list.length}
                </p>
              </div>
            ) : null}
          </Card>
        </div>
        <div className="lg:col-span-4 min-w-0 lg:sticky lg:top-24">
          <Card title="Contracts" aside="Source verified">
            {cfg.data ? (
              <ul className="divide-y divide-rule -my-2">
                {Object.entries(cfg.data.deployments).map(([name, d]) => {
                  const [label, role] = CONTRACT_NAMES[name] ?? [name, '']
                  return (
                    <li key={name} className="py-3 flex items-baseline justify-between gap-4 min-w-0">
                      <div className="min-w-0">
                        <p className="text-sm font-bold">{label}</p>
                        {role ? <p className="text-xs text-ink-3">{role}</p> : null}
                      </div>
                      <a className="link font-mono text-xs inline-flex items-center gap-0.5 shrink-0" href={`${explorerAddr(d.address)}?tab=contract`} target="_blank" rel="noopener noreferrer">
                        {shortAddr(d.address)}
                        <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
                      </a>
                    </li>
                  )
                })}
              </ul>
            ) : cfg.error ? (
              <Notice tone="error">Contract details are unavailable.</Notice>
            ) : (
              <Skeleton className="h-40" />
            )}
            {cfg.data && !cfg.data.termsHashMatchesChain ? (
              <div className="mt-4">
                <Notice tone="error">The published terms do not match the contract. Do not transact until this is resolved.</Notice>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  )
}
