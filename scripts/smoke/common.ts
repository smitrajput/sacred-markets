/**
 * Shared plumbing for the live 00b smoke scripts (Arc Testnet 5042002 only).
 * Keys are read from the ignored .env inside this process and are never logged, printed or passed as arguments.
 * Every transaction is simulated, fee-checked, budget-checked and recorded in deployments/smoke-state.json so a
 * re-run resumes instead of repeating a step.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { resolveRpcUrl } from '../../server/rpc'

export const ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const CHAIN_ID = 5042002
export const GWEI = 1_000_000_000n
export const NATIVE_PER_USDC_ATOM = 1_000_000_000_000n

export const ADDR = {
  poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
  positionManager: '0x6049c9a0e26405C0985f9E3685C87d0aE917f82B',
  quoter: '0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94',
  stateView: '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  usdc: '0x3600000000000000000000000000000000000000',
  cirBtc: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
} as const satisfies Record<string, Address>

export const POOL_ID: Hex = '0xf4e18ec272549ab0140d43d33a7ba93768ecaec4dee4a7fb4f2c9af00950cde4'
export const POOL_KEY = {
  currency0: ADDR.usdc,
  currency1: ADDR.cirBtc,
  fee: 3000,
  tickSpacing: 60,
  hooks: '0x0000000000000000000000000000000000000000',
} as const
export const TICK_LOWER = -887220
export const TICK_UPPER = 887220

/** Fixture price: 100,000 USDC per whole cirBTC (token atoms 1e11 USDC atoms : 1e8 cirBTC atoms). */
export const FIXTURE_USDC_ATOMS_PER_BTC = 100_000n * 1_000_000n
export const FIXTURE_BTC_ATOMS = 100_000_000n

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
])
export const erc20TransferAbi = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])
export const permit2Abi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
])
export const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128)',
  'function poolManager() view returns (address)',
])
export const posmAbi = parseAbi([
  'function initializePool((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96) payable returns (int24)',
  'function modifyLiquidities(bytes unlockData, uint256 deadline) payable',
  'function nextTokenId() view returns (uint256)',
  'function getPositionLiquidity(uint256 tokenId) view returns (uint128)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function poolManager() view returns (address)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed id)',
])
export const quoterAbi = parseAbi([
  'function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)',
  'function poolManager() view returns (address)',
])

