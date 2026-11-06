/**
 * Write-ahead transaction journal for the live core scripts (Arc Testnet 5042002 only).
 *
 * Order of every transaction: validate chain and signer, simulate, estimate, sign LOCALLY, compute the hash from the
 * signed bytes, persist intent + chain + signer + nonce + calldata hash + tx hash to deployments/core-state.json, and
 * only then broadcast. The raw signed transaction and private keys are never persisted, logged or printed.
 * One transaction at a time; a step is "done" only after its receipt is re-read from the chain and shows success.
 * On restart the journal is compared with the chain nonce: an unexplained nonce advance or an ambiguous pending
 * transaction STOPS the script (no blind resend). The only automatic resend is of the byte-identical transaction
 * (same nonce, fees, calldata, deterministic signature) when the chain provably never saw it.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, http, keccak256, type Address, type Hex, type PublicClient, type TransactionReceipt } from 'viem'

import {
  CHAIN_ID,
  GWEI,
  ROOT,
  arcChain,
  assertArcChain,
  feeParams,
  loadAccount,
  publicClient,
  type Role,
} from '../smoke/common'

export const STATE_PATH = join(ROOT, 'deployments', 'core-state.json')
export const RESERVE_WEI = 2n * 10n ** 18n // keep 2 USDC of gas on every wallet
const PUBLIC_RPC = 'https://rpc.testnet.arc.io'

export type Phase = 'signed' | 'broadcast' | 'confirmed' | 'reverted'

export interface CoreStep {
  label: string
  role: Role
  signer: Address
  chainId: number
  nonce: number
  to?: Address
  calldataHash: Hex
  gas: string
  maxFeePerGas: string
  maxPriorityFeePerGas: string
  txHash: Hex
  phase: Phase
  blockNumber?: string
  gasUsed?: string
  effectiveGasPriceWei?: string
  gasCostWei?: string
  contractAddress?: Address
}

export interface CoreState {
  schemaVersion: 1
  chainId: number
  steps: Record<string, CoreStep>
  records: Record<string, unknown>
}

export class Stop extends Error {
  constructor(message: string) {
    super('STOP: ' + message)
  }
}

export function loadCore(): CoreState {
  if (!existsSync(STATE_PATH)) return { schemaVersion: 1, chainId: CHAIN_ID, steps: {}, records: {} }
  return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as CoreState
}

export function saveCore(s: CoreState): void {
  const tmp = STATE_PATH + '.tmp'
  writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n')
  renameSync(tmp, STATE_PATH)
}

export function setCoreRecord(key: string, value: unknown): void {
  const s = loadCore()
  s.records[key] = value
  saveCore(s)
}

export function getCoreRecord<T>(key: string): T | undefined {
  return loadCore().records[key] as T | undefined
}

/** Node used for nonces, receipts and broadcasting: the public Arc RPC (the read proxy rejects raw sends). */
export function chainClient(): PublicClient {
  return createPublicClient({ chain: arcChain, transport: http(PUBLIC_RPC) })
}

export interface Plan {
  step: string
  label: string
  role: Role
  to?: Address // omitted for contract creation
  data: Hex
  /** Native USDC (wei) this transaction moves besides gas, for the budget check. */
  valueSpendWei?: bigint
}

async function waitForHead(pc: PublicClient, block: bigint): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if ((await pc.getBlockNumber()) >= block) return
    await new Promise((r) => setTimeout(r, 1000))
  }
}

async function finalize(cc: PublicClient, step: string): Promise<CoreStep> {
  const state = loadCore()
  const rec = state.steps[step]
  if (!rec) throw new Stop('journal lost ' + step)
  let receipt: TransactionReceipt
  try {
    receipt = await cc.waitForTransactionReceipt({ hash: rec.txHash, timeout: 150_000 })
  } catch {
    throw new Stop(`no receipt for ${step} (${rec.txHash}) within the timeout; re-run to resume, do not resend by hand`)
  }
  rec.blockNumber = receipt.blockNumber.toString()
  rec.gasUsed = receipt.gasUsed.toString()
  rec.effectiveGasPriceWei = receipt.effectiveGasPrice.toString()
  rec.gasCostWei = (receipt.gasUsed * receipt.effectiveGasPrice).toString()
  if (receipt.contractAddress) rec.contractAddress = receipt.contractAddress
  rec.phase = receipt.status === 'success' ? 'confirmed' : 'reverted'
  saveCore(state)
  if (receipt.status !== 'success') throw new Stop(`${step} reverted on chain (${rec.txHash})`)
  await waitForHead(publicClient(), receipt.blockNumber) // the read node must have reached the receipt block
  return rec
}

/** Re-reads the receipt of a step recorded as confirmed: recorded success is never trusted on its own. */
async function verifyConfirmed(cc: PublicClient, step: string, rec: CoreStep): Promise<CoreStep> {
  const receipt = await cc.getTransactionReceipt({ hash: rec.txHash }).catch(() => undefined)
  if (!receipt || receipt.status !== 'success' || receipt.blockNumber.toString() !== rec.blockNumber) {
    throw new Stop(`journal says ${step} is confirmed but the chain disagrees (${rec.txHash})`)
  }
  return rec
}

