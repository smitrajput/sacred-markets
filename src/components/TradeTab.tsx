import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { usePublicClient } from 'wagmi'
import { arcTestnet } from 'viem/chains'

import { ActionButton, Disclosure, Field, Notice, Panel, Row, Rows, Stat } from './ui'
import { tradeEngineAbi } from '@/contracts/abis'
import { useAction } from '@/hooks/useAction'
import { useWallet } from '@/hooks/useWallet'
import { useApi, type OracleInfo, type PositionRow, type PositionsResponse, type VaultResponse } from '@/lib/api'
import { CONTRACTS, POOL_KEY, QUOTER, TERMS_HASH, explorerAddr, quoterAbi } from '@/lib/contracts'
import { bpsToPercent, btc, formatIst, formatTime, parseDecimal, shortAddr, toBig, usdc } from '@/lib/format'
import { PROBLEM_TEXT, checkOpen, saleFloor } from '@/lib/policy'
import { BLOCKER_TEXT } from '@/lib/text'

const now = () => BigInt(Math.floor(Date.now() / 1000))

function OracleBox({ o }: { o: OracleInfo }) {
  return (
    <Notice tone={o.fresh ? 'info' : 'warn'}>
      <span className="block">
        <span className="font-serif text-xl num text-ink">{usdc(BigInt(o.priceMicroUsdcPerBtc))} USDC per BTC</span> <span className="text-sm text-secondary">reference price</span>
      </span>
      <span className="block text-sm mt-1">
        Testnet operator fixture, not a market oracle; you cannot update it. Set {formatTime(BigInt(o.observedAt))}, {o.fresh ? 'valid until' : 'expired at'} {formatTime(BigInt(o.expiresAt))} ({formatIst(BigInt(o.expiresAt))}).
        {o.fresh ? '' : <strong> Opens, sales and rebalances are paused; repay and claim still work.</strong>}
      </span>
    </Notice>
  )
}

