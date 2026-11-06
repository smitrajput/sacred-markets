import { useAccount, useConnect, useDisconnect } from 'wagmi'

import { shortAddr } from '@/lib/format'

export function Header() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()
  const hasProvider = typeof window !== 'undefined' && (window as unknown as { ethereum?: unknown }).ethereum !== undefined
  return (
    <header className="border-b border-hairline bg-panel">
      <div className="mx-auto max-w-5xl px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-2xl text-ink mr-auto">Sacred</h1>
        <span className="border border-ink text-ink text-xs px-2 py-1 rounded" title="All writes are Arc Testnet (chain 5042002) only">
          Arc Testnet
        </span>
        <a className="text-sm text-secondary underline" href="/guide.html">
          Help
        </a>
        {isConnected && address ? (
          <div className="flex items-center gap-2">
            <span className="num text-sm text-ink" title={address}>
              {shortAddr(address)}
            </span>
            <button type="button" onClick={() => disconnect()} className="border border-ink rounded px-3 py-1 text-sm hover:bg-raised">
              Disconnect
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={!hasProvider || isPending}
            onClick={() => connectors[0] && connect({ connector: connectors[0] })}
            className="bg-accent text-panel hover:bg-accent-hover rounded px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {isPending ? 'Connecting…' : 'Connect wallet'}
          </button>
        )}
      </div>
      {!hasProvider && !isConnected ? (
        <p className="mx-auto max-w-5xl px-4 pb-2 text-sm text-secondary">No browser wallet was found. Open this hosted app in a wallet-enabled browser (for example a browser with an injected wallet extension) to connect. You can still read everything below.</p>
      ) : null}
      {error ? <p role="alert" className="mx-auto max-w-5xl px-4 pb-2 text-sm text-accent">{error.message.split('\n')[0]}</p> : null}
    </header>
  )
}
