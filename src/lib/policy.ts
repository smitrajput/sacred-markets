/**
 * Pure arithmetic mirroring the deployed contracts, used for quotes and pre-flight checks in the UI.
 * The contracts remain the authority; these functions only warn before signing. All bigint.
 */
export const BPS = 10_000n
export const ATOMS_PER_BTC = 100_000_000n
export const TERM_SECONDS = 1_209_600n
export const FRICTION_BPS = 300n
export const DUST_ATOMS = 10_000n
export const INITIAL_COVERAGE_BPS = 19_000n
export const GAS_RESERVE_ATOMS = 100_000n // 0.10 USDC kept for gas on every wallet

export const markupFor = (principal: bigint) => (principal * 1_000n * TERM_SECONDS) / (10_000n * 31_536_000n)
export const atomsForUsdc = (usdc: bigint, price: bigint) => (usdc * ATOMS_PER_BTC) / price
export const valueOf = (atoms: bigint, price: bigint) => (atoms * price) / ATOMS_PER_BTC
export const afterFriction = (v: bigint, f: bigint = FRICTION_BPS) => (v * (BPS - f)) / BPS
export const saleFloor = (atoms: bigint, price: bigint, f: bigint = FRICTION_BPS) => afterFriction(valueOf(atoms, price), f)
export const coverageBps = (value: bigint, debt: bigint) => (debt === 0n ? 0n : (value * BPS) / debt)

export type OpenProblem =
  | 'invalid_amount'
  | 'below_dust'
  | 'over_account_cap'
  | 'over_vault_headroom'
  | 'stale_reference'
  | 'no_quote'
  | 'quote_below_reference_floor'
  | 'initial_coverage_below_190'
  | 'insufficient_balance'

export interface OpenInput {
  equity: bigint
  price: bigint
  priceFresh: boolean
  quoteAtoms: bigint | null
  accountHeadroom: bigint
  vaultHeadroom: bigint
  spendable: bigint
}
export interface OpenCheck {
  principal: bigint
  gross: bigint
  markup: bigint
  debt: bigint
  referenceAtoms: bigint
  referenceFloor: bigint
  executionMin: bigint
  quotedValue: bigint
  coverageBps: bigint
  problems: OpenProblem[]
}

/** Initial coverage is measured on the ACTUAL quoted output, not on the oracle floor (the contract does the same). */
export function checkOpen(i: OpenInput): OpenCheck {
  const principal = i.equity
  const gross = principal * 2n
  const markup = markupFor(principal)
  const debt = principal + markup
  const referenceAtoms = i.price > 0n ? atomsForUsdc(gross, i.price) : 0n
  const referenceFloor = afterFriction(referenceAtoms)
  const q = i.quoteAtoms ?? 0n
  const executionMin = q > referenceFloor ? q : referenceFloor
  const quotedValue = i.price > 0n ? valueOf(q, i.price) : 0n
  const cov = coverageBps(quotedValue, debt)
  const problems: OpenProblem[] = []
  if (principal <= 0n) problems.push('invalid_amount')
  else {
    if (principal < DUST_ATOMS) problems.push('below_dust')
    if (principal > i.accountHeadroom) problems.push('over_account_cap')
    if (principal > i.vaultHeadroom) problems.push('over_vault_headroom')
    if (principal > i.spendable) problems.push('insufficient_balance')
    if (!i.priceFresh) problems.push('stale_reference')
    if (i.quoteAtoms === null) problems.push('no_quote')
    else {
      if (q < referenceFloor || referenceFloor === 0n) problems.push('quote_below_reference_floor')
      if (cov < INITIAL_COVERAGE_BPS) problems.push('initial_coverage_below_190')
    }
  }
  return { principal, gross, markup, debt, referenceAtoms, referenceFloor, executionMin, quotedValue, coverageBps: cov, problems }
}

export const PROBLEM_TEXT: Record<OpenProblem, string> = {
  invalid_amount: 'Enter an amount.',
  below_dust: 'The minimum is 0.01 USDC.',
  over_account_cap: 'This is above your remaining account limit.',
  over_vault_headroom: 'The vault cannot finance this size right now. Try a smaller amount.',
  stale_reference: 'Trading is paused until the reference price is refreshed.',
  no_quote: 'No quote is available for this size. Try a smaller amount.',
  quote_below_reference_floor: 'The pool price has moved away from the reference price. Try again shortly or use a smaller amount.',
  initial_coverage_below_190: 'At this size the purchase would start below 190% coverage. Try a slightly different amount.',
  insufficient_balance: 'Not enough USDC. 0.10 USDC is kept back for network fees.',
}

/** Shares minted for a deposit at current NAV (first deposit is 1:1). Contract rounds down. */
export const sharesForDeposit = (amount: bigint, totalShares: bigint, nav: bigint) =>
  totalShares === 0n ? amount : nav === 0n ? 0n : (amount * totalShares) / nav

export const usdcForShares = (shares: bigint, totalShares: bigint, nav: bigint) => (totalShares === 0n ? 0n : (shares * nav) / totalShares)

/** Balance that may be spent while keeping the gas reserve. Native gas (18 decimals) is the same USDC as the ERC-20 view. */
export function spendableAtoms(erc20Atoms: bigint, nativeWei: bigint, reserve: bigint = GAS_RESERVE_ATOMS): bigint {
  const fromNative = nativeWei / 1_000_000_000_000n
  const total = erc20Atoms < fromNative ? erc20Atoms : fromNative
  return total > reserve ? total - reserve : 0n
}

/** 1-based place in the global FIFO queue of a request id, given the queue head. */
export const queuePlace = (requestId: bigint, head: bigint) => requestId - head + 1n