function OpenForm({ vault, positions, positionsState, oracle }: { vault: VaultResponse; positions: PositionRow[]; positionsState: 'ready' | 'loading' | 'error'; oracle: OracleInfo }) {
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
  const block = !w.isConnected ? 'Connect a wallet.' : positionsState === 'loading' ? 'Loading your current exposure so the account cap can be enforced…' : positionsState === 'error' ? 'Your current exposure could not be read, so the account cap cannot be checked. Retrying automatically.' : vaultBlock ? (BLOCKER_TEXT[vaultBlock] ?? 'Financing is closed.') : quote.isLoading ? 'Fetching a live swap quote…' : problems[0] ? PROBLEM_TEXT[problems[0]] : null

  const covBelow = problems.includes('initial_coverage_below_190') || (quoteAtoms !== null && check.coverageBps < 19_000n)
  const covOk = quoteAtoms !== null && !covBelow
  const covText = quote.isLoading
    ? 'Fetching a live quote. Coverage is measured on it and must be at least 190.00%.'
    : quoteAtoms === null
      ? 'No live quote is available, so coverage cannot be measured. Opening is blocked; retrying every 15 seconds.'
      : covBelow
        ? 'Below the required 190.00% at this quote. Opening is blocked.'
        : 'Meets the 190.00% minimum, measured on the quoted output.'
  return (
    <Panel title="Open a 2x cirBTC position">
      <div className="space-y-5">
        <Field id="eq" label="Your contribution" value={amount} onChange={setAmount} suffix="USDC" hint={w.isConnected ? `Spendable ${usdc(w.spendable)} USDC (0.10 kept for gas)` : undefined} />
        <Rows>
          <Row label="Principal P (sale financing)" value={usdc(check.principal)} />
          <Row label="Markup M (fixed at open)" value={usdc(check.markup)} hint="10% annualized for 14 days; no growth, rollover or late fees" />
          <Row label="Total debt D = P + M" value={usdc(check.debt)} strong />
          <Row label="Maturity" value="14 days" hint="Zero early-repayment rebate" />
          <Row label="Live pool quote" value={quote.isLoading ? 'quoting…' : quoteAtoms === null ? 'unavailable' : `${btc(quoteAtoms)} BTC`} hint="Actual Uniswap v4 quote for the full 2x purchase" />
          <Row label="Execution minimum" value={`${btc(check.executionMin)} BTC`} hint="Stricter of quote and reference floor" strong />
        </Rows>
        <div className={`flex items-start justify-between gap-4 border rounded px-4 py-3 ${covOk ? 'border-ink bg-panel' : 'border-red bg-white'}`} aria-live="polite">
          <div className="min-w-0">
            <p className="text-sm font-bold">Initial coverage</p>
            <p className="text-sm text-secondary">{covText}</p>
          </div>
          <p className="font-serif text-2xl num shrink-0">{quoteAtoms === null ? '—' : bpsToPercent(check.coverageBps)}</p>
        </div>
        <p className="text-sm text-secondary">Fixed 2x sale financing: you contribute P, the vault funds the full purchase first, and you pay your contribution after the BTC is acquired and pledged. Pressing the button accepts these terms.</p>
        {problems.length > 1 ? (
          <ul className="text-sm text-secondary list-disc pl-5 space-y-1">
            {problems.slice(1).map((p) => (
              <li key={p}>{PROBLEM_TEXT[p]}</li>
            ))}
          </ul>
        ) : null}
        <ActionButton
          label="Open position and accept terms"
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
        <Disclosure summary="Limits and references">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
            <Stat label="Account cap / headroom" value={`${usdc(cap)} / ${usdc(accountHeadroom)}`} />
            <Stat label="Vault can finance" value={`${usdc(toBig(vault.financingHeadroom))} USDC`} />
            <Stat label="Reference floor" value={`${btc(check.referenceFloor)} BTC`} hint={`${btc(check.referenceAtoms)} BTC at reference less 3.00% friction`} />
          </dl>
          <p className="font-mono text-xs break-all">
            Accepted terms hash {TERMS_HASH}. Engine {shortAddr(CONTRACTS.engine)}.
          </p>
        </Disclosure>
      </div>
    </Panel>
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
  const staleNote = oracle.fresh ? null : 'Needs a fresh reference price.'
  const dl = () => now() + 600n
  return (
    <article className="bg-panel border border-rule rounded p-5 sm:p-6 space-y-5">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-lg">Position {p.id}</h3>
        <span className="text-sm text-secondary text-right">{p.matured ? 'matured' : `matures ${formatTime(BigInt(p.maturesAt))}`}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
        <Stat size="lg" label="Total debt" value={usdc(debt)} />
        <Stat size="lg" label="Coverage" value={bpsToPercent(BigInt(p.coverageBps))} hint="Reference value over debt; rebalance at 160%, restores 190%" />
      </dl>
      <Rows>
        <Row label="Remaining principal" value={usdc(BigInt(p.principal))} />
        <Row label="Remaining markup" value={usdc(BigInt(p.markup))} />
        <Row label="Pledged BTC" value={`${btc(BigInt(p.collateral))}`} />
        <Row label="Price freshness" value={p.priceFresh ? 'fresh' : 'stale'} />
      </Rows>
      <ActionButton label={`Repay ${usdc(debt)} and release`} action={full} disabled={debt > w.spendable} reason={debt > w.spendable ? 'Not enough USDC after keeping the 0.10 USDC gas reserve.' : null} onClick={() => void full.start({ label: 'repayAndRelease', approvals: [{ token: CONTRACTS.usdc, spender: CONTRACTS.engine, amount: debt }], call: { address: CONTRACTS.engine, abi: tradeEngineAbi, functionName: 'repayAndRelease', args: [BigInt(p.id), debt] } })} />
      <div className="flex items-end gap-3">
        <div className="flex-1 min-w-0 sm:max-w-[12rem]">
          <Field id={`pay${p.id}`} label="Partial repayment" value={pay} onChange={setPay} suffix="USDC" />
        </div>
        <ActionButton variant="plain" label="Repay" action={part} disabled={!payAmt || payAmt > debt || payAmt > w.spendable} reason={payAmt && payAmt > debt ? 'More than the debt.' : payAmt && payAmt > w.spendable ? 'Not enough USDC after keeping the 0.10 USDC gas reserve.' : null} onClick={() => payAmt && void part.start({ label: 'repay', approvals: [{ token: CONTRACTS.usdc, spender: CONTRACTS.engine, amount: payAmt }], call: { address: CONTRACTS.engine, abi: tradeEngineAbi, functionName: 'repay', args: [BigInt(p.id), payAmt] } })} />
      </div>
      <p className="text-xs text-secondary">Repayment applies to principal first, then markup. Repay and release never need a fresh price.</p>
      <div className="border-t border-rule pt-5 space-y-3">
        <ActionButton variant="plain" label="Sell collateral and close (owner)" action={close} disabled={!oracle.fresh || floor === 0n} reason={staleNote} onClick={() => void close.start({ label: 'close', approvals: [], call: { address: CONTRACTS.engine, abi: tradeEngineAbi, functionName: 'ownerClose', args: [BigInt(p.id), floor, dl()] } })} />
        <p className="text-xs text-secondary">Coverage rebalances and maturity settlement are permissionless; they are listed in the Keeper panel below for anyone to trigger.</p>
      </div>
    </article>
  )
}

function KeeperPanel({ oracle }: { oracle: OracleInfo }) {
  const w = useWallet()
  const all = useApi<PositionsResponse>(['positions', 'all'], '/api/positions')
  return (
    <Panel title="Keeper actions (anyone)" variant="plain" aside={<span>manual fallback</span>}>
      <p className="text-sm text-secondary max-w-prose mb-4">Coverage rebalances and matured settlements are permissionless. A keeper may do them automatically, but nothing here depends on one. The engine, not the caller, chooses the quantity sold.</p>
      {all.isLoading ? <Notice>Loading live positions…</Notice> : all.error || !all.data ? <Notice tone="error">Live positions are unavailable right now. Retrying automatically.</Notice> : <KeeperList rows={all.data.positions} oracle={oracle} connected={w.isConnected} />}
    </Panel>
  )
}

function KeeperRow({ p, oracle, connected }: { p: PositionRow; oracle: OracleInfo; connected: boolean }) {
  const act = useAction(`keeper-${p.id}`)
  const price = BigInt(oracle.priceMicroUsdcPerBtc)
  const dl = now() + 600n
  const matured = p.matured
  const reason = !connected ? 'Connect a wallet.' : !oracle.fresh ? 'Needs a fresh reference price.' : null
  const call = matured
    ? { address: CONTRACTS.engine, abi: tradeEngineAbi, functionName: 'settleMatured', args: [BigInt(p.id), saleFloor(BigInt(p.collateral), price), dl] as const }
    : { address: CONTRACTS.engine, abi: tradeEngineAbi, functionName: 'rebalance', args: [BigInt(p.id), BigInt(p.rebalance.minUsdc), dl] as const }
  return (
    <li className="py-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
      <p className="text-base">
        Position {p.id} · owner <span className="font-mono text-sm">{shortAddr(p.trader)}</span> · coverage {bpsToPercent(BigInt(p.coverageBps))}
      </p>
      <p className="text-sm text-secondary">{matured ? 'Matured: anyone may settle it.' : `Coverage is at or below 160%: the engine will sell ${btc(BigInt(p.rebalance.sellAtoms))} BTC to restore 190%.`}</p>
      </div>
      <ActionButton variant="plain" label={matured ? 'Settle matured position' : 'Rebalance coverage'} action={act} disabled={!!reason} reason={reason} onClick={() => void act.start({ label: 'permissionless', approvals: [], call })} />
    </li>
  )
}

function KeeperList({ rows, oracle, connected }: { rows: PositionRow[]; oracle: OracleInfo; connected: boolean }) {
  const eligible = rows.filter((p) => p.matured || p.rebalance.eligible)
  if (eligible.length === 0) return <Notice>{rows.length} live position(s) checked: none is eligible for a permissionless rebalance or maturity settlement right now.</Notice>
  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {eligible.map((p) => (
        <KeeperRow key={p.id} p={p} oracle={oracle} connected={connected} />
      ))}
    </ul>
  )
}

