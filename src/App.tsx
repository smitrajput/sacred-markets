import { useBlockNumber, useChainId, useReadContracts } from 'wagmi'
import { erc20Abi } from 'viem'
import { arcTestnet } from 'viem/chains'
import { ExternalLink } from 'lucide-react'
import { addressUrl, manifest, shortAddress } from '@/lib/sacred'

const { usdc, cirBTC } = manifest.externalContracts

function useTokenCheck(token: typeof usdc) {
  const { data, isLoading, isError } = useReadContracts({
    allowFailure: false,
    contracts: [
      { chainId: arcTestnet.id, address: token.address, abi: erc20Abi, functionName: 'symbol' },
      { chainId: arcTestnet.id, address: token.address, abi: erc20Abi, functionName: 'decimals' },
    ],
  })
  const [symbol, decimals] = data ?? []
  const matches = data ? symbol === token.symbol && decimals === token.decimals : null
  return { symbol, decimals, matches, isLoading, isError }
}

function TokenRow({ label, token }: { label: string; token: typeof usdc }) {
  const live = useTokenCheck(token)
  const status = live.isLoading
    ? 'Checking'
    : live.isError
      ? 'RPC unreachable'
      : live.matches
        ? 'Matches manifest'
        : 'Mismatch'
  const tone = live.matches ? 'text-emerald-700' : live.isLoading ? 'text-slate-500' : 'text-red-700'

  return (
    <li className="flex items-center justify-between gap-4 rounded-2xl bg-white/70 px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium text-[#1B3158]">{label}</p>
        <a
          href={addressUrl(token.address)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-xs text-slate-500 hover:text-[#1B3158]"
        >
          {shortAddress(token.address)}
          <ExternalLink size={12} aria-hidden />
        </a>
      </div>
      <div className="text-right">
        <p className="tabular-nums text-sm text-[#1B3158]">{token.decimals} decimals</p>
        <p className={`text-xs ${tone}`}>{status}</p>
      </div>
    </li>
  )
}

export default function App() {
  const walletChainId = useChainId()
  const { data: block } = useBlockNumber({ chainId: arcTestnet.id, watch: false })
  const sacred = Object.entries(manifest.sacredContracts)

  return (
    <main className="min-h-dvh bg-[#F6F3EE] px-4 py-10 text-[#1B3158]">
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <header className="px-1">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
            {manifest.network.name}
          </p>
          <h1 className="font-display text-4xl font-bold tracking-[-0.03em] text-balance">Sacred</h1>
          <p className="mt-1 max-w-[65ch] text-pretty text-slate-600">
            USDC Earn and cirBTC spot financing on Arc. Scaffold only: no application contracts are deployed yet.
          </p>
        </header>

        <section className="rounded-3xl border border-white/60 bg-white/50 p-5 shadow-sm backdrop-blur">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Network</h2>
          <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Chain ID</dt>
            <dd className="text-right tabular-nums">{manifest.network.chainId}</dd>
            <dt className="text-slate-500">Latest block</dt>
            <dd className="text-right tabular-nums">{block !== undefined ? block.toString() : '...'}</dd>
            <dt className="text-slate-500">Gas token</dt>
            <dd className="text-right">{manifest.network.nativeGas.symbol} (same pool as ERC20 USDC)</dd>
            <dt className="text-slate-500">Config chain</dt>
            <dd className="text-right tabular-nums">{walletChainId === arcTestnet.id ? 'Arc Testnet' : walletChainId}</dd>
          </dl>
        </section>

        <section className="rounded-3xl border border-white/60 bg-white/50 p-5 shadow-sm backdrop-blur">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Verified tokens</h2>
          <ul className="mt-3 flex flex-col gap-2">
            <TokenRow label="USDC (ERC20)" token={usdc} />
            <TokenRow label="cirBTC" token={cirBTC} />
          </ul>
        </section>

        <section className="rounded-3xl border border-white/60 bg-white/50 p-5 shadow-sm backdrop-blur">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Sacred contracts</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {sacred.map(([key, c]) => (
              <li key={key} className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 text-sm">
                <span>{c.description}</span>
                <span className="text-slate-500">{c.address ? shortAddress(c.address) : 'Not deployed'}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}
