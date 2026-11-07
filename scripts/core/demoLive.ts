// Live Env for the demo CLI: real chain reads (pinned block snapshots), the write-ahead journal runner, lock, prompts. Wallets load lazily, only on a real send.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { encodeFunctionData, getAddress, type Address } from 'viem'
import { erc20Abi } from 'viem'

import { blockers, readOracle, readPositions, readVault } from '../../server/reads'
import { makeReader } from '../../server/chain'
import { ADDR, assertArcChain, loadAccount, publicAddress, publicClient } from '../smoke/common'
import { ART, SMOKE_VENUE, addrs, erc20ApproveData, pool, quoteBuy, quoteSell, rd, snap } from './lib'
import { Stop, fileStore, liveChain, makeRunner, type ChainLike, type SignerLike } from './journal'
import { BROWSER_TRADER, checkFinalPrereqs, type Addrs, type Env, type PosV, type Snapshot } from './demoCore'
import { LEGACY_PATH, LOCK_PATH, PROFILES, type Profile } from './demoProfiles'

export { LEGACY_PATH as EPISODE_PATH, LOCK_PATH }

/** Exclusive lock. A leftover/ambiguous lock FAILS CLOSED with instructions; it is never cleared automatically. */
export function acquireLock(path: string): () => void {
  mkdirSync(dirname(path), { recursive: true }) // only write commands reach here; read-only commands never create a directory or a lock
  try {
    const fd = openSync(path, 'wx')
    writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
    closeSync(fd)
  } catch {
    let who = 'unknown'
    try {
      who = readFileSync(path, 'utf8')
    } catch {
      /* unreadable */
    }
    throw new Stop(`another demo run holds the lock (${who}) or a previous run ended abnormally. Check that no \`bun run demo\` is running, then remove the file yourself: ${path}. It is never cleared automatically.`)
  }
  return () => {
    if (existsSync(path)) unlinkSync(path)
  }
}

let cancelled = false
export function installCancel(): void {
  process.on('SIGINT', () => {
    if (cancelled) process.exit(130)
    cancelled = true
    console.log('\nCancelling: nothing new will be signed. A transaction already sent is protected by the journal. Press Ctrl-C again to exit immediately.')
  })
}

async function ask(prompt: string, expected: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.log('No interactive terminal: refusing to sign without --yes.')
    return false
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer: string = await new Promise((r) => rl.question(prompt, r))
  rl.close()
  return answer.trim() === expected
}

/** Caps gas x fee at the persisted reservation INSIDE the shared runner (it estimates and reprices on its own); throws before anything is signed or sent. */
export function boundedChain(chain: ChainLike, cap: () => bigint | undefined): ChainLike {
  let lastGas = 0n
  return {
    ...chain,
    estimateGas: async (a) => {
      lastGas = await chain.estimateGas(a)
      return lastGas
    },
    fees: async () => {
      const f = await chain.fees()
      const c = cap()
      if (c !== undefined && (lastGas * 12n * f.maxFeePerGas) / 10n > c) throw new Stop('gas or fees jumped above this step\'s persisted reservation; nothing was signed or sent')
      return f
    },
  }
}

