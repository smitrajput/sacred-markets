# Sacred demo runbook

Use the current presentation and a fresh browser flow. The operator CLI runs in **Arc Studio’s Terminal**, with the dedicated testnet keys already in its ignored environment. It does not run in the browser app or on Vercel. All amounts are test assets.

## Completed rehearsal and fresh recording

The founder completed the self-service rehearsal with Position 5: 0.10 test USDC contribution, 0.141889 payout, 0.041889 trading profit before gas and 0.0101442 after all trader gas. The depositor claimed 0.100028 test USDC after the one-shot FIFO command. Operator spending and gas are separate. [Independent verification](review/SELF_SERVICE_REHEARSAL_VERIFICATION.json).

The rehearsal remains preserved in `deployments/demo-recording-20261107.json` and is inspected with `bun run demo status`. The actual recording uses **`bun run demo:record`**, a separate fixed episode and journal. Both commands share the same operator lock. Recording preparation requires the completed rehearsal and closed Position 5, no active browser-trader position and an empty queue. It retains the same bounded operator limits.

Final preparation succeeded: pool **79,999.39 USDC/cirBTC**, reference **80,000**, opening quote **247 sats / 196.84% coverage**. The reference expires **November 8 at 08:25:44 IST**. Preparation spent **0.006845775 test USDC** in gas. The recording price rise is unused. [Receipt verification](review/FINAL_RECORDING_PREP_VERIFICATION.json). Run `bun run demo:record status` immediately before filming because live conditions can change.

## Before recording

