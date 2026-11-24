import { Check, ChevronDown, Copy, ExternalLink, LogOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'

import { Brand } from './Brand'
import { useWallet } from '@/hooks/useWallet'
import { explorerAddr } from '@/lib/contracts'
import { shortAddr, usdc } from '@/lib/format'

export type View = 'earn' | 'trade' | 'activity' | 'guide'
export const VIEWS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'earn', label: 'Earn' },
  { id: 'trade', label: 'Trade' },
  { id: 'activity', label: 'Activity' },
  { id: 'guide', label: 'Guide' },
]

/** Closes a popover on an outside press or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

function WalletButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()
  const w = useWallet()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const hasProvider = typeof window !== 'undefined' && (window as unknown as { ethereum?: unknown }).ethereum !== undefined
  const item = 'flex w-full items-center gap-2.5 px-4 h-10 text-sm text-ink-2 hover:bg-raised hover:text-ink no-underline'

  if (isConnected && address) {
    return (
      <div ref={ref} className="relative">
        <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="btn h-10 pl-3 pr-2.5 border-rule-strong bg-sheet text-sm font-normal hover:border-ink">
          <span aria-hidden className="h-2 w-2 rounded-full bg-up" />
          <span className="font-mono text-xs">{shortAddr(address)}</span>
          <ChevronDown aria-hidden className={`h-4 w-4 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open ? (
          <div role="menu" className="absolute right-0 top-12 z-30 w-64 rounded border border-rule-strong bg-sheet shadow-pop py-1.5">
            <div className="px-4 pt-2.5 pb-3 border-b border-rule mb-1.5">
              <p className="label">Wallet balance</p>
              <p className="font-serif text-xl mt-1 num">
                {usdc(w.usdcAtoms)} <span className="text-xs font-sans text-ink-3">USDC</span>
              </p>
            </div>
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                void navigator.clipboard?.writeText(address).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }}
            >
              {copied ? <Check aria-hidden className="h-4 w-4 text-up" /> : <Copy aria-hidden className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy address'}
            </button>
            <a role="menuitem" className={item} href={explorerAddr(address)} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden className="h-4 w-4" />
              View on explorer
            </a>
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false)
                disconnect()
              }}
            >
              <LogOut aria-hidden className="h-4 w-4" />
              Disconnect
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" disabled={isPending} onClick={() => (hasProvider && connectors[0] ? connect({ connector: connectors[0] }) : setOpen((o) => !o))} className="btn-primary h-10 px-4">
        {isPending ? 'Connecting' : 'Connect wallet'}
      </button>
      {open || error ? (
        <div role="status" className="absolute right-0 top-12 z-30 w-72 rounded border border-rule-strong bg-sheet shadow-pop px-4 py-3.5 text-sm text-ink-2">
          {error ? (
            error.message.split('\n')[0]
          ) : (
            <>
              <p className="font-bold text-ink">No wallet found</p>
              <p className="mt-1">
                Install{' '}
                <a className="link" href="https://metamask.io/download" target="_blank" rel="noopener noreferrer">
                  MetaMask
                </a>{' '}
                or{' '}
                <a className="link" href="https://rabby.io" target="_blank" rel="noopener noreferrer">
                  Rabby
                </a>
                , then reload this page. You can browse without one.
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

export function Header({ view, onView }: { view: View; onView: (v: View) => void }) {
  const nav = (extra: string) => (
    <nav aria-label="Sections" className={extra}>
      {VIEWS.map((v) => (
        <a
          key={v.id}
          href={`#${v.id}`}
          aria-current={view === v.id ? 'page' : undefined}
          onClick={(e) => {
            e.preventDefault()
            onView(v.id)
          }}
          className={`relative inline-flex items-center h-full px-3.5 text-sm no-underline transition-colors ${view === v.id ? 'text-ink font-bold after:absolute after:inset-x-3.5 after:bottom-0 after:h-[2px] after:bg-accent' : 'text-ink-2 hover:text-ink'}`}
        >
          {v.label}
        </a>
      ))}
    </nav>
  )
  return (
    <header className="sticky top-0 z-20 bg-paper/95 backdrop-blur border-b border-rule">
      <div className="mx-auto max-w-page px-5 sm:px-8 h-16 flex items-center gap-6">
        <Brand />
        {nav('hidden md:flex h-full items-stretch ml-4')}
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-2 h-10 px-3 rounded border border-rule text-xs text-ink-2" title="Arc Testnet · chain 5042002">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-up" />
            Arc Testnet
          </span>
          <WalletButton />
        </div>
      </div>
      {nav('md:hidden flex h-11 items-stretch border-t border-rule px-1.5 overflow-x-auto')}
    </header>
  )
}
