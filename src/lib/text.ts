import { btc, formatTime, usdc } from './format'
import type { ActivityRow } from './api'

export const BLOCKER_TEXT: Record<string, string> = {
  funding_paused: 'New deposits and financing are paused by the guardian. Repayments, releases and claims still work.',
  withdrawal_queue: 'Deposits and new financing wait while withdrawal requests are unfilled (first in, first out).',
  pending_open: 'A financing open is in flight; deposits resume right after it settles.',
  stale_price: 'The reference price is stale. Opens, sales and deposits are held until the operator refreshes it. Repay and claim are unaffected.',
  unsettled_impairment: 'A live position is worth less than its remaining principal and has not been settled yet. Deposits and new financing wait.',
  reserves_below_target: 'Protection reserves are below target, so new financing is closed until the treasury restores them.',
}

const u = (s?: string) => usdc(BigInt(s ?? '0'))
const b = (s?: string) => btc(BigInt(s ?? '0'))

/** Human line for a decoded event. Falls back to the raw event name and arguments. */
export function describeEvent(e: ActivityRow): { title: string; detail: string } {
  const a = e.args
  switch (e.event) {
    case 'AssetAcquired':
      return { title: `Position ${a.id}: BTC acquired`, detail: `${b(a.atoms)} cirBTC bought for ${u(a.cost)} USDC (vault funded the full purchase first)` }
    case 'DisclosedSaleAgreed':
      return { title: `Position ${a.id}: disclosed sale agreed`, detail: `Contribution ${u(a.equity)}, principal ${u(a.principal)}, fixed markup ${u(a.markup)} USDC` }
    case 'Pledged':
      return { title: `Position ${a.id}: BTC pledged`, detail: `${b(a.atoms)} cirBTC held by the engine as collateral` }
    case 'Opened':
      return { title: `Position ${a.id}: opened`, detail: `Matures ${formatTime(BigInt(a.maturesAt ?? '0'))}` }
    case 'Repaid':
      return { title: `Position ${a.id}: repayment`, detail: `Principal ${u(a.principalPaid)} then markup ${u(a.markupPaid)} USDC` }
    case 'Released':
      return { title: `Position ${a.id}: collateral released`, detail: `${b(a.atomsReturned)} cirBTC returned to the trader` }
    case 'Rebalanced':
      return { title: `Position ${a.id}: coverage rebalance`, detail: `Sold ${b(a.atomsSold)} cirBTC for ${u(a.proceeds)} USDC; principal now ${u(a.principalAfter)}, collateral ${b(a.collateralAfter)}` }
    case 'Closed':
      return { title: `Position ${a.id}: closed`, detail: `Sold ${b(a.atomsSold)} cirBTC for ${u(a.proceeds)}; surplus ${u(a.surplusToTrader)}; principal loss ${u(a.grossPrincipalLoss)}` }
    case 'Deposited':
      return { title: 'LP deposit', detail: `${u(a.amount)} USDC for ${u(a.shares)} shares` }
    case 'WithdrawalRequested':
      return { title: `Withdrawal request ${a.requestId}`, detail: `${u(a.shares)} shares queued` }
    case 'WithdrawalFilled':
      return { title: `Queue fill ${a.requestId}`, detail: `${u(a.sharesBurned)} shares burned, ${u(a.payout)} USDC reserved for claim` }
    case 'WithdrawalDustWrittenOff':
      return { title: `Queue dust written off ${a.requestId}`, detail: `${u(a.sharesBurned)} shares of negligible value` }
    case 'Claimed':
      return { title: 'Claim paid', detail: `${u(a.amount)} USDC claimed` }
    case 'MarkupCollected':
      return { title: `Position ${a.id}: markup collected`, detail: `Payment ${u(a.payment)}: LPs ${u(a.lpIncrement)}, reserves ${u(String(BigInt(a.toPrimary ?? '0') + BigInt(a.toTail ?? '0')))}, manager cash ${u(a.toManagerCash)}` }
    case 'FinalLossSettled':
      return { title: `Position ${a.id}: loss settled`, detail: `Gross ${u(a.grossLoss)}; primary ${u(a.fromPrimary)}, tail ${u(a.fromTail)}, backstop ${u(a.fromBackstop)}; LP loss ${u(a.uncoveredLpLoss)}` }
    case 'ProtectionSeeded':
      return { title: 'Protection reserve seeded', detail: `${u(a.amount)} USDC added (bucket now ${u(a.bucketAfter)})` }
    case 'PrincipalRepaid':
      return { title: `Position ${a.id}: principal returned to vault`, detail: `${u(a.amount)} USDC, ${u(a.remaining)} remaining` }
    case 'OpenReserved':
      return { title: `Position ${a.id}: vault reserved gross`, detail: `Principal ${u(a.principal)} USDC` }
    case 'OpenConfirmed':
      return { title: `Position ${a.id}: vault confirmed open`, detail: 'Trader contribution received' }
    case 'PositionFinalized':
      return { title: `Position ${a.id}: finalized in vault`, detail: 'No further collections' }
    default:
      return { title: e.event, detail: Object.entries(a).map(([k, v]) => `${k}=${v}`).join(' ') }
  }
}
