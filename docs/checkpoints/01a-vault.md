> Historical first pass. Lead review rejected its acquisition funding order and principal-only lifecycle; checkpoint 01b replaces those behaviors. This is not the final implementation specification.

# Checkpoint 01a: MarginVault deposits, share/NAV pricing, funding and caps

Scope: pure vault accounting with a unit-test engine stub. No deployment, no wallet use, no live transaction, no transaction hashes.
The demo wallet secrets were not read.

## Files

| Path | Role |
| --- | --- |
| `contracts/src/MarginVault.sol` | The vault (10,150 bytes runtime) |
| `contracts/src/interfaces/IMarginVaultEngine.sol` | Explicit engine surface: `IMarginVaultEngine` (vault side) and `IMarginEngineView.positionValue` (what the vault asks the engine) |
| `contracts/test/mocks/TestMarginEngine.sol` | Unit-test engine stub (forwards calls as the bound engine, holds gross cash, reports configurable values/freshness) |
| `contracts/test/VaultBase.sol` | Shared setup, demo sizing (ceiling 100, per-account cap 10) |
| `contracts/test/MarginVault.deposit.t.sol` | 21 tests: pricing, validation, pause, queue, donations, impairment gate |
| `contracts/test/MarginVault.funding.t.sol` | 21 tests: binding, seeding, reserve targets, limits, commitments, queue/pause gates, principal return |
| `contracts/test/MarginVault.model.t.sol` | 1 randomized test against an independent in-test model |

## What is implemented

- NAV = `depositorIdleCash + outstandingPrincipal` from recorded buckets only. Donations change nothing. Buckets are separate: idle, outstanding, commitments (a subset of idle until confirmed), manager cash, primary, tail, backstop, claimable.
- `deposit(amount, minShares, mandateHash)`: fixed mandate hash (`MANDATE_HASH`, a keccak of the 2x / 14-day / 10% / 77-23 / collected-only / no-late-growth / no-trader-profit terms), paused and queue gates, impairment scan, 1:1 initial funding only with supply 0, no recorded assets, nothing live or pending, then `floor(amount*totalShares/NAV)` at pre-deposit NAV with nonzero-share and `minShares` checks, zero-NAV rejection, actual-received check.
- `requestWithdraw(shares)`: enqueue only. Locks shares (they stay in supply) in one global queue. Processing, claims and burns are 01b.
- Origination (`reserveOpen`): not paused, queue empty, fewer than 32 live plus pending, both reserve targets met, ceiling, 95% of NAV, per-account cap (all counting commitments), net idle after opening at least 5% of NAV, lendable cash at least the principal, and physical free cash at least gross 2P. Effects (commitment, exposure, pending count, position) are recorded before the equity is pulled and the gross cash is sent. `confirmOpen` and `cancelOpen` finish it and work while paused.
- Reserve targets are 0.4% and 0.6% of the immutable ceiling: 0.4 and 0.6 USDC at ceiling 100, 0.004 and 0.006 at ceiling 1. `seedProtection(kind, amount)` is treasury-only, pulls real USDC, increments only its bucket, never touches shares or NAV. Backstop is optional and never counts toward the targets.
- Guardian `setFundingPaused` blocks new deposits and originations only. Principal repayment, confirm/cancel of existing reservations stay open.
- Engine accounting surface: `repayPrincipal` (cash in, idle up, outstanding down, closes at zero), `creditLpMarkup` (cash in, idle up) and `writeOffPrincipal` (no cash, outstanding down). The last two are the NAV primitives that 01c will sit behind (77/23 split, replenishment order, loss waterfall).
- `vaultState()`, `nav()`, `financingHeadroom()`, `isFullyBacked()`, `liveCount()`/`liveIdAt()`.
- Impairment gate: before a deposit the vault scans the live positions (at most 32) via `positionValue(id)`. A stale price reverts `StalePrice(id)`. A value strictly below the position's remaining principal reverts `AccountingNeedsSettlement(id)`. Repayment is never gated.

## Decisions for review

1. Stale prices also block deposits. The brief names reservations and distributions for stale prices; a deposit needs the same fresh scan to price safely, so it is blocked too.
2. `requestWithdraw` exists now only because deposits and originations are gated on an unfilled queue and had to be tested through a public entry point.
3. `creditLpMarkup` and `writeOffPrincipal` exist now so share pricing against a moved NAV can be tested through public entry points. 01c routes the 77/23 split and the loss waterfall into them.
4. No impairment scan on origination, as the brief lists none there. The engine's own fresh-price requirement covers it.
5. The 95% and 5% idle rules are the same inequality while NAV is only idle plus principal. Both are coded; the 95% check fires first.
6. Trader equity equals principal (exposure is exactly 2x). `reserveOpen` pulls it, then sends 2P to the engine, so net vault outflow is P. `cancelOpen` takes back only the vault's P; the engine keeps the trader's equity for refund.

## Tests actually run

| Command | Result |
| --- | --- |
| `forge test` (standard Forge, fork directory skipped by config) | 83 passed, 0 failed (43 new) |
| `forge test --match-path "contracts/test/MarginVault.*.t.sol" --fuzz-runs 1000` | 43 passed |
| `bun run check` | passed |

Independent expectations are hand-computed in each test (for example 21 USDC at NAV 105 / 100 shares gives exactly 20 shares; 9 USDC after a 10 USDC loss gives exactly 10 shares; 3 shares, NAV 4, deposit 5 gives 3). The randomized test replays 40 random steps per run (deposit, open, repay, markup, write-off, donation) against a separate model and compares every bucket, share balance, position and the physical cash.

Targeted fault injection (8 faults, source restored and diffed): utilisation 95 to 96, account cap `>` to `>=`, share rounding up, ceiling ignoring commitments, gate `<` to `<=`, tail target 0.6 to 0.5, queue check dropped on open, pause ignored on deposit. All 8 made at least one test fail.

## Not covered yet (by design or by reach)

- Zero-NAV rejection with shares outstanding is coded but cannot be reached through public entries until withdrawals exist (01b).
- FIFO processing, claims, dust and zero-NAV write-offs, worthless-share burns and the last-share guard (01b).
- Treasury/manager buckets routing, replenishment order, loss waterfall and engine-only markup/loss accounting (01c).
- No audit or Slither pass in this checkpoint. Reentrancy: state-changing functions use a guard, USDC is pulled with a received-amount check.
