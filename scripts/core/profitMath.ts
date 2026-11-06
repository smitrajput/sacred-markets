// Pure arithmetic for the bounded profit-demo operator (no I/O). Pool: USDC (token0, 6 dec) / cirBTC (token1, 8 dec), fee 3000 pips.
export const Q96 = 1n << 96n
export const FEE_PIPS = 3000n
export const MILLION = 1_000_000n

export const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b

export function isqrt(n: bigint): bigint {
  if (n < 2n) return n
  let x = n
  let y = (x + 1n) >> 1n
  while (y < x) {
    x = y
    y = (x + n / x) >> 1n
  }
  return x
}

/** micro-USDC per whole BTC implied by a sqrtPriceX96 (token1 atoms per token0 atom = sqrt^2 / 2^192). */
export const priceFromSqrt = (sqrt: bigint): bigint => (10n ** 8n * (1n << 192n)) / (sqrt * sqrt)
export const sqrtForPrice = (priceMicroPerBtc: bigint): bigint => isqrt(((10n ** 8n) << 192n) / priceMicroPerBtc)

/** Signed deviation of `price` from `target` in basis points (truncated toward zero). */
export const devBps = (price: bigint, target: bigint): bigint => ((price - target) * 10_000n) / target

/** cirBTC atoms (gross of the pool fee) to SELL so the pool price falls to `target` (needs sqrt to rise). 0 when already at or below target. */
export function restoreSellAtoms(sqrt0: bigint, liquidity: bigint, target: bigint): { net: bigint; gross: bigint } {
  const sqrt1 = sqrtForPrice(target)
  if (sqrt1 <= sqrt0) return { net: 0n, gross: 0n }
  const net = (liquidity * (sqrt1 - sqrt0)) / Q96
  return { net, gross: ceilDiv(net * MILLION, MILLION - FEE_PIPS) + 1n }
}

/** micro-USDC (gross of the pool fee) to BUY so the pool price rises to `target`. 0 when already at or above target. */
export function buyUsdcNeeded(sqrt0: bigint, liquidity: bigint, target: bigint): { net: bigint; gross: bigint } {
  const sqrt1 = sqrtForPrice(target)
  if (sqrt1 >= sqrt0) return { net: 0n, gross: 0n }
  const net = ceilDiv(liquidity * Q96 * (sqrt0 - sqrt1), sqrt0 * sqrt1)
  return { net, gross: ceilDiv(net * MILLION, MILLION - FEE_PIPS) }
}

const max = (a: bigint, b: bigint): bigint => (a > b ? a : b)
/** Sell minimum: the stricter of the independent reference floor (97% of the nominal value) and 99.5% of the real quote. */
export const minOutSell = (atoms: bigint, quoteUsdc: bigint, refPrice: bigint): bigint => max((((atoms * refPrice) / 10n ** 8n) * 9700n) / 10_000n, (quoteUsdc * 995n) / 1000n)
/** Buy minimum: the stricter of the independent reference floor (97% of the nominal atoms) and 99.5% of the real quote. */
export const minOutBuy = (usdcIn: bigint, quoteAtoms: bigint, refPrice: bigint): bigint => max((((usdcIn * 10n ** 8n) / refPrice) * 9700n) / 10_000n, (quoteAtoms * 995n) / 1000n)

/** What the owner would net from selling all pledged BTC at the live quote, before gas: payout = quote - debt; profit = payout - original equity. */
export function cashout(quoteUsdc: bigint, debt: bigint, equity: bigint): { payout: bigint; profit: bigint } {
  const payout = quoteUsdc > debt ? quoteUsdc - debt : 0n
  return { payout, profit: payout - equity }
}
