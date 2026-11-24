/** wagmi configuration: Arc Testnet only, injected wallet only (no WalletConnect project key, no mainnet or ENS). */
import { http, createConfig } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'

export const config = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(),
  },
})
