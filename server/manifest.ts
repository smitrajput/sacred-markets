import manifest from '../deployments/arc-testnet.json' with { type: 'json' }

/** Public deployment manifest. Source of truth for which Sacred contracts exist; never invent an address. */
export function contractStatuses(): Record<string, 'undeployed' | 'deployed'> {
  const entries = Object.entries(manifest.sacredContracts as Record<string, { status: string }>)
  return Object.fromEntries(entries.map(([name, c]) => [name, c.status === 'deployed' ? 'deployed' : 'undeployed']))
}

export const NETWORK = manifest.network