1. Open the [app](https://sacred.markets/app), the presentation, and the signed-in [Studio continuation](https://studio.arc.io/app/37c6c8dc-b313-49c9-9cbb-fe5f61673ab3?thread=868bf545-07ba-4ecd-a97c-b45762be5d3c).
2. In Studio, open Code → Terminal. Run `cd /home/user/app`, then `bun run demo:record status`.
3. The recording episode is `final-recording-20261107`. Preparation must report **READY**, with the pool near 80,000, a fresh 80,000 reference, an empty withdrawal queue, and an opening quote at or above 190% coverage. Preparation is a separate step before filming: `bun run demo:record prepare --plan`, then `bun run demo:record prepare` and type `PREPARE` when requested. If already complete, it reports status without trading again.
4. Identify the two MetaMask accounts: depositor `0x5B93…2659`, trader `0xAA46…dEcC`. Verify the app header after switching accounts. The founder signs all browser approvals, deposits, openings, closes, withdrawal requests and claims.
5. Keep Studio’s environment and secret files closed. The demo CLI’s output contains public amounts, addresses and explorer links. Show Studio’s code and working preview/runtime traces as build evidence.
6. Keep the CLI terminal open beside the app. There is **no scheduled price move** and no need to ask an assistant during the recording.

## Live recording sequence

**Introduce Sacred.** Briefly show the product and how it works slides. The current MVP supports USDC Earn and fixed 2x cirBTC financing; wider leverage and Borrow are future work. Describe interest-free as the intended fixed-markup sale structure, not a free product or a completed Shariah certification.

**Earn.** Connect the depositor, enter `0.10` USDC, accept the mandate, and sign the exact approval and deposit. Wait for Confirmed. Explain shares at NAV and participation in collected markup; no promised APY.

**Open Trade.** Switch to trader `0xAA46…dEcC`. Enter `0.10` USDC and check initial coverage is at least 190%. Explain the 0.20 USDC cirBTC purchase and fixed debt of 0.100383 USDC. Sign approval and opening. Wait for the new position card and note its number. Leave it open.

**Raise the actual pool price.** Switch to Studio Terminal and run:

```sh
bun run demo:record rise POSITION_NUMBER
```

Replace `POSITION_NUMBER` with the number the app just showed, for example `bun run demo:record rise 6` only if the card actually says Position 6. Review the printed plan, then type `RISE 6` (using the same actual number) when prompted. No wallet popup is needed: this bounded command uses the dedicated testnet operator wallets, never your browser wallet.

Say: “I’m simulating market demand with a separate operator buying cirBTC in our real Uniswap v4 test pool. After verifying the pool price, the command updates our separate test reference.” Hold the before/after pool price, percentage change and swap receipt link on screen. The target is approximately 80,000 → 100,000, not a guaranteed exact percentage or payout. The command separately labels the immediately-before-buy and prepared-starting-point comparisons.

Wait for the completed result and **Return to Trade → Sell collateral and close (owner)**. The command’s payout and profit are estimates **before gas**, unrealized until the close. The reference update alone does not raise the AMM’s sale proceeds.

**Close.** Return to Trade, refresh if necessary, and choose **Sell collateral and close (owner)**. Sign and wait for confirmation. Do not choose “Repay and release” for this cash-profit demo: that returns cirBTC instead of selling it. Show Activity and the close transaction to establish actual sale proceeds, fixed-debt settlement and trader payout. Operator costs are separate from trader P&L; gas reduces the trader’s net return.

**Withdraw (optional live ending).** Switch back to the depositor. In Earn, request the actual unlocked shares shown, not an old rehearsed number. After the request confirms, run in Studio Terminal:

```sh
bun run demo:record process
```

Review and type `PROCESS`. It makes one permissionless FIFO-processing call, reserving available payout. Then return to Earn and sign **Claim**. If the queue is empty, the command does nothing. The UI’s **Process queue** button is also available. This step demonstrates the keeper’s job without claiming an always-on service.

**Finish.** Show the architecture, roadmap, live link and Thank you slide. Invite viewers to follow [@smit__rajput](https://x.com/smit__rajput) as you bring Sacred to the masses.

## Commands to keep beside the recording

| When | Studio Terminal command |
|---|---|
| Before filming | `bun run demo:record status` |
| Review preparation | `bun run demo:record prepare --plan` |
| Prepare once, if not complete | `bun run demo:record prepare` → type `PREPARE` |
| After your new position confirms | `bun run demo:record rise POSITION_NUMBER` → type `RISE POSITION_NUMBER` |
| After a depositor withdrawal request | `bun run demo:record process` → type `PROCESS` |

The CLI is deliberately bound to one recording episode and one new trader position. Do not delete or edit `deployments/demo-final-recording-20261107.json` to replay it. Completed steps report saved receipts instead of spending again. After a network interruption, run status, then the **same command with the same position number**. A pending transaction is reconciled; never start a parallel command or a second position to work around it. An abnormal exit may leave a lock; follow the printed instructions only after confirming no other demo process is running.

The reference expires 24 hours after its update. If status reports stale or drifting conditions, resolve readiness before filming; a completed preparation is not a promise of perpetual readiness. No background keeper runs automatically. The existing keeper implementation is [`scripts/keeper.ts`](../scripts/keeper.ts); the self-service commands are [`scripts/demo.ts`](../scripts/demo.ts).

## Operator limits

This episode uses only Arc Testnet (5042002). Preparation may sell at most 5,000 cirBTC sats. All preparation and rise purchases together may spend at most 4 test USDC in at most two buys. Operator gas is capped at 0.2 test USDC; one-shot queue calls have a separate cumulative 0.05 test USDC gas cap. Each signer retains a 2 test USDC reserve. Every write is journaled and simulated before signing. These are bounded demo operations, not continuous cloud hosting or a production oracle.

## Previous rehearsal: Position 4 (historical evidence)

| On-screen label | Verified value | Meaning |
|---|---:|---|
| Prepared pool price | 79,997.77 USDC/cirBTC | Before the trader opened Position 4 |
| Pool after operator buy | 100,377.57 USDC/cirBTC | After a real 2.761982 USDC purchase; +25.47% against the prepared starting point |
| Separate reference fixture | 80,000 → 100,000 USDC/cirBTC | Coverage input updated after the pool swap; +25.00% |
| Trader profit before gas | +0.041887 USDC (+41.89%) | After fixed debt and original contribution |
| Trader profit after gas | +0.011845 USDC (+11.85%) | Also deducts approval, opening and closing fees |

Use a before/after comparison, not an invented continuous price chart. Price checkpoints are pool spot prices, not the trader's average entry or exit execution prices. The 25.47% pool move includes the intervening trader opening. Percentages are rounded; [raise verification](review/PROFIT_RAISE_VERIFICATION.json), [close verification](review/PROFIT_CLOSE_VERIFICATION.json) and [hosted checkpoint](checkpoints/04-hosted.md) retain the evidence. Operator funds and gas are separate from trader P&L. These receipts describe the completed November 6 rehearsal, not the new recording episode. Do not reuse its return figures as the result of a new trade.

## Submission checks

Include the Studio and public app URLs, public repository, demo video, presentation and frontend/backend architecture. For Uniswap, [README source pointers](../README.md#uniswap-v4-integration) and [FEEDBACK.md](../FEEDBACK.md) are ready. Judge access to the Studio conversation remains unverified; the founder selected the two URLs plus a direct Studio demonstration. Keep the earlier Position 4 results explicitly historical if showing that evidence slide during the new run.
