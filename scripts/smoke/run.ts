/**
 * Live 00b smoke driver (Arc Testnet only). Idempotent: progress lives in deployments/smoke-state.json.
 *   bun scripts/smoke/run.ts status   read-only: balances, pool state, recorded steps
 *   bun scripts/smoke/run.ts seed [--dry]  approvals, pool initialization if needed, full-range position
 *   bun scripts/smoke/run.ts venue    deploy and bind the SMOKE-ONLY venue
 *   bun scripts/smoke/run.ts trade    real 0.20 USDC buy, then sell the acquired cirBTC back
 *   bun scripts/smoke/run.ts manifest write verified addresses/hashes into deployments/arc-testnet.json
 * Needs "forge build" first (reads contracts/out). Keys come only from the ignored .env.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { getAddress } from 'viem'
import { join } from 'node:path'
import { ADDR, POOL_ID, POOL_KEY, ROOT, TICK_LOWER, TICK_UPPER, assertArcChain, balances, fmt, loadState, publicAddress, publicClient, getRecord } from './common'
import { deployAndBindVenue, poolState, preflight, seedPool } from './seed'
import { runTrade } from './trade'

async function status() {
  const pc = publicClient()
  await assertArcChain(pc)
  await preflight(pc)
  const pool = await poolState(pc)
  const out: Record<string, unknown> = { chainId: await pc.getChainId(), block: (await pc.getBlockNumber()).toString(), poolId: POOL_ID }
  out.pool = { sqrtPriceX96: pool.sqrtPriceX96.toString(), tick: pool.tick, liquidity: pool.liquidity.toString(), lpFee: pool.lpFee, protocolFee: pool.protocolFee }
  for (const role of ['deployer', 'trader', 'keeper'] as const) out[role] = { address: publicAddress(role), ...fmt(await balances(pc, publicAddress(role))) }
  out.steps = Object.fromEntries(Object.entries(loadState().steps).map(([k, v]) => [k, { status: v.status ?? 'pending', tx: v.txHash }]))
  console.log(JSON.stringify(out, null, 2))
}

function writeManifest() {
  const path = join(ROOT, 'deployments', 'arc-testnet.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  const state = loadState()
  const ok = (k: string) => state.steps[k]?.status === 'success'
  const position = getRecord<Record<string, unknown>>('position')
  const venue = getRecord<{ address: string }>('venue')
  manifest.uniswapV4 = {
    note: 'Existing v4 deployment on chain 5042002, not deployed by Sacred. Runtime identity checked against pinned sources in docs/checkpoints/00b-deps.md. Uniswap lists these addresses under Arc mainnet (5042).',
    poolManager: ADDR.poolManager,
    positionManager: ADDR.positionManager,
    quoter: ADDR.quoter,
    stateView: ADDR.stateView,
    permit2: ADDR.permit2,
    pool: {
      poolId: POOL_ID,
      currency0: POOL_KEY.currency0,
      currency1: POOL_KEY.currency1,
      fee: POOL_KEY.fee,
      tickSpacing: POOL_KEY.tickSpacing,
      hooks: POOL_KEY.hooks,
      initializeTx: ok('pool.initialize') ? state.steps['pool.initialize']?.txHash : null,
      fixture: '100000 USDC per cirBTC (atoms 1e11 : 1e8)',
    },
    fullRangePosition: position ? { ...position, tickLower: TICK_LOWER, tickUpper: TICK_UPPER } : null,
  }
  manifest.smoke = {
    note: 'Smoke-only venue bound to the trader wallet. The production venue will be bound to the real engine later. Sacred vault and engine are still undeployed.',
    venue: venue ? { address: getAddress(venue.address), deployTx: state.steps['venue.deploy']?.txHash ?? null, bindEngineTx: state.steps['venue.bindEngine']?.txHash ?? null } : null,
    trades: getRecord('trade.complete')
      ? { approveBuyTx: state.steps['trade.approve.buy']?.txHash, buyTx: state.steps['trade.buy']?.txHash, approveSellTx: state.steps['trade.approve.sell']?.txHash, sellTx: state.steps['trade.sell']?.txHash }
      : null,
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
  console.log('manifest updated')
}

async function main() {
  const cmd = process.argv[2]
  const pc = publicClient()
  if (cmd === 'status') return status()
  if (cmd === 'seed') return void (await seedPool(pc, process.argv.includes('--dry')))
  if (cmd === 'venue') return void (await deployAndBindVenue(pc))
  if (cmd === 'trade') return runTrade(pc)
  if (cmd === 'manifest') return writeManifest()
  throw new Error('usage: run.ts status|seed|venue|trade|manifest')
}

main().catch((e: unknown) => {
  // Never echo URLs: the sandbox RPC endpoint can carry a token.
  const msg = e instanceof Error ? e.message : 'failed'
  console.error(msg.replace(/https?:\/\/\S+/g, '<url>').slice(0, 800))
  process.exit(1)
})
