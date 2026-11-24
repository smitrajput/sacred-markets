import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { usePublicClient } from 'wagmi'
import { arcTestnet } from 'viem/chains'

import { ActionButton, Amount, Card, Disclosure, Empty, Field, Notice, PageHead, PageSkeleton, Row, Rows, Skeleton, Stat, StatStrip } from './ui'
import { tradeEngineAbi } from '@/contracts/abis'
import { useAction } from '@/hooks/useAction'
import { useWallet } from '@/hooks/useWallet'
import { useApi, type OracleInfo, type PositionRow, type PositionsResponse, type VaultResponse } from '@/lib/api'
import { CONTRACTS, POOL_KEY, QUOTER, TERMS_HASH, quoterAbi } from '@/lib/contracts'
import { bpsToPercent, btc, formatDate, formatTime, parseDecimal, shortAddr, shortHash, toBig, usdc } from '@/lib/format'
import { PROBLEM_TEXT, checkOpen, saleFloor } from '@/lib/policy'
import { BLOCKER_TEXT } from '@/lib/text'

const now = () => BigInt(Math.floor(Date.now() / 1000))
const TERM_DAYS = 14n

function Pill({ tone = 'plain', children }: { tone?: 'plain' | 'good' | 'alert'; children: string }) {
  const cls = tone === 'good' ? 'border-up/40 text-up' : tone === 'alert' ? 'border-accent/50 text-accent' : 'border-rule-strong text-ink-2'
  return <span className={`inline-flex items-center h-6 px-2 rounded border text-2xs uppercase tracking-[0.1em] ${cls}`}>{children}</span>
}

function OrderTicket({ vault, positions, positionsState, oracle }: { vault: VaultResponse; positions: PositionRow[]; positionsState: 'ready' | 'loading' | 'error'; oracle: OracleInfo }) {
  const w = useWallet()
  const pc = usePublicClient({ chainId: arcTestnet.id })
  const [amount, setAmount] = useState('0.10')
  const act = useAction('open')
  const equity = parseDecimal(amount, 6) ?? 0n
  const gross = equity * 2n
  const price = BigInt(oracle.priceMicroUsdcPerBtc)
  const quote = useQuery({
    queryKey: ['quote', gross.toString()],
    enabled: !!pc && gross > 0n,
    refetchInterval: 15_000,
    retry: 0,
    queryFn: async () => {
      const r = await pc!.simulateContract({ address: QUOTER, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ poolKey: POOL_KEY, zeroForOne: true, exactAmount: gross, hookData: '0x' }] })
      return r.result[0]
    },
  })
  const cap = toBig(vault.vault.perAccountCap)
  const exposure = positions.reduce((a, p) => a + toBig(p.principal), 0n)
  const accountHeadroom = cap > exposure ? cap - exposure : 0n
  const quoteAtoms = quote.isError || quote.data === undefined ? null : quote.data
  const check = checkOpen({ equity, price, priceFresh: oracle.fresh, quoteAtoms, accountHeadroom, vaultHeadroom: toBig(vault.financingHeadroom), spendable: w.spendable })
  const vaultBlock = vault.blockers.financing[0]
  const problems = check.problems.filter((p) => !(p === 'no_quote' && quote.isLoading))
  const block = !w.isConnected ? 'Connect a wallet to buy.' : vaultBlock ? 'New purchases are paused.' : positionsState === 'loading' ? 'Checking your account limit.' : positionsState === 'error' ? 'Your account limit could not be checked. Retrying.' : quote.isLoading ? 'Getting a quote.' : problems[0] ? PROBLEM_TEXT[problems[0]] : null

  const covOk = quoteAtoms !== null && check.coverageBps >= 19_000n
  return (
    <Card title="Buy cirBTC" aside={<Pill>2× financing</Pill>}>
      <div className="space-y-5">
        <Field id="eq" label="You pay" value={amount} onChange={setAmount} suffix="USDC" hint={w.isConnected ? `Available ${usdc(w.spendable)}` : undefined} />
        <div>
          <p className="label mb-2">You receive</p>
          <div className="flex items-center justify-between h-14 px-4 border border-rule rounded bg-paper/60">
            <span className="font-serif text-xl num">{quote.isLoading ? <Skeleton className="h-5 w-28" /> : quoteAtoms === null ? '—' : btc(quoteAtoms)}</span>
            <span className="text-sm text-ink-3">cirBTC</span>
          </div>
        </div>
        <Rows>
          <Row label="Purchase size" value={`${usdc(gross)} USDC`} />
          <Row label="Financed by the vault" value={`${usdc(check.principal)} USDC`} />
          <Row label="Fixed markup" value={`${usdc(check.markup)} USDC`} hint="10% a year, for 14 days. It never grows." />
          <Row label="Total to repay" value={`${usdc(check.debt)} USDC`} hint={`Due ${formatDate(now() + TERM_DAYS * 86_400n)}`} strong />
          <Row
            label="Starting coverage"
            value={quoteAtoms === null ? '—' : <span className={covOk ? 'text-up' : 'text-accent'}>{bpsToPercent(check.coverageBps)}</span>}
            hint="Value of your BTC against what you owe. Minimum 190%."
          />
        </Rows>
        <ActionButton
          label="Buy cirBTC"
          action={act}
          disabled={!!block}
          reason={block}
          onClick={() =>
            void act.start({
              label: 'open',
              approvals: [{ token: CONTRACTS.usdc, spender: CONTRACTS.engine, amount: equity }],
              call: { address: CONTRACTS.engine, abi: tradeEngineAbi, functionName: 'open', args: [equity, check.executionMin, now() + 600n, TERMS_HASH] },
            })
          }
        />
        <p className="text-xs text-ink-3">The vault buys the BTC, sells it to you at cost plus the fixed markup, and holds it as security until you repay. Confirming accepts these terms. Repaying early does not reduce the markup.</p>
        <div className="border-t border-rule pt-2">
          <Disclosure summary="Limits and details">
            <Rows>
              <Row label="Minimum received" value={`${btc(check.executionMin)} cirBTC`} />
              <Row label="Your financing limit" value={`${usdc(cap)} USDC`} hint={`${usdc(accountHeadroom)} USDC remaining`} />
              <Row label="Vault can finance" value={`${usdc(toBig(vault.financingHeadroom))} USDC`} />
              <Row label="Terms" value={<span className="font-mono text-xs" title={TERMS_HASH}>{shortHash(TERMS_HASH)}</span>} />
            </Rows>
          </Disclosure>
        </div>
      </div>
    </Card>
  )
}

