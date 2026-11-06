import { useState } from 'react'

import { ActionButton, Field, Notice, Panel, Stat } from './ui'
import { useAction } from '@/hooks/useAction'
import { useWallet } from '@/hooks/useWallet'
import { useApi, type VaultResponse } from '@/lib/api'
import { CONTRACTS } from '@/lib/contracts'
import { formatUnits, parseDecimal, toBig, usdc } from '@/lib/format'
import { queuePlace, sharesForDeposit, usdcForShares } from '@/lib/policy'
import { BLOCKER_TEXT } from '@/lib/text'
import { marginVaultAbi } from '@/contracts/abis'

const shares = (n: bigint) => formatUnits(n, 6)

export function EarnTab() {
  const w = useWallet()
  const { data, error, isLoading } = useApi<VaultResponse>(['vault', w.address ?? ''], `/api/vault${w.address ? `?owner=${w.address}` : ''}`)
  const [amount, setAmount] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [wd, setWd] = useState('')
  const dep = useAction('deposit')
  const req = useAction('request')
  const proc = useAction('process')
  const claim = useAction('claim')

  if (isLoading) return <Notice>Loading vault state from the chain…</Notice>
  if (error || !data) return <Notice tone="error">{error instanceof Error ? error.message : 'Vault state is unavailable.'} Retrying automatically.</Notice>

  const v = data.vault
  const S = toBig(v.totalShares)
  const NAV = toBig(v.nav)
  const mine = data.account
  const myShares = toBig(mine?.shares)
  const myLocked = toBig(mine?.lockedShares)
  const myClaim = toBig(mine?.claimable)
  const head = toBig(v.queueHead)
  const queuedTotal = data.queue.reduce((a, r) => a + toBig(r.shares), 0n)
  const myQueue = data.queue.filter((r) => mine && r.owner.toLowerCase() === mine.owner.toLowerCase())

  const amt = parseDecimal(amount, 6)
  const quote = amt ? sharesForDeposit(amt, S, NAV) : 0n
  const minShares = S === 0n ? quote : (quote * 995n) / 1000n
  const depBlock = !w.isConnected ? 'Connect a wallet.' : !amt ? 'Enter an amount.' : amt > w.spendable ? 'Not enough USDC after the 0.10 USDC gas reserve.' : data.blockers.deposit[0] ? (BLOCKER_TEXT[data.blockers.deposit[0]] ?? 'Deposits are closed.') : quote === 0n ? 'That amount would mint zero shares.' : !accepted ? 'Accept the mandate terms.' : null

  const procBlock = data.blockers.deposit.includes('stale_price') ? BLOCKER_TEXT.stale_price : data.blockers.deposit.includes('unsettled_impairment') ? BLOCKER_TEXT.unsettled_impairment : null
  const wsh = parseDecimal(wd, 6)
  const avail = myShares - myLocked
  const wdBlock = !w.isConnected ? 'Connect a wallet.' : !wsh ? 'Enter shares to redeem.' : wsh > avail ? 'More than your unlocked shares.' : toBig(v.activeRequests) >= 64n ? 'The queue is full (64 active requests).' : null

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Panel title="Vault" aside={<span className="text-xs text-muted num">block {data.observedBlock}</span>}>
          <dl className="grid grid-cols-2 gap-3">
            <Stat label="Your USDC" value={w.isConnected ? usdc(w.usdcAtoms) : '—'} hint="ERC-20 view; gas draws from the same balance" />
            <Stat label="Your shares" value={w.isConnected ? shares(myShares) : '—'} hint={myLocked > 0n ? `${shares(myLocked)} queued` : undefined} />
            <Stat label="Value of your shares" value={w.isConnected ? `${usdc(usdcForShares(myShares, S, NAV))} USDC` : '—'} hint="At current NAV" />
            <Stat label="Vault NAV" value={`${usdc(NAV)} USDC`} hint={`${shares(S)} shares`} />
            <Stat label="Available liquidity" value={`${usdc(toBig(v.depositorIdleCash))} USDC`} hint="Idle depositor cash" />
            <Stat label="Financed to traders" value={`${usdc(toBig(v.outstandingPrincipal))} USDC`} />
            <Stat label="Primary reserve" value={`${usdc(toBig(v.primaryReserve))} / ${usdc(toBig(v.primaryTarget))}`} />
            <Stat label="Tail reserve" value={`${usdc(toBig(v.tailReserve))} / ${usdc(toBig(v.tailTarget))}`} />
            <Stat label="Queued shares" value={shares(queuedTotal)} hint={`${v.activeRequests} request(s)`} />
            <Stat label="Reserved claim cash" value={`${usdc(toBig(v.claimableWithdrawals))} USDC`} hint={w.isConnected ? `yours: ${usdc(myClaim)}` : undefined} />
          </dl>
          {data.blockers.deposit.length > 0 ? (
            <div className="mt-3 space-y-2">
              {data.blockers.deposit.map((c) => (
                <Notice key={c} tone="warn">
                  {BLOCKER_TEXT[c] ?? c}
                </Notice>
              ))}
            </div>
          ) : null}
        </Panel>
        <Panel title="How Earn works">
          <ul className="list-disc pl-5 text-sm text-secondary space-y-1">
            <li>Deposits enter at the current NAV. Current holders share markup collected from traders in the future.</li>
            <li>The fixed markup is a price paid by traders. It is not a promised or projected APY.</li>
            <li>Redeemed shares give up later collections. Queued shares stay exposed to losses until the request is filled.</li>
            <li>Deposits and new financing wait while any withdrawal request is unfilled, while funding is paused, while the reference price is stale, while a position is impaired and unsettled, or when caps are reached.</li>
            <li>Withdrawals are first in, first out. A filled request becomes reserved claim cash that you pull with Claim.</li>
          </ul>
        </Panel>
      </div>
      <div className="space-y-4">
        <Panel title="Deposit USDC">
          <div className="space-y-3">
            <Field id="dep" label="Amount" value={amount} onChange={setAmount} suffix="USDC" hint={w.isConnected ? `Spendable: ${usdc(w.spendable)} USDC (0.10 kept for gas)` : undefined} />
            <p className="text-sm text-secondary num">
              Estimated shares: {shares(quote)} · Minimum accepted: {shares(minShares)}
            </p>
            <label className="flex gap-2 text-sm text-secondary">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-1" />
              <span>
                I accept the fixed mandate: collected markup splits 77% to depositors and 23% to protection reserves and the manager. No late growth, no trader-profit share. Mandate hash <span className="num break-all">{data.mandateHash}</span>.
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
        </Panel>
        <Panel title="Withdraw">
          <div className="space-y-3">
            <Field id="wd" label="Shares to redeem" value={wd} onChange={setWd} suffix="shares" hint={w.isConnected ? `Unlocked: ${shares(avail)}` : undefined} />
            <p className="text-sm text-secondary num">
              Estimated payout at current NAV: {usdc(wsh ? usdcForShares(wsh, S, NAV) : 0n)} USDC · Your place in line: {String(queuePlace(toBig(v.queueTail), head))} of {String(toBig(v.queueTail) - head + 1n)}
            </p>
            <ActionButton label="Request withdrawal" action={req} disabled={!!wdBlock} reason={wdBlock} onClick={() => wsh && void req.start({ label: 'request', approvals: [], call: { address: CONTRACTS.vault, abi: marginVaultAbi, functionName: 'requestWithdraw', args: [wsh] } })} />
            {myQueue.length > 0 ? (
              <ul className="text-sm text-secondary num border-t border-hairline pt-2">
                {myQueue.map((r) => (
                  <li key={r.id}>
                    Request {r.id}: place {String(queuePlace(BigInt(r.id), head))}, remaining {shares(BigInt(r.shares))} shares
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-4 border-t border-hairline pt-3">
              <ActionButton variant="plain" label="Process queue (up to 16)" action={proc} disabled={!w.isConnected || data.queue.length === 0 || procBlock !== null} reason={data.queue.length === 0 ? 'The queue is empty.' : !w.isConnected ? 'Connect a wallet.' : procBlock} onClick={() => void proc.start({ label: 'process', approvals: [], call: { address: CONTRACTS.vault, abi: marginVaultAbi, functionName: 'processWithdrawals', args: [16n] } })} />
              <ActionButton variant="plain" label={`Claim ${usdc(myClaim)} USDC`} action={claim} disabled={!w.isConnected || myClaim === 0n} reason={myClaim === 0n ? 'Nothing reserved for you yet.' : null} onClick={() => void claim.start({ label: 'claim', approvals: [], call: { address: CONTRACTS.vault, abi: marginVaultAbi, functionName: 'claim', args: [] } })} />
            </div>
            <p className="text-xs text-muted">Anyone can process the queue. Filling a request reserves cash, so while positions are live it first requires a fresh reference price and no unsettled impairment (with no live positions it needs no price). Claiming cash that is already reserved needs no price and is never blocked by a pause.</p>
          </div>
        </Panel>
      </div>
    </div>
  )
}
