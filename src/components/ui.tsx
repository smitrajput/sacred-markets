import { ArrowUpRight, Check, ChevronDown, CircleAlert, Info, LoaderCircle } from 'lucide-react'
import { useId, type ReactNode } from 'react'

import { explorerTx } from '@/lib/contracts'
import type { ActionHandle } from '@/hooks/useAction'

/** Page title block: a small red eyebrow, the serif title and one sentence. */
export function PageHead({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-8 sm:mb-10">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-2 text-2xl sm:text-3xl">{title}</h1>
      {children ? <p className="mt-3 max-w-[60ch] text-base text-ink-2">{children}</p> : null}
    </header>
  )
}

/** A figure with its unit set smaller and quieter beside it. */
export function Amount({ value, unit }: { value: ReactNode; unit?: string }) {
  return (
    <span className="num whitespace-nowrap">
      {value}
      {unit ? <span className="ml-1.5 text-[0.62em] tracking-wide text-ink-3 font-sans">{unit}</span> : null}
    </span>
  )
}

/** The row of headline figures under a page title. */
export function StatStrip({ children }: { children: ReactNode }) {
  return <dl className="mb-8 sm:mb-10 grid grid-cols-2 lg:grid-cols-4 border-y border-rule divide-rule max-lg:[&>*:nth-child(odd)]:pr-5 max-lg:[&>*:nth-child(even)]:pl-5 max-lg:[&>*:nth-child(even)]:border-l max-lg:[&>*:nth-child(n+3)]:border-t lg:divide-x lg:[&>*]:px-6 lg:[&>*:first-child]:pl-0">{children}</dl>
}

export function Stat({ label, value, hint, size = 'md' }: { label: string; value: ReactNode; hint?: ReactNode; size?: 'md' | 'lg' }) {
  return (
    <div className="min-w-0 py-4 border-rule">
      <dt className="label">{label}</dt>
      <dd className={`font-serif text-ink mt-1.5 break-words ${size === 'lg' ? 'text-2xl' : 'text-xl'}`}>{value}</dd>
      {hint ? <p className="text-xs text-ink-3 mt-1">{hint}</p> : null}
    </div>
  )
}

export function Card({ title, aside, children, className = '' }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  const hid = useId()
  return (
    <section aria-labelledby={title ? hid : undefined} className={`card ${className}`}>
      {title ? (
        <div className="flex items-baseline justify-between gap-4 px-5 sm:px-6 pt-5 pb-4 border-b border-rule">
          <h2 id={hid} className="text-lg">
            {title}
          </h2>
          {aside ? <div className="shrink-0 text-xs text-ink-3">{aside}</div> : null}
        </div>
      ) : null}
      <div className="px-5 sm:px-6 py-5">{children}</div>
    </section>
  )
}

export function Rows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-rule">{children}</dl>
}

export function Row({ label, value, hint, strong }: { label: ReactNode; value: ReactNode; hint?: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className={`min-w-0 flex-1 text-sm ${strong ? 'text-ink font-bold' : 'text-ink-2'}`}>
        {label}
        {hint ? <span className="block text-xs font-normal text-ink-3 mt-0.5">{hint}</span> : null}
      </dt>
      <dd className={`num shrink-0 min-w-0 max-w-[62%] text-right break-words text-ink ${strong ? 'font-serif text-lg' : 'text-sm'}`}>{value}</dd>
    </div>
  )
}

export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex items-center justify-between gap-3 py-2 text-sm text-ink-2 hover:text-ink">
        {summary}
        <ChevronDown aria-hidden className="chev h-4 w-4 shrink-0 text-ink-3 transition-transform" />
      </summary>
      <div className="pb-2 pt-1 text-sm text-ink-2">{children}</div>
    </details>
  )
}

