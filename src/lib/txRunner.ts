import type { Abi, Address, Hex } from 'viem'

import type { Intent } from './intent'

export const ARC_CHAIN_ID = 5042002

export type Phase =
  | 'idle'
  | 'switching'
  | 'allowance'
  | 'approve-sign'
  | 'approve-pending'
  | 'simulating'
  | 'sign'
  | 'pending'
  | 'unconfirmed' // a transaction was sent and its outcome is unknown: never an "unsent" failure
  | 'refreshing' // confirmed on chain, waiting for the API to observe the receipt block
  | 'refresh-failed' // confirmed on chain, displayed data may be outdated
  | 'success'
  | 'error'
export type ErrorKind = 'rejected' | 'reverted' | 'replaced' | 'cancelled' | 'simulation' | 'chain' | 'wallet'

export interface ActionState {
  phase: Phase
  message?: string
  hash?: Hex
  approvalHash?: Hex
  errorKind?: ErrorKind
  receiptBlock?: bigint
  /** Which transaction is unresolved when phase is 'unconfirmed'. */
  unresolved?: 'approval' | 'action' | 'foreign'
}
export interface Approval {
  token: Address
  spender: Address
  amount: bigint
}
export interface Call {
  address: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
}
export interface ActionPlan {
  label: string
  approvals: Approval[]
  call: Call
}
export interface Replacement {
  kind: 'repriced' | 'replaced' | 'cancelled'
  hash: Hex
}
export interface WaitResult {
  status: 'success' | 'reverted'
  blockNumber: bigint
  replacement?: Replacement
}
export interface RunnerDeps {
  chainId(): Promise<number>
  switchChain(id: number): Promise<void>
  /** Optional: resolve and validate the signing client/account/chain before any allowance read or signature. */
  prepare?(): Promise<void>
  allowance(a: Approval): Promise<bigint>
  approve(a: Approval): Promise<Hex>
  simulate(call: Call): Promise<unknown>
  send(request: unknown): Promise<Hex>
  wait(hash: Hex): Promise<WaitResult>
  /** Looks an existing transaction up; undefined while it has no receipt. NEVER sends anything. */
  receipt(hash: Hex): Promise<WaitResult | undefined>
  /** Waits until the API has observed `block`, refreshes displayed data; false if it could not within its bounded wait. */
  refresh(block: bigint): Promise<boolean>
  /** Records / clears the one unresolved transaction for this chain and account. */
  persist(intent: { kind: 'approval' | 'action' | 'refresh'; hash: Hex; block?: bigint } | null): void
}

export const idle: ActionState = { phase: 'idle' }

export function classifyError(e: unknown): { kind: ErrorKind | 'timeout'; message: string } {
  const err = e as { code?: number; name?: string; shortMessage?: string; message?: string; cause?: { code?: number; data?: { errorName?: string } } }
  const text = `${err?.name ?? ''} ${err?.shortMessage ?? ''} ${err?.message ?? ''}`
  if (err?.code === 4001 || err?.cause?.code === 4001 || /user (rejected|denied)|rejected the request/i.test(text)) {
    return { kind: 'rejected', message: 'You rejected the request in your wallet. Nothing was sent.' }
  }
  if (/WaitForTransactionReceiptTimeout|timed out/i.test(text)) return { kind: 'timeout', message: 'Confirmation is taking longer than expected.' }
  const name = err?.cause?.data?.errorName
  if (name) return { kind: 'simulation', message: `The contract would reject this: ${name}.` }
  return { kind: 'wallet', message: (err?.shortMessage ?? err?.message ?? 'Unknown wallet error').split('\n')[0].slice(0, 200) }
}

const NOT_CONFIRMED = {
  replaced: 'Your transaction was replaced by a different transaction, so the operation you asked for was NOT confirmed. Chain data was refreshed; check the explorer before trying again.',
  cancelled: 'Your transaction was cancelled by a replacement, so the operation you asked for was NOT confirmed. Chain data was refreshed.',
} as const

type Persist = RunnerDeps['persist']
/** A persist that can never throw: losing the record must not lose the hash or turn a sent transaction into an "unsent" error. */
function safe(deps: RunnerDeps): { persist: Persist; failed: () => boolean } {
  let failed = false
  return {
    persist: (i) => {
      try {
        deps.persist(i)
      } catch {
        failed = true
      }
    },
    failed: () => failed,
  }
}
const NOTE = ' Your browser would not save the pending-transaction record, so duplicate-send protection lasts only until this page is reloaded.'

/**
 * Confirmed on chain: the intent stays recorded as 'refresh' (so a remount cannot submit again on stale data) while the UI
 * shows "refreshing"; it is cleared only when the authoritative refresh succeeds.
 */
