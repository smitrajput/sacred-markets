# Checkpoint 02 boundaries: initial coverage and engine reentrancy

No economic code changed. The 190% initial-coverage guard is preserved exactly. Changes are test-side only (`EngineBase`, `MockSpotVenue`, `TradeEngine.open.t.sol`, `TradeEngine.rebalance.t.sol`) plus a corrected claim in `02-engine.md`.

## The reproduced fuzz failure was a real boundary, not a bug

`testFuzz_rebalance_restores190_orClosesCleanly` (args `[1245444331, 420098978722728347300953235495345]`, seed `0xfe64cf54...2021f`) hit `InitialCoverage(18987)` while opening. Root cause: BTC has 8 decimals, so at 100,000 USDC per BTC one atom is 1,000 micro-USDC; at small equities the floor of the purchased atoms can leave `value / (P + M)` under 190% even with zero execution cost. `02-engine.md` wrongly called the revert unreachable; it is corrected there.

## Classification (price 100,000 USDC per BTC, independent arithmetic in the tests)

| Equity E | Venue cost | Atoms | M | Coverage | Result |
| --- | --- | --- | --- | --- | --- |
| 10,486 | 0 | 20 | 40 | 19,000 bps | valid, opens |
| 10,487 | 0 | 20 | 40 | 18,998 bps | invalid, `InitialCoverage(18998)` |
| 10,499 | 0 | 20 | 40 | 18,977 bps | invalid, `InitialCoverage(18977)` |
| 10,500 | 0 | 21 | 40 | 19,924 bps | valid, opens |
| 10,000 | 300 bps | 19 (equals oracle minimum 19) | 38 | 18,928 bps | invalid, `InitialCoverage(18928)` |

(The brief's figure for the last row was 18,927; 190,000,000 / 10,038 floors to 18,928, which is what the engine returns and the test asserts.) The oracle minimum alone therefore does not guarantee 190%. Every rejection asserts a full rollback: idle cash, pending gross, commitments and pending opens unchanged, the trader paid nothing, the purchase undone at the venue, no BTC kept, no stranded engine USDC, no new position.

## Property tests

Both rebalance property tests that open arbitrary equity in 10,000 to 100,000 (`testFuzz_rebalance_restores190_orClosesCleanly`, `testFuzz_modeAndQuantityIgnoreTheCallerFloor`) now use `_openChecked`: it computes the expected initial coverage independently from the actual fixture execution (price and venue cost in force). If it is under 190%, the test expects the exact `InitialCoverage(bps)` revert, asserts the rollback and returns; otherwise the property continues. No `vm.assume`, no catch-all, no reseeding.

For the next phase: the UI quote must check initial coverage against the actual DEX output (quote the buy, compute value and `P + M`), not only the oracle minimum, and tell the user when a small equity would be rejected.

## Reentrancy regression (one adversarial venue test)

`MockSpotVenue` gained an optional hook that makes a nested call to a target while the engine is mid-operation. `test_reentrancy_nestedFinancialCallsDuringBuyAndSellAreRejected_outerCustodyIsCorrect`:
- during the purchase of a real `open`, the venue calls `open` and then `repay`; both are rejected with `ReentrancyGuardReentrantCall`, the outer opens complete, custody is clean (engine BTC equals pledged collateral, no stranded USDC, vault fully backed);
- during the sale of an `ownerClose`, the venue calls `repay` on the same position and a nested `ownerClose`; both are rejected, each outer close completes exactly once;
- when the venue forwards the nested revert, the whole outer `open` reverts and every balance and pending counter is rolled back.

## Results

| Command | Result |
| --- | --- |
| `forge test --match-test testFuzz_rebalance_restores190_orClosesCleanly --fuzz-seed 0xfe64cf541cf139a9a492c3490882768e3f623ffb588a97012742fee5ec52021f` | pass (256 runs) |
| both property tests at default 256 runs | pass |
| full vault + engine suites once: `forge test --match-path "contracts/test/{MarginVault,TradeEngine}.*.t.sol"` | **138 passed, 0 failed** (engine suites now 39 tests; vault 99, including the 5 invariants at 30,720 calls each) |
| `bun run check` | passes |

Runtime sizes unchanged (no source change): TradeEngine 14,753; MarginVault 13,678; DemoPriceGuard 937 (limit 24,576). The fork cases were not rerun (engine source untouched). Slither notes from the lead (balance-reentrancy under the root guard, strict-equality checks, guard timestamp via the freshness flag, default initialization) were not re-analysed. No deployment, no mutation or other analysis campaign.
