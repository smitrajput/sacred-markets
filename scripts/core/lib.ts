/** Shared reads, ABIs and public-record helpers for the live core scripts. No secrets here. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  decodeEventLog,
  encodeDeployData,
  encodeFunctionData,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
  type Log,
} from 'viem'

import { ADDR, ROOT, erc20Abi, publicClient, quoterAbi, POOL_KEY, stateViewAbi, POOL_ID } from '../smoke/common'
import { chainClient, getCoreRecord, setCoreRecord } from './journal'

export const EXPLORER = 'https://explorer.testnet.arc.io'
export const SMOKE_VENUE: Address = '0x1eaE39A746C49708696FBA57CE4a1948eA4337E4'
export const NATIVE_PER_ATOM = 1_000_000_000_000n

interface Raw {
  abi: Abi
  bytecode: { object: Hex }
  deployedBytecode: { object: Hex; immutableReferences?: Record<string, Array<{ start: number; length: number }>> }
}
export function raw(name: string): Raw {
  return JSON.parse(readFileSync(join(ROOT, 'contracts', 'out', `${name}.sol`, `${name}.json`), 'utf8')) as Raw
}
export const ART = {
  vault: raw('MarginVault'),
  engine: raw('TradeEngine'),
  guard: raw('DemoPriceGuard'),
  venue: raw('V4SpotVenue'),
}

export interface Addresses {
  guard: Address
  vault: Address
  venue: Address
  engine: Address
}
export function addrs(): Addresses {
  const a = getCoreRecord<Addresses>('addresses')
  if (!a) throw new Error('core contracts are not deployed yet (run: deploy)')
  return a
}

export async function rd<T>(address: Address, abi: Abi, functionName: string, args: unknown[] = [], block?: bigint): Promise<T> {
  return (await publicClient().readContract({ address, abi, functionName, args, blockNumber: block })) as T
}

export interface Snap {
  block: string
  nativeWei: string
  usdc: string
  cirBtc: string
}
export async function snap(who: Address, block: bigint): Promise<Snap> {
  const pc = publicClient()
  const [n, u, b] = await Promise.all([
    pc.getBalance({ address: who, blockNumber: block }),
    pc.readContract({ address: ADDR.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [who], blockNumber: block }),
    pc.readContract({ address: ADDR.cirBtc, abi: erc20Abi, functionName: 'balanceOf', args: [who], blockNumber: block }),
  ])
  return { block: block.toString(), nativeWei: n.toString(), usdc: (u).toString(), cirBtc: (b).toString() }
}

export async function head(): Promise<bigint> {
  return publicClient().getBlockNumber()
}

/** Pool facts from StateView at a block: sqrtPrice, tick, liquidity and the implied USDC per whole BTC (micro-USDC). */
export async function pool(block?: bigint) {
  const pc = publicClient()
  const [slot0, liquidity] = await Promise.all([
    pc.readContract({ address: ADDR.stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [POOL_ID], blockNumber: block }),
    pc.readContract({ address: ADDR.stateView, abi: stateViewAbi, functionName: 'getLiquidity', args: [POOL_ID], blockNumber: block }),
  ])
  const [sqrt, tick] = slot0
  // price (token1 atoms per token0 atom) = sqrt^2 / 2^192; USDC per BTC (micro) = 1e8 / price
  const priceMicroPerBtc = (10n ** 8n * (1n << 192n)) / (sqrt * sqrt)
  return { sqrtPriceX96: sqrt, tick, liquidity, priceMicroPerBtc }
}

export async function quoteBuy(usdcIn: bigint): Promise<bigint> {
  const r = await publicClient().simulateContract({
    address: ADDR.quoter,
    abi: quoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [{ poolKey: POOL_KEY, zeroForOne: true, exactAmount: usdcIn, hookData: '0x' }],
  })
  return r.result[0]
}
export async function quoteSell(btcIn: bigint): Promise<bigint> {
  const r = await publicClient().simulateContract({
    address: ADDR.quoter,
    abi: quoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [{ poolKey: POOL_KEY, zeroForOne: false, exactAmount: btcIn, hookData: '0x' }],
  })
  return r.result[0]
}

