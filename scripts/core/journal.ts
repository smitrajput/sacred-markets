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

export const loadCore = (): CoreState => fileStore(STATE_PATH).load()
export const saveCore = (s: CoreState): void => fileStore(STATE_PATH).save(s)

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

/** Everything runTx touches, injectable so the recovery rules can be tested with mocks (no live failure injection). */
export interface Store {
  load(): CoreState
  save(s: CoreState): void
}
export interface ChainLike {
  assertChain(): Promise<void>
  getReceipt(hash: Hex): Promise<Pick<TransactionReceipt, 'status' | 'blockNumber' | 'gasUsed' | 'effectiveGasPrice' | 'contractAddress'> | undefined>
  waitReceipt(hash: Hex): Promise<Pick<TransactionReceipt, 'status' | 'blockNumber' | 'gasUsed' | 'effectiveGasPrice' | 'contractAddress'>>
  nonce(address: Address, tag: 'latest' | 'pending'): Promise<number>
  call(args: { account: Address; to?: Address; data: Hex }): Promise<void>
  estimateGas(args: { account: Address; to?: Address; data: Hex }): Promise<bigint>
  fees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>
  balance(address: Address): Promise<bigint>
  send(serialized: Hex): Promise<Hex | undefined>
  readReached(block: bigint): Promise<void>
}
export interface SignerLike {
  address: Address
  signTransaction(tx: Record<string, unknown>): Promise<Hex>
}
export interface RunDeps {
  store: Store
  chain: ChainLike
  signer(role: Role): SignerLike
}

export const fileStore = (path: string): Store => ({
  load() {
    if (!existsSync(path)) return { schemaVersion: 1, chainId: CHAIN_ID, steps: {}, records: {} }
    return JSON.parse(readFileSync(path, 'utf8')) as CoreState
  },
  save(s) {
    const tmp = path + '.tmp'
    writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n')
    renameSync(tmp, path)
  },
})

export function liveChain(): ChainLike {
  const cc = chainClient()
  return {
    assertChain: () => assertArcChain(cc),
    getReceipt: (hash) => cc.getTransactionReceipt({ hash }).catch(() => undefined),
    waitReceipt: (hash) => cc.waitForTransactionReceipt({ hash, timeout: 150_000 }),
    nonce: (address, tag) => cc.getTransactionCount({ address, blockTag: tag }),
    call: async (a) => {
      await cc.call(a)
    },
    estimateGas: (a) => cc.estimateGas(a),
    fees: () => feeParams(cc),
    balance: (address) => cc.getBalance({ address }),
    send: (serializedTransaction) => cc.sendRawTransaction({ serializedTransaction }).catch(() => undefined),
    readReached: async (block) => {
      const reader = publicClient()
      for (let i = 0; i < 60; i++) {
        if ((await reader.getBlockNumber()) >= block) return
        await new Promise((r) => setTimeout(r, 1000))
      }
    },
  }
}

const liveDeps = (): RunDeps => ({ store: fileStore(STATE_PATH), chain: liveChain(), signer: (role) => loadAccount(role) as unknown as SignerLike })

const sameAddr = (a?: string, b?: string) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()

async function finalizeStep(d: RunDeps, step: string): Promise<CoreStep> {
  const state = d.store.load()
  const rec = state.steps[step]
  if (!rec) throw new Stop('journal lost ' + step)
  let receipt
  try {
    receipt = await d.chain.waitReceipt(rec.txHash)
  } catch {
    throw new Stop(`no receipt for ${step} (${rec.txHash}) within the timeout; re-run to resume, do not resend by hand`)
  }
  rec.blockNumber = receipt.blockNumber.toString()
  rec.gasUsed = receipt.gasUsed.toString()
  rec.effectiveGasPriceWei = receipt.effectiveGasPrice.toString()
  rec.gasCostWei = (receipt.gasUsed * receipt.effectiveGasPrice).toString()
  if (receipt.contractAddress) rec.contractAddress = receipt.contractAddress
  rec.phase = receipt.status === 'success' ? 'confirmed' : 'reverted'
  d.store.save(state)
  if (receipt.status !== 'success') throw new Stop(`${step} reverted on chain (${rec.txHash})`)
  await d.chain.readReached(receipt.blockNumber)
  return rec
}

