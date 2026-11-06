// Read-only check of deployments/arc-testnet.json against the live chain.
// Usage: bun run verify:onchain
import { createPublicClient, erc20Abi, http, keccak256 } from 'viem'
import manifest from '../deployments/arc-testnet.json' with { type: 'json' }

const client = createPublicClient({ transport: http(manifest.network.rpcUrl) })
let failed = false
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) failed = true
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${detail}`)
}

const chainId = await client.getChainId()
check('chain id', chainId === manifest.network.chainId, `${chainId} (expected ${manifest.network.chainId})`)
console.log(`block ${await client.getBlockNumber()}`)

for (const [key, t] of Object.entries(manifest.externalContracts)) {
  const code = await client.getCode({ address: t.address as `0x${string}` })
  const size = code ? (code.length - 2) / 2 : 0
  check(`${key} bytecode`, size > 0, `${size} bytes`)
  if (code) {
    check(`${key} code hash`, keccak256(code) === t.verification.codeHash, keccak256(code))
  }
  const read = (functionName: 'symbol' | 'name' | 'decimals') =>
    client.readContract({ address: t.address as `0x${string}`, abi: erc20Abi, functionName })
  const [symbol, name, decimals] = await Promise.all([read('symbol'), read('name'), read('decimals')])
  check(`${key} symbol`, symbol === t.symbol, String(symbol))
  check(`${key} name`, name === t.name, String(name))
  check(`${key} decimals`, decimals === t.decimals, String(decimals))
}

for (const [key, c] of Object.entries(manifest.sacredContracts)) {
  check(`${key} manifest`, c.status === 'undeployed' && c.address === null, `${c.status}, address ${c.address}`)
}
process.exit(failed ? 1 : 0)
