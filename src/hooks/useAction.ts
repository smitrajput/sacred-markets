import { useCallback, useMemo, useRef, useState } from 'react'
import type { Address } from 'viem'
import { arcTestnet } from 'viem/chains'
import { useAccount, useConfig } from 'wagmi'
import { getAccount } from 'wagmi/actions'

import { useRefreshAfter } from '@/lib/api'
import { createIntentStore, type KV } from '@/lib/intent'
import { idle, recover, retryRefresh, runAction, stateFromIntent, type ActionPlan, type ActionState, type RunnerDeps } from '@/lib/txRunner'
import { makeRunnerDeps } from '@/lib/wallet'

export interface ActionHandle {
  state: ActionState
  start: (plan: ActionPlan) => Promise<void>
  reset: () => void
  recover: () => Promise<void>
  refresh: () => Promise<void>
}

function sessionKv(): KV | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}
// One store for the page; it never throws and falls back to memory (reload-limited) if sessionStorage is unavailable.
let intentStore: ReturnType<typeof createIntentStore> | undefined
const store = () => (intentStore ??= createIntentStore(sessionKv()))

/**
 * Each caller gets its own state machine (`id` names the button). The running guard is taken BEFORE anything is awaited, so a
 * second click cannot start a parallel preparation or signing. The signing client is resolved from the live connection at action
 * time (see lib/wallet.ts); recovery and refresh never need one.
 */
export function useAction(id: string): ActionHandle {
  const config = useConfig()
  const { address } = useAccount()
  const refreshAfter = useRefreshAfter()
  const [state, setState] = useState<ActionState>(idle)
  const running = useRef(false)

  // After a remount the unresolved record is re-read during render (no effect, no silent loss).
  const stored = address ? store().read(arcTestnet.id, address) : null
  const storedId = stored?.id
  const storedKind = stored?.kind
  const storedHash = stored?.hash
  const storedBlock = stored?.block
  const view = useMemo<ActionState>(
    () => (state.phase === 'idle' && storedHash && storedKind && storedId === id ? stateFromIntent({ id: storedId, kind: storedKind, hash: storedHash, block: storedBlock }, id) : state),
    [state, storedId, storedKind, storedHash, storedBlock, id],
  )

  const guarded = useCallback(
    async (needsAccount: boolean, fn: (deps: RunnerDeps, account: Address) => Promise<unknown>) => {
      if (running.current) return // taken synchronously: duplicate clicks cannot prepare or sign in parallel
      running.current = true
      try {
        const a = getAccount(config) // the freshest connection state, not a possibly stale render value
        const account = a.address
        if (!account || (a.status !== 'connected' && a.status !== 'connecting' && a.status !== 'reconnecting')) {
          setState({ phase: 'error', errorKind: 'wallet', message: needsAccount ? 'Your wallet is not connected. Press Connect wallet, then try again.' : 'Connect the wallet that sent the transaction to check on it.' })
          return
        }
        const deps = makeRunnerDeps(config, account, {
          refresh: refreshAfter,
          persist: (i) => {
            if (i) store().write(arcTestnet.id, account, { id, kind: i.kind, hash: i.hash, label: id, at: Date.now(), block: i.block?.toString() })
            else store().clear(arcTestnet.id, account)
          },
        })
        await fn(deps, account)
      } finally {
        running.current = false
      }
    },
    [config, refreshAfter, id],
  )

  const start = useCallback(
    (plan: ActionPlan) =>
      guarded(true, async (deps, account) => {
        const pending = store().read(arcTestnet.id, account)
        if (pending) {
          // an earlier transaction of this wallet is unresolved (outcome unknown, or confirmed but data not refreshed)
          setState(stateFromIntent(pending, id))
          return
        }
        await runAction(deps, plan, setState)
      }),
    [guarded, id],
  )
  const recoverFn = useCallback(() => guarded(false, (deps) => recover(deps, view, setState)), [guarded, view])
  const refresh = useCallback(() => guarded(false, (deps) => retryRefresh(deps, view, setState)), [guarded, view])
  const reset = useCallback(() => {
    setState((s) => (s.phase === 'unconfirmed' || s.phase === 'refresh-failed' ? s : idle))
  }, [])
  return { state: view, start, reset, recover: recoverFn, refresh }
}
