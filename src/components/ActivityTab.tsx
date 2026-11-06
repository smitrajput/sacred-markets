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
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Panel title="On-chain activity" aside={first.data ? <span className="text-xs text-muted num">block {first.data.observedBlock}</span> : null}>
        {first.isLoading ? <Notice>Reading recent events from the chain…</Notice> : null}
        {first.error ? <Notice tone="error">{first.error instanceof Error ? first.error.message : 'Activity is unavailable.'} Retrying automatically.</Notice> : null}
        {first.data && list.length === 0 ? <Notice>No Sacred events in the scanned range yet. Older history can be loaded below.</Notice> : null}
        <ol className="divide-y divide-hairline">
          {list.map((e) => {
            const d = describeEvent(e)
            return (
              <li key={e.key} className="py-3">
                <p className="text-sm text-ink">{d.title}</p>
                <p className="text-sm text-secondary">{d.detail}</p>
                <p className="text-xs text-muted num">
                  {formatTime(BigInt(e.timestamp))} · block {e.blockNumber} ·{' '}
                  <a className="underline" href={explorerTx(e.txHash)} target="_blank" rel="noopener noreferrer">
                    {shortHash(e.txHash)}
                  </a>{' '}
                  · {e.contract}
                </p>
              </li>
            )
          })}
        </ol>
        {loadErr ? <Notice tone="error">{loadErr}</Notice> : null}
        {first.data ? (
          next ? (
            <button type="button" onClick={() => void loadOlder()} disabled={loading} className="mt-3 border border-ink rounded px-3 py-1.5 text-sm hover:bg-raised disabled:opacity-50">
              {loading ? 'Loading…' : 'Load older activity'}
            </button>
          ) : (
            <p className="text-xs text-muted mt-3">Reached the deployment block. Nothing older exists.</p>
          )
        ) : null}
        {first.data?.truncated ? <p className="text-xs text-muted mt-2">This page was capped; newer events are listed first.</p> : null}
      </Panel>
      <div className="space-y-4">
        <Panel title="Verified contracts">
          {cfg.data ? (
            <ul className="text-sm space-y-1">
              {Object.entries(cfg.data.deployments).map(([name, d]) => (
                <li key={name}>
                  {name}:{' '}
                  <a className="underline num" href={explorerAddr(d.address)} target="_blank" rel="noopener noreferrer">
                    {shortAddr(d.address)}
                  </a>{' '}
                  <span className="text-xs text-muted">block {d.deployBlock}</span>
                </li>
              ))}
              <li className="text-xs text-muted pt-1">{cfg.data.termsHashMatchesChain ? 'Manifest terms hash matches the engine on chain.' : 'Warning: manifest terms hash differs from the chain.'}</li>
            </ul>
          ) : cfg.error ? (
            <Notice tone="error">Config unavailable.</Notice>
          ) : (
            <Notice>Loading…</Notice>
          )}
        </Panel>
        <Panel title="Keeper">
          <p className="text-sm text-secondary">Keeper scheduling is external and unverified: no heartbeat is published, so this app cannot say whether a keeper is running. Every action above works from your own wallet without it.</p>
        </Panel>
      </div>
    </div>
  )
}