async function finishConfirmed(deps: RunnerDeps, persist: Persist, set: (s: ActionState) => void, base: ActionState, block: bigint, success: ActionState = { phase: 'success', message: 'Confirmed.' }): Promise<ActionState> {
  persist({ kind: 'refresh', hash: base.hash as Hex, block })
  set({ ...base, phase: 'refreshing', message: 'Confirmed on chain. Updating the displayed data…', receiptBlock: block })
  const ok = await deps.refresh(block).catch(() => false)
  if (ok) persist(null)
  const done: ActionState = ok
    ? { ...base, ...success, receiptBlock: block }
    : { ...base, phase: 'refresh-failed', message: 'The transaction is confirmed, but the displayed data may be outdated because the data service did not catch up. Your funds are not at risk; refresh the data below before doing anything else.', receiptBlock: block }
  set(done)
  return done
}

/**
 * One wallet action: switch to Arc 5042002, read a FRESH allowance, approve the exact amount only if needed, simulate,
 * sign, then wait for a successful receipt and for the API to observe it. Once a hash exists, any problem while waiting is
 * "confirmation unknown" (recoverable by looking the hash up), never an unsent failure, and nothing is ever sent twice.
 */
export async function runAction(rawDeps: RunnerDeps, plan: ActionPlan, set: (s: ActionState) => void): Promise<ActionState> {
  const sp = safe(rawDeps)
  const deps: RunnerDeps = { ...rawDeps, persist: sp.persist }
  let approvalHash: Hex | undefined
  const fail = (kind: ErrorKind, message: string, extra: Partial<ActionState> = {}): ActionState => {
    const s: ActionState = { phase: 'error', errorKind: kind, message, approvalHash, ...extra }
    set(s)
    return s
  }
  const notConfirmed = async (kind: 'replaced' | 'cancelled', r: WaitResult, hash: Hex): Promise<ActionState> => {
    await deps.refresh(r.blockNumber).catch(() => false) // the chain changed: refresh what is displayed
    return fail(kind, NOT_CONFIRMED[kind], { hash: r.replacement?.hash ?? hash, receiptBlock: r.blockNumber })
  }
  try {
    if ((await deps.chainId()) !== ARC_CHAIN_ID) {
      set({ phase: 'switching', message: 'Switching your wallet to Arc Testnet (5042002)…' })
      try {
        await deps.switchChain(ARC_CHAIN_ID)
      } catch (e) {
        const c = classifyError(e)
        return fail(c.kind === 'rejected' ? 'rejected' : 'chain', c.kind === 'rejected' ? 'You declined the network switch. Writes only work on Arc Testnet.' : 'Could not switch to Arc Testnet. Add the network in your wallet and retry.')
      }
      if ((await deps.chainId()) !== ARC_CHAIN_ID) return fail('chain', 'Your wallet is still on another network. Switch to Arc Testnet and retry.')
    }
    if (deps.prepare) {
      set({ phase: 'allowance', message: 'Preparing your wallet…' })
      await deps.prepare()
    }
    for (const a of plan.approvals) {
      set({ phase: 'allowance', message: 'Checking your current allowance…' })
      if ((await deps.allowance(a)) >= a.amount) continue
      set({ phase: 'approve-sign', message: 'Approve the exact amount in your wallet.' })
      approvalHash = await deps.approve(a)
      deps.persist({ kind: 'approval', hash: approvalHash })
      set({ phase: 'approve-pending', message: 'Waiting for the approval to confirm…', approvalHash })
      let r: WaitResult
      try {
        r = await deps.wait(approvalHash)
      } catch {
        const s: ActionState = { phase: 'unconfirmed', unresolved: 'approval', approvalHash, message: 'The approval was sent but its confirmation is unknown. Check its status below; it will not be sent again.' + (sp.failed() ? NOTE : '') }
        set(s)
        return s
      }
      deps.persist(null)
      if (r.replacement && r.replacement.kind !== 'repriced') return notConfirmed(r.replacement.kind, r, approvalHash)
      if (r.status !== 'success') return fail('reverted', 'The approval transaction failed. Nothing else was sent.')
      if ((await deps.allowance(a)) < a.amount) return fail('wallet', 'The approval confirmed but the allowance is still too low. Retry.')
    }
    set({ phase: 'simulating', message: 'Simulating the transaction…', approvalHash })
    let request: unknown
    try {
      request = await deps.simulate(plan.call)
    } catch (e) {
      const c = classifyError(e)
      return fail('simulation', c.kind === 'simulation' || c.kind === 'wallet' ? c.message : 'The simulation failed. Nothing was signed.')
    }
    set({ phase: 'sign', message: 'Confirm in your wallet.', approvalHash })
    const hash = await deps.send(request)
    deps.persist({ kind: 'action', hash }) // recorded the moment a hash exists, before anything else can fail
    set({ phase: 'pending', message: 'Transaction submitted. Waiting for confirmation…', hash, approvalHash })
    let r: WaitResult
    try {
      r = await deps.wait(hash)
    } catch {
      const s: ActionState = { phase: 'unconfirmed', unresolved: 'action', hash, approvalHash, message: 'The transaction was sent but its confirmation is unknown. It may still confirm. Check its status below; it will not be sent again.' + (sp.failed() ? NOTE : '') }
      set(s)
      return s
    }
    if (r.replacement && r.replacement.kind !== 'repriced') {
      deps.persist(null) // a definitive "not confirmed" outcome
      return notConfirmed(r.replacement.kind, r, hash)
    }
    const finalHash = r.replacement?.hash ?? hash // a repriced (same-intent) replacement is the intended transaction
    if (r.status !== 'success') {
      deps.persist(null) // a definitive non-success receipt
      return fail('reverted', 'The transaction reverted on chain. Your funds did not move; check the explorer for the reason.', { hash: finalHash, receiptBlock: r.blockNumber })
    }
    return finishConfirmed(deps, sp.persist, set, { phase: 'success', hash: finalHash, approvalHash }, r.blockNumber)
  } catch (e) {
    const c = classifyError(e)
    return fail(c.kind === 'timeout' ? 'wallet' : c.kind, c.message)
  }
}