function PositionCard({ p, oracle }: { p: PositionRow; oracle: OracleInfo }) {
  const w = useWallet()
  const full = useAction(`repay-full-${p.id}`)
  const part = useAction(`repay-part-${p.id}`)
  const close = useAction(`close-${p.id}`)
  const [pay, setPay] = useState('')
  const debt = BigInt(p.debt)
  const price = BigInt(oracle.priceMicroUsdcPerBtc)
  const payAmt = parseDecimal(pay, 6)
  const floor = saleFloor(BigInt(p.collateral), price)
  const short = 'Not enough USDC. 0.10 USDC is kept back for network fees.'
  const coverage = BigInt(p.coverageBps)
  return (
    <article className="card">
      <div className="flex items-center justify-between gap-4 px-5 sm:px-6 pt-5 pb-4 border-b border-rule">
        <h3 className="text-lg">
          cirBTC <span className="text-ink-3">#{p.id}</span>
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-3">{p.matured ? `Was due ${formatDate(BigInt(p.maturesAt))}` : `Due ${formatTime(BigInt(p.maturesAt))}`}</span>
          {p.matured ? <Pill tone="alert">Due</Pill> : <Pill tone="good">Active</Pill>}
        </div>
      </div>
      <div className="px-5 sm:px-6 py-5 space-y-5">
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 [&>div]:py-0">
          <Stat label="Holding" value={<Amount value={btc(BigInt(p.collateral))} unit="cirBTC" />} />
          <Stat label="To repay" value={<Amount value={usdc(debt)} unit="USDC" />} />
          <Stat label="Coverage" value={<span className={coverage <= 16_000n ? 'text-accent' : ''}>{bpsToPercent(coverage)}</span>} />
        </dl>
        <Rows>
          <Row label="Financing outstanding" value={`${usdc(BigInt(p.principal))} USDC`} />
          <Row label="Markup outstanding" value={`${usdc(BigInt(p.markup))} USDC`} />
        </Rows>
        <div className="grid gap-3 sm:grid-cols-2 items-start">
          <ActionButton label="Repay in full" action={full} disabled={debt > w.spendable} reason={debt > w.spendable ? short : null} onClick={() => void full.start({ label: 'repayAndRelease', approvals: [{ token: CONTRACTS.usdc, spender: CONTRACTS.engine, amount: debt }], call: { address: CONTRACTS.engine, abi: tradeEngineAbi, functionName: 'repayAndRelease', args: [BigInt(p.id), debt] } })} />
          <ActionButton variant="dark" label="Sell and close" action={close} disabled={!oracle.fresh || floor === 0n} reason={oracle.fresh ? null : 'Paused until the reference price is refreshed.'} onClick={() => void close.start({ label: 'close', approvals: [], call: { address: CONTRACTS.engine, abi: tradeEngineAbi, functionName: 'ownerClose', args: [BigInt(p.id), floor, now() + 600n] } })} />
        </div>
        <p className="text-xs text-ink-3">Repaying in full returns all your BTC. Selling repays what you owe from the proceeds and sends you the rest. If coverage falls to 160%, part of the BTC is sold to bring it back to 190%.</p>
        <div className="border-t border-rule pt-2">
          <Disclosure summary="Repay part">
            <div className="flex items-end gap-3 pt-1">
              <div className="flex-1 min-w-0">
                <Field id={`pay${p.id}`} label="Amount" value={pay} onChange={setPay} suffix="USDC" />
              </div>
            </div>
            <div className="mt-3">
              <ActionButton variant="secondary" label="Repay" action={part} disabled={!payAmt || payAmt > debt || payAmt > w.spendable} reason={payAmt && payAmt > debt ? 'More than you owe.' : payAmt && payAmt > w.spendable ? short : null} onClick={() => payAmt && void part.start({ label: 'repay', approvals: [{ token: CONTRACTS.usdc, spender: CONTRACTS.engine, amount: payAmt }], call: { address: CONTRACTS.engine, abi: tradeEngineAbi, functionName: 'repay', args: [BigInt(p.id), payAmt] } })} />
            </div>
            <p className="text-xs text-ink-3 mt-3">Part payments reduce the financing first, then the markup. Your BTC stays pledged until everything is repaid.</p>
          </Disclosure>
        </div>
      </div>
    </article>
  )
}