export function liveEnv(flags: { yes: boolean; replan: boolean }, profile: Profile = PROFILES.legacy): Env {
  const a: Addrs = {
    ...(({ guard, vault, engine }) => ({ guard, vault, engine }))(addrs()),
    smokeVenue: SMOKE_VENUE,
    usdc: ADDR.usdc,
    btc: ADDR.cirBtc,
    operator: publicAddress('trader'),
    deployer: publicAddress('deployer'),
    keeper: publicAddress('keeper'),
  }
  const chain = liveChain()
  const reader = makeReader()
  const store = fileStore(profile.journalPath)
  let runner: ReturnType<typeof makeRunner> | undefined
  let currentCap: bigint | undefined
  const bal = async (who: Address, block: bigint) => {
    const s = await snap(who, block)
    return { native: BigInt(s.nativeWei), usdc: BigInt(s.usdc), btc: BigInt(s.cirBtc) }
  }
  const position = async (id: bigint, block?: bigint): Promise<PosV | undefined> => {
    try {
      const p = await rd<Record<string, unknown>>(a.engine, ART.engine.abi, 'getPosition', [id], block)
      return { id, trader: String(p.trader), status: Number(p.status), openedAt: BigInt(p.openedAt as bigint), principal0: BigInt(p.principal0 as bigint), principal: BigInt(p.principal as bigint), markup0: BigInt(p.markup0 as bigint), markup: BigInt(p.markup as bigint), collateral: BigInt(p.collateral as bigint) }
    } catch {
      return undefined
    }
  }
  return {
    episodeId: profile.episodeId,
    prereq: profile.requiresRehearsal
      ? async (snapshot) => checkFinalPrereqs({ rehearsal: existsSync(LEGACY_PATH) ? (JSON.parse(readFileSync(LEGACY_PATH, 'utf8')) as { steps: Record<string, { phase: string }>; records: Record<string, unknown> }) : undefined, pos5: await position(5n, snapshot.block), snap: snapshot })
      : undefined,
    a,
    store,
    flags,
    enc: {
      approve: (_token, spender, amount) => erc20ApproveData(spender, amount), // the transaction's `to` is the token; the exact amount is the only argument that matters
      sell: (atoms, minOut, deadline) => encodeFunctionData({ abi: ART.venue.abi, functionName: 'sellCirBtc', args: [atoms, minOut, deadline] }),
      buy: (usdc, minOut, deadline) => encodeFunctionData({ abi: ART.venue.abi, functionName: 'buyCirBtc', args: [usdc, minOut, deadline] }),
      guardUpdate: (p, ts) => encodeFunctionData({ abi: ART.guard.abi, functionName: 'update', args: [p, ts] }),
      process: (max) => encodeFunctionData({ abi: ART.vault.abi, functionName: 'processWithdrawals', args: [max] }),
    },
    async snapshot(): Promise<Snapshot> {
      const block = await reader.getBlockNumber()
      const time = (await reader.getBlock({ blockNumber: block })).timestamp
      const [oracle, v, positions, pl, operator, deployer, keeper, browser] = await Promise.all([
        readOracle(reader, block),
        readVault(reader, block),
        readPositions(reader, block, time),
        pool(block),
        bal(a.operator, block),
        bal(a.deployer, block),
        bal(a.keeper, block),
        bal(BROWSER_TRADER, block),
      ])
      const b = blockers(v.state, positions, oracle.fresh)
      return {
        block,
        time,
        pool: { price: pl.priceMicroPerBtc, sqrt: pl.sqrtPriceX96, liquidity: pl.liquidity },
        oracle: { price: oracle.priceMicroUsdcPerBtc, observedAt: oracle.observedAt, expiresAt: oracle.expiresAt, fresh: oracle.fresh },
        positions: positions.map((p) => ({ id: BigInt(p.id), trader: p.trader, status: p.status, openedAt: BigInt(p.openedAt), principal0: BigInt(p.principal0), principal: BigInt(p.principal), markup0: BigInt(p.markup0), markup: BigInt(p.markup), collateral: BigInt(p.collateral) })),
        vault: { queueHead: v.state.queueHead as bigint, queueTail: v.state.queueTail as bigint, idle: v.state.depositorIdleCash as bigint, headroom: v.financingHeadroom, perAccountCap: v.state.perAccountCap as bigint, blockersFinancing: b.financing, blockersDeposit: b.deposit, fundingPaused: Boolean(v.state.fundingPaused), queueRequests: v.queue.length },
        operator,
        deployer,
        keeper,
        browser,
      }
    },
    quoteBuy,
    quoteSell,
    gasQuote: async (role, to, data) => {
      const account = publicAddress(role)
      const [gas, fees] = await Promise.all([chain.estimateGas({ account, to, data }), chain.fees()])
      return { gas, maxFeePerGas: fees.maxFeePerGas }
    },
    simulate: async (role, to, data) => chain.call({ account: publicAddress(role), to, data }),
    run: (plan, bound) => {
      currentCap = bound.maxGasWei
      runner ??= makeRunner({ store, chain: boundedChain(chain, () => currentCap), signer: (role) => loadAccount(role) as unknown as SignerLike }) // wallets load only here, on a real send
      return runner(plan)
    },
    confirm: ask,
    cancelled: () => cancelled,
    out: (line) => console.log(line),
  }
}

/** Chain, token and contract identity + wiring. Throws Stop on anything unexpected. */
export async function verifyIdentity(a: Addrs): Promise<void> {
  const pc = publicClient()
  await assertArcChain(pc)
  for (const [name, addr] of Object.entries({ guard: a.guard, vault: a.vault, engine: a.engine, smokeVenue: a.smokeVenue, usdc: a.usdc, btc: a.btc })) {
    const code = await pc.getCode({ address: addr })
    if (!code || code === '0x') throw new Stop(`no contract code at ${name} ${addr}`)
  }
  const [usdcDec, btcDec, venueEngine, admin, wired] = await Promise.all([
    rd<number>(a.usdc, erc20Abi, 'decimals'),
    rd<number>(a.btc, erc20Abi, 'decimals'),
    rd<Address>(a.smokeVenue, ART.venue.abi, 'engine'),
    rd<Address>(a.guard, ART.guard.abi, 'priceAdmin'),
    rd<boolean>(a.engine, ART.engine.abi, 'isWired'),
  ])
  if (usdcDec !== 6 || btcDec !== 8) throw new Stop(`unexpected token decimals ${usdcDec}/${btcDec}`)
  if (getAddress(venueEngine) !== getAddress(a.operator)) throw new Stop('the smoke venue is not bound to the dedicated market wallet')
  if (getAddress(admin) !== getAddress(a.deployer)) throw new Stop('the reference price admin is not the dedicated deployer')
  if (!wired) throw new Stop('the engine is not wired to the production venue and vault')
  const set = new Set([a.operator, a.deployer, a.keeper, BROWSER_TRADER].map((x) => x.toLowerCase()))
  if (set.size !== 4) throw new Stop('operator, deployer, keeper and browser wallets must be four different addresses')
}
