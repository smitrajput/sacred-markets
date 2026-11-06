# Sacred demo runbook

Target: a three-minute core walkthrough inside the four-minute demo slot, followed by three minutes of Q&A. Record at normal speed. This is an Arc Testnet demonstration using test assets with no value.

## Before recording

- Use the public hosted app after the deployment check in `docs/checkpoints/04-hosted.md` passes.
- Connect the funded browser wallet `0x5B935E09b4749efbE9AA9855ac049d7cacE32659` on Arc Testnet, chain 5042002. The person approves every browser transaction.
- Check the displayed reference fixture is fresh, reserves meet targets and no withdrawal remains unfilled. The reference is an admin-controlled test fixture, not a production price oracle.
- Keep at least 0.10 USDC available for browser-wallet gas. Test USDC has one underlying balance: the ERC-20 view has six decimals and the native gas view has eighteen.
- Keep the explorer open for the new receipts. The existing coverage-sale and FIFO evidence is linked below; label it as the earlier rehearsal when showing it.

## Three-minute narrative

**0:00–0:25: Product and provenance.** “Sacred demonstrates sale-based spot financing. The vault buys cirBTC through Uniswap v4, records a disclosed fixed-markup sale, then holds the asset as pledge. The debt is fixed when the position opens.” Show the Studio workspace and source repository. The website and protocol design predate this hackathon implementation.

**0:25–1:10: Earn.** Show the live vault, segregated primary/tail reserves and NAV. Deposit 0.10 test USDC after reading and accepting the mandate. Approve the exact amount, confirm the deposit and wait for the refreshed shares. “Depositors share collected markup. The trader price is not a promised depositor APY.”

**1:10–2:05: Trade.** Open with 0.10 test USDC contribution when the live quote meets the 190% coverage guard. Show principal 0.10, fixed markup 0.000383 and total debt 0.100383. Accept the terms, approve the exact contribution and confirm. Show the explorer's AssetAcquired → DisclosedSaleAgreed → Pledged sequence. Repay the full displayed debt and verify the pledge is released; approval and signing time may require a separate prepared take.

**2:05–2:40: Protection and exit.** Show the public Keeper panel and its truthful current eligibility. Open the earlier [real partial-sale receipt](https://explorer.testnet.arc.io/tx/0xc7afcee5e170601d01468b8acef07f62439b49404a31dbe553b770dd4a783f78): 52 cirBTC atoms sold, 0.040612 USDC collected and coverage restored to 191.39%. Show the prior [FIFO reservation](https://explorer.testnet.arc.io/tx/0x8be5d0517b2ca62e0dc9842ad506533fb3ad67b2c663943f9932750e1f17ed55) and [claim](https://explorer.testnet.arc.io/tx/0xb4b830b521adcdbae48815d193479531aa48a60669d349faf0502b9c72b9b5f3). Claims do not debit NAV a second time.

**2:40–3:00: Boundaries.** Show the architecture diagram and repository. “One market, fixed 2x policy, fourteen-day term, no late growth or rollover. The price fixture and small liquidity pool are testnet limitations. Repayment and already-reserved claims remain available after price expiry.” Bridging is outside this demo.

## Separate browser rehearsal

Before the final take, verify each step without rushing: deposit; open; full repayment and BTC release; request a small withdrawal in shares; process the queue from a wallet; claim. Wait for each receipt and refreshed state before the next action. Save the hashes in the hosted checkpoint. Do not retry an unresolved transaction; use its confirmation/refresh recovery.

The earlier money flows are already independently verified in [checkpoint 02](checkpoints/02-live.md). Do not imply that a fourteen-day position matured live: maturity was tested using local time warp.

## Likely judge questions

- **Is this production-ready or certified Shariah-compliant?** No. This is a proposed sale-financing implementation with open design/review questions, an admin-priced fixture and testnet assets.
- **What actually uses Uniswap?** `V4SpotVenue` buys and sells against the existing v4 PoolManager in the fixed USDC/cirBTC 3000/60 pool. No mock AMM is used in the live receipts.
- **What makes it execute over time?** A gas-funded operator can run the bounded keeper. Eligible settlement and withdrawal processing are also permissionless wallet actions. If nobody calls, eligible work waits; there is no claim of autonomous contract scheduling.
- **Who can block activity?** The guardian can pause funding, the price operator can let the fixture expire, and the token/network/hosting providers have their normal controls. Wallet repayment and reserved claims remain self-serve onchain.
- **How are losses handled?** Principal shortfalls consume primary reserve, then tail reserve, then optional backstop, then LP NAV. Markup write-off is tracked separately.
