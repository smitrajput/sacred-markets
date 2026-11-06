import { useAccount, useConnect, useDisconnect } from 'wagmi'

import { shortAddr } from '@/lib/format'

export function Header() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()
  const hasProvider = typeof window !== 'undefined' && (window as unknown as { ethereum?: unknown }).ethereum !== undefined
  return (
    <header className="bg-paper border-b border-rule">
      <div className="mx-auto max-w-page px-5 sm:px-8 py-3 sm:min-h-[84px] flex flex-wrap items-center gap-x-6 gap-y-3">
        <h1 className="mr-auto">
          <a href="/" className="block">
            <img src="/brand/sacred-horizontal-primary.svg" alt="Sacred" width={1000} height={300} className="w-44 h-auto" />
          </a>
        </h1>
        <div className="order-2 sm:order-3 flex items-center gap-3 min-w-0">
          {isConnected && address ? (
            <>
              <span className="font-mono text-sm text-ink" title={address}>
                {shortAddr(address)}
              </span>
              <button type="button" onClick={() => disconnect()} className="h-11 px-4 border border-ink rounded text-sm font-bold hover:bg-raised transition-colors">
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!hasProvider || isPending}
              onClick={() => connectors[0] && connect({ connector: connectors[0] })}
              className="h-11 px-5 border border-transparent rounded bg-red text-white text-sm font-bold hover:bg-deep transition-colors disabled:bg-raised disabled:text-secondary disabled:border-rule disabled:cursor-not-allowed"
            >
              {isPending ? 'Connecting…' : 'Connect wallet'}
            </button>
          )}
        </div>
        <div className="order-3 sm:order-2 w-full sm:w-auto flex items-center gap-6">
          <span className="inline-flex items-center h-8 px-2.5 border border-ink rounded text-sm font-bold text-ink" title="All writes are Arc Testnet (chain 5042002) only">
            Arc Testnet
          </span>
          <a className="inline-flex items-center min-h-11 text-sm text-ink underline" href="/guide.html">
            Help
          </a>
        </div>
      </div>
      {!hasProvider && !isConnected ? (
        <p className="mx-auto max-w-page px-5 sm:px-8 pb-3 text-sm text-secondary">No browser wallet was found. Open this hosted app in a wallet-enabled browser (for example a browser with an injected wallet extension) to connect. You can still read everything below.</p>
      ) : null}
      {error ? (
        <p role="alert" className="mx-auto max-w-page px-5 sm:px-8 pb-3 text-sm text-red">
          {error.message.split('\n')[0]}
        </p>
      ) : null}
    </header>
  )
}
