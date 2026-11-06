import { preflight, deploy } from './deploy'
import { fifo, flow1, flow2, prep2, release, status } from './rehearse'

const cmd = process.argv[2]
const table: Record<string, () => Promise<void>> = { preflight, deploy, flow1, prep2, flow2, fifo, release, status }

async function main(): Promise<void> {
  const fn = cmd ? table[cmd] : undefined
  if (!fn) throw new Error('usage: bun scripts/core/run.ts <' + Object.keys(table).join('|') + '>')
  await fn()
}
main().catch((e: unknown) => {
  const msg = (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, '<url>').slice(0, 800)
  console.error(msg)
  process.exit(1)
})
