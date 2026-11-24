import { useState } from 'react'

import { ActionButton, Amount, Card, Disclosure, Empty, Field, Notice, PageHead, PageSkeleton, Row, Rows, Segmented, Stat, StatStrip } from './ui'
import { useAction } from '@/hooks/useAction'
import { useWallet } from '@/hooks/useWallet'
import { useApi, type VaultResponse } from '@/lib/api'
import { CONTRACTS } from '@/lib/contracts'
import { bpsToPercent, formatUnits, parseDecimal, shortHash, toBig, usdc } from '@/lib/format'
import { queuePlace, sharesForDeposit, usdcForShares } from '@/lib/policy'
import { BLOCKER_TEXT } from '@/lib/text'
import { marginVaultAbi } from '@/contracts/abis'

const shares = (n: bigint) => formatUnits(n, 6)
const MODES = [
  { id: 'deposit', label: 'Deposit' },
  { id: 'withdraw', label: 'Withdraw' },
] as const

export function EarnTab() {
  const w = useWallet()
  const { data, error, isLoading } = useApi<VaultResponse>(['vault', w.address ?? ''], `/api/vault${w.address ? `?owner=${w.address}` : ''}`)
  const [mode, setMode] = useState<(typeof MODES)[number]['id']>('deposit')
  const [amount, setAmount] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [wd, setWd] = useState('')
  const dep = useAction('deposit')
  const req = useAction('request')
  const proc = useAction('process')
  const claim = useAction('claim')

  if (isLoading) return <PageSkeleton />
  if (error || !data)
    return (
      <Notice tone="error" title="The vault could not be loaded">
        {error instanceof Error ? error.message : 'Please try again.'} Retrying automatically.
      </Notice>
    )

  const v = data.vault
  const S = toBig(v.totalShares)
  const NAV = toBig(v.nav)
  const financed = toBig(v.outstandingPrincipal)
  const mine = data.account
  const myShares = toBig(mine?.shares)
  const myLocked = toBig(mine?.lockedShares)
  const myClaim = toBig(mine?.claimable)
  const head = toBig(v.queueHead)
  const myQueue = data.queue.filter((r) => mine && r.owner.toLowerCase() === mine.owner.toLowerCase())
  const utilisation = NAV > 0n ? (financed * 10_000n) / NAV : 0n

  const amt = parseDecimal(amount, 6)
  const quote = amt ? sharesForDeposit(amt, S, NAV) : 0n
  const minShares = S === 0n ? quote : (quote * 995n) / 1000n
  const depBlock = !w.isConnected ? 'Connect a wallet to deposit.' : data.blockers.deposit[0] ? 'Deposits are paused.' : !amt ? 'Enter an amount.' : amt > w.spendable ? 'Not enough USDC. 0.10 USDC is kept back for network fees.' : quote === 0n ? 'This amount is too small.' : !accepted ? 'Accept the vault terms to continue.' : null

  const procBlock = data.blockers.deposit.includes('stale_price') ? BLOCKER_TEXT.stale_price : data.blockers.deposit.includes('unsettled_impairment') ? BLOCKER_TEXT.unsettled_impairment : null
  const wsh = parseDecimal(wd, 6)
  const avail = myShares - myLocked
  const wdBlock = !w.isConnected ? 'Connect a wallet to withdraw.' : !wsh ? 'Enter the shares to redeem.' : wsh > avail ? 'More than your available shares.' : toBig(v.activeRequests) >= 64n ? 'The withdrawal queue is full. Try again shortly.' : null

  return (
    <>
      <PageHead eyebrow="Earn" title="USDC Vault">
        Your USDC finances BTC purchases at a fixed markup. Depositors receive 77% of every markup collected. Returns vary with demand and are not guaranteed.
      </PageHead>

      <StatStrip>
        <Stat label="Total deposits" value={<Amount value={usdc(NAV)} unit="USDC" />} />
        <Stat label="Available to withdraw" value={<Amount value={usdc(toBig(v.depositorIdleCash))} unit="USDC" />} />
        <Stat label="Financing purchases" value={<Amount value={usdc(financed)} unit="USDC" />} hint={`${bpsToPercent(utilisation)} of deposits in use`} />
        <Stat label="Share price" value={<Amount value={formatUnits(toBig(data.navPerShareE6), 6, 4)} unit="USDC" />} />
      </StatStrip>

      {data.blockers.deposit.length > 0 ? (
        <div className="mb-8 space-y-2">
          {data.blockers.deposit.map((c) => (
            <Notice key={c} tone="warn" title="Deposits are paused">
              {BLOCKER_TEXT[c] ?? 'Deposits are temporarily unavailable.'}
            </Notice>
          ))}
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-12 lg:gap-10 items-start">
        <div className="lg:col-span-7 space-y-8 order-2 lg:order-1">
          <Card title="Your position">
            {w.isConnected ? (
              <>
                <p className="label">Current value</p>
                <p className="font-serif text-3xl mt-1.5">
                  <Amount value={usdc(usdcForShares(myShares, S, NAV))} unit="USDC" />
                </p>
                <div className="mt-5">
                  <Rows>
                    <Row label="Shares" value={shares(myShares)} hint={myLocked > 0n ? `${shares(myLocked)} waiting to be withdrawn` : undefined} />
                    <Row label="Ready to claim" value={`${usdc(myClaim)} USDC`} />
                    <Row label="Wallet balance" value={`${usdc(w.usdcAtoms)} USDC`} />
                  </Rows>
                </div>
                {myClaim > 0n ? (
                  <div className="mt-5">
                    <ActionButton label={`Claim ${usdc(myClaim)} USDC`} action={claim} onClick={() => void claim.start({ label: 'claim', approvals: [], call: { address: CONTRACTS.vault, abi: marginVaultAbi, functionName: 'claim', args: [] } })} />
                  </div>
                ) : null}
                {myQueue.length > 0 ? (
                  <div className="mt-6">
                    <p className="label mb-1">Pending withdrawals</p>
                    <Rows>
                      {myQueue.map((r) => (
                        <Row key={r.id} label={`${shares(BigInt(r.shares))} shares`} value={`No. ${String(queuePlace(BigInt(r.id), head))} in line`} />
                      ))}
                    </Rows>
                  </div>
                ) : null}
              </>
            ) : (
              <Empty title="No wallet connected">Connect a wallet to see your deposits and withdrawals.</Empty>
            )}
          </Card>

          <Card title="Vault">
            <Rows>
              <Row label="Total deposits" value={`${usdc(NAV)} USDC`} hint={`${shares(S)} shares outstanding`} />
              <Row label="Idle cash" value={`${usdc(toBig(v.depositorIdleCash))} USDC`} />
              <Row label="Financing purchases" value={`${usdc(financed)} USDC`} />
              <Row label="Protection reserves" value={`${usdc(toBig(v.primaryReserve) + toBig(v.tailReserve))} USDC`} hint={`Target ${usdc(toBig(v.primaryTarget) + toBig(v.tailTarget))} USDC. Reserves absorb losses before depositors.`} />
              <Row label="Withdrawals in line" value={v.activeRequests} hint={data.queue.length > 0 ? 'Paid in order as cash frees up' : undefined} />
              <Row label="Set aside for claims" value={`${usdc(toBig(v.claimableWithdrawals))} USDC`} />
            </Rows>
            {data.queue.length > 0 ? (
              <div className="mt-4 pt-4 border-t border-rule flex flex-wrap items-start justify-between gap-4">
                <p className="text-sm text-ink-2 max-w-[38ch]">Withdrawals are normally paid automatically. Anyone can also pay the next requests in line.</p>
                <ActionButton block={false} variant="secondary" label="Pay withdrawals" action={proc} disabled={!w.isConnected || procBlock !== null} reason={!w.isConnected ? 'Connect a wallet.' : procBlock} onClick={() => void proc.start({ label: 'process', approvals: [], call: { address: CONTRACTS.vault, abi: marginVaultAbi, functionName: 'processWithdrawals', args: [16n] } })} />
              </div>
            ) : null}
          </Card>

          <section aria-label="How Earn works" className="grid gap-6 sm:grid-cols-3">
            {[
              ['Deposit', 'You receive vault shares at the current share price.'],
              ['Earn', 'Each markup collected from a buyer raises the share price.'],
              ['Withdraw', 'Request a withdrawal, then claim your USDC once it is paid.'],
            ].map(([t, d], i) => (
              <div key={t} className="border-t border-rule-strong pt-3">
                <p className="font-serif text-accent">{i + 1}</p>
                <p className="font-bold text-sm mt-1">{t}</p>
                <p className="text-sm text-ink-2 mt-1">{d}</p>
              </div>
            ))}
          </section>
        </div>

        <div className="lg:col-span-5 order-1 lg:order-2 lg:sticky lg:top-24">
          <Card>
            <Segmented label="Deposit or withdraw" value={mode} onChange={setMode} options={MODES} />
            {mode === 'deposit' ? (
              <div className="mt-5 space-y-5">
                <Field id="dep" label="Amount" value={amount} onChange={setAmount} suffix="USDC" hint={w.isConnected ? `Available ${usdc(w.spendable)}` : undefined} onMax={w.isConnected && w.spendable > 0n ? () => setAmount(formatUnits(w.spendable, 6, 0).replace(/,/g, '')) : undefined} />
                <Rows>
                  <Row label="You receive" value={`${shares(quote)} shares`} strong />
                  <Row label="Share price" value={`${formatUnits(toBig(data.navPerShareE6), 6, 4)} USDC`} />
                  <Row label="Minimum received" value={`${shares(minShares)} shares`} hint="0.5% tolerance" />
                </Rows>
                <label className="flex items-start gap-3 text-sm text-ink-2 cursor-pointer">
                  <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[#1b1915]" />
                  <span>
                    I accept the vault terms: 77% of collected markup goes to depositors and 23% to protection reserves and the manager.
                    <span className="block font-mono text-2xs text-ink-3 mt-1" title={data.mandateHash}>
                      Terms {shortHash(data.mandateHash)}
                    </span>
                  </span>
                </label>
                <ActionButton
                  label="Deposit"
                  action={dep}
                  disabled={!!depBlock}
                  reason={depBlock}
                  onClick={() => amt && void dep.start({ label: 'deposit', approvals: [{ token: CONTRACTS.usdc, spender: CONTRACTS.vault, amount: amt }], call: { address: CONTRACTS.vault, abi: marginVaultAbi, functionName: 'deposit', args: [amt, minShares, data.mandateHash] } })}
                />
              </div>
            ) : (
              <div className="mt-5 space-y-5">
                <Field id="wd" label="Shares" value={wd} onChange={setWd} suffix="shares" hint={w.isConnected ? `Available ${shares(avail)}` : undefined} onMax={w.isConnected && avail > 0n ? () => setWd(formatUnits(avail, 6, 0).replace(/,/g, '')) : undefined} />
                <Rows>
                  <Row label="You receive" value={`${usdc(wsh ? usdcForShares(wsh, S, NAV) : 0n)} USDC`} hint="Estimated at today's share price" strong />
                  <Row label="Withdrawals ahead of you" value={v.activeRequests} />
                </Rows>
                <ActionButton label="Request withdrawal" variant="dark" action={req} disabled={!!wdBlock} reason={wdBlock} onClick={() => wsh && void req.start({ label: 'request', approvals: [], call: { address: CONTRACTS.vault, abi: marginVaultAbi, functionName: 'requestWithdraw', args: [wsh] } })} />
                <div className="border-t border-rule pt-2">
                  <Disclosure summary="How withdrawals work">
                    <p>Requests are paid in order as cash returns to the vault, usually straight away when idle cash is available. Once paid, your USDC is set aside and you claim it from Your position. A request cannot be cancelled, and shares in line keep earning and stay exposed to losses until they are paid.</p>
                  </Disclosure>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
