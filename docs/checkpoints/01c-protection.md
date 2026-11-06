# Checkpoint 01c: protection, collected-markup accounting and the final-loss waterfall

Vault code and tests only. Not deployed; no transaction hashes. The FIFO queue and the reviewed gross-acquisition sequence are unchanged. Green tests are evidence, not a production safety claim.

## One narrow engine accounting API

`IMarginVaultEngine` now has exactly: `reserveOpen`, `confirmOpen`, `cancelOpen`, `repayPrincipal`, `recordCollectedMarkup(id, payment)`, `settleFinalLoss(id)`, `finalizePosition(id)`. The raw `creditLpMarkup` and `writeOffPrincipal` primitives are removed from the vault, the interface and the stub. There is no admin rescue, no manager withdrawal and no way to move reserves out; USDC exits through gross purchase funding to the engine and depositor claims; there is no management withdrawal entry point.

- **`recordCollectedMarkup(id, payment)`** (engine only, position must be live, principal may be zero; allowed while paused or stale). The vault pulls exactly `payment` USDC (received amount is checked) and does the split itself: `lpTotal = floor(cumulativeCollected * 7700 / 10000)` per position, `lpIncrement = lpTotal - lpAllocatedBefore`, `manager = payment - lpIncrement`. The LP increment goes to depositor idle cash (so NAV). The manager part refills primary to 0.4% of the immutable ceiling, then tail to 0.6%, and any excess becomes locked `managerCash`. The vault computes the split rather than trusting an engine-supplied one, so a faulty engine cannot misallocate it; the engine only reports the actual payment. No principal/surplus splitting. Event `MarkupCollected` per payment.
- **`settleFinalLoss(id)`** (engine only, live position, remaining principal above zero). The engine first returns any sale proceeds with `repayPrincipal`; the remaining principal is the gross shortfall. It draws primary, then tail, then the optional pilot backstop, then LP NAV. Covered principal moves from the reserve bucket into depositor idle cash; uncovered principal only reduces outstanding principal and credits nothing. Manager cash is never drawn. Remaining principal becomes zero and the position stays live until `finalizePosition`. Event `FinalLossSettled(id, gross, fromPrimary, fromTail, fromBackstop, uncoveredLpLoss)` is emitted every time, including when everything is covered. A second call reverts `NoShortfall`.
- Funding is blocked while either target is depleted; only the treasury's real `seedProtection` restores a bucket (no NAV or shares). Manager cash never satisfies a reserve minimum.

## Two lead-review fixes in this checkpoint

1. `_requireNoImpairment` again scans every live position, including principal zero with markup owed: a stale price on a P=0 position blocks deposits and withdrawal reservations (`StalePrice`). Repayment, collected markup, final loss, finalization and claims of already-reserved cash never consult the oracle. Regression: `test_gate_scansPrincipalZeroPositionsToo_...` in the deposit suite.
2. Deposit share conversion uses `Math.mulDiv`.

## Independent tests (hand-computed, ceiling 1000 unless noted)

