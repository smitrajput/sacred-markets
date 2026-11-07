#!/usr/bin/env bun
/** `bun run demo ...` - bounded operator CLI for the live profit recording. See --help. Arc Testnet only; dedicated testnet wallets only. */
import { HELP, parseArgs } from './core/demoArgs'
import { Cancelled, prepareCmd, processCmd, riseCmd, statusCmd } from './core/demoCore'
import { LOCK_PATH, acquireLock, installCancel, liveEnv, verifyIdentity } from './core/demoLive'
import { Stop } from './core/journal'

async function main(): Promise<number> {
  let p
  try {
    p = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${HELP}`)
    return 2
  }
  if (p.cmd === 'help') {
    console.log(HELP)
    return 0
  }
  let release: (() => void) | undefined
  try {
    const env = liveEnv({ yes: p.yes, replan: p.replan })
    await verifyIdentity(env.a)
    if (p.cmd === 'status') {
      await statusCmd(env)
      return 0
    }
    if (!p.plan) {
      release = acquireLock(LOCK_PATH) // read-only plans never take the lock or write anything
      installCancel()
    }
    if (p.cmd === 'prepare') await prepareCmd(env, { planOnly: p.plan })
    else if (p.cmd === 'rise') await riseCmd(env, p.id!, { planOnly: p.plan })
    else await processCmd(env, { planOnly: p.plan })
    return 0
  } catch (e) {
    if (e instanceof Cancelled) {
      console.log('Cancelled. Nothing further was signed.')
      return 130
    }
    const m = (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, '<url>').slice(0, 600)
    console.error(e instanceof Stop ? m : `ERROR: ${m}`)
    return e instanceof Stop ? 3 : 1
  } finally {
    release?.()
  }
}

if (import.meta.main) process.exit(await main())
