/**
 * Explicit operator refresh of the testnet DemoPriceGuard (a fixture, not a production oracle).
 *
 *   bun scripts/push-price.ts --guard 0x... --price 100000                 # dry run: reads, simulates, prints the plan
 *   bun scripts/push-price.ts --guard 0x... --price 100000 --broadcast     # signs and sends exactly one update
 *
 * There is no implicit spot refresh: the price is whatever the operator passes, in whole USDC per whole BTC
 * (converted to micro-USDC). The signer is the price-admin wallet (SACRED_DEPLOYER_PRIVATE_KEY, read inside this
 * process only, never printed). The script refuses to sign unless the connected chain is Arc Testnet (5042002),
 * the guard has code, and guard.priceAdmin() equals the signer. After the receipt it reads the guard back.
 */
import { parseArgs } from 'node:util'
import { encodeFunctionData, getAddress, isAddress, parseAbi, parseUnits, type Address } from 'viem'

import {
  CHAIN_ID,
  GWEI,
  arcChain,
  assertArcChain,
  feeParams,
  loadAccount,
  publicClient,
  walletClient,
} from './smoke/common'

const guardAbi = parseAbi([
  'function priceAdmin() view returns (address)',
  'function maxAge() view returns (uint256)',
  'function read() view returns (uint256 price, uint256 timestamp, bool fresh)',
  'function update(uint256 newPrice, uint256 newTimestamp)',
])

const MIN_PRICE = 1_000_000n // 1 USDC per BTC in micro-USDC
const MAX_PRICE = 10_000_000_000_000n // 10,000,000 USDC per BTC

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      guard: { type: 'string' },
      price: { type: 'string' },
      'observed-at': { type: 'string' },
      broadcast: { type: 'boolean', default: false },
    },
  })
  if (!values.guard || !isAddress(values.guard)) throw new Error('--guard <address> is required')
  if (!values.price) throw new Error('--price <USDC per whole BTC> is required (there is no implicit refresh)')
  const guard: Address = getAddress(values.guard)
  const price = parseUnits(values.price, 6)
  if (price < MIN_PRICE || price > MAX_PRICE) throw new Error('price is outside the guard domain')

  const pc = publicClient()
  await assertArcChain(pc)
  const code = await pc.getCode({ address: guard })
  if (!code || code === '0x') throw new Error('no contract code at the guard address on chain ' + CHAIN_ID)

  const account = loadAccount('deployer')
  const admin = await pc.readContract({ address: guard, abi: guardAbi, functionName: 'priceAdmin' })
  if (admin.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`signer ${account.address} is not the guard's priceAdmin ${admin}`)
  }
  const block = await pc.getBlock()
  const observedAt = values['observed-at'] ? BigInt(values['observed-at']) : block.timestamp
  if (observedAt > block.timestamp) throw new Error('observed-at is in the future')

  const before = await pc.readContract({ address: guard, abi: guardAbi, functionName: 'read' })
  const data = encodeFunctionData({ abi: guardAbi, functionName: 'update', args: [price, observedAt] })
  await pc.call({ account: account.address, to: guard, data }) // a revert aborts before any signature
  const gas = ((await pc.estimateGas({ account: account.address, to: guard, data })) * 12n) / 10n
  const fees = await feeParams(pc)
  if (fees.maxFeePerGas < 20n * GWEI) throw new Error('maxFeePerGas below the 20 gwei floor')

  console.log(
    JSON.stringify({
      mode: values.broadcast ? 'broadcast' : 'dry-run',
      chainId: CHAIN_ID,
      guard,
      signer: account.address,
      priceMicroUsdc: price.toString(),
      observedAt: observedAt.toString(),
      previous: { price: before[0].toString(), timestamp: before[1].toString(), fresh: before[2] },
      gas: gas.toString(),
      maxFeePerGas: fees.maxFeePerGas.toString(),
    }),
  )
  if (!values.broadcast) return

  const wc = walletClient(account)
  const hash = await wc.sendTransaction({
    account,
    chain: arcChain,
    to: guard,
    data,
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  })
  const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 120_000 })
  if (receipt.status !== 'success') throw new Error(`update reverted: ${hash}`)
  const after = await pc.readContract({ address: guard, abi: guardAbi, functionName: 'read', blockNumber: receipt.blockNumber })
  if (after[0] !== price || after[1] !== observedAt) throw new Error('read-back does not match the update')
  console.log(
    JSON.stringify({
      txHash: hash,
      block: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      readBack: { price: after[0].toString(), timestamp: after[1].toString(), fresh: after[2] },
    }),
  )
}

main().catch((e: unknown) => {
  // never print URLs or request bodies: they can carry the RPC token
  const msg = (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, '<url>').slice(0, 400)
  console.error('push-price failed:', msg)
  process.exit(1)
})
