import { useCallback, useMemo, useRef, useState } from 'react'
import { erc20Abi, type Hex } from 'viem'
import { arcTestnet } from 'viem/chains'
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi'

import { useRefreshAfter } from '@/lib/api'
import { createIntentStore, type KV } from '@/lib/intent'
import { idle, recover, retryRefresh, runAction, stateFromIntent, type ActionPlan, type ActionState, type RunnerDeps, type WaitResult } from '@/lib/txRunner'

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
 * Each caller gets its own state machine (`id` names the button). A second click while an action runs, while its receipt is
 * being refreshed, or while ANY earlier transaction of this wallet is unresolved (also after a tab remount) is ignored.
 */
export function useAction(id: string): ActionHandle {
  const { address } = useAccount()
  const publicClient = usePublicClient({ chainId: arcTestnet.id })
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
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

  const makeDeps = useCallback((): RunnerDeps | null => {
    if (!address || !publicClient || !walletClient) return null
    const pc = publicClient
    const wc = walletClient
    return {
      chainId: () => wc.getChainId(),
      switchChain: async (cid) => {
        await switchChainAsync({ chainId: cid })
      },
      allowance: (a) => pc.readContract({ address: a.token, abi: erc20Abi, functionName: 'allowance', args: [address, a.spender] }),
      approve: (a) => wc.writeContract({ address: a.token, abi: erc20Abi, functionName: 'approve', args: [a.spender, a.amount], account: address, chain: arcTestnet }),
      simulate: async (c) => (await pc.simulateContract({ account: address, address: c.address, abi: c.abi, functionName: c.functionName, args: c.args })).request,
      send: (request) => wc.writeContract(request as Parameters<typeof wc.writeContract>[0]),
      wait: async (hash: Hex): Promise<WaitResult> => {
        const rep: { kind?: 'repriced' | 'replaced' | 'cancelled'; hash?: Hex } = {}
        const r = await pc.waitForTransactionReceipt({
          hash,
          timeout: 120_000,
          onReplaced: (x) => {
            rep.kind = x.reason
            rep.hash = x.transaction.hash
          },
        })
        return { status: r.status, blockNumber: r.blockNumber, replacement: rep.kind && rep.hash ? { kind: rep.kind, hash: rep.hash } : undefined }
      },
      receipt: async (hash: Hex) => {
        try {
          const r = await pc.getTransactionReceipt({ hash })
          return { status: r.status, blockNumber: r.blockNumber }
        } catch {
          return undefined // not mined yet (or the node cannot say): never resend
        }
      },
      refresh: refreshAfter,
      persist: (i) => {
        if (i) store().write(arcTestnet.id, address, { id, kind: i.kind, hash: i.hash, label: id, at: Date.now(), block: i.block?.toString() })
        else store().clear(arcTestnet.id, address)
      },
    }
  }, [address, publicClient, walletClient, switchChainAsync, refreshAfter, id])

  const guarded = useCallback(async (fn: (deps: RunnerDeps) => Promise<unknown>) => {
    if (running.current) return // duplicate submission is ignored while one action runs or its receipt refreshes
    const deps = makeDeps()
    if (!deps) {
      setState({ phase: 'error', errorKind: 'wallet', message: 'Connect a wallet first.' })
      return
    }
    running.current = true
    try {
      await fn(deps)
    } finally {
      running.current = false
    }
  }, [makeDeps])

  const start = useCallback(
    (plan: ActionPlan) =>
      guarded(async (deps) => {
        const pending = address ? store().read(arcTestnet.id, address) : null
        if (pending) {
          // an earlier transaction of this wallet is unresolved (outcome unknown, or confirmed but data not refreshed)
          setState(stateFromIntent(pending, id))
          return
        }
        await runAction(deps, plan, setState)
      }),
    [guarded, address, id],
  )
  const recoverFn = useCallback(() => guarded((deps) => recover(deps, view, setState)), [guarded, view])
  const refresh = useCallback(() => guarded((deps) => retryRefresh(deps, view, setState)), [guarded, view])
  const reset = useCallback(() => {
    setState((s) => (s.phase === 'unconfirmed' || s.phase === 'refresh-failed' ? s : idle))
  }, [])
  return { state: view, start, reset, recover: recoverFn, refresh }
}
