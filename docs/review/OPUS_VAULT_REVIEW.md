# Vault protection review — November 6

Scope: frozen MarginVault, engine interface and invariant handler after Studio checkpoint01c. Codex independently passed all98 vault tests. Claude Opus5.5 reviewed the bounded source snapshot without tools. This is a focused review, not an audit or production sign-off.

## Findings and lead decisions

1. **Origination does not scan existing impaired positions.** Confirmed behavior: deposit and withdrawal reservation scan live positions, while reserveOpen only checks liquidity, caps and reserves. The reviewer called this a high-severity specification violation because the review brief shortened “withdrawal cash reservation” to “reservation.” The actual spec §4.1 only mandates the gate for deposits, withdrawal reservations and distributions; the claimed direct spec violation is therefore rejected. Nevertheless, blocking fresh lending while another position is impaired is a useful, small defense. Pending integration correction: extend the scan to origination and test stale/impaired existing positions. New engine opens already require their own fresh reference.
2. **Handler coverage gaps.** The handler uses healthy price marks; freshness/impairment behavior is covered by separate unit cases, not randomized mark transitions. Its pending-open invariants only inspect completed atomic opens; pending accounting is separately tested in funding tests and must never persist in the production engine. These are coverage limits, not evidence that the deployed application violates conservation. Accepted focused correction: count unexpected burnWorthless reverts instead of treating every failure as a benign skip. Keep the existing targeted stale/impairment tests; add the origination regressions with the guard.

## Confirmed checks

- Gross2P advance and subsequent P equity receipt conserve custody.
- FIFO ordering, partial-zero-payout waiting, whole worthless residual handling and the last-share guard agree with the approved design.
- Cumulative77/23 rounding, reserve replenishment and final-loss priority agree with independent examples.
- Handler campaign:4,000 calls;2,194 reached the vault;0 unexpected reverts. Randomized invariants exercise30,720 calls each at256 runs/depth120, with recorded custody plus donations equal token holdings.

## Engine integration conditions

The engine must keep opens atomic, value every live position including P0/M>0, return actual principal proceeds before final loss, cap markup to the fixed remaining amount, and finalize only after all debt and collateral are settled. Vault markup splitting is authoritative; the engine must not allocate it a second time.

Status: protection implementation verified; the two focused hardening edits above are queued for the next Studio correction before deployment. No vault deployment yet.
