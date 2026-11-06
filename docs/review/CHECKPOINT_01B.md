# Vault/FIFO lead review (November 6)

The initial 01a pass had 43 passing tests but two semantic defects: trader equity arrived before asset acquisition, and full principal repayment removed positions even when markup remained. Codex identified both against the approved specification and directed Studio to correct them before any deployment.

01b source review confirms that the vault now advances gross 2P from recorded depositor cash before receiving equity; pending gross cash and principal commitments are separate. Confirmation receives equity P, cancellation returns 2P, and the production engine must keep the whole sequence atomic. Principal reduction no longer closes the position; explicit engine finalization requires principal zero.

FIFO review covers request locking, 64 active requests, 16 attempts per processing call, persistent partial-head priority, reserved pull claims, dust/zero-NAV treatment and last-share protection. A request may lock shares during an existing pending open, while share pricing, cash reservation and worthless-share burning remain blocked until confirmation or cancellation. Clamping maxRequests to 16 is accepted.

Independent verification: `forge test --match-path 'contracts/test/MarginVault.*.t.sol' -v` passed all 76 tests, including two randomized sequence suites with 256 seeds each. These are not yet the final handler-driven invariant suite; protection accounting is checkpoint 01c.

Two small reconciliations are queued in 01c: scan freshness for every live position even when remaining principal is zero, and use full-precision mulDiv for deposit share conversion. Repayments, finalization and already-reserved claims stay independent of the price feed. No vault or engine has been deployed.
