# Solidity static analysis — November6

Tool: Slither0.11.6, invoked through the existing `uv` runtime using the [official installation guidance](https://github.com/crytic/slither). Command:

```sh
uvx --from slither-analyzer slither . --filter-paths 'lib/|node_modules/|contracts/test/|contracts/script/' --exclude-dependencies --json /private/tmp/sacred-slither-02.json
```

Analysis succeeded. Sacred-source reports:6High,13Medium,12Low and5Informational. These are detector labels, not6confirmed high-severity vulnerabilities. Each high/medium category was reviewed against the fixed deployment dependencies and reachable callers.

| Detector | Count | Disposition |
|---|---:|---|
| arbitrary-send-erc20 (High) |1|Venue pulls from its one-time bound engine only. The entrypoint verifies `msg.sender == engine`; the payer is not caller-selectable. Existing unauthorized-call and callback tests cover the boundary.|
| reentrancy-balance (High)|5|Intentional before/after balance measurements around the fixed vault/venue. All financial engine entrypoints are `nonReentrant`; the venue has its own busy/single-callback protections. Values are checked for exact acquisition/sale deltas. An explicit malicious-venue callback regression passed independently, covering nested open, repay and close during buys/sells and full rollback on a forwarded failure.|
| incorrect-equality (Medium)|3|Exact zero checks distinguish worthless whole residuals from partial zero payouts and no liquidity. These checks enforce the specified FIFO rounding behavior and have separate tests.|
| reentrancy-no-eth (Medium)|2|Venue resets `_busy` only after its authenticated callback completes; nested swaps fail while busy. Engine writes its acquired position after purchase under the root reentrancy guard. Read-only views can observe intermediate state, but cannot mutate it; vault pending-open checks block cash repricing/reservation.|
| uninitialized-local (Medium)|2|Solidity initializes the local Boolean tofalse and the memory context tozero. The context fields are assigned before use. No uninitialized storage pointer.|
| unused-return (Medium)|6|Price timestamp is deliberately omitted where the guard's `fresh` Boolean already applies the bound. `coverageBps` is diagnostic and does not enforce freshness; callers must read/show freshness separately. Solvency actions use guarded references.|

Low/informational results are bounded external scans and FIFO writes, expected deadline/maturity/freshness timestamp comparisons, and event/state ordering under the same guards. Live scans are capped at32 and processing at16requests. A stale fixture deliberately blocks price-dependent actions; repayment and reserved claims remain independent.

Conclusion: no supported high/medium code defect remained from these detector reports after review. This statement is scoped to the supplied contracts and trusted immutable dependencies; it is not an audit or a production safety claim. The separately reproduced keeper-sizing defect and small-open test-domain correction are documented in `ENGINE_REVIEW.md`.
