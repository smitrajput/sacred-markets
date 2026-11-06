/** Decimal-string <-> bigint helpers. Money is never a JS number. USDC has 6 decimals, cirBTC 8, native gas 18. */

export const USDC_DECIMALS = 6
export const BTC_DECIMALS = 8
export const NATIVE_PER_USDC_ATOM = 1_000_000_000_000n // 18-decimal native gas vs 6-decimal ERC-20 view of the same USDC

/** Strict decimal parse: digits with an optional fraction no longer than `decimals`. Returns null for anything else. */
export function parseDecimal(input: string, decimals: number): bigint | null {
  const s = input.trim()
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null
  const [whole = '0', frac = ''] = s.split('.')
  if (frac.length > decimals) return null
  return BigInt((whole === '' ? '0' : whole) + frac.padEnd(decimals, '0'))
}

/** Exact formatting. Keeps up to `decimals` digits, trims trailing zeros but never below `minFrac`, and never rounds to zero. */
export function formatUnits(value: bigint, decimals: number, minFrac = 2): string {
  const neg = value < 0n
  const v = neg ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = (v / base).toString()
  let frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  if (frac.length < minFrac) frac = frac.padEnd(minFrac, '0')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${grouped}${frac ? '.' + frac : ''}`
}

export const usdc = (atoms: bigint) => formatUnits(atoms, USDC_DECIMALS)
export const btc = (atoms: bigint) => formatUnits(atoms, BTC_DECIMALS, 0)
export const toBig = (s: string | bigint | undefined): bigint => (s === undefined ? 0n : BigInt(s))

export const bpsToPercent = (bps: bigint) => `${bps / 100n}.${(bps % 100n).toString().padStart(2, '0')}%`

export const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function formatTime(unixSeconds: bigint): string {
  const d = new Date(Number(unixSeconds) * 1000)
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** Same instant in India Standard Time (UTC+5:30), for operators reading expiry times. */
export function formatIst(unixSeconds: bigint): string {
  const d = new Date(Number(unixSeconds) * 1000 + 19_800_000)
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} IST`
}
