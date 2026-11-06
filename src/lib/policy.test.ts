import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatUnits, parseDecimal, usdc } from './format'
import { checkOpen, markupFor, sharesForDeposit, spendableAtoms, usdcForShares, queuePlace, saleFloor } from './policy'

const P100K = 100_000_000_000n
const base = { price: P100K, priceFresh: true, accountHeadroom: 100_000n, vaultHeadroom: 1_000_000n, spendable: 10_000_000n }

test('decimal parsing is strict and exact', () => {
  assert.equal(parseDecimal('0.10', 6), 100_000n)
  assert.equal(parseDecimal('.5', 6), 500_000n)
  assert.equal(parseDecimal('1', 6), 1_000_000n)
  assert.equal(parseDecimal('0.0000001', 6), null, 'too many decimals')
  for (const bad of ['', '.', '-1', '1e3', '1,5', '0x10', 'abc']) assert.equal(parseDecimal(bad, 6), null, bad)
})

test('small debt is shown to 6 decimals and never rounds to zero', () => {
  assert.equal(usdc(383n), '0.000383')
  assert.equal(usdc(100_383n), '0.100383')
  assert.equal(usdc(100_000n), '0.10')
  assert.equal(usdc(1n), '0.000001')
  assert.equal(formatUnits(1_234_567_890n, 6), '1,234.56789')
})

test('markup, debt and the policy vectors', () => {
  assert.equal(markupFor(100_000n), 383n)
  assert.equal(markupFor(500_000_000n), 1_917_808n)
  const c = checkOpen({ ...base, equity: 100_000n, quoteAtoms: 195n })
  assert.equal(c.markup, 383n)
  assert.equal(c.debt, 100_383n)
  assert.equal(c.referenceAtoms, 200n)
  assert.equal(c.referenceFloor, 194n)
  assert.equal(c.coverageBps, 19_425n)
  assert.deepEqual(c.problems, [])
})

test('initial coverage is checked on the ACTUAL quote: E=10487 buying 20 atoms meets the oracle floor but fails 190%', () => {
  const ok = checkOpen({ ...base, equity: 10_486n, quoteAtoms: 20n })
  assert.equal(ok.coverageBps, 19_000n)
  assert.deepEqual(ok.problems, [])
  const bad = checkOpen({ ...base, equity: 10_487n, quoteAtoms: 20n })
  assert.equal(bad.referenceFloor, 19n)
  assert.ok(bad.quotedValue > 0n && 20n >= bad.referenceFloor, 'the quote meets the reference floor')
  assert.equal(bad.coverageBps, 18_998n)
  assert.deepEqual(bad.problems, ['initial_coverage_below_190'])
  assert.deepEqual(checkOpen({ ...base, equity: 10_499n, quoteAtoms: 20n }).problems, ['initial_coverage_below_190'])
  assert.deepEqual(checkOpen({ ...base, equity: 10_500n, quoteAtoms: 21n }).problems, [])
})

test('every recoverable open problem is reported before signing', () => {
  assert.deepEqual(checkOpen({ ...base, equity: 0n, quoteAtoms: null }).problems, ['invalid_amount'])
  assert.ok(checkOpen({ ...base, equity: 9_999n, quoteAtoms: 19n }).problems.includes('below_dust'))
  assert.ok(checkOpen({ ...base, equity: 100_001n, quoteAtoms: 200n }).problems.includes('over_account_cap'))
  assert.ok(checkOpen({ ...base, equity: 100_000n, quoteAtoms: 200n, vaultHeadroom: 50_000n }).problems.includes('over_vault_headroom'))
  assert.ok(checkOpen({ ...base, equity: 100_000n, quoteAtoms: 200n, priceFresh: false }).problems.includes('stale_reference'))
  assert.ok(checkOpen({ ...base, equity: 100_000n, quoteAtoms: null }).problems.includes('no_quote'))
  assert.ok(checkOpen({ ...base, equity: 100_000n, quoteAtoms: 150n }).problems.includes('quote_below_reference_floor'))
  assert.ok(checkOpen({ ...base, equity: 100_000n, quoteAtoms: 200n, spendable: 99_999n }).problems.includes('insufficient_balance'))
})

test('gas reserve: native gas and ERC-20 USDC are the same funds; 0.10 USDC stays', () => {
  assert.equal(spendableAtoms(5_000_000n, 5_000_000n * 10n ** 12n), 4_900_000n)
  assert.equal(spendableAtoms(5_000_000n, 99_999n * 10n ** 12n), 0n)
  assert.equal(spendableAtoms(0n, 0n), 0n)
  assert.equal(spendableAtoms(1_000_000n, 600_000n * 10n ** 12n + 123n), 500_000n, 'native fraction below one atom is ignored')
})

test('earn arithmetic: shares at NAV, estimate on withdrawal, queue place', () => {
  assert.equal(sharesForDeposit(1_000_000n, 0n, 0n), 1_000_000n)
  assert.equal(sharesForDeposit(21_540_000n, 100_000_000n, 107_700_000n), 20_000_000n)
  assert.equal(sharesForDeposit(5n, 3n, 4n), 3n, 'floors like the contract')
  assert.equal(usdcForShares(100_000n, 1_000_000n, 1_000_294n), 100_029n)
  assert.equal(queuePlace(5n, 5n), 1n)
  assert.equal(queuePlace(7n, 5n), 3n)
})

test('sale floor mirrors the engine: floor(floor(atoms*price/1e8)*9700/10000)', () => {
  assert.equal(saleFloor(52n, 80_000_000_000n), 40_352n)
})
