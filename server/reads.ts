import type { Address } from 'viem'

import { demoPriceGuardAbi, marginVaultAbi, tradeEngineAbi } from '../src/contracts/abis.js'
import type { Reader } from './chain.js'
import { core } from './manifest.js'

type Obj = Record<string, unknown>

export interface PositionRead {
  id: string
  trader: Address
  status: number
  openedAt: string
  maturesAt: string
  principal0: string
  principal: string
  markup0: string
  markup: string
  debt: string
  collateral: string
  collected: string
  lpAllocation: string
  termsHash: string
  netCollateralValue: string
  priceFresh: boolean
  coverageBps: string
  rebalance: { eligible: boolean; partial: boolean; sellAtoms: string; minUsdc: string }
  matured: boolean
  impaired: boolean
}

export async function readPositions(c: Reader, block: bigint, blockTime: bigint): Promise<PositionRead[]> {
  const { engine } = core()
  const ids = (await c.readContract({ address: engine, abi: tradeEngineAbi, functionName: 'activeIds', blockNumber: block })) as readonly bigint[]
  return Promise.all(
    ids.map(async (id) => {
      const [p, value, cov, quote] = await Promise.all([
        c.readContract({ address: engine, abi: tradeEngineAbi, functionName: 'getPosition', args: [id], blockNumber: block }) as Promise<Obj>,
        c.readContract({ address: engine, abi: tradeEngineAbi, functionName: 'positionValue', args: [id], blockNumber: block }) as Promise<readonly [bigint, boolean]>,
        c.readContract({ address: engine, abi: tradeEngineAbi, functionName: 'coverageBps', args: [id], blockNumber: block }) as Promise<bigint>,
        c.readContract({ address: engine, abi: tradeEngineAbi, functionName: 'quoteRebalance', args: [id, 0n], blockNumber: block }) as Promise<readonly [Obj, boolean]>,
      ])
      const principal = p.principal as bigint
      const markup = p.markup as bigint
      const plan = quote[0]
      const fresh = value[1]
      return {
        id: id.toString(),
        trader: p.trader as Address,
        status: Number(p.status),
        openedAt: String(p.openedAt),
        maturesAt: String(p.maturesAt),
        principal0: String(p.principal0),
        principal: principal.toString(),
        markup0: String(p.markup0),
        markup: markup.toString(),
        debt: (principal + markup).toString(),
        collateral: String(p.collateral),
        collected: String(p.collected),
        lpAllocation: String(p.lpAllocation),
        termsHash: String(p.termsHash),
        netCollateralValue: value[0].toString(),
        priceFresh: fresh,
        coverageBps: cov.toString(),
        rebalance: {
          eligible: fresh && Boolean(plan.eligible),
          partial: Boolean(plan.isPartial),
          sellAtoms: (plan.sellAtoms as bigint).toString(),
          minUsdc: (plan.minUsdc as bigint).toString(),
        },
        matured: blockTime >= BigInt(p.maturesAt as bigint),
        impaired: fresh && value[0] < principal,
      } satisfies PositionRead
    }),
  )
}

export async function readOracle(c: Reader, block: bigint) {
  const { guard } = core()
  const [read, maxAge] = await Promise.all([
    c.readContract({ address: guard, abi: demoPriceGuardAbi, functionName: 'read', blockNumber: block }) as Promise<readonly [bigint, bigint, boolean]>,
    c.readContract({ address: guard, abi: demoPriceGuardAbi, functionName: 'maxAge', blockNumber: block }) as Promise<bigint>,
  ])
  return { priceMicroUsdcPerBtc: read[0], observedAt: read[1], fresh: read[2], maxAgeSeconds: maxAge, expiresAt: read[1] + maxAge }
}

export async function readVault(c: Reader, block: bigint, owner?: Address) {
  const { vault } = core()
  const call = (functionName: string, args: readonly unknown[] = []) =>
    c.readContract({ address: vault, abi: marginVaultAbi, functionName, args, blockNumber: block })
  const [state, mandate, headroom, backed] = await Promise.all([
    call('vaultState') as Promise<Obj>,
    call('MANDATE_HASH') as Promise<string>,
    call('financingHeadroom') as Promise<bigint>,
    call('isFullyBacked') as Promise<boolean>,
  ])
  const head = state.queueHead as bigint
  const tail = state.queueTail as bigint
  const count = tail > head ? Number(tail - head) : 0
  if (count > 64) throw new Error('queue_out_of_bounds')
  const queue = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const id = head + BigInt(i)
      const r = (await call('withdrawalRequests', [id])) as readonly [Address, bigint]
      return { id: id.toString(), owner: r[0], shares: r[1].toString() }
    }),
  )
  let account: Record<string, string> | null = null
  if (owner) {
    const [shares, locked, claimable] = await Promise.all([call('sharesOf', [owner]), call('lockedShares', [owner]), call('claimable', [owner])])
    account = { owner, shares: String(shares), lockedShares: String(locked), claimable: String(claimable) }
  }
  const nav = state.nav as bigint
  const totalShares = state.totalShares as bigint
  return { state, mandateHash: mandate, financingHeadroom: headroom, fullyBacked: backed, queue, account, navPerShareE6: totalShares > 0n ? (nav * 1_000_000n) / totalShares : 0n }
}

export function blockers(state: Obj, positions: PositionRead[], oracleFresh: boolean) {
  const deposit: string[] = []
  const financing: string[] = []
  const queueOpen = (state.queueHead as bigint) !== (state.queueTail as bigint)
  if (state.fundingPaused) {
    deposit.push('funding_paused')
    financing.push('funding_paused')
  }
  if (queueOpen) {
    deposit.push('withdrawal_queue')
    financing.push('withdrawal_queue')
  }
  if ((state.pendingOpens as bigint) > 0n) deposit.push('pending_open')
  if (positions.some((p) => !p.priceFresh)) {
    deposit.push('stale_price')
    financing.push('stale_price')
  }
  if (!oracleFresh && !financing.includes('stale_price')) financing.push('stale_price')
  if (positions.some((p) => p.impaired)) {
    deposit.push('unsettled_impairment')
    financing.push('unsettled_impairment')
  }
  if (((state.primaryReserve as bigint) < (state.primaryTarget as bigint)) || ((state.tailReserve as bigint) < (state.tailTarget as bigint))) financing.push('reserves_below_target')
  return { deposit, financing }
}
