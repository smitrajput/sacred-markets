import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Notice, Panel } from './ui'
import { getJson, type ActivityResponse, type ActivityRow, type ConfigResponse } from '@/lib/api'
import { explorerAddr, explorerTx } from '@/lib/contracts'
import { formatTime, shortAddr, shortHash } from '@/lib/format'
import { describeEvent } from '@/lib/text'

export function ActivityTab() {
  const cfg = useQuery({ queryKey: ['api', 'config'], queryFn: () => getJson<ConfigResponse>('/api/config'), staleTime: 60_000 })
  const first = useQuery({ queryKey: ['api', 'activity', 'first'], queryFn: () => getJson<ActivityResponse>('/api/activity'), refetchInterval: 20_000, retry: 1 })
  const [older, setOlder] = useState<ActivityRow[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)

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
      setLoadErr(e instanceof Error ? e.message : 'Could not load older activity.')
    } finally {
      setLoading(false)
    }
  }

  const list = [...rows.values()].sort((a, b) => (BigInt(b.blockNumber) === BigInt(a.blockNumber) ? b.logIndex - a.logIndex : BigInt(b.blockNumber) > BigInt(a.blockNumber) ? 1 : -1))
  return (
    <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
      <div className="lg:col-span-8 min-w-0">
        <Panel title="On-chain activity" aside={first.data ? <span className="font-mono">block {first.data.observedBlock}</span> : null}>
          {first.isLoading ? <Notice>Reading recent events from the chain…</Notice> : null}
          {first.error ? <Notice tone="error">{first.error instanceof Error ? first.error.message : 'Activity is unavailable.'} Retrying automatically.</Notice> : null}
          {first.data && list.length === 0 ? <Notice>No Sacred events in the scanned range yet. Older history can be loaded below.</Notice> : null}
          <ol className="divide-y divide-rule border-y border-rule">
            {list.map((e) => {
              const d = describeEvent(e)
              return (
                <li key={e.key} className="py-4 grid gap-1 sm:grid-cols-[9.5rem_1fr] sm:gap-x-6">
                  <p className="text-sm text-secondary num">{formatTime(BigInt(e.timestamp))}</p>
                  <div className="min-w-0">
                    <p className="text-base font-bold text-ink break-words">{d.title}</p>
                    <p className="text-sm text-secondary break-words">{d.detail}</p>
                    <p className="text-xs text-secondary num mt-1 break-all">
                      block {e.blockNumber} ·{' '}
                      <a className="font-mono underline" href={explorerTx(e.txHash)} target="_blank" rel="noopener noreferrer">
                        {shortHash(e.txHash)}
                      </a>{' '}
                      · {e.contract}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
          {loadErr ? (
            <div className="mt-5">
              <Notice tone="error">{loadErr}</Notice>
            </div>
          ) : null}
          {first.data ? (
            next ? (
              <button type="button" onClick={() => void loadOlder()} disabled={loading} className="mt-5 h-11 px-5 border border-ink rounded text-sm font-bold hover:bg-raised transition-colors w-full sm:w-auto disabled:bg-raised disabled:text-secondary disabled:border-rule disabled:cursor-not-allowed">
                {loading ? 'Loading…' : 'Load older activity'}
              </button>
            ) : (
              <p className="text-sm text-secondary mt-5">Reached the deployment block. Nothing older exists.</p>
            )
          ) : null}
          {first.data?.truncated ? <p className="text-sm text-secondary mt-3">This page was capped; newer events are listed first.</p> : null}
        </Panel>
      </div>
      <div className="lg:col-span-4 min-w-0">
        <Panel title="Verified contracts" variant="plain">
          {cfg.data ? (
            <ul className="space-y-4">
              {Object.entries(cfg.data.deployments).map(([name, d]) => (
                <li key={name} className="min-w-0">
                  <p className="text-sm font-bold">{name}</p>
                  <a className="font-mono text-sm break-all" href={explorerAddr(d.address)} target="_blank" rel="noopener noreferrer">
                    {shortAddr(d.address)}
                  </a>
                  <p className="text-xs text-secondary">block {d.deployBlock}</p>
                </li>
              ))}
              <li>
                {cfg.data.termsHashMatchesChain ? <p className="text-sm text-ink">Manifest terms hash matches the engine on chain.</p> : <Notice tone="error">Warning: manifest terms hash differs from the chain.</Notice>}
              </li>
            </ul>
          ) : cfg.error ? (
            <Notice tone="error">Config unavailable.</Notice>
          ) : (
            <Notice>Loading…</Notice>
          )}
          <section className="border-t border-rule mt-6 pt-5">
            <h3 className="text-lg">Keeper</h3>
            <p className="text-sm text-secondary mt-2">Keeper scheduling is external and unverified: no heartbeat is published, so this app cannot say whether a keeper is running. Every action above works from your own wallet without it.</p>
          </section>
        </Panel>
      </div>
    </div>
  )
}
