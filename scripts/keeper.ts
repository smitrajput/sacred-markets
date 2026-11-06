/**
 * Sacred keeper (operator process; NOT hosted anywhere until someone actually runs it).
 *
 *   bun scripts/keeper.ts --dry-run --once   # read-only: report what it would do
 *   bun scripts/keeper.ts --once             # at most one real action, then exit
 *   bun scripts/keeper.ts                    # sequential loop, 12 s between ticks, no overlapping runs
 *
 * Uses only the dedicated keeper wallet (SACRED_KEEPER_PRIVATE_KEY from the ignored .env; gas only, no price or
 * treasury authority). Each action is simulated, then sent through the reviewed write-ahead journal
 * (deployments/keeper-state.json): intent, nonce and the hash of the locally signed transaction are persisted
 * before broadcast, never the raw bytes or keys. One transaction at a time; any ambiguity STOPS the process.
 * Manual wallet actions in the app work without this process.
 */
import { join } from 'node:path'
import type { Hex } from 'viem'
import { encodeFunctionData } from 'viem'

import { demoPriceGuardAbi, marginVaultAbi, tradeEngineAbi } from '../src/contracts/abis'
import { ROOT, loadAccount, publicClient } from './smoke/common'
import { fileStore, liveChain, makeRunner, type CoreState, type SignerLike } from './core/journal'
import { core } from '../server/manifest'

const STATE_PATH = join(ROOT, 'deployments', 'keeper-state.json')
const INTERVAL_MS = 12_000
const GAS_BUDGET_WEI = 5n * 10n ** 17n // 0.5 USDC of gas for this journal, well inside the approved testnet cap
const DEADLINE_SECONDS = 600n

const args = new Set(process.argv.slice(2))
const dry = args.has('--dry-run')
const once = args.has('--once')

const store = fileStore(STATE_PATH)
const run = makeRunner({ store, chain: liveChain(), signer: () => loadAccount('keeper') as unknown as SignerLike })
const k = core()
const pc = publicClient()
const say = (m: string) => console.log(`${new Date().toISOString()} keeper ${m}`)

interface PlanRec {
  action: 'rebalance' | 'settleMatured' | 'process'
  to: `0x${string}`
  data: Hex
}

const planKey = (step: string) => `plan.${step}`
function spent(s: CoreState): bigint {
  return Object.values(s.steps).reduce((a, x) => a + BigInt(x.gasCostWei ?? '0'), 0n)
}

/** Durable ids: keeper.<n>.<action>.<id>. n only advances when a step is confirmed, so a later legitimate action never reuses an old step. */
async function execute(label: string, rec: PlanRec, step: string): Promise<void> {
  const s = store.load()
  s.records[planKey(step)] = rec
  store.save(s) // the exact calldata is saved so a resume rebuilds identical bytes
  await run({ step, label, role: 'keeper', to: rec.to, data: rec.data })
  const done = store.load()
  done.records['keeper.seq'] = Number(done.records['keeper.seq'] ?? 0) + 1
  store.save(done)
}

async function resumeUnfinished(): Promise<void> {
  const s = store.load()
  const open = Object.entries(s.steps).find(([, x]) => x.phase === 'signed' || x.phase === 'broadcast')
  if (!open) return
  const rec = s.records[planKey(open[0])] as PlanRec | undefined
  if (!rec) throw new Error(`STOP: unfinished step ${open[0]} has no saved plan`)
  say(`resuming ${open[0]}`)
  await execute(open[1].label, rec, open[0])
}

async function tick(): Promise<void> {
  const s0 = store.load()
  if (spent(s0) > GAS_BUDGET_WEI) throw new Error('STOP: keeper gas budget for this journal is used up')
  const seq = Number(s0.records['keeper.seq'] ?? 0)
  const head = await pc.getBlock()
  const guard = (await pc.readContract({ address: k.guard, abi: demoPriceGuardAbi, functionName: 'read' }))
  const ids = (await pc.readContract({ address: k.engine, abi: tradeEngineAbi, functionName: 'activeIds' }))
  say(`block ${head.number} live=${ids.length} reference=${guard[0]} fresh=${guard[2]}`)
  let chosen: { label: string; step: string; rec: PlanRec } | undefined
  if (guard[2]) {
    for (const id of ids) {
      const [plan, fresh] = (await pc.readContract({ address: k.engine, abi: tradeEngineAbi, functionName: 'quoteRebalance', args: [id, 0n] })) as readonly [{ eligible: boolean; minUsdc: bigint }, boolean]
      const pos = (await pc.readContract({ address: k.engine, abi: tradeEngineAbi, functionName: 'getPosition', args: [id] })) as { maturesAt: bigint }
      const deadline = head.timestamp + DEADLINE_SECONDS
      if (fresh && plan.eligible) {
        chosen = { label: `rebalance(${id})`, step: `keeper.${seq}.rebalance.${id}`, rec: { action: 'rebalance', to: k.engine, data: encodeFunctionData({ abi: tradeEngineAbi, functionName: 'rebalance', args: [id, plan.minUsdc, deadline] }) } }
        break
      }
      if (head.timestamp >= pos.maturesAt) {
        chosen = { label: `settleMatured(${id})`, step: `keeper.${seq}.settleMatured.${id}`, rec: { action: 'settleMatured', to: k.engine, data: encodeFunctionData({ abi: tradeEngineAbi, functionName: 'settleMatured', args: [id, 0n, deadline] }) } }
        break
      }
    }
  } else if (ids.length > 0) {
    say('reference is stale: sales fail closed, nothing to do until the operator refreshes it')
  }
  if (!chosen) {
    const st = (await pc.readContract({ address: k.vault, abi: marginVaultAbi, functionName: 'vaultState' })) as { queueHead: bigint; queueTail: bigint }
    if (st.queueTail > st.queueHead) {
      chosen = { label: 'processWithdrawals(16)', step: `keeper.${seq}.process.${st.queueHead}`, rec: { action: 'process', to: k.vault, data: encodeFunctionData({ abi: marginVaultAbi, functionName: 'processWithdrawals', args: [16n] }) } }
    }
  }
  if (!chosen) return say('nothing eligible')
  const account = loadAccount('keeper').address
  try {
    await pc.call({ account, to: chosen.rec.to, data: chosen.rec.data }) // simulate once; a revert means skip, not send
  } catch {
    return say(`${chosen.label} simulation reverted; skipping this tick`)
  }
  if (dry) return say(`DRY RUN: would send ${chosen.label}`)
  say(`sending ${chosen.label}`)
  await execute(chosen.label, chosen.rec, chosen.step)
  say(`confirmed ${chosen.label}`)
}

async function main(): Promise<void> {
  if (!dry) await resumeUnfinished()
  for (;;) {
    try {
      await tick()
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, '<url>')
      if (/^STOP/.test(msg)) throw e // ambiguity or budget: stop the process, never blind-resend
      say(`tick failed (will retry): ${msg.slice(0, 200)}`)
    }
    if (once) return
    await new Promise((r) => setTimeout(r, INTERVAL_MS)) // sequential: the next tick starts only after this wait
  }
}

main().catch((e: unknown) => {
  console.error((e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, '<url>').slice(0, 400))
  process.exit(1)
})
