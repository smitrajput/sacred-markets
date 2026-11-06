import manifest from '../deployments/arc-testnet.json' with { type: 'json' }

/** Public deployment manifest. Source of truth for which Sacred contracts exist; never invent an address. */
export function contractStatuses(): Record<string, 'undeployed' | 'deployed'> {
  const entries = Object.entries(manifest.sacredContracts as Record<string, { status: string }>)
  return Object.fromEntries(entries.map(([name, c]) => [name, c.status === 'deployed' ? 'deployed' : 'undeployed']))
}

export const NETWORK = manifest.network

type Entry = { address: string; deployBlock: number; deployTxHash: string; codeHash: string; policy?: Record<string, unknown> }

/** Verified deployed Sacred contracts from the manifest. Throws if the manifest does not describe a deployment. */
export function core() {
  const sc = manifest.sacredContracts as unknown as Record<string, Entry & { status: string }>
  const get = (key: string): Entry => {
    const e = sc[key]
    if (!e || e.status !== 'deployed') throw new Error('manifest: ' + key + ' is not deployed')
    return e
  }
  const vault = get('usdcEarn')
  const engine = get('cirBtcSpotFinancing')
  const guard = get('demoPriceGuard')
  const venue = get('productionVenue')
  return {
    vault: vault.address as `0x${string}`,
    engine: engine.address as `0x${string}`,
    guard: guard.address as `0x${string}`,
    venue: venue.address as `0x${string}`,
    deployBlock: BigInt(Math.min(vault.deployBlock, engine.deployBlock, guard.deployBlock, venue.deployBlock)),
    termsHash: String((engine.policy as { termsHash: string }).termsHash),
    entries: { vault, engine, guard, venue },
  }
}

export const EXTERNAL = manifest.externalContracts
export const UNISWAP = manifest.uniswapV4
export const EXPLORER = manifest.network.explorerUrl
