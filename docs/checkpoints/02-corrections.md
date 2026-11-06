# Checkpoint 02 corrections (before deployment)

Nothing deployed, no economic parameter changed. Three focused fixes after the lead's engine review.

## 1. Keeper oversell (confirmed present, fixed)

`TradeEngine._plan` used the caller's floor to compute the worst-case remaining principal, so a larger `minUsdc` could push the plan from partial to a full sale (repro: 195 atoms, 80,000 price, P 100,000, M 383, dust 10,000: intrinsic plan is a 52-atom partial with floor 40,352; `callerMin = 91,000` made the worst-case remaining principal 9,000 < dust and flipped it to a 195-atom full sale that could pay about 151,320 and succeed).

Fix: partial feasibility, mode and quantity are now computed from the position, the captured reference and the independent oracle floor only (`worstPaid = min(oracleFloor, principal)`). After the mode and quantity are chosen, `minUsdc = max(callerMin, floor)`. A stricter caller floor can now only make the chosen execution revert. The actual-output dust fallback is unchanged and remains engine-controlled (it depends on what the venue really paid, never on a caller choice).

Tests: `test_callerFloor_neverChangesModeOrQuantity_andAnOversizedFloorRevertsWithoutStateChange` (quote with caller floor 0, 40,352, 91,000 and max: always partial, 52 atoms, gross 41,196, `minUsdc = max(floor, 40,352)`; a real `rebalance` with 91,000 reverts and leaves principal 100,000, collateral 195, vault outstanding and engine BTC unchanged, zero sells) and `testFuzz_modeAndQuantityIgnoreTheCallerFloor` (256 runs: eligibility, mode, quantity and gross identical for any caller floor).

## 2. Origination now respects impairment (vault)

`MarginVault._checkOrigination` calls `_requireNoImpairment()` after the pause and queue checks, so no new exposure opens against an existing live position that is below its remaining principal or has a stale price. Repayment, finalization, release and claims still never read the oracle. No parameter changed.

Tests: vault level `test_origination_isBlockedByAnImpairedOrStaleLivePosition_andRecoversAfterRepayment` (impaired and stale both block `reserveOpen`; repayment under a stale price works; a repayment that brings remaining principal back under the value unblocks it) and engine level `test_open_isBlockedWhileAnExistingPositionIsImpaired_andRecoversAfterRepayment` (price falls to 40,000, second trader's `open` reverts `AccountingNeedsSettlement` with nothing pending; a third-party repayment of 25,000 restores cover and the open succeeds).

## 3. Handler burnWorthless

`MarginVault.handler.t.sol`: the `burnWorthlessShares` catch now treats only `LastShareGuard` as benign; any other revert is counted as a failed call.

## Evidence (each run once, default 256 fuzz and invariant runs)

| Command | Result |
| --- | --- |
| `forge test --match-path "contracts/test/{MarginVault,TradeEngine}.*.t.sol"` (complete vault + engine suites incl. handler invariants, 30,720 calls each, 5 to 8 reverts per run) | **136 passed, 0 failed** |
| `bash scripts/test-arc-fork.sh --threads 1 --match-path contracts/test/fork/TradeEngine.fork.t.sol` | **2 passed** |
| `bun run check` | passes |

Runtime bytecode (EIP-170 limit 24,576): TradeEngine 14,753; MarginVault 13,678; DemoPriceGuard 937; V4SpotVenue 7,230 (unchanged). Venue suites were not rerun.

Not done: no mutation or fault-injection campaign, no deployment, no oracle push.
