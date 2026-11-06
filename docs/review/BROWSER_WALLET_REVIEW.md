# Connected-wallet deposit failure

The founder’s screenshot showed a connected MetaMask account, 20 test USDC and no deposit blocker. Pressing Deposit for 0.10 returned “Connect a wallet first” without an approval prompt. At 2026-11-06T14:41:37Z, independent public reads returned zero vault allowance, zero latest/pending nonce, zero shares and the original balance. The attempt stopped before signing.

## Reproduction and correction

`useAction` previously required the reactive `useWalletClient().data` before constructing any runner dependencies. Its absence, including loading or query failure, was treated as disconnection. That also made the runner’s network-switch path unreachable for a wallet whose client could not be created on its current chain.

Studio rendered the real hook using a real Wagmi configuration and a scripted wallet in a temporary DOM harness. It observed the false connection message for client delay, wrong chain and provider initialization failure. After the correction, the same harness reached one signing request, switched when needed, classified setup failures, stopped on disconnect/account change and suppressed three rapid duplicate clicks. No real wallet or network transaction was used by the harness. [Studio result](STUDIO_WALLET_FIX_RESULT.json).

The action now takes its running guard before awaiting preparation and resolves the current connector’s signing client at action time. It verifies account and chain, switches to Arc when required, and revalidates before approval/send. Receipt recovery and confirmed-data refresh use public reads without requiring a signing client. Exact approvals, persisted hashes and authoritative refresh remain intact.

## Independent validation and deployment

- Codex reproduced the unsupported-network client failure with the installed Wagmi implementation and a deterministic connector, and verified that switching before obtaining the client resolves it with zero signing calls.
- `bun test src/lib/wallet.test.ts src/lib/txRunner.test.ts src/lib/refresh.test.ts`: 28 passed, zero failed. Eight wallet regressions are new. Contract suites were not repeated.
- `bun run check` and `bun run build`: passed. Existing dependency annotation and bundle-size warnings remain.
- All five implementation/test files match the reviewed Studio download exactly. Commit: `d71ddbd`.
- Deployment `dpl_3tCzpRKHCFNvRCEr8QekURFG9DKe` is ready at the existing public URL. Its main bundle matches the tested local bundle byte-for-byte; health returns 200 and reports d71ddbd. [Public verification](WALLET_FIX_HOSTED_VERIFICATION.json).

The founder’s exact provider-side reason for the original unavailable reactive client was not observable. After hard refresh, the founder confirmed approval and deposit completed and supplied the Confirmed screenshot with refreshed shares. Independent raw transaction/receipt checks verified approval nonce 0 and deposit nonce 1, both successful, exact 100,000 micro-USDC approval/deposit, mandate hash, 99,470 minimum shares and 99,970 actual minted shares. NAV and share rounding reconcile. The deposit path has passed the real MetaMask acceptance step. [Receipt and accounting evidence](BROWSER_DEPOSIT_VERIFICATION.json).

## Complete browser lifecycle

The founder switched to a separately funded trader account, opened position 3 with 0.10 test USDC and repaid the full 0.100383 debt, receiving all 246 pledged cirBTC atoms. Switching back to the depositor account, the founder requested all 0.09997 shares and claimed the 0.100028-USDC payout after the authorized keeper processed the queue. All nine approval/action/keeper receipts were independently checked. No duplicate action or further wallet-preparation error was reported. [Opening](BROWSER_OPEN_VERIFICATION.json), [repayment](BROWSER_REPAY_VERIFICATION.json), [withdrawal accounting](BROWSER_WITHDRAWAL_VERIFICATION.json), [complete walkthrough](../checkpoints/04-hosted.md).
