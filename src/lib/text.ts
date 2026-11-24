import { btc, formatTime, usdc } from './format'
import type { ActivityRow } from './api'

export const BLOCKER_TEXT: Record<string, string> = {
  funding_paused: 'New deposits and purchases are paused. Repayments and claims work as normal.',
  withdrawal_queue: 'New deposits and purchases resume once pending withdrawals have been paid.',
  pending_open: 'A purchase is settling. Deposits resume in a moment.',
  stale_price: 'New deposits and purchases are paused until the reference price is refreshed. Repayments and claims work as normal.',
  unsettled_impairment: 'A position is being settled. New deposits and purchases resume once it closes.',
  reserves_below_target: 'New purchases are paused while the protection reserves are topped up.',
}

const u = (s?: string) => usdc(BigInt(s ?? '0'))
const b = (s?: string) => btc(BigInt(s ?? '0'))

/** Human line for a decoded event. Falls back to the raw event name and arguments. */
export function describeEvent(e: ActivityRow): { title: string; detail: string } {
  const a = e.args
  const pos = `Position #${a.id}`
  switch (e.event) {
    case 'AssetAcquired':
      return { title: `${pos} · BTC purchased`, detail: `${b(a.atoms)} cirBTC for ${u(a.cost)} USDC` }
    case 'DisclosedSaleAgreed':
      return { title: `${pos} · Terms agreed`, detail: `Contribution ${u(a.equity)}, financing ${u(a.principal)}, markup ${u(a.markup)} USDC` }
    case 'Pledged':
      return { title: `${pos} · BTC pledged`, detail: `${b(a.atoms)} cirBTC held as security` }
    case 'Opened':
      return { title: `${pos} · Opened`, detail: `Due ${formatTime(BigInt(a.maturesAt ?? '0'))}` }
    case 'Repaid':
      return { title: `${pos} · Repayment`, detail: `${u(a.principalPaid)} financing and ${u(a.markupPaid)} markup, in USDC` }
    case 'Released':
      return { title: `${pos} · BTC released`, detail: `${b(a.atomsReturned)} cirBTC returned to the owner` }
    case 'Rebalanced':
      return { title: `${pos} · Coverage restored`, detail: `Sold ${b(a.atomsSold)} cirBTC for ${u(a.proceeds)} USDC` }
    case 'Closed':
      return { title: `${pos} · Closed`, detail: `Sold ${b(a.atomsSold)} cirBTC for ${u(a.proceeds)} USDC; ${u(a.surplusToTrader)} USDC paid to the owner` }
    case 'Deposited':
      return { title: 'Deposit', detail: `${u(a.amount)} USDC for ${u(a.shares)} shares` }
    case 'WithdrawalRequested':
      return { title: 'Withdrawal requested', detail: `${u(a.shares)} shares` }
    case 'WithdrawalFilled':
      return { title: 'Withdrawal ready', detail: `${u(a.payout)} USDC set aside for ${u(a.sharesBurned)} shares` }
    case 'WithdrawalDustWrittenOff':
      return { title: 'Withdrawal remainder cleared', detail: `${u(a.sharesBurned)} shares of negligible value` }
    case 'Claimed':
      return { title: 'Withdrawal claimed', detail: `${u(a.amount)} USDC` }
    case 'MarkupCollected':
      return { title: `${pos} · Markup collected`, detail: `${u(a.lpIncrement)} USDC to depositors, ${u(String(BigInt(a.toPrimary ?? '0') + BigInt(a.toTail ?? '0')))} to reserves, ${u(a.toManagerCash)} to the manager` }
    case 'FinalLossSettled':
      return { title: `${pos} · Loss settled`, detail: `${u(a.grossLoss)} USDC: reserves covered ${u(String(BigInt(a.fromPrimary ?? '0') + BigInt(a.fromTail ?? '0') + BigInt(a.fromBackstop ?? '0')))}, depositors ${u(a.uncoveredLpLoss)}` }
    case 'ProtectionSeeded':
      return { title: 'Protection reserve funded', detail: `${u(a.amount)} USDC added` }
    case 'PrincipalRepaid':
      return { title: `${pos} · Financing returned to the vault`, detail: `${u(a.amount)} USDC, ${u(a.remaining)} outstanding` }
    case 'OpenReserved':
      return { title: `${pos} · Financing reserved`, detail: `${u(a.principal)} USDC` }
    case 'OpenConfirmed':
      return { title: `${pos} · Contribution received`, detail: 'Purchase complete' }
    case 'PositionFinalized':
      return { title: `${pos} · Settled`, detail: 'Nothing further is owed' }
    default:
      return { title: e.event.replace(/([a-z])([A-Z])/g, '$1 $2'), detail: Object.entries(a).map(([k, v]) => `${k} ${v}`).join(' · ') }
  }
}
