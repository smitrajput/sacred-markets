// Screen-recording-safe, human-readable units (testnet). No raw bigints in user output.
const group = (s: string): string => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const dec = (v: bigint, d: number, shown: number, trim = false): string => {
  const neg = v < 0n
  const a = neg ? -v : v
  const base = 10n ** BigInt(d)
  let frac = (a % base).toString().padStart(d, '0').slice(0, shown)
  if (trim) frac = frac.replace(/0+$/, '')
  return `${neg ? '-' : ''}${group((a / base).toString())}${frac ? '.' + frac : ''}`
}
/** micro-USDC -> "0.000383 USDC" (6 decimals, small debts are never rounded to zero). */
export const usdc = (micro: bigint): string => `${dec(micro, 6, 6)} USDC`
/** cirBTC satoshi-units (8 decimals). */
export const btc = (sats: bigint): string => `${dec(sats, 8, 8)} cirBTC`
/** micro-USDC per whole BTC -> "80,000.00 USDC per cirBTC". */
export const price = (microPerBtc: bigint): string => `${dec(microPerBtc, 6, 2)} USDC per cirBTC`
/** native 18-decimal USDC (gas currency) with 6 shown. */
export const native = (wei: bigint): string => `${dec(wei, 18, 6)} USDC`
export const pct = (bps: bigint): string => `${bps >= 0n ? '+' : '-'}${dec(bps < 0n ? -bps : bps, 2, 2)}%`
export const utc = (unix: bigint): string => new Date(Number(unix) * 1000).toISOString().replace('.000Z', 'Z')
export const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`
export const explorerTx = (h: string): string => `https://explorer.testnet.arc.io/tx/${h}`
/** basis points as a plain ratio, e.g. 19684 -> "196.84%" (coverage). */
export const ratio = (bps: bigint): string => `${dec(bps, 2, 2)}%`