| Check | Result asserted |
| --- | --- |
| Targets at ceiling 1000 | primary 4, tail 6 |
| Principal 500, proceeds 480 | gross shortfall 20; primary 4 + tail 6 + backstop 5 cover 15; LPs lose 5 (NAV 1100 to 1095); markup 0; event fields; reserves empty; custody exact |
| Fully covered loss | event still emitted with uncovered 0; NAV unchanged; backstop 200 to 160 |
| No protection left | first loss covered 10 of 100, second falls on LPs in full (NAV 1100 to 1010 to 910) |
| Collected markup on P=500 | payment 1,917,808 (500 x 10% x 14/365, independently computed); LP 1,476,712; manager 441,096; exactly 1,917,808 USDC arrives |
| Rounding across payments | 1,000,000 + 500,000 + 417,808 gives the same LP total 1,476,712; atom case 3 then 3 gives LP 2 then 2, manager 1 then 1 |
| Reserve deficits take priority | with both buckets empty, three payments of 20 give (primary 4, tail 0.6, cash 0), then (4, 5.2, 0), then (4, 6, 3.8); partial primary deficit of 3 refills exactly 3 and locks 1.6 |
| Manager cash | persists, is not lendable, is not NAV, is untouched by losses, and cannot satisfy the reserve minimum |
| Authority and lifecycle | non-engine calls revert; zero payment, double loss, double finalization and markup after closure revert; markup and loss need a live position |
| Exact transfers | fee-on-transfer token makes markup and repayment revert `TransferShort` with nothing changed |
| Pause, stale, impaired | repayment, markup, final loss and finalization all still work |
| Donations | never enter a bucket; custody equality holds with them |
| Demo ceiling 1 | targets 0.004 and 0.006; 0.10 principal gives markup 383 atoms, LP 294, manager 89; shortfall 0.01 is covered entirely by primary 0.004 and tail 0.006 |

## Test suites and results (default 256 runs, each relevant suite once)

`forge test --match-path "contracts/test/MarginVault.*.t.sol"`: **98 passed, 0 failed** (deposit 21, funding 29, fifo 12, guards 12, protection 17, model 1, handler 6). Existing tests were migrated to the new API with recomputed numbers (the 1 USDC of protection now absorbs the first losses; a `_drainReserves` helper spends it when a test needs a fully uncovered loss). One test was removed: the "recorded assets with zero supply" initial-funding case is no longer reachable now that markup needs a live position.

The randomized model test was rewritten: it tracks LP cash, principal, primary, tail, backstop, manager cash, per-position cumulative markup and LP allocation with its own arithmetic, includes seeding and donations, and asserts exact custody after each of 40 steps.

**Handler-driven invariants** (`MarginVault.handler.t.sol`, 256 runs x depth 120 = 30,720 calls per invariant, 12 bounded actions). Actors are pre-funded and pre-approved; only the configured USDC is used. Actions check their preconditions first. Invariants: share and queue conservation (locked shares equal queued shares, 64 cap, claimable sums to the reserved total); recorded buckets plus explicit donations equal token custody exactly; outstanding principal equals the sum over live positions including P=0 with markup owed, account exposure matches, a live position always has a share; reserved minus claimed equals what remains claimable (no claim debited twice) and reserves, manager cash, claims and donations are not NAV; and flags raised inside the handler if its independently computed share price, 77/23 split and replenishment order, loss waterfall, claim payout, fill cash flow or seeding-without-NAV-change ever disagreed with the vault. `afterInvariant` fails any run whose handler revert rate exceeds 5%.

Call statistics from the deterministic campaign test (4,000 handler calls, run with -vv): 2,194 reached the vault, 1,806 skipped on unmet preconditions, **0 reverts**. Successes: requestWithdraw 408, deposit 296, process 244, markup 197, repay 176, open 154, finalLoss 147, finalize 146, claim 138, donate 87, seedProtection 74, setPaused 69, reserveThenCancel 58. The campaign asserts minimum counts per action. In the invariant runs Foundry reports 4 to 13 reverts per 30,720 calls (about 0.03%). `burnWorthlessShares` is in the handler but NAV never reaches zero in these runs, so that path stays covered by the guards suite.

## Runtime size (EIP-170)

`MarginVault` runtime 13,670 bytes (limit 24,576), initcode 14,491 bytes (limit 49,152). No blocker.

## Not done or open

- No audit, Slither pass, deployment or mutation campaign in this checkpoint; venue suites were not rerun.
- The vault does not cap collected markup per position; the engine owns the fixed-at-open amount and must pass only actual payments.
- Engine duties for 02: reserve, acquisition, resale, equity receipt and confirm in one transaction; return proceeds with `repayPrincipal` before `settleFinalLoss`; call `finalizePosition` only after all debt and collateral are settled.
