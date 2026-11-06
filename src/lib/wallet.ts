/**
 * Action-time wallet resolution. The signing client is resolved from the CURRENT Wagmi connection when an action runs (not from
 * a reactive hook value that may still be loading, failed, or sit on another chain): await connection/initialisation, switch to
 * Arc if needed, then validate the account and chain before anything is signed. Reading a receipt or refreshing a confirmed
 * result never needs a signing client.
 */
import { arcTestnet } from 'viem/chains'
import { erc20Abi, walletActions, type Address, type Hex, type WalletClient } from 'viem'
import type { Config } from 'wagmi'
import { getAccount, getConnectorClient, getPublicClient, switchChain } from 'wagmi/actions'

import type { Approval, Call, RunnerDeps, WaitResult } from './txRunner'

export type WalletErrorKind = 'disconnected' | 'connecting' | 'account_changed' | 'network' | 'client'
export class WalletError extends Error {
  constructor(
    readonly kind: WalletErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'WalletError'
  }
}

const same = (a?: string, b?: string) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()
const brief = (e: unknown) => ((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? 'unknown error').split('\n')[0].slice(0, 120)

export interface Signer {
  client: WalletClient
  account: Address
}

/** Wait (bounded) for a wallet that is still connecting or reconnecting. */
async function settled(config: Config, waitMs = 4000) {
  const until = Date.now() + waitMs
  let a = getAccount(config)
  while ((a.status === 'connecting' || a.status === 'reconnecting') && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 50))
    a = getAccount(config)
  }
  return a
}

/**
 * Resolve a signing client NOW for `expected` on Arc. Throws a WalletError that says what is actually wrong: not connected,
 * still connecting, wrong account, network switch failed, or the connector's client could not be initialised.
 */
export async function resolveSigner(config: Config, expected: Address, chainId: number = arcTestnet.id): Promise<Signer> {
  let acct = await settled(config)
  if (acct.status === 'connecting' || acct.status === 'reconnecting') throw new WalletError('connecting', 'Your wallet is still connecting. Wait a moment and try again.')
  if (acct.status !== 'connected' || !acct.address || !acct.connector) throw new WalletError('disconnected', 'Your wallet is not connected. Press Connect wallet, then try again.')
  if (!same(acct.address, expected)) throw new WalletError('account_changed', 'Your wallet account changed while preparing the transaction. Nothing was signed; check the account and try again.')
  if (acct.chainId !== chainId) {
    try {
      await switchChain(config, { chainId, connector: acct.connector })
    } catch (e) {
      if ((e as { code?: number })?.code === 4001) throw e // the user declined: reported as a rejection
      throw new WalletError('network', `Could not switch your wallet to Arc Testnet (${chainId}): ${brief(e)}. Approve the switch or add the network in your wallet, then retry.`)
    }
    acct = getAccount(config)
    if (acct.chainId !== chainId) throw new WalletError('network', `Your wallet is still on another network. Switch it to Arc Testnet (${chainId}) and retry.`)
  }
  let client: WalletClient
  try {
    client = (await getConnectorClient(config, { chainId, account: acct.address, connector: acct.connector })).extend(walletActions)
  } catch (e) {
    throw new WalletError('client', `Your wallet is connected, but its signing client could not be initialised (${brief(e)}). Reconnect the wallet or reload the page, then retry.`)
  }
  // the connection may have changed while the client was initialising
  const now = getAccount(config)
  if (now.status !== 'connected') throw new WalletError('disconnected', 'Your wallet disconnected while preparing the transaction. Nothing was signed.')
  if (!same(now.address, expected) || !same(client.account?.address, expected)) throw new WalletError('account_changed', 'Your wallet account changed while preparing the transaction. Nothing was signed; check the account and try again.')
  let actual: number
  try {
    actual = await client.getChainId()
  } catch (e) {
    throw new WalletError('client', `Your wallet did not answer a network check (${brief(e)}). Reconnect the wallet and retry.`)
  }
  if (actual !== chainId) throw new WalletError('network', `Your wallet reports network ${actual}, not Arc Testnet (${chainId}). Switch networks and retry.`)
  return { client, account: expected }
}

export interface DepsExtras {
  refresh: (block: bigint) => Promise<boolean>
  persist: RunnerDeps['persist']
}

/** Runner dependencies bound to the live Wagmi config. Only approve/send need (and lazily resolve) a signing client. */
export function makeRunnerDeps(config: Config, account: Address, extras: DepsExtras): RunnerDeps {
  const pc = () => {
    const c = getPublicClient(config, { chainId: arcTestnet.id })
    if (!c) throw new WalletError('network', 'The Arc Testnet read client is unavailable.')
    return c
  }
  return {
    chainId: async () => {
      const a = await settled(config)
      if (a.status !== 'connected') throw new WalletError('disconnected', 'Your wallet is not connected. Press Connect wallet, then try again.')
      return a.chainId ?? 0
    },
    switchChain: async (id) => {
      const a = getAccount(config)
      if (!a.connector) throw new WalletError('disconnected', 'Your wallet is not connected. Press Connect wallet, then try again.')
      await switchChain(config, { chainId: id, connector: a.connector })
    },
    prepare: async () => {
      await resolveSigner(config, account) // validates the client, account and chain before any allowance read or signature
    },
    allowance: (a: Approval) => pc().readContract({ address: a.token, abi: erc20Abi, functionName: 'allowance', args: [account, a.spender] }),
    approve: async (a: Approval) => {
      const s = await resolveSigner(config, account)
      return s.client.writeContract({ address: a.token, abi: erc20Abi, functionName: 'approve', args: [a.spender, a.amount], account: s.account, chain: arcTestnet })
    },
    simulate: async (c: Call) => (await pc().simulateContract({ account, address: c.address, abi: c.abi, functionName: c.functionName, args: c.args })).request,
    send: async (request: unknown) => {
      const s = await resolveSigner(config, account)
      return s.client.writeContract(request as Parameters<WalletClient['writeContract']>[0])
    },
    wait: async (hash: Hex): Promise<WaitResult> => {
      const rep: { kind?: 'repriced' | 'replaced' | 'cancelled'; hash?: Hex } = {}
      const r = await pc().waitForTransactionReceipt({
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
        const r = await pc().getTransactionReceipt({ hash })
        return { status: r.status, blockNumber: r.blockNumber }
      } catch {
        return undefined // not mined yet (or the node cannot say): never resend
      }
    },
    refresh: extras.refresh,
    persist: extras.persist,
  }
}
