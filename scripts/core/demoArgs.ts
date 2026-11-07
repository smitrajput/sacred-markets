// Strict argument parsing for the demo CLI (pure; importing it never touches wallets or the network).
export type Cmd = 'status' | 'prepare' | 'rise' | 'process'
export interface Parsed { cmd: Cmd | 'help'; id?: bigint; plan: boolean; yes: boolean; replan: boolean }

const ALLOWED: Record<Cmd, string[]> = {
  status: [],
  prepare: ['--plan', '--yes', '--replan'],
  rise: ['--plan', '--yes', '--replan'],
  process: ['--plan', '--yes'],
}

export const helpFor = (cmd: string): string => `Sacred demo operator (Arc Testnet only, dedicated testnet wallets only)

  ${cmd} status                    read-only: pool, reference, vault, positions, funds, readiness
  ${cmd} prepare --plan            read-only plan for restoring the pool to ~80,000 and refreshing the reference
  ${cmd} prepare                   sign the plan after you type PREPARE
  ${cmd} rise <positionId>         raise the pool and reference to 100,000 for YOUR position (type RISE <id>); add --plan to preview
  ${cmd} process                   optional one-shot withdrawal-queue processing by the keeper wallet (type PROCESS)

Flags: --plan (never signs or writes)  --yes (skip the typed confirmation; authorised operators only)  --replan (replace ONE expired, never-signed plan)
This tool never signs for the browser wallet and never loops or runs on a timer. There is no way to choose a journal path or reset an episode.`
export const HELP = helpFor('bun run demo')

export function parseArgs(argv: string[]): Parsed {
  const out: Parsed = { cmd: 'help', plan: false, yes: false, replan: false }
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') return out
  const cmd = argv[0] as Cmd
  if (!(cmd in ALLOWED)) throw new Error(`unknown command "${argv[0]}". Try: bun run demo --help`)
  const rest = argv.slice(1)
  const positional: string[] = []
  for (const a of rest) {
    if (a.startsWith('--')) {
      if (!ALLOWED[cmd].includes(a)) throw new Error(`flag ${a} is not valid for "${cmd}"`)
      if (a === '--plan') out.plan = true
      if (a === '--yes') out.yes = true
      if (a === '--replan') out.replan = true
    } else positional.push(a)
  }
  if (out.plan && out.yes) throw new Error('--plan never signs, so --yes makes no sense with it')
  if (cmd === 'rise') {
    if (positional.length !== 1) throw new Error('rise needs exactly one position ID, e.g. `bun run demo rise 5`')
    if (!/^[1-9][0-9]{0,9}$/.test(positional[0])) throw new Error(`"${positional[0]}" is not a valid position ID (a plain positive whole number)`)
    out.id = BigInt(positional[0])
  } else if (positional.length) throw new Error(`"${cmd}" takes no positional argument (got "${positional[0]}")`)
  out.cmd = cmd
  return out
}
