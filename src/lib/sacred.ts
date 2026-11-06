import manifestJson from '../../deployments/arc-testnet.json'

export type VerifiedContract = {
  status: 'verified'
  address: `0x${string}`
  standard: 'ERC20'
  symbol: string
  name: string
  decimals: number
}

export type SacredContract = {
  status: 'undeployed' | 'deployed'
  description: string
  address: `0x${string}` | null
}

export type Manifest = {
  schemaVersion: number
  project: string
  network: {
    name: string
    chainId: number
    rpcUrl: string
    explorerUrl: string
    nativeGas: { symbol: string; decimals: number; note: string }
  }
  externalContracts: { usdc: VerifiedContract; cirBTC: VerifiedContract }
  sacredContracts: Record<string, SacredContract>
  roles: Record<string, `0x${string}` | null>
}

export const manifest = manifestJson as Manifest

export const addressUrl = (address: string) => `${manifest.network.explorerUrl}/address/${address}`

export const shortAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`