async function buildSigned(plan: Plan, nonce: number, rec: Pick<CoreStep, 'gas' | 'maxFeePerGas' | 'maxPriorityFeePerGas'>) {
  const account = loadAccount(plan.role)
  if (!account.signTransaction) throw new Stop('account cannot sign locally')
  const serialized = await account.signTransaction({
    type: 'eip1559',
    chainId: CHAIN_ID,
    nonce,
    to: plan.to,
    data: plan.data,
    value: 0n,
    gas: BigInt(rec.gas),
    maxFeePerGas: BigInt(rec.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(rec.maxPriorityFeePerGas),
  })
  return { account, serialized, hash: keccak256(serialized) }
}

export async function runTx(plan: Plan): Promise<CoreStep> {
  const cc = chainClient()
  await assertArcChain(cc)
  const state = loadCore()
  const known = state.steps[plan.step]

  if (known) {
    if (known.chainId !== CHAIN_ID) throw new Stop('journal chain mismatch for ' + plan.step)
    if (known.calldataHash !== keccak256(plan.data) || known.role !== plan.role) {
      throw new Stop(`step ${plan.step} exists in the journal with different calldata or signer; refusing to continue`)
    }
    if (known.phase === 'confirmed') return verifyConfirmed(cc, plan.step, known)
    if (known.phase === 'reverted') throw new Stop(`step ${plan.step} previously reverted (${known.txHash})`)
    // signed or broadcast but not confirmed: look for the receipt first
    const receipt = await cc.getTransactionReceipt({ hash: known.txHash }).catch(() => undefined)
    if (receipt) return finalize(cc, plan.step)
    const latest = await cc.getTransactionCount({ address: known.signer, blockTag: 'latest' })
    const pending = await cc.getTransactionCount({ address: known.signer, blockTag: 'pending' })
    if (latest > known.nonce) {
      throw new Stop(`nonce ${known.nonce} was consumed on chain by a transaction other than ${known.txHash}; ambiguous, not resending`)
    }
    if (pending > latest) {
      // the node reports a pending transaction at this nonce: wait for it, do not resend
      return finalize(cc, plan.step)
    }
    // nonce unchanged, nothing pending: the chain never saw it. Resend only the byte-identical transaction.
    const again = await buildSigned(plan, known.nonce, known)
    if (again.hash !== known.txHash) throw new Stop(`cannot rebuild the identical transaction for ${plan.step}; not resending`)
    await cc.sendRawTransaction({ serializedTransaction: again.serialized })
    known.phase = 'broadcast'
    saveCore(state)
    return finalize(cc, plan.step)
  }

  // ---- new step. One transaction at a time: nothing else may be unconfirmed.
  const open = Object.entries(state.steps).find(([, s]) => s.phase === 'signed' || s.phase === 'broadcast')
  if (open) throw new Stop(`step ${open[0]} is not confirmed yet; resolve it first`)
  const account = loadAccount(plan.role)
  const latest = await cc.getTransactionCount({ address: account.address, blockTag: 'latest' })
  const pending = await cc.getTransactionCount({ address: account.address, blockTag: 'pending' })
  if (pending !== latest) throw new Stop(`${account.address} has a pending transaction (latest ${latest}, pending ${pending})`)

  await cc.call({ account: account.address, to: plan.to, data: plan.data }) // a revert aborts before any signature
  const estimate = await cc.estimateGas({ account: account.address, to: plan.to, data: plan.data })
  const gas = (estimate * 12n) / 10n
  const fees = await feeParams(cc)
  if (fees.maxFeePerGas < 20n * GWEI) throw new Stop('maxFeePerGas below the 20 gwei floor')
  const bal = await cc.getBalance({ address: account.address })
  const need = gas * fees.maxFeePerGas + (plan.valueSpendWei ?? 0n) + RESERVE_WEI
  if (bal < need) throw new Stop(`budget: ${plan.role} balance ${bal} < required ${need} (includes the 2 USDC gas reserve)`)

  const rec: CoreStep = {
    label: plan.label,
    role: plan.role,
    signer: account.address,
    chainId: CHAIN_ID,
    nonce: latest,
    to: plan.to,
    calldataHash: keccak256(plan.data),
    gas: gas.toString(),
    maxFeePerGas: fees.maxFeePerGas.toString(),
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
    txHash: '0x',
    phase: 'signed',
  }
  const signed = await buildSigned(plan, latest, rec)
  rec.txHash = signed.hash
  state.steps[plan.step] = rec
  saveCore(state) // intent + hash are on disk BEFORE the broadcast
  const sent = await cc.sendRawTransaction({ serializedTransaction: signed.serialized }).catch(() => undefined)
  if (sent !== undefined && sent !== signed.hash) throw new Stop('node returned a different hash than the signed transaction')
  rec.phase = 'broadcast'
  saveCore(state)
  return finalize(cc, plan.step)
}