/** Inline message. `warn` is a paused or limited state, `error` a failure; plain is neutral information. */
export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'error'; title?: string; children: ReactNode }) {
  const Icon = tone === 'info' ? Info : CircleAlert
  const cls = tone === 'error' ? 'border-accent/40 bg-accent/[0.04]' : tone === 'warn' ? 'border-rule-strong bg-raised/70' : 'border-rule bg-sheet'
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-3 border ${cls} rounded px-4 py-3 text-sm text-ink-2`}>
      <Icon aria-hidden className={`h-4 w-4 mt-[3px] shrink-0 ${tone === 'error' ? 'text-accent' : 'text-ink-3'}`} />
      <div className="min-w-0 break-words">
        {title ? <p className="font-bold text-ink">{title}</p> : null}
        {children}
      </div>
    </div>
  )
}

/** Quiet placeholder for a section that has nothing to show yet. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded border border-dashed border-rule-strong px-5 py-8 text-center">
      <p className="font-serif text-lg text-ink">{title}</p>
      {children ? <p className="mt-1 text-sm text-ink-3">{children}</p> : null}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />
}

/** Loading shape shared by the Earn and Trade pages: title, figures, then the two columns. */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-10 w-64 mt-3" />
      <Skeleton className="h-4 w-96 max-w-full mt-4" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 border-y border-rule py-5 my-10">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-32 mt-2.5" />
          </div>
        ))}
      </div>
      <div className="grid gap-8 lg:grid-cols-12">
        <Skeleton className="lg:col-span-7 h-72" />
        <Skeleton className="lg:col-span-5 h-96" />
      </div>
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: ReadonlyArray<{ id: T; label: string }>; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="grid grid-flow-col auto-cols-fr rounded border border-rule-strong p-0.5 bg-paper">
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)} className={`h-9 rounded-[2px] text-sm font-bold transition-colors ${value === o.id ? 'bg-ink text-sheet' : 'text-ink-2 hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ id, label, value, onChange, hint, suffix, onMax, placeholder = '0.00' }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; suffix?: string; onMax?: () => void; placeholder?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <label htmlFor={id} className="label">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-ink-3 num text-right">
            {hint}
          </p>
        ) : null}
      </div>
      <div className="flex items-center h-14 border border-rule-strong bg-white rounded transition-colors focus-within:border-ink">
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode="decimal" autoComplete="off" spellCheck={false} aria-describedby={hint ? `${id}-hint` : undefined} className="num w-full min-w-0 bg-transparent pl-4 pr-2 font-serif text-xl text-ink outline-none" />
        {onMax ? (
          <button type="button" onClick={onMax} className="mr-2 h-7 px-2 rounded border border-rule text-2xs uppercase tracking-[0.1em] text-ink-2 hover:border-ink hover:text-ink">
            Max
          </button>
        ) : null}
        {suffix ? <span className="pr-4 text-sm text-ink-3">{suffix}</span> : null}
      </div>
    </div>
  )
}

export function TxLink({ hash, children = 'View transaction' }: { hash?: string; children?: ReactNode }) {
  if (!hash) return null
  return (
    <a className="link inline-flex items-center gap-0.5 whitespace-nowrap" href={explorerTx(hash)} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
    </a>
  )
}

const PHASE_LABEL: Record<string, string> = {
  switching: 'Switching network',
  allowance: 'Checking allowance',
  'approve-sign': 'Approve in your wallet',
  'approve-pending': 'Approving',
  simulating: 'Preparing',
  sign: 'Confirm in your wallet',
  pending: 'Confirming',
  refreshing: 'Updating',
}
// Spelled out so the stylesheet build keeps every variant.
const BTN = { primary: 'btn-primary', dark: 'btn-dark', secondary: 'btn-secondary' } as const
const WORKING = new Set(Object.keys(PHASE_LABEL))

export function ActionButton({ label, action, onClick, disabled, reason, variant = 'primary', block = true }: { label: string; action: ActionHandle; onClick: () => void; disabled?: boolean; reason?: string | null; variant?: 'primary' | 'dark' | 'secondary'; block?: boolean }) {
  const { state } = action
  const working = WORKING.has(state.phase)
  const blocked = state.phase === 'unconfirmed' || state.phase === 'refresh-failed'
  const reasonId = useId()
  const showReason = Boolean(reason && !working && !blocked && state.phase !== 'success' && state.phase !== 'error')
  const textBtn = 'ml-1 font-bold text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink'
  return (
    <div className={block ? 'w-full' : ''}>
      <button type="button" onClick={onClick} disabled={working || blocked || disabled} aria-busy={working} aria-describedby={showReason ? reasonId : undefined} className={`${BTN[variant]} ${block ? 'w-full' : ''}`}>
        {working ? (
          <>
            <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
            {PHASE_LABEL[state.phase]}
          </>
        ) : (
          label
        )}
      </button>
      {showReason ? (
        <p id={reasonId} className={`text-xs text-ink-3 mt-2 ${block ? 'text-center' : ''}`}>
          {reason}
        </p>
      ) : null}
      <div aria-live="polite" className="text-sm">
        {working && state.message ? <p className="mt-2 text-xs text-ink-3">{state.message}</p> : null}
        {state.phase === 'idle' && state.message ? <p className="mt-2 text-xs text-ink-3">{state.message}</p> : null}
        {state.phase === 'success' ? (
          <p className="mt-3 flex flex-wrap items-center gap-x-2 text-ink-2">
            <Check aria-hidden className="h-4 w-4 text-up" />
            <span className="text-up font-bold">Confirmed</span>
            <TxLink hash={state.hash} />
            <button type="button" className={textBtn} onClick={action.reset}>
              Done
            </button>
          </p>
        ) : null}
        {state.phase === 'error' ? (
          <p role="alert" className="mt-3 text-accent">
            {state.message} <TxLink hash={state.hash ?? state.approvalHash} />
            <button type="button" className={textBtn} onClick={action.reset}>
              Try again
            </button>
          </p>
        ) : null}
        {state.phase === 'unconfirmed' ? (
          <p role="alert" className="mt-3 text-accent">
            {state.message} <TxLink hash={state.unresolved === 'approval' ? state.approvalHash : state.hash} />
            <button type="button" className={textBtn} onClick={() => void action.recover()}>
              Check status
            </button>
          </p>
        ) : null}
        {state.phase === 'refresh-failed' ? (
          <p role="alert" className="mt-3 text-ink-2">
            {state.message} <TxLink hash={state.hash} />
            <button type="button" className={textBtn} onClick={() => void action.refresh()}>
              Refresh
            </button>
          </p>
        ) : null}
      </div>
    </div>
  )
}
