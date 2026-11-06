import type { Address } from 'viem'
import { parseAbi } from 'viem'

import { manifest } from './sacred'

type Entry = { address: Address; deployBlock: number; deployTxHash: string; policy?: { termsHash?: string } }
const sc = manifest.sacredContracts as unknown as Record<string, Entry>

/** Verified deployed addresses straight from the manifest. */
export const CONTRACTS = {
  vault: sc.usdcEarn.address,
  engine: sc.cirBtcSpotFinancing.address,
  guard: sc.demoPriceGuard.address,
  venue: sc.productionVenue.address,
  usdc: manifest.externalContracts.usdc.address,
  cirBtc: manifest.externalContracts.cirBTC.address,
}
export const TERMS_HASH = sc.cirBtcSpotFinancing.policy!.termsHash as `0x${string}`
const uni = (manifest as unknown as { uniswapV4: { quoter: Address } }).uniswapV4
export const QUOTER = uni.quoter

export const POOL_KEY = {
  currency0: CONTRACTS.usdc,
  currency1: CONTRACTS.cirBtc,
  fee: 3000,
  tickSpacing: 60,
  hooks: '0x0000000000000000000000000000000000000000' as Address,
} as const

export const quoterAbi = parseAbi([
  'function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)',
])

export const explorerTx = (h: string) => `${manifest.network.explorerUrl}/tx/${h}`
export const explorerAddr = (a: string) => `${manifest.network.explorerUrl}/address/${a}`
