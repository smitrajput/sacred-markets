import type { ReactNode } from 'react'

import { explorerTx } from '@/lib/contracts'
import type { ActionHandle } from '@/hooks/useAction'

export function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border border-hairline bg-panel rounded p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2 mb-3">
        <h2 className="text-lg text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="num text-base text-ink break-words">{value}</dd>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  const cls = tone === 'error' ? 'border-accent text-accent' : tone === 'warn' ? 'border-secondary text-secondary' : 'border-hairline text-secondary'
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`border-l-2 ${cls} bg-raised px-3 py-2 text-sm`}>
      {children}
    </p>
  )
}

export function Field({ id, label, value, onChange, hint, suffix, inputMode = 'decimal' }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; suffix?: string; inputMode?: 'decimal' | 'numeric' }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-secondary mb-1">
        {label}
      </label>
      <div className="flex items-center border border-hairline bg-panel rounded focus-within:outline focus-within:outline-2 focus-within:outline-accent">
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} inputMode={inputMode} autoComplete="off" className="num w-full bg-transparent px-3 py-2 text-ink outline-none min-w-0" />
        {suffix ? <span className="px-3 text-sm text-muted">{suffix}</span> : null}
      </div>
      {hint ? <p className="text-xs text-muted mt-1">{hint}</p> : null}
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
  const base = variant === 'primary' ? 'bg-accent text-panel hover:bg-accent-hover' : 'border border-ink text-ink hover:bg-raised'
  const link = (hash?: string, text = 'View transaction') =>
    hash ? (
      <a className="underline" href={explorerTx(hash)} target="_blank" rel="noopener noreferrer">
        {text}
      </a>
    ) : null
  return (
    <div>
      <button type="button" onClick={onClick} disabled={working || blocked || disabled} className={`${base} rounded px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed`}>
        {working ? (PHASE_LABEL[state.phase] ?? 'Working…') : label}
      </button>
      {reason && !working && !blocked ? <p className="text-xs text-muted mt-1">{reason}</p> : null}
      <div aria-live="polite" className="mt-2 space-y-1">
        {state.phase === 'idle' && state.message ? <p className="text-sm text-secondary">{state.message}</p> : null}
        {state.phase === 'success' ? (
          <p className="text-sm text-secondary">
            Confirmed. {link(state.hash)}{' '}
            <button type="button" className="underline text-muted" onClick={action.reset}>
              Dismiss
            </button>
          </p>
        ) : null}
        {state.phase === 'error' ? (
          <p role="alert" className="text-sm text-accent">
            {state.message} {link(state.hash ?? state.approvalHash)}{' '}
            <button type="button" className="underline text-secondary" onClick={action.reset}>
              Try again
            </button>
          </p>
        ) : null}
        {state.phase === 'unconfirmed' ? (
          <p role="alert" className="text-sm text-accent">
            {state.message} {link(state.unresolved === 'approval' ? state.approvalHash : state.hash)}{' '}
            <button type="button" className="underline text-secondary" onClick={() => void action.recover()}>
              Check status
            </button>
          </p>
        ) : null}
        {state.phase === 'refresh-failed' ? (
          <p role="alert" className="text-sm text-secondary">
            {state.message} {link(state.hash, 'View confirmed transaction')}{' '}
            <button type="button" className="underline text-ink" onClick={() => void action.refresh()}>
              Refresh data
            </button>
          </p>
        ) : null}
        {working && state.message ? <p className="text-xs text-muted">{state.message}</p> : null}
      </div>
    </div>
  )
}