export function TradeTab() {
  const w = useWallet()
  const vault = useApi<VaultResponse>(['vault', w.address ?? ''], `/api/vault${w.address ? `?owner=${w.address}` : ''}`)
  const pos = useApi<PositionsResponse>(['positions', w.address ?? ''], w.address ? `/api/positions?owner=${w.address}` : null)
  if (vault.isLoading) return <Notice>Loading market state from the chain…</Notice>
  if (vault.error || !vault.data) return <Notice tone="error">{vault.error instanceof Error ? vault.error.message : 'Market state is unavailable.'} Retrying automatically.</Notice>
  const oracle = vault.data.oracle
  return (
    <div className="space-y-8">
      <OracleBox o={oracle} />
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-7">
          <OpenForm vault={vault.data} positions={pos.data?.positions ?? []} positionsState={!w.isConnected || pos.isSuccess ? 'ready' : pos.isError ? 'error' : 'loading'} oracle={oracle} />
        </div>
        <div className="lg:col-span-5 space-y-5">
          <h2 className="text-xl sm:text-2xl">Your positions</h2>
          {!w.isConnected ? <Notice>Connect a wallet to see your positions.</Notice> : pos.isLoading ? <Notice>Loading your positions…</Notice> : pos.error ? <Notice tone="error">Positions are unavailable right now. Retrying automatically.</Notice> : pos.data && pos.data.positions.length === 0 ? <Notice>You have no open positions. Closed positions appear in Activity.</Notice> : pos.data?.positions.map((p) => <PositionCard key={p.id} p={p} oracle={pos.data.oracle} />)}
          <p className="text-sm text-secondary">
            Contracts: engine <a className="font-mono" href={explorerAddr(CONTRACTS.engine)} target="_blank" rel="noopener noreferrer">{shortAddr(CONTRACTS.engine)}</a>, vault <a className="font-mono" href={explorerAddr(CONTRACTS.vault)} target="_blank" rel="noopener noreferrer">{shortAddr(CONTRACTS.vault)}</a>.
          </p>
        </div>
      </div>
      <div className="border-t border-rule pt-8">
        <KeeperPanel oracle={oracle} />
      </div>
    </div>
  )
}
