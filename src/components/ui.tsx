import { useId, type ReactNode } from 'react'

import { explorerTx } from '@/lib/contracts'
import type { ActionHandle } from '@/hooks/useAction'

export function Panel({ title, children, aside, lede, variant = 'card' }: { title: string; children: ReactNode; aside?: ReactNode; lede?: ReactNode; variant?: 'card' | 'plain' }) {
  const hid = useId()
  return (
    <section aria-labelledby={hid} className={variant === 'card' ? 'bg-panel border border-rule rounded p-5 sm:p-7' : ''}>
      <div className="mb-5">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id={hid} className="text-xl sm:text-2xl text-ink">
            {title}
          </h2>
          {aside ? <div className="shrink-0 whitespace-nowrap text-xs text-secondary text-right">{aside}</div> : null}
        </div>
        {lede ? <p className="text-sm text-secondary mt-1 max-w-prose">{lede}</p> : null}
      </div>
      {children}
    </section>
  )
}

export function Stat({ label, value, hint, size }: { label: string; value: ReactNode; hint?: string; size?: 'lg' }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-secondary">{label}</dt>
      <dd className={`num font-serif text-ink mt-0.5 break-words ${size === 'lg' ? 'text-2xl sm:text-3xl' : 'text-lg'}`}>{value}</dd>
      {hint ? <p className="text-xs text-secondary mt-0.5">{hint}</p> : null}
    </div>
  )
}

export function Rows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-rule border-y border-rule">{children}</dl>
}

export function Row({ label, value, hint, strong }: { label: string; value: ReactNode; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="min-w-0 flex-1 text-sm text-secondary">
        {label}
        {hint ? <span className="block text-xs mt-0.5">{hint}</span> : null}
      </dt>
      <dd className={`num shrink-0 min-w-0 max-w-[60%] text-right break-words ${strong ? 'font-serif text-lg' : 'text-base'} text-ink`}>{value}</dd>
    </div>
  )
}

export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="border-t border-rule">
      <summary>{summary}</summary>
      <div className="pb-4 pt-1 space-y-4 text-sm text-secondary">{children}</div>
    </details>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  const cls = tone === 'error' ? 'border-red bg-white text-ink' : tone === 'warn' ? 'border-ink bg-raised text-ink' : 'border-rule bg-panel text-secondary'
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`border ${cls} rounded px-4 py-3 text-sm break-words`}>
      {tone === 'error' ? <strong className="text-red">Error: </strong> : null}
      {children}
    </p>
  )
}

export function Field({ id, label, value, onChange, hint, suffix, inputMode = 'decimal' }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; suffix?: string; inputMode?: 'decimal' | 'numeric' }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-bold text-ink mb-2">
        {label}
      </label>
      <div className="flex items-stretch h-12 border border-rule bg-panel rounded focus-within:border-ink focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-red">
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} inputMode={inputMode} autoComplete="off" aria-describedby={hint ? `${id}-hint` : undefined} className="num w-full min-w-0 bg-transparent px-4 text-lg text-ink outline-none placeholder:text-secondary" />
        {suffix ? <span className="flex items-center px-4 border-l border-rule text-sm text-secondary">{suffix}</span> : null}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-secondary mt-2">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

const PHASE_LABEL: Record<string, string> = {
  switching: 'Switching network…',
  allowance: 'Checking allowance…',
  'approve-sign': 'Approve in wallet…',
  'approve-pending': 'Approval confirming…',
  simulating: 'Simulating…',
  sign: 'Confirm in wallet…',
  pending: 'Confirming…',
  refreshing: 'Updating data…',
}
const WORKING = new Set(Object.keys(PHASE_LABEL))

export function ActionButton({ label, action, onClick, disabled, reason, variant = 'primary' }: { label: string; action: ActionHandle; onClick: () => void; disabled?: boolean; reason?: string | null; variant?: 'primary' | 'plain' }) {
  const { state } = action
  const working = WORKING.has(state.phase)
  const blocked = state.phase === 'unconfirmed' || state.phase === 'refresh-failed'
  const reasonId = useId()
  const showReason = Boolean(reason && !working && !blocked)
  const base = variant === 'primary' ? 'h-12 px-6 border border-transparent bg-red text-white text-base hover:bg-deep' : 'h-11 px-5 border border-ink text-ink text-sm hover:bg-raised'
  const link = (hash?: string, text = 'View transaction') =>
    hash ? (
      <a className="underline" href={explorerTx(hash)} target="_blank" rel="noopener noreferrer">
        {text}
      </a>
    ) : null
  return (
    <div>
      <button type="button" onClick={onClick} disabled={working || blocked || disabled} aria-busy={working} aria-describedby={showReason ? reasonId : undefined} className={`${base} rounded w-full sm:w-auto font-bold transition-colors disabled:bg-raised disabled:text-secondary disabled:border-rule disabled:cursor-not-allowed`}>
        {working ? (PHASE_LABEL[state.phase] ?? 'Working…') : label}
      </button>
      {showReason ? (
        <p id={reasonId} className="text-sm text-secondary mt-2">
          {reason}
        </p>
      ) : null}
      <div aria-live="polite" className="mt-3 space-y-1">
        {state.phase === 'idle' && state.message ? <p className="text-sm text-secondary">{state.message}</p> : null}
        {state.phase === 'success' ? (
          <p className="text-sm text-secondary">
            Confirmed. {link(state.hash)}{' '}
            <button type="button" className="ml-1 py-2 underline font-bold text-ink" onClick={action.reset}>
              Dismiss
            </button>
          </p>
        ) : null}
        {state.phase === 'error' ? (
          <p role="alert" className="text-sm text-red">
            {state.message} {link(state.hash ?? state.approvalHash)}{' '}
            <button type="button" className="ml-1 py-2 underline font-bold text-ink" onClick={action.reset}>
              Try again
            </button>
          </p>
        ) : null}
        {state.phase === 'unconfirmed' ? (
          <p role="alert" className="text-sm text-red">
            {state.message} {link(state.unresolved === 'approval' ? state.approvalHash : state.hash)}{' '}
            <button type="button" className="ml-1 py-2 underline font-bold text-ink" onClick={() => void action.recover()}>
              Check status
            </button>
          </p>
        ) : null}
        {state.phase === 'refresh-failed' ? (
          <p role="alert" className="text-sm text-secondary">
            {state.message} {link(state.hash, 'View confirmed transaction')}{' '}
            <button type="button" className="ml-1 py-2 underline font-bold text-ink" onClick={() => void action.refresh()}>
              Refresh data
            </button>
          </p>
        ) : null}
        {working && state.message ? <p className="text-sm text-secondary">{state.message}</p> : null}
      </div>
    </div>
  )
}
