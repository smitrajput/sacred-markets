# Checkpoint 01b: FIFO withdrawals, claims, dust, zero NAV, last-share guard (with the two 01a corrections)

Vault code and tests only. No deployment, no live transaction, no transaction hashes. Live pool and smoke receipts untouched. 01c (manager buckets, markup split, loss waterfall) is not done.

## 01a corrections (lead review)

1. **Funding sequence.** `reserveOpen` no longer receives equity. It requires recorded free depositor cash (idle minus pending gross) of at least `2P`, records the principal commitment and a separate `pendingGrossCash` (`2P`), then sends the whole gross `2P` to the engine out of depositor idle cash. Recorded idle, and therefore NAV, are unchanged while the open is pending; the physical-backing check now excludes pending gross. `confirmOpen` pulls the trader equity `P` only after the engine's acquisition, then records net idle `-P` and outstanding `+P`. `cancelOpen` pulls back the full gross `2P`. Reserves, manager cash, claims, backstop and donations never count as lendable. While any open is pending, deposits, processing and worthless burns revert `PendingOpensBlockAccounting`. The stub engine now follows the real order (reserve, acquire, equity arrives, confirm) and never mints equity before the reserve.
2. **Lifecycle.** Reducing remaining principal to zero (repayment or write-off) no longer removes the position, because markup may still be owed. New engine-only `finalizePosition(id)` requires recorded principal zero, removes the position from the bounded live set exactly once (swapped indexes stay correct), and fails on duplicates. It and repayment are never price-gated. The impairment scan skips zero-principal positions, since nothing is at risk.

Regressions added (`MarginVault.funding.t.sol`): idle 15 / principal 10 rejects even with engine funds, protection reserves, a backstop and a donation present; idle 20 / principal 10 opens with no prior equity and confirm then receives exactly 10; a cancelled pending purchase returns the full 20; an atomic open whose equity never arrives reverts every step (balances, commitments, pending gross and the position id all unchanged, and the id can be reused); principal fully repaid keeps the live count; finalization removes exactly once, rejects non-zero principal, duplicates and reserved positions, and works with stale or impaired prices. The independent randomized model was corrected for both bugs and now also exercises finalization.

## What 01b implements

- `requestWithdraw`: locks shares (they stay in supply), one global queue, no cancel or reinsert, at most 64 unfilled requests (`TooManyRequests`), slot freed only when a request completes. Requesting is allowed while an open is pending (it only locks shares).
- `processWithdrawals(maxRequests)`: permissionless; zero reverts; more than 16 is clamped to 16 attempts; an empty queue returns 0 without scanning. Reverts while an open is pending, and on `AccountingNeedsSettlement` or `StalePrice` before any cash is reserved (zero-value burns included). Not affected by the funding pause.
- Per attempt on the oldest request, with `Math.mulDiv` throughout:
  - Residual worth nothing (`NAV == 0` or `floor(residual*NAV/supply) == 0`): burn it for zero, emit `WithdrawalDustWrittenOff`, advance. Decided before the idle check, so it works at zero idle.
  - Otherwise `burn = min(residual, floor(idle*supply/NAV))`, `payout = floor(burn*NAV/supply)`; idle zero, `burn == 0` or a partial `payout == 0` returns without mutation. Cash is moved from idle to the owner's reserved balance and shares are burned; the head advances only when the request is complete. Partial fills keep the head and its priority; the next call recomputes against the new NAV and supply.
- `claim()`: pays only `msg.sender`'s reserved balance, zeroed before the transfer, nonReentrant, no pause or price requirement, never touches NAV.
- `burnWorthlessShares(shares)`: the holder's own unlocked shares, only at NAV zero, blocked while an open is pending.
- Last-share guard: while any position is live (including P=0 with markup owed) `totalShares` stays at least one. Regular fills are capped at `supply - 1` with the payout recomputed; dust and zero-NAV burns are capped the same way (the residual then waits for settlement); worthless burns revert `LastShareGuard`. Once all positions are finalized the final share redeems or burns normally, and initial funding is allowed again at supply zero.
- `vaultState()` now also reports `pendingGrossCash` and `activeRequests`; `financingHeadroom()` includes the free-cash limit.

## Tests (standard Forge, default 256 fuzz runs, each relevant suite run once)

Vault suites: 76 tests, all passing. `forge test` for the whole project (fork directory excluded by config): 117 passed, 0 failed. `bun run check` passed.

| Suite | Tests | Covers |
| --- | --- | --- |
| `MarginVault.deposit.t.sol` | 21 | 01a pricing, gates, donations (updated for lifecycle) |
| `MarginVault.funding.t.sol` | 29 | Origination limits, the new funding order, cancellation, atomic rollback, finalization, caps |
| `MarginVault.fifo.t.sol` | 12 | Immediate fill, claim, NAV-priced payout, donations ignored, partial fills limited by idle, repayment funding the head, strict order across three requests, 16-attempt bound, 64-request cap, claims during pause/stale/impairment, processing gated by impairment and stale price but not pause, pending-open gates, hostile callers |
| `MarginVault.guards.t.sol` | 12 | Dust write-off (also at zero idle and as the tail of a partial fill), waiting kept separate from dust (zero idle; idle worth less than one share), rounding favouring the vault, total loss through to re-initialisation, worthless-share burns, last-share guard with P=0/M>0 then full request, final markup and final claim |
| `MarginVault.model.t.sol` | 1 | Independent model of buckets and positions |
| `MarginVault.invariants.t.sol` | 1 | 40-step random sequences over every entry point incl. the queue; after each step: custody, NAV, share and claim conservation, locked shares equal queued shares, active count, 64 cap, no orphaned live position, outstanding equals the sum of positions |

Expected values are hand-computed in each test (examples: 80 requested at idle 60 burns exactly 60, then 15, then 5 as repayments arrive; with NAV 5 over 10 shares one share is dust and three shares pay exactly 1; sole LP with P=0 gets 9,999,999, then 77,000 of markup arrives and the last share collects 10,077,000 in total). Effects are asserted (balances, queue, shares, claimable), not getter echoes.

One deliberate-break check was run on the randomized invariant test only (it caught a one-share supply error immediately); the source was restored and diffed. No mutation campaign.

## Notes for review

1. Processing, deposits and burns are blocked while an open is pending; requestWithdraw is not.
2. `maxRequests > 16` is clamped rather than rejected.
3. Initial funding with a live position (the `InvalidInitialState` branch for live positions) cannot be reached through public calls, because the guard keeps supply at one while any position is live. It remains as defence in depth. The branch for pre-recorded assets is tested.
4. A partial dust burn under the guard leaves a zero-value residual at the head until the last position is finalized (tested).
5. Engine duties for 02: perform reserve, acquisition, resale, equity receipt and confirm in one transaction; call `finalizePosition` only after full debt settlement or write-off.
