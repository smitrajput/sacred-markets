# Opus adapter review — November 6

Model confirmed by CLI result: `claude-opus-5-5`, high effort. Tool-free review of a fixed allowlisted code/test bundle; no repository writes, tests or transactions executed by Claude. It reported no high/medium-severity exploitable issue within the stated trusted-engine/PoolManager/token scope. This is a bounded review, not an audit.

Codex dispositions:

1. **Accept focused test:** existing tampered-callback test changes the second callback after pending state is cleared. Add a first-callback mutation test for amount, direction and minOut; require authenticated hash rejection and unchanged balances. No production defect demonstrated.
2. **Accept focused test:** add fractional native-USDC dust to engine/venue/PoolManager on the real Arc fork and prove exact ERC20 deltas survive buy/sell. Integer transfer arithmetic suggests safety; test the runtime directly.
3. **Already partly covered:** reviewer lacked `forkAdversarial` in its bundle; `test_donatedBalancesNeverLeakIntoExecution` already covers cirBTC donation. Combine USDC donation coverage with item 2, without a duplicate suite.
4. **Defer diagnostic-only change:** malicious-token balance increases can cause arithmetic panic before a custom error. Atomic rollback still applies and the fixed supported tokens do not rebase. Not a release blocker.
5. **Existing engine acceptance criterion:** use 6/8-decimal amounts and exact per-operation venue approval; cover it when implementing TradeEngine. No engine exists at this checkpoint, so this is not a current engine finding.

All 68 adapter tests independently passed across the full run and targeted RPC-error retry before these two extra checks. Add accepted cases during the next venue/smoke checkpoint; no broad mutation campaign or unrelated redesign is required.