interface Artifact {
  abi: Abi
  bytecode: { object: Hex }
  deployedBytecode: { object: Hex }
}
export function artifact(name: string): Artifact {
  const path = join(ROOT, 'contracts', 'out', `${name}.sol`, `${name}.json`)
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run "forge build" first.`)
  return JSON.parse(readFileSync(path, 'utf8')) as Artifact
}

// ------------------------------------------------------------------ clients

export const arcChain = defineChain({
  id: CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
})

export function publicClient(): PublicClient {
  return createPublicClient({ chain: arcChain, transport: http(resolveRpcUrl('Arc_Testnet', CHAIN_ID)) })
}

export type Role = 'deployer' | 'trader' | 'keeper'
const SECRET_NAMES: Record<Role, string> = {
  deployer: 'SACRED_DEPLOYER_PRIVATE_KEY',
  trader: 'SACRED_TRADER_PRIVATE_KEY',
  keeper: 'SACRED_KEEPER_PRIVATE_KEY',
}

interface DemoWallets {
  wallets: Array<{ role: string; address: Address }>
}
export function publicAddress(role: Role): Address {
  const j = JSON.parse(readFileSync(join(ROOT, 'deployments', 'demo-wallets.json'), 'utf8')) as DemoWallets
  const w = j.wallets.find((x) => x.role === role)
  if (!w) throw new Error('No public address for role ' + role)
  return w.address
}

/** Loads the role's account from the environment and checks it matches the public address on file. */
export function loadAccount(role: Role): Account {
  const raw = process.env[SECRET_NAMES[role]]
  if (!raw || !/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error(`${SECRET_NAMES[role]} is missing or malformed in .env`)
  const account = privateKeyToAccount(raw as Hex)
  if (account.address.toLowerCase() !== publicAddress(role).toLowerCase()) {
    throw new Error(`${role} key does not match deployments/demo-wallets.json`)
  }
  return account
}

/** Broadcasts through the public Arc RPC: the sandbox read proxy rejects eth_sendRawTransaction (HTTP 403). */
export function walletClient(account: Account): WalletClient {
  return createWalletClient({ account, chain: arcChain, transport: http('https://rpc.testnet.arc.io') })
}

export async function assertArcChain(pc: PublicClient): Promise<void> {
  const id = await pc.getChainId()
  if (id !== CHAIN_ID) throw new Error(`Refusing to sign: connected chain ${id}, expected ${CHAIN_ID}`)
}

// ------------------------------------------------------------------ balances

export interface Balances {
  nativeWei: bigint
  usdc: bigint
  cirBtc: bigint
}
/** Pass `blockNumber` to read at an exact block: the RPC endpoint may be load balanced, so "latest" can lag a receipt. */
export async function balances(pc: PublicClient, who: Address, blockNumber?: bigint): Promise<Balances> {
  const [nativeWei, usdc, cirBtc] = await Promise.all([
    pc.getBalance({ address: who, blockNumber }),
    pc.readContract({ address: ADDR.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [who], blockNumber }),
    pc.readContract({ address: ADDR.cirBtc, abi: erc20Abi, functionName: 'balanceOf', args: [who], blockNumber }),
  ])
  return { nativeWei, usdc, cirBtc }
}
export const fmt = (b: Balances) => ({ nativeWei: b.nativeWei.toString(), usdcAtoms: b.usdc.toString(), cirBtcAtoms: b.cirBtc.toString() })

// ------------------------------------------------------------------ state (public, no secrets)

export interface StepRecord {
  label: string
  txHash: Hex
  status?: 'success' | 'reverted'
  blockNumber?: string
  gasUsed?: string
  effectiveGasPriceWei?: string
  gasCostWei?: string
  contractAddress?: Address
}
export interface SmokeState {
  schemaVersion: 1
  chainId: number
  steps: Record<string, StepRecord>
  records: Record<string, unknown>
}
const STATE_PATH = join(ROOT, 'deployments', 'smoke-state.json')
export function loadState(): SmokeState {
  if (!existsSync(STATE_PATH)) return { schemaVersion: 1, chainId: CHAIN_ID, steps: {}, records: {} }
  return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as SmokeState
}
export function saveState(s: SmokeState): void {
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2) + '\n')
}

// ------------------------------------------------------------------ transactions

export async function feeParams(pc: PublicClient): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const block = await pc.getBlock()
  const base = block.baseFeePerGas ?? 0n
  const floor = 20n * GWEI
  const maxFeePerGas = base * 2n > floor ? base * 2n : floor
  let tip = 0n
  try {
    const hex = (await pc.request({ method: 'eth_maxPriorityFeePerGas' }))
    tip = BigInt(hex)
  } catch {
    tip = 0n
  }
  return { maxFeePerGas, maxPriorityFeePerGas: tip > maxFeePerGas ? maxFeePerGas : tip }
}

export interface TxPlan {
  step: string
  label: string
  role: Role
  to?: Address // omitted for contract creation
  data: Hex
  /** Native USDC (wei) this transaction may move besides gas, for the budget check. */
  valueSpendWei?: bigint
  /** Minimum native balance (wei) the wallet must still hold after this tx's worst-case gas. */
  reserveWei?: bigint
}

/**
 * Runs one transaction exactly once. If the step is already recorded the receipt is re-read and the step is not
 * repeated. Simulates, estimates gas, checks the fee floor and budget, sends, records the hash before waiting.
 */
export async function runStep(pc: PublicClient, plan: TxPlan): Promise<StepRecord> {
  const state = loadState()
  const existing = state.steps[plan.step]
  if (existing?.status === 'success') return existing
  if (existing && !existing.status) return finalize(pc, plan.step, existing.txHash)
  if (existing?.status === 'reverted') throw new Error(`Step ${plan.step} previously reverted (${existing.txHash}); not retrying automatically`)

  await assertArcChain(pc)
  const account = loadAccount(plan.role)
  const wc = walletClient(account)

  // Simulate against current state; a revert aborts before any signature.
  await pc.call({ account: account.address, to: plan.to, data: plan.data })
  const estimate = await pc.estimateGas({ account: account.address, to: plan.to, data: plan.data })
  const gas = (estimate * 12n) / 10n
  const fees = await feeParams(pc)
  if (fees.maxFeePerGas < 20n * GWEI) throw new Error('maxFeePerGas below the 20 gwei floor')
  const worstGasWei = gas * fees.maxFeePerGas
  const bal = await pc.getBalance({ address: account.address })
  const needed = worstGasWei + (plan.valueSpendWei ?? 0n) + (plan.reserveWei ?? 0n)
  if (bal < needed) throw new Error(`Budget check failed for ${plan.step}: balance ${bal} < required ${needed}`)

  const txHash = await wc.sendTransaction({
    account,
    chain: arcChain,
    to: plan.to,
    data: plan.data,
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  })
  state.steps[plan.step] = { label: plan.label, txHash }
  saveState(state)
  return finalize(pc, plan.step, txHash)
}

async function finalize(pc: PublicClient, step: string, txHash: Hex): Promise<StepRecord> {
  const receipt = await pc.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 })
  const state = loadState()
  const rec = state.steps[step]
  if (!rec) throw new Error('state lost for ' + step)
  rec.status = receipt.status
  rec.blockNumber = receipt.blockNumber.toString()
  rec.gasUsed = receipt.gasUsed.toString()
  rec.effectiveGasPriceWei = receipt.effectiveGasPrice.toString()
  rec.gasCostWei = (receipt.gasUsed * receipt.effectiveGasPrice).toString()
  if (receipt.contractAddress) rec.contractAddress = receipt.contractAddress
  saveState(state)
  if (receipt.status !== 'success') throw new Error(`Transaction ${txHash} (${step}) reverted`)
  return rec
}

export function setRecord(key: string, value: unknown): void {
  const s = loadState()
  s.records[key] = value
  saveState(s)
}
export function getRecord<T>(key: string): T | undefined {
  return loadState().records[key] as T | undefined
}
export type { PublicClient }