export const erc20ApproveData = (spender: Address, amount: bigint): Hex =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] })

export const data = (abi: Abi, functionName: string, args: unknown[] = []): Hex => encodeFunctionData({ abi, functionName, args })
export const deployData = (abi: Abi, bytecode: Hex, args: unknown[]): Hex => encodeDeployData({ abi, bytecode, args })

/** Persist a parameter once so a resumed step rebuilds byte-identical calldata (deadlines, minimums). */
export async function param<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const have = getCoreRecord<T>('param.' + key)
  if (have !== undefined) return have
  const v = await compute()
  setCoreRecord('param.' + key, v)
  return v
}

/** Same as param for a bigint value (stored as a decimal string). */
export async function paramBig(key: string, compute: () => Promise<bigint>): Promise<bigint> {
  const s = await param<string>(key, async () => (await compute()).toString())
  return BigInt(s)
}

export async function chainNow(): Promise<bigint> {
  return (await chainClient().getBlock()).timestamp
}

const engineEvents = parseAbi([
  'event AssetAcquired(uint256 indexed id, address indexed trader, uint256 cost, uint256 atoms, uint256 referencePrice)',
  'event DisclosedSaleAgreed(uint256 indexed id, address indexed trader, uint256 equity, uint256 principal, uint256 markup, uint256 atoms, bytes32 termsHash)',
  'event Pledged(uint256 indexed id, address indexed trader, uint256 atoms, bytes32 termsHash)',
  'event Opened(uint256 indexed id, address indexed trader, uint256 maturesAt)',
  'event Repaid(uint256 indexed id, address indexed payer, uint256 principalPaid, uint256 markupPaid)',
  'event Released(uint256 indexed id, address indexed trader, uint256 atomsReturned)',
  'event Rebalanced(uint256 indexed id, uint256 atomsSold, uint256 proceeds, uint256 principalAfter, uint256 markupAfter, uint256 collateralAfter, bool dustFallback, bool toleranceUsed)',
  'event Closed(uint256 indexed id, uint8 kind, uint256 atomsSold, uint256 proceeds, uint256 surplusToTrader, uint256 grossPrincipalLoss, uint256 writtenOffMarkup)',
])

export interface EventRow {
  name: string
  logIndex: number
  args: Record<string, string>
}
/** Engine events of a transaction, in log order, with bigint args stringified. */
export async function engineEventsOf(txHash: Hex, engine: Address): Promise<EventRow[]> {
  const receipt = await chainClient().getTransactionReceipt({ hash: txHash })
  const rows: EventRow[] = []
  for (const log of receipt.logs as Log[]) {
    if (log.address.toLowerCase() !== engine.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: engineEvents, data: log.data, topics: log.topics })
      const args: Record<string, string> = {}
      for (const [k, v] of Object.entries((ev.args ?? {}) as Record<string, unknown>)) args[k] = String(v)
      rows.push({ name: ev.eventName, logIndex: Number(log.logIndex), args })
    } catch {
      /* not an engine event we decode */
    }
  }
  return rows.sort((a, b) => a.logIndex - b.logIndex)
}

export const link = {
  address: (a: string) => `${EXPLORER}/address/${a}`,
  tx: (h: string) => `${EXPLORER}/tx/${h}`,
}

const bigintReplacer = (_k: string, v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v)
/** JSON round-trip that stringifies bigint values: safe for public records and logs. */
export function jsonSafe(x: unknown): unknown {
  return JSON.parse(JSON.stringify(x, bigintReplacer)) as unknown
}
export function jsonLine(label: string, x: unknown): void {
  console.log(label + ' ' + JSON.stringify(x, bigintReplacer))
}