/** Recovery for 'unconfirmed': looks the existing transaction up (no resend, ever) and resolves it. */
export async function recover(rawDeps: RunnerDeps, st: ActionState, set: (s: ActionState) => void): Promise<ActionState> {
  const persist = safe(rawDeps).persist
  const deps: RunnerDeps = { ...rawDeps, persist }
  const hash = st.unresolved === 'approval' ? st.approvalHash : st.hash
  if (!hash) {
    const s: ActionState = { phase: 'idle' }
    set(s)
    return s
  }
  let r: WaitResult | undefined
  try {
    r = await deps.receipt(hash)
  } catch {
    r = undefined
  }
  if (!r) {
    const s: ActionState = { ...st, message: 'Still not confirmed. It may be pending: check again shortly or open it on the explorer. Nothing was sent again.' }
    set(s)
    return s
  }
  if (r.replacement && r.replacement.kind !== 'repriced') {
    persist(null)
    await deps.refresh(r.blockNumber).catch(() => false)
    const s: ActionState = { phase: 'error', errorKind: r.replacement.kind, message: NOT_CONFIRMED[r.replacement.kind], hash, approvalHash: st.approvalHash, receiptBlock: r.blockNumber }
    set(s)
    return s
  }
  if (r.status !== 'success') {
    persist(null)
    const s: ActionState = { phase: 'error', errorKind: 'reverted', message: 'That transaction reverted on chain. Funds did not move.', hash, approvalHash: st.approvalHash, receiptBlock: r.blockNumber }
    set(s)
    return s
  }
  if (st.unresolved === 'approval') {
    persist(null) // the allowance is re-read fresh on the next start, so nothing is approved twice
    const s: ActionState = { phase: 'idle', message: 'The approval confirmed. Press the action again to continue: the allowance is re-checked, so nothing is approved twice.' }
    set(s)
    return s
  }
  if (st.unresolved === 'foreign') {
    // another button's transaction: refresh the displayed state BEFORE new writes are enabled
    return finishConfirmed(deps, persist, set, { phase: 'success', hash, approvalHash: st.approvalHash }, r.blockNumber, { phase: 'idle', message: 'The earlier transaction is resolved and the data is refreshed. You can continue.', hash: undefined })
  }
  return finishConfirmed(deps, persist, set, { phase: 'success', hash, approvalHash: st.approvalHash }, r.blockNumber)
}

/** Refresh-only recovery after 'refresh-failed' (also after a remount): re-reads the data; never touches the transaction. */
export async function retryRefresh(rawDeps: RunnerDeps, st: ActionState, set: (s: ActionState) => void): Promise<ActionState> {
  const persist = safe(rawDeps).persist
  const deps: RunnerDeps = { ...rawDeps, persist }
  return finishConfirmed(deps, persist, set, { phase: 'success', hash: st.hash, approvalHash: st.approvalHash }, st.receiptBlock ?? 0n)
}

/** The state a component shows for a recorded intent (after a remount, or when another button's transaction is unresolved). */
export function stateFromIntent(i: Pick<Intent, 'id' | 'kind' | 'hash' | 'block'>, ownId: string): ActionState {
  if (i.kind === 'refresh') {
    return { phase: 'refresh-failed', hash: i.hash, receiptBlock: i.block ? BigInt(i.block) : undefined, message: 'A confirmed transaction is still waiting for the displayed data to catch up. Refresh before sending anything new; nothing will be resent.' }
  }
  const own = i.id === ownId
  return {
    phase: 'unconfirmed',
    unresolved: own ? i.kind : 'foreign',
    hash: i.kind === 'action' || !own ? i.hash : undefined,
    approvalHash: own && i.kind === 'approval' ? i.hash : undefined,
    message: own ? 'A transaction from before this page reloaded is not resolved yet. Check its status below; it will not be sent again.' : 'An earlier transaction from this wallet is still unresolved, so a new one cannot start. Check its status below.',
  }
}

/** Prevents duplicate submission: a second call while one is running is ignored. */
export function singleFlight<A extends unknown[]>(fn: (...a: A) => Promise<unknown>): (...a: A) => Promise<void> {
  let running = false
  return async (...a: A) => {
    if (running) return
    running = true
    try {
      await fn(...a)
    } finally {
      running = false
    }
  }
}
