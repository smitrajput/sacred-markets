/** Preflight, deployment, wiring, identity checks, protection seeding and the demo LP deposit (Arc Testnet only). */
import { keccak256, type Address, type Hex } from 'viem'

import { ADDR, balances, loadAccount, publicAddress, publicClient } from '../smoke/common'
import { getCoreRecord, loadCore, runTx, setCoreRecord } from './journal'
import { ART, SMOKE_VENUE, chainNow, data, deployData, erc20ApproveData, jsonLine, jsonSafe, link, paramBig, pool, quoteBuy, rd, type Addresses } from './lib'

const ZERO = '0x0000000000000000000000000000000000000000' as Address
const FRICTION = 300n
const DUST = 10_000n
const CEILING = 1_000_000n
const CAP = 100_000n
const MAX_AGE = 86_400n
const REF_PRICE = 100_000n * 1_000_000n

const log = jsonLine

export async function preflight(): Promise<void> {
  const pc = publicClient()
  const chainId = await pc.getChainId()
  if (chainId !== 5042002) throw new Error('wrong chain ' + chainId)
  for (const [name, a] of Object.entries(ADDR)) {
    const code = await pc.getCode({ address: a })
    if (!code || code === '0x') throw new Error('no code at ' + name)
  }
  const dec = async (a: Address) => (await pc.readContract({ address: a, abi: [{ type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' }], functionName: 'decimals' }))
  const decimals = { usdc: await dec(ADDR.usdc), cirBtc: await dec(ADDR.cirBtc) }
  if (decimals.usdc !== 6 || decimals.cirBtc !== 8) throw new Error('unexpected token decimals')
  const roles = ['deployer', 'trader', 'keeper'] as const
  const wallets: Record<string, unknown> = {}
  for (const r of roles) {
    loadAccount(r) // proves the key in .env matches deployments/demo-wallets.json (never printed)
    const b = await balances(pc, publicAddress(r))
    wallets[r] = { address: publicAddress(r), nativeWei: b.nativeWei.toString(), usdcAtoms: b.usdc.toString(), cirBtcAtoms: b.cirBtc.toString() }
  }
  const smokeEngine = await rd<Address>(SMOKE_VENUE, ART.venue.abi, 'engine')
  const p = await pool()
  const devBps = ((p.priceMicroPerBtc > REF_PRICE ? p.priceMicroPerBtc - REF_PRICE : REF_PRICE - p.priceMicroPerBtc) * 10_000n) / REF_PRICE
  const q = await quoteBuy(200_000n)
  const sizes = Object.fromEntries(Object.entries(ART).map(([k, v]) => [k, (v.deployedBytecode.object.length - 2) / 2]))
  const out = {
    chainId,
    decimals,
    wallets,
    smokeVenue: { address: SMOKE_VENUE, engine: smokeEngine, isTraderEoa: smokeEngine.toLowerCase() === publicAddress('trader').toLowerCase() },
    pool: { sqrtPriceX96: p.sqrtPriceX96, tick: p.tick, liquidity: p.liquidity, usdcPerBtcMicro: p.priceMicroPerBtc, deviationFromFixtureBps: devBps },
    buyQuote200000: q,
    runtimeBytes: sizes,
  }
  log('preflight', out)
  setCoreRecord('preflight', jsonSafe(out))
  if (devBps > 200n) throw new Error(`pool price is ${devBps} bps from the 100,000 fixture; align it before setting the reference`)
  if (smokeEngine.toLowerCase() !== publicAddress('trader').toLowerCase()) throw new Error('smoke venue is not bound to the trader EOA')
  for (const [k, n] of Object.entries(sizes)) if (n > 24_576) throw new Error(k + ' exceeds EIP-170')
}

/** Masks immutable slots in both codes and compares; returns the result for the public record. */
function identity(deployed: Hex, art: { deployedBytecode: { object: Hex; immutableReferences?: Record<string, Array<{ start: number; length: number }>> } }) {
  const mask = (hex: string) => {
    const chars = hex.slice(2).split('')
    for (const refs of Object.values(art.deployedBytecode.immutableReferences ?? {})) {
      for (const r of refs) for (let i = r.start * 2; i < (r.start + r.length) * 2; i++) chars[i] = '0'
    }
    return chars.join('').toLowerCase()
  }
  const a = mask(deployed)
  const b = mask(art.deployedBytecode.object)
  return { matchesCompiledRuntimeExceptImmutables: a === b, runtimeBytes: (deployed.length - 2) / 2, codeHash: keccak256(deployed) }
}

export async function deploy(): Promise<void> {
  await preflight()
  const dep = publicAddress('deployer')
  const partial = (getCoreRecord<Partial<Addresses>>('deploy.partial') ?? {})
  const save = (k: keyof Addresses, v: Address) => {
    partial[k] = v
    setCoreRecord('deploy.partial', partial)
  }
  const contractAt = (step: string): Address => {
    const a = loadCore().steps[step]?.contractAddress
    if (!a) throw new Error('no contract address for ' + step)
    return a
  }

  // 1. guard
  await runTx({ step: 'deploy.guard', label: 'Deploy DemoPriceGuard', role: 'deployer', data: deployData(ART.guard.abi, ART.guard.bytecode.object, [dep, MAX_AGE]) })
  const guard = contractAt('deploy.guard')
  if ((await rd<Address>(guard, ART.guard.abi, 'priceAdmin')).toLowerCase() !== dep.toLowerCase()) throw new Error('guard admin mismatch')
  if ((await rd<bigint>(guard, ART.guard.abi, 'maxAge')) !== MAX_AGE) throw new Error('guard maxAge mismatch')
  save('guard', guard)

  // 2. vault (guardian = treasury = deployer; engine bound later)
  await runTx({
    step: 'deploy.vault',
    label: 'Deploy MarginVault',
    role: 'deployer',
    data: deployData(ART.vault.abi, ART.vault.bytecode.object, [ADDR.usdc, dep, dep, dep, CEILING, CAP]),
  })
  const vault = contractAt('deploy.vault')
  const expectVault: Array<[string, unknown]> = [['usdc', ADDR.usdc], ['guardian', dep], ['treasury', dep], ['financingCeiling', CEILING], ['perAccountCap', CAP], ['primaryTarget', 4_000n], ['tailTarget', 6_000n]]
  for (const [fn, want] of expectVault) {
    const got = await rd<unknown>(vault, ART.vault.abi, fn)
    const ok = typeof want === 'bigint' ? got === want : String(got).toLowerCase() === String(want).toLowerCase()
    if (!ok) throw new Error(`vault.${fn} readback ${String(got)} != ${String(want)}`)
  }
  save('vault', vault)

  // 3. production venue (new; the smoke venue stays separate)
  await runTx({
    step: 'deploy.venue',
    label: 'Deploy V4SpotVenue (production)',
    role: 'deployer',
    data: deployData(ART.venue.abi, ART.venue.bytecode.object, [ADDR.poolManager, ADDR.usdc, ADDR.cirBtc, 3000, 60, dep]),
  })
  const venue = contractAt('deploy.venue')
  if (venue.toLowerCase() === SMOKE_VENUE.toLowerCase()) throw new Error('production venue equals the smoke venue')
  for (const [fn, want] of [['poolManager', ADDR.poolManager], ['usdc', ADDR.usdc], ['cirBtc', ADDR.cirBtc]] as Array<[string, Address]>) {
    if ((await rd<Address>(venue, ART.venue.abi, fn)).toLowerCase() !== want.toLowerCase()) throw new Error('venue.' + fn)
  }
  if (!loadCore().steps['wire.venue'] && (await rd<Address>(venue, ART.venue.abi, 'engine')) !== ZERO) throw new Error('venue engine must start unbound')
  save('venue', venue)

  // 4. engine
  await runTx({
    step: 'deploy.engine',
    label: 'Deploy TradeEngine',
    role: 'deployer',
    data: deployData(ART.engine.abi, ART.engine.bytecode.object, [vault, venue, guard, FRICTION, DUST]),
  })
  const engine = contractAt('deploy.engine')
  save('engine', engine)
  const eng = { vault, venue, guard: guard }
  for (const [fn, want] of Object.entries(eng)) {
    if ((await rd<Address>(engine, ART.engine.abi, fn)).toLowerCase() !== want.toLowerCase()) throw new Error('engine.' + fn)
  }
  if ((await rd<bigint>(engine, ART.engine.abi, 'frictionBps')) !== FRICTION || (await rd<bigint>(engine, ART.engine.abi, 'dust')) !== DUST) throw new Error('engine policy mismatch')

  // 5. bind exactly once on each side, then assert the wiring
  await runTx({ step: 'wire.venue', label: 'Venue bindEngine(engine)', role: 'deployer', to: venue, data: data(ART.venue.abi, 'bindEngine', [engine]) })
  await runTx({ step: 'wire.vault', label: 'Vault bindEngine(engine)', role: 'deployer', to: vault, data: data(ART.vault.abi, 'bindEngine', [engine]) })
  const wired =
    (await rd<Address>(venue, ART.venue.abi, 'engine')).toLowerCase() === engine.toLowerCase() &&
    (await rd<Address>(vault, ART.vault.abi, 'engine')).toLowerCase() === engine.toLowerCase() &&
    (await rd<boolean>(engine, ART.engine.abi, 'isWired'))
  if (!wired) throw new Error('wiring assertions failed; the deployment is not recorded as actual')

  // identity: deployed runtime equals the compiled runtime except immutable slots
  const pc = publicClient()
  const ids: Record<string, unknown> = {}
  for (const [name, addr, art] of [['guard', guard, ART.guard], ['vault', vault, ART.vault], ['venue', venue, ART.venue], ['engine', engine, ART.engine]] as const) {
    const code = (await pc.getCode({ address: addr })) as Hex
    const r = identity(code, art)
    ids[name] = r
    if (!r.matchesCompiledRuntimeExceptImmutables) throw new Error(`${name} runtime differs from the compiled artifact`)
  }
  const termsHash = await rd<Hex>(engine, ART.engine.abi, 'termsHash')
  setCoreRecord('addresses', { guard, vault, venue, engine })
  setCoreRecord('identity', ids)
  setCoreRecord('termsHash', termsHash)
  log('deployed', { guard, vault, venue, engine, termsHash })

  // 6. reference price (after the pool alignment check in preflight)
  const observedAt = await paramBig('guard.observedAt', async () => (await chainNow()) - 3n)
  await runTx({ step: 'guard.update', label: 'DemoPriceGuard.update(100000 USDC per BTC)', role: 'deployer', to: guard, data: data(ART.guard.abi, 'update', [REF_PRICE, observedAt]) })

  // 7. protection seed (exact approval, then primary 4000 and tail 6000)
  await runTx({ step: 'seed.approve', label: 'USDC approve(vault, 10000)', role: 'deployer', to: ADDR.usdc, data: erc20ApproveData(vault, 10_000n) })
  await runTx({ step: 'seed.primary', label: 'seedProtection(Primary, 4000)', role: 'deployer', to: vault, data: data(ART.vault.abi, 'seedProtection', [0, 4_000n]) })
  await runTx({ step: 'seed.tail', label: 'seedProtection(Tail, 6000)', role: 'deployer', to: vault, data: data(ART.vault.abi, 'seedProtection', [1, 6_000n]) })

  // 8. demo LP: 1 USDC with the actual mandate hash, minShares = amount (first deposit is 1:1)
  const mandate = await rd<Hex>(vault, ART.vault.abi, 'MANDATE_HASH')
  await runTx({ step: 'lp.approve', label: 'USDC approve(vault, 1000000)', role: 'deployer', to: ADDR.usdc, data: erc20ApproveData(vault, 1_000_000n) })
  const dep1 = await runTx({ step: 'lp.deposit', label: 'Vault deposit 1 USDC', role: 'deployer', to: vault, data: data(ART.vault.abi, 'deposit', [1_000_000n, 1_000_000n, mandate]) })
  const state = await rd<Record<string, unknown>>(vault, ART.vault.abi, 'vaultState', [], BigInt(dep1.blockNumber ?? '0'))
  const guardRead = await rd<readonly [bigint, bigint, boolean]>(guard, ART.guard.abi, 'read', [], BigInt(dep1.blockNumber ?? '0'))
  log('vaultState', state)
  log('guardRead', guardRead)
  setCoreRecord('afterDeploy', jsonSafe({ vaultState: state, guard: guardRead, links: Object.fromEntries(Object.entries({ guard, vault, venue, engine }).map(([k, v]) => [k, link.address(v)])) }))
}
