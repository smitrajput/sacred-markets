import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buyUsdcNeeded, cashout, devBps, minOutBuy, minOutSell, priceFromSqrt, restoreSellAtoms, sqrtForPrice } from './profitMath'

const P80 = 80_000n * 1_000_000n
const P100 = 100_000n * 1_000_000n

test('sqrt <-> price round trip stays within one part in a million', () => {
  const p = priceFromSqrt(sqrtForPrice(P80))
  assert.ok(devBps(p, P80) === 0n && (p > P80 ? p - P80 : P80 - p) < P80 / 1_000_000n)
})

test('restore sizing reproduces the independent fork estimate (pool 82860.893, L 884452 -> ~547 atoms)', () => {
  const s0 = sqrtForPrice(82_860_893_000n)
  const r = restoreSellAtoms(s0, 884_452n, P80)
  assert.ok(r.gross >= 545n && r.gross <= 549n, `got ${r.gross}`)
  assert.equal(restoreSellAtoms(sqrtForPrice(79_000_000_000n), 884_452n, P80).gross, 0n, 'already below target: no sell')
})

test('buy sizing is positive only below the target, grows with the gap and lands the price at the target', () => {
  const L = 884_452n
  const s80 = sqrtForPrice(P80)
  const a = buyUsdcNeeded(s80, L, P100)
  assert.ok(a.gross > 0n)
  assert.equal(buyUsdcNeeded(sqrtForPrice(P100), L, P100).gross, 0n)
  assert.ok(buyUsdcNeeded(sqrtForPrice(70_000n * 1_000_000n), L, P100).gross > a.gross)
  // adding `net` USDC to constant liquidity moves sqrt down by net*sqrt0^2/(L*Q96 + net*sqrt0): the resulting price must be ~100k
  const sqrt1 = (L * (1n << 96n) * s80) / (L * (1n << 96n) + a.net * s80)
  assert.ok(devBps(priceFromSqrt(sqrt1), P100) >= -2n && devBps(priceFromSqrt(sqrt1), P100) <= 2n)
})

test('minimums take the stricter of the independent floor and 99.5% of the quote', () => {
  assert.equal(minOutSell(547n, 443_721n, P80), (443_721n * 995n) / 1000n) // quote rule binds
  assert.equal(minOutSell(547n, 1n, P80), (((547n * P80) / 10n ** 8n) * 9700n) / 10_000n) // floor binds
  assert.equal(minOutBuy(2_761_982n, 2_000n, P100), (((2_761_982n * 10n ** 8n) / P100) * 9700n) / 10_000n)
})

test('cashout matches the independently verified fork result', () => {
  // fork: ownerClose paid 141887 microUSDC surplus to the owner after debt 100383 => quote = 242270; profit = 141887 - 100000 = 41887
  const c = cashout(242_270n, 100_383n, 100_000n)
  assert.equal(c.payout, 141_887n)
  assert.equal(c.profit, 41_887n)
  assert.equal(cashout(50_000n, 100_383n, 100_000n).profit, -100_000n)
})
