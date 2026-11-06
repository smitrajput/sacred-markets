# Lead verification: live v4 smoke (November 6)

Status: accepted as a live integration checkpoint. Sacred vault and engine remain undeployed.

- Read all 12 transaction receipts directly from the public Arc Testnet RPC: all succeeded, and all block numbers match Studio's evidence.
- Independently decoded buy/sell calldata and venue Swapped logs. Buying with 200,000 USDC atoms returned 195 cirBTC atoms; selling those 195 atoms returned 197,898 USDC atoms. Both met the submitted minimum output.
- Read trader native-USDC balances at each receipt block and its preceding block. After accounting for gas, the exact USDC movement matched the trade amounts. Combined gas for all 12 transactions was 0.0692811925824 USDC; the trader's four transactions used 0.0105570175824 USDC. Native and ERC20 USDC are one balance.
- Independently reran the first-callback tampering regression and real Arc-fork fractional-dust/donation regression: one pass each. TypeScript check passed. The prior 68 adapter checks plus these two now total 70; this is not an audit claim.
- Source review confirms the fixed pool, bounded approvals, deadline, minimum output, chain check and public-only journal. No local signing or repeated live transactions occurred.

## Transaction journal follow-up

`scripts/smoke/common.ts` records a hash after broadcasting. A crash between broadcast and the journal write leaves an uncertain step; its “exactly once” comment is stronger than its guarantee. Completed steps were independently verified and no duplicate occurred.

Before reusing this helper for unattended deployment or keeper restarts, persist the nonce and intent before broadcast, then reconcile pending/latest nonces and receipts before retrying. Pause on ambiguity. The existing success shortcut also trusts the saved journal rather than rereading the receipt. These limitations do not invalidate the verified transactions.

Reproduction and evidence: `docs/checkpoints/00b-smoke.md`, `deployments/smoke-state.json`, and `scripts/smoke/`. No keys were pulled or used locally. The reference price and faucet-funded full-range liquidity are specific to this testnet demo.
