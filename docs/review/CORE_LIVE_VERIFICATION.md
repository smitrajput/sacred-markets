# Independent live core verification — November 6

Codex performed 55 read-only checks against the public Arc Testnet RPC after Studio's deployment and rehearsal. All passed. This is integration evidence, not an audit.

- Chain identity: 5042002. All four deployed runtimes match the reviewed local compiler output after masking immutable slots; bindings and policy getters were checked separately.
- All 29 journal transactions have successful receipts. Signer, nonce, block and calldata hash match the public journal.
- Full repayment: at block 71033777, LP idle and NAV are 1000294 atoms, manager cash 89, principal zero, primary 4000 and tail 6000. Engine acquisition / resale / pledge / open and repayment / release events were decoded independently.
- Keeper: at block 71033997, 52 BTC atoms sold for 40612 USDC atoms. Position 2 retains principal 59388, markup 383, collateral 143 and coverage 19139 bps. No dust fallback or rounding tolerance was used.
- FIFO: request leaves shares and NAV intact; fill burns 100000 shares and reserves 100029 cash. Claim leaves NAV 900265 and supply 900000 unchanged, clears the reserved liability, and pays exactly 100029 atoms after accounting for the receipt's actual gas fee.

Public source evidence: [manifest](../../deployments/arc-testnet.json), [transaction journal](../../deployments/core-state.json), [live checkpoint and explorer links](../checkpoints/02-live.md).

The operator journal also received a source review. Before reusing it in the keeper, the app checkpoint must bind resumed steps to destination and actual signer, require the expected nonce for an identical-hash resend, and add mocked recovery tests. No failure injection was performed on the live chain. Completed rehearsal commands are historical scenarios, not a generic reset button: rerunning a completed scenario can stop on its changed preconditions without sending another transaction.