async function signPlan(d: RunDeps, plan: Plan, nonce: number, rec: Pick<CoreStep, 'gas' | 'maxFeePerGas' | 'maxPriorityFeePerGas'>) {
  const signer = d.signer(plan.role)
  const serialized = await signer.signTransaction({
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
  return { signer, serialized, hash: keccak256(serialized) }
}

export function makeRunner(d: RunDeps) {
  return async function run(plan: Plan): Promise<CoreStep> {
    await d.chain.assertChain()
    const state = d.store.load()
    const known = state.steps[plan.step]

    if (known) {
      // A resumed step must be the SAME transaction: chain, role, destination, calldata and the actual loaded signer.
      const signer = d.signer(plan.role)
      if (
        known.chainId !== CHAIN_ID ||
        known.role !== plan.role ||
        known.calldataHash !== keccak256(plan.data) ||
        !sameAddr(known.to, plan.to) ||
        !sameAddr(known.signer, signer.address)
      ) {
        throw new Stop(`step ${plan.step} exists in the journal with a different destination, calldata or signer; refusing to continue`)
      }
      if (known.phase === 'confirmed') {
        const receipt = await d.chain.getReceipt(known.txHash)
        if (!receipt || receipt.status !== 'success' || receipt.blockNumber.toString() !== known.blockNumber) {
          throw new Stop(`journal says ${plan.step} is confirmed but the chain disagrees (${known.txHash})`)
        }
        return known
      }
      if (known.phase === 'reverted') throw new Stop(`step ${plan.step} previously reverted (${known.txHash})`)
      if (await d.chain.getReceipt(known.txHash)) return finalizeStep(d, plan.step)
      const latest = await d.chain.nonce(known.signer, 'latest')
      const pending = await d.chain.nonce(known.signer, 'pending')
      if (latest > known.nonce) {
        throw new Stop(`nonce ${known.nonce} was consumed on chain by a transaction other than ${known.txHash}; ambiguous, not resending`)
      }
      if (pending > latest) return finalizeStep(d, plan.step) // the node holds it pending: wait, never resend
      if (latest !== known.nonce || pending !== known.nonce) {
        throw new Stop(`nonce state (latest ${latest}, pending ${pending}) does not match the saved nonce ${known.nonce}; not resending`)
      }
      // The chain never saw it. Retransmit ONLY the identical bytes (same nonce, fees, calldata; deterministic signature).
      const again = await signPlan(d, plan, known.nonce, known)
      if (again.hash !== known.txHash) throw new Stop(`cannot rebuild the identical transaction for ${plan.step}; not resending`)
      await d.chain.send(again.serialized)
      known.phase = 'broadcast'
      d.store.save(state)
      return finalizeStep(d, plan.step)
    }

    // ---- new step. One transaction at a time: nothing else may be unconfirmed.
    const open = Object.entries(state.steps).find(([, s]) => s.phase === 'signed' || s.phase === 'broadcast')
    if (open) throw new Stop(`step ${open[0]} is not confirmed yet; resolve it first`)
    const signer = d.signer(plan.role)
    const latest = await d.chain.nonce(signer.address, 'latest')
    const pending = await d.chain.nonce(signer.address, 'pending')
    if (pending !== latest) throw new Stop(`${signer.address} has a pending transaction (latest ${latest}, pending ${pending})`)

    await d.chain.call({ account: signer.address, to: plan.to, data: plan.data }) // a revert aborts before any signature
    const gas = ((await d.chain.estimateGas({ account: signer.address, to: plan.to, data: plan.data })) * 12n) / 10n
    const fees = await d.chain.fees()
    if (fees.maxFeePerGas < 20n * GWEI) throw new Stop('maxFeePerGas below the 20 gwei floor')
    const bal = await d.chain.balance(signer.address)
    const need = gas * fees.maxFeePerGas + (plan.valueSpendWei ?? 0n) + RESERVE_WEI
    if (bal < need) throw new Stop(`budget: ${plan.role} balance ${bal} < required ${need} (includes the 2 USDC gas reserve)`)

    const rec: CoreStep = {
      label: plan.label,
      role: plan.role,
      signer: signer.address,
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
    const signed = await signPlan(d, plan, latest, rec)
    rec.txHash = signed.hash
    state.steps[plan.step] = rec
    d.store.save(state) // intent + hash are on disk BEFORE the broadcast
    const sent = await d.chain.send(signed.serialized)
    if (sent !== undefined && sent !== signed.hash) throw new Stop('node returned a different hash than the signed transaction')
    rec.phase = 'broadcast'
    d.store.save(state)
    return finalizeStep(d, plan.step)
  }
}

export const runTx = (plan: Plan): Promise<CoreStep> => makeRunner(liveDeps())(plan)