function SettleRow({ p, oracle, connected }: { p: PositionRow; oracle: OracleInfo; connected: boolean }) {
  const act = useAction(`keeper-${p.id}`)
  const price = BigInt(oracle.priceMicroUsdcPerBtc)
  const dl = now() + 600n
  const reason = !connected ? 'Connect a wallet.' : !oracle.fresh ? 'Paused until the reference price is refreshed.' : null
  const call = p.matured
    ? { address: CONTRACTS.engine, abi: tradeEngineAbi, functionName: 'settleMatured', args: [BigInt(p.id), saleFloor(BigInt(p.collateral), price), dl] as const }
    : { address: CONTRACTS.engine, abi: tradeEngineAbi, functionName: 'rebalance', args: [BigInt(p.id), BigInt(p.rebalance.minUsdc), dl] as const }
  return (
    <li className="py-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="min-w-0">
        <p className="text-sm text-ink">
          cirBTC #{p.id} <span className="text-ink-3">· {shortAddr(p.trader)} · coverage {bpsToPercent(BigInt(p.coverageBps))}</span>
        </p>
        <p className="text-sm text-ink-2 mt-0.5">{p.matured ? `Due date passed on ${formatDate(BigInt(p.maturesAt))}. The BTC is sold, the vault repaid and the rest returned to the owner.` : `Coverage is at or below 160%. ${btc(BigInt(p.rebalance.sellAtoms))} cirBTC is sold to restore 190%.`}</p>
      </div>
      <ActionButton block={false} variant="secondary" label={p.matured ? 'Settle' : 'Restore coverage'} action={act} disabled={!!reason} reason={reason} onClick={() => void act.start({ label: 'permissionless', approvals: [], call })} />
    </li>
  )
}

