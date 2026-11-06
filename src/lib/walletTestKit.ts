/**
 * Deterministic test wallet for the action-preparation regressions. A Wagmi connector backed by a scripted EIP-1193 provider:
 * it never touches a real wallet or network, records every request (a signing request is logged as "PROMPT:<method>") and
 * can be told to be slow, fail to initialise, sit on another chain, refuse a chain switch, or change account.
 * Test tooling only: nothing in the app imports this file.
 */
import { createConfig, createConnector, type Config } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { custom, type Address } from 'viem'

export interface WalletCtl {
  account: Address
  chainId: number
  providerDelayMs: number
  providerError?: string
  switchError?: string
  log: string[]
  emitChange?: (change: { chainId?: number; accounts?: readonly Address[] }) => void
  emitDisconnect?: () => void
}
export const newCtl = (over: Partial<WalletCtl> = {}): WalletCtl => ({
  account: '0x5b93000000000000000000000000000000002659',
  chainId: arcTestnet.id,
  providerDelayMs: 0,
  log: [],
  ...over,
})

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const hex = (n: number) => `0x${n.toString(16)}`

export function testWallet(ctl: WalletCtl) {
  return createConnector((config) => {
    ctl.emitChange = (c) => config.emitter.emit('change', c)
    ctl.emitDisconnect = () => config.emitter.emit('disconnect')
    const answer = (method: string): unknown => {
      switch (method) {
        case 'eth_chainId':
          return hex(ctl.chainId)
        case 'eth_accounts':
        case 'eth_requestAccounts':
          return [ctl.account]
        case 'wallet_switchEthereumChain':
          if (ctl.switchError) throw Object.assign(new Error(ctl.switchError), { code: 4001 })
          ctl.chainId = arcTestnet.id
          return null
        case 'eth_sendTransaction':
          ctl.log.push('PROMPT:eth_sendTransaction') // the wallet approval prompt would open here; nothing is sent
          return `0x${'ab'.repeat(32)}`
        default:
          throw new Error(`test wallet: unsupported ${method}`)
      }
    }
    const provider = {
      request: ({ method }: { method: string; params?: unknown }): Promise<unknown> => {
        ctl.log.push(`request:${method}`)
        try {
          return Promise.resolve(answer(method))
        } catch (e) {
          return Promise.reject(e instanceof Error ? e : new Error(String(e)))
        }
      },
    }
    return {
      id: 'sacred-test',
      name: 'Sacred test wallet',
      type: 'test',
      setup: () => Promise.resolve(),
      connect: () => Promise.resolve({ accounts: [ctl.account], chainId: ctl.chainId }),
      disconnect: () => Promise.resolve(),
      getAccounts: () => Promise.resolve([ctl.account]),
      getChainId: () => Promise.resolve(ctl.chainId),
      getProvider: async () => {
        ctl.log.push('getProvider')
        await sleep(ctl.providerDelayMs)
        if (ctl.providerError) throw new Error(ctl.providerError)
        return provider
      },
      isAuthorized: () => Promise.resolve(true),
      switchChain: ({ chainId }: { chainId: number }) => {
        ctl.log.push(`switch:${chainId}`)
        if (ctl.switchError) return Promise.reject(Object.assign(new Error(ctl.switchError), { code: 4001 }))
        ctl.chainId = chainId
        config.emitter.emit('change', { chainId })
        return Promise.resolve(config.chains.find((c) => c.id === chainId)!)
      },
      onAccountsChanged() {},
      onChainChanged() {},
      onDisconnect() {},
    } as never
  })
}

/** Canned read-only chain for the public client: allowance 0, empty receipts. No network. */
const rpcAnswer = (method: string): unknown => {
  switch (method) {
    case 'eth_chainId':
      return hex(arcTestnet.id)
    case 'eth_call':
      return `0x${'0'.repeat(64)}`
    case 'eth_estimateGas':
      return '0x5208'
    case 'eth_blockNumber':
      return '0x10'
    case 'eth_getTransactionReceipt':
      return null
    case 'eth_getTransactionCount':
      return '0x0'
    case 'eth_gasPrice':
    case 'eth_maxPriorityFeePerGas':
      return '0x3b9aca00'
    case 'eth_getBlockByNumber':
      return { number: '0x10', timestamp: '0x1', baseFeePerGas: '0x3b9aca00', transactions: [], hash: `0x${'11'.repeat(32)}` }
    default:
      throw new Error(`test rpc: unsupported ${method}`)
  }
}
const rpc = custom({
  request: ({ method }: { method: string }): Promise<unknown> => {
    try {
      return Promise.resolve(rpcAnswer(method))
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)))
    }
  },
})

export function testConfig(ctl: WalletCtl): Config {
  return createConfig({ chains: [arcTestnet], connectors: [testWallet(ctl)], transports: { [arcTestnet.id]: rpc }, multiInjectedProviderDiscovery: false, batch: { multicall: false } })
}
