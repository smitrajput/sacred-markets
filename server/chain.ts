import { createPublicClient, defineChain, http, type Abi, type Address, type Hex } from 'viem'

import { NETWORK } from './manifest.js'
import { resolveRpcUrl, type Env } from './rpc.js'

export interface RawLog {
  address: Address
  data: Hex
  topics: readonly Hex[]
  blockNumber: bigint
  logIndex: number
  transactionHash: Hex
}

/** The few chain reads the API needs. Tests pass a mock; production adapts a viem public client. */
export interface Reader {
  getBlockNumber(): Promise<bigint>
  getBlock(args: { blockNumber: bigint }): Promise<{ number: bigint; timestamp: bigint }>
  readContract(args: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }): Promise<unknown>
  getLogs(args: { address: Address[]; fromBlock: bigint; toBlock: bigint }): Promise<RawLog[]>
}

const arc = defineChain({
  id: NETWORK.chainId,
  name: NETWORK.name,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [NETWORK.rpcUrl] } },
})

export function makeReader(env: Env = process.env): Reader {
  const url = resolveRpcUrl('Arc_Testnet', NETWORK.chainId, env)
  const client = createPublicClient({ chain: arc, transport: http(url, { timeout: 8000, retryCount: 2, retryDelay: 400, batch: { batchSize: 40, wait: 15 } }) })
  return client
}
