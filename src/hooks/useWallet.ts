import { erc20Abi } from 'viem'
import { arcTestnet } from 'viem/chains'
import { useAccount, useBalance, useReadContract } from 'wagmi'

import { CONTRACTS } from '@/lib/contracts'
import { spendableAtoms } from '@/lib/policy'

export function useWallet() {
  const { address, isConnected, chainId } = useAccount()
  const erc20 = useReadContract({ chainId: arcTestnet.id, address: CONTRACTS.usdc, abi: erc20Abi, functionName: 'balanceOf', args: address ? [address] : undefined, query: { enabled: !!address, refetchInterval: 12_000 } })
  const native = useBalance({ chainId: arcTestnet.id, address, query: { enabled: !!address, refetchInterval: 12_000 } })
  const usdcAtoms = erc20.data ?? 0n
  const nativeWei = native.data?.value ?? 0n
  return {
    address,
    isConnected,
    onArc: chainId === arcTestnet.id,
    usdcAtoms,
    nativeWei,
    spendable: spendableAtoms(usdcAtoms, nativeWei),
    loading: erc20.isLoading || native.isLoading,
    refetch: async () => {
      await Promise.all([erc20.refetch(), native.refetch()])
    },
  }
}