/** Positions past their due date or below the coverage trigger. Settling them is open to any wallet; the section is hidden when there are none. */
function Settlements({ oracle }: { oracle: OracleInfo }) {
  const w = useWallet()
  const all = useApi<PositionsResponse>(['positions', 'all'], '/api/positions')
  const eligible = (all.data?.positions ?? []).filter((p) => p.matured || p.rebalance.eligible)
  if (eligible.length === 0) return null
  return (
    <Card title="Awaiting settlement" aside={`${eligible.length} position${eligible.length === 1 ? '' : 's'}`}>
      <p className="text-sm text-ink-2">These are normally settled automatically. Any wallet can also settle them; the contract decides how much is sold.</p>
      <ul className="mt-3 divide-y divide-rule border-t border-rule">
        {eligible.map((p) => (
          <SettleRow key={p.id} p={p} oracle={oracle} connected={w.isConnected} />
        ))}
      </ul>
    </Card>
  )
}

export function TradeTab() {
  const w = useWallet()
  const vault = useApi<VaultResponse>(['vault', w.address ?? ''], `/api/vault${w.address ? `?owner=${w.address}` : ''}`)
  const pos = useApi<PositionsResponse>(['positions', w.address ?? ''], w.address ? `/api/positions?owner=${w.address}` : null)
  if (vault.isLoading) return <PageSkeleton />
  if (vault.error || !vault.data)
    return (
      <Notice tone="error" title="The market could not be loaded">
        {vault.error instanceof Error ? vault.error.message : 'Please try again.'} Retrying automatically.
      </Notice>
    )
  const oracle = vault.data.oracle
  const blockers = vault.data.blockers.financing
  return (
    <>
      <PageHead eyebrow="Trade" title="cirBTC / USDC">
        Buy real BTC with twice your capital. The cost is one fixed markup, agreed up front: no interest, no funding payments.
      </PageHead>

      <StatStrip>
        <Stat label="Reference price" value={<Amount value={usdc(BigInt(oracle.priceMicroUsdcPerBtc))} unit="USDC" />} hint={oracle.fresh ? `Updated ${formatTime(BigInt(oracle.observedAt))}` : <span className="text-accent">Expired {formatTime(BigInt(oracle.expiresAt))}</span>} />
        <Stat label="Buying power" value="2×" hint="Half yours, half financed" />
        <Stat label="Fixed markup" value="10%" hint="A year, over a 14-day term" />
        <Stat label="Available financing" value={<Amount value={usdc(toBig(vault.data.financingHeadroom))} unit="USDC" />} />
      </StatStrip>

      {blockers.length > 0 ? (
        <div className="mb-8 space-y-2">
          {blockers.map((c) => (
            <Notice key={c} tone="warn" title="New purchases are paused">
              {BLOCKER_TEXT[c] ?? 'New purchases are temporarily unavailable.'}
            </Notice>
          ))}
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-12 lg:gap-10 items-start">
        <div className="lg:col-span-7 space-y-6 order-2 lg:order-1">
          <h2 className="text-xl">Your positions</h2>
          {!w.isConnected ? (
            <Empty title="No wallet connected">Connect a wallet to see your positions.</Empty>
          ) : pos.isLoading ? (
            <Skeleton className="h-64" />
          ) : pos.error ? (
            <Notice tone="error">Your positions could not be loaded. Retrying automatically.</Notice>
          ) : pos.data && pos.data.positions.length === 0 ? (
            <Empty title="No open positions">Positions you buy appear here. Closed positions are listed under Activity.</Empty>
          ) : (
            pos.data?.positions.map((p) => <PositionCard key={p.id} p={p} oracle={pos.data.oracle} />)
          )}
          <Settlements oracle={oracle} />
        </div>
        <div className="lg:col-span-5 order-1 lg:order-2 lg:sticky lg:top-24">
          <OrderTicket vault={vault.data} positions={pos.data?.positions ?? []} positionsState={!w.isConnected || pos.isSuccess ? 'ready' : pos.isError ? 'error' : 'loading'} oracle={oracle} />
        </div>
      </div>
    </>
  )
}
