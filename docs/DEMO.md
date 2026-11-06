# Sacred demo runbook

Target: a three-minute core walkthrough inside the four-minute demo slot, followed by three minutes of Q&A. Record at normal speed. This is an Arc Testnet demonstration using test assets with no value.

## Before recording

- Use the public hosted app after the deployment check in `docs/checkpoints/04-hosted.md` passes.
- Keep the two browser accounts identified: depositor `0x5B935E09b4749efbE9AA9855ac049d7cacE32659` and trader `0xAA46220DfD751f915d9c802412eDaBC0aB69dEcC`. Both completed the lifecycle. The person approves every new browser transaction; no new signing is needed for the receipt walkthrough below.
- Check the displayed reference fixture is fresh, reserves meet targets and no withdrawal remains unfilled. The reference is an admin-controlled test fixture, not a production price oracle.
- Keep at least 0.10 USDC available for browser-wallet gas. Test USDC has one underlying balance: the ERC-20 view has six decimals and the native gas view has eighteen.
- Open the receipt links in [the browser rehearsal record](checkpoints/04-hosted.md#browser-wallet-rehearsal-complete). Show the successful completed transactions as a recorded lifecycle walkthrough, not as transactions being sent during this take.
- The thin pool now quotes another 0.10 opening below 190% coverage. Show the guard honestly; do not repeatedly submit or change the price/threshold to recreate the earlier quote. The bounded keeper finished after 60 checks; manual Process queue is available for later requests.

## Three-minute narrative

**0:00–0:30: Product and provenance.** “Sacred demonstrates sale-based spot financing on Arc Testnet. Arc Studio generated the contracts, frontend, read API and operator scripts in this workspace. Codex reviewed the downloaded code and handled Git and web hosting. Our earlier design and website predate this implementation.” Show the signed-in Studio continuation conversation, a completed build checkpoint and the current code. Interact with Earn or Trade in the working Studio preview and show its runtime tracing panel. Explain that build history/source comparison establish provenance while runtime traces show execution. Keep secrets and environment files closed. Include both the Studio app URL and public Vercel URL in the submission; organizer confirmation is not a blocker. Show [source comparison](BUILD_PROVENANCE.md).

**0:30–1:00: Earn.** Show the live vault and segregated reserves, then the founder's [deposit receipt](https://explorer.testnet.arc.io/tx/0xee5a1b2847299604da329322f857ed90fd3fe3d87822438a61c0edeac2b22baf). “We tested this through MetaMask with separate depositor and trader wallets. The depositor put in 0.10 test USDC and received 0.09997 shares at the current NAV. Depositors share collected markup; the trader price is not a promised depositor APY.”

**1:00–1:50: Trade.** Show the [opening receipt](https://explorer.testnet.arc.io/tx/0xa311d6e40c00a24e4d83434fa91733899b3f5235f46c7decaf38b34044400a20) and its AssetAcquired → DisclosedSaleAgreed → Pledged sequence. “The trader contributed 0.10; the vault first paid the full 0.20 purchase, acquired cirBTC, recorded the sale and pledge, then collected the contribution. Principal is 0.10, markup fixed at 0.000383, debt 0.100383. This opening had 196.04% coverage.” Show the [full repayment](https://explorer.testnet.arc.io/tx/0x8e76a287a16c5ebe6d719298d0c4391f0035889037052f2e2999fb290d4bf12c): “Repayment closed position 3 and returned all 246 cirBTC atoms to the trader.” The current Trade panel correctly shows no open position for that wallet.

**1:50–2:30: Protection and exit.** Open the earlier [real partial-sale receipt](https://explorer.testnet.arc.io/tx/0xc7afcee5e170601d01468b8acef07f62439b49404a31dbe553b770dd4a783f78): 52 cirBTC atoms sold, 0.040612 USDC collected and coverage restored to 191.39%. Label it as the earlier operator rehearsal. Then show the founder's [FIFO reservation](https://explorer.testnet.arc.io/tx/0xcb4125096e937bad51fe05641370f2a5dc5c3c09e32fc4f979a18461034e3855) and [claim](https://explorer.testnet.arc.io/tx/0x72683156f818699601f9d43bf96118ebe38cc34018e120a2153dc9dcf04835c4). “The keeper served our depositor's request in FIFO order and reserved 0.100028 USDC. Claim paid that cash without charging NAV twice. Anyone can process the queue; this bounded keeper episode is now stopped.”

**2:30–3:00: Architecture and boundaries.** Show the architecture diagram and repository. “The read API cannot sign. User wallets and a separate keeper submit transactions. We have one market, fixed 2x policy, a fourteen-day term and no late growth or rollover. The price fixture and thin pool are testnet limitations: another 0.10 opening is currently blocked by the coverage guard. Repayment and reserved claims remain available after price expiry.” Bridging is outside this demo.

## Separate browser rehearsal

Completed November 6 by 20:53 IST: deposit; separate-wallet open; full repayment and BTC release; request all depositor shares; keeper queue processing; depositor claim. All nine receipts were independently verified and linked in [checkpoint 04](checkpoints/04-hosted.md). Further transactions are not required to record this evidence walkthrough. If a later live take is chosen, use the current quote and wait for every receipt; do not retry an unresolved transaction.

The earlier money flows are already independently verified in [checkpoint 02](checkpoints/02-live.md). Do not imply that a fourteen-day position matured live: maturity was tested using local time warp.

## Likely judge questions

- **Is this production-ready or certified Shariah-compliant?** No. This is a proposed sale-financing implementation with open design/review questions, an admin-priced fixture and testnet assets.
- **What actually uses Uniswap?** `V4SpotVenue` buys and sells against the existing v4 PoolManager in the fixed USDC/cirBTC 3000/60 pool. No mock AMM is used in the live receipts.
- **What makes it execute over time?** A gas-funded operator can run the bounded keeper. Eligible settlement and withdrawal processing are also permissionless wallet actions. If nobody calls, eligible work waits; there is no claim of autonomous contract scheduling.
- **Who can block activity?** The guardian can pause funding, the price operator can let the fixture expire, and the token/network/hosting providers have their normal controls. Wallet repayment and reserved claims remain self-serve onchain.
- **How are losses handled?** Principal shortfalls consume primary reserve, then tail reserve, then optional backstop, then LP NAV. Markup write-off is tracked separately.
