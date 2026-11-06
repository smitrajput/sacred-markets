# Sacred submission package

Prepared November 6, 2026. The application and browser rehearsal are complete. The final video URL, presentation sharing/export and judge access to the Studio workspace still need confirmation before submission.

## Project title and short description

**Sacred: fixed-markup spot financing on Arc**

Deposit test USDC into a NAV-priced vault or finance a cirBTC spot purchase with fixed debt. Built in Arc Studio, with real Uniswap v4 execution, separate protection reserves and FIFO withdrawals on Arc Testnet.

## Project description

Sacred demonstrates a sale-financing structure for a single cirBTC market. A trader supplies half the purchase price. The vault first funds the full acquisition through Uniswap v4; the engine records acquisition, the disclosed fixed-markup sale and the pledge before collecting the trader's contribution. Principal and markup are fixed at opening, with no late growth or rollover. Full repayment returns all remaining pledged BTC.

Depositors receive non-transferable shares at NAV and participate in collected markup. Their return is not a promised APY. USDC accounting separates LP cash, outstanding principal, primary and tail protection, manager cash and reserved withdrawals. Withdrawals preserve FIFO priority; anyone can process eligible requests, and depositors pull their reserved cash with Claim.

The public MVP includes Earn, Trade and Activity, a read-only API, four deployed contracts and a separate gas-funded keeper. The founder completed a real MetaMask rehearsal using separate depositor and trader accounts: 0.10 test-USDC deposit, a 0.10 trader contribution, repayment of 0.100383 debt, release of 246 cirBTC atoms, and a 0.100028-USDC withdrawal claim. All nine approval/action/keeper receipts were independently verified. The claim payout is before wallet gas, not a net-profit claim.

## How it was built

Arc Studio authored and tested the contracts, frontend, read API and operator scripts in one persistent app. Codex directed scoped checkpoints through the Studio CLI, reviewed downloaded files, independently tested critical behavior and verified public chain receipts. Codex also maintained small sequential Git commits and deployed the Studio-generated frontend/API through the authenticated Vercel CLI. Claude assisted bounded reviews and the explanatory guide. The prior Sacred design, brand and website predate this MVP and are disclosed in the repository.

A fresh comparison at implementation checkpoint d71ddbd covers 81 source/configuration files: 79 exact byte matches and two differences only in trailing whitespace. The repository includes prompts, sanitized checkpoint references, source hashes, review dispositions and transaction evidence. The video must show the actual Studio conversation and current source.

## Integration and qualification

The strongest technical fit is Arc's **Best DeFi / Onchain Finance App Built End to End in Arc Studio** bounty. Confirm the founder's registered track and chosen bounty in the final form; do not claim eligibility for the Continuity Track without that registration. [Official requirements](https://ethglobal.com/events/mumbai/prizes/arc).

Actual integrations are Arc Testnet, USDC for settlement and native gas, cirBTC and the real Uniswap v4 PoolManager/Quoter. Circle's Arc-aware Foundry was used for real native-USDC fork checks. The MVP does not claim Gateway, CCTP, Circle Wallets, Marketplace Discovery or Bridge Kit integration.

## Links for the form

| Field | Link or state |
| --- | --- |
| Public app and read API | https://sacred-arc-mvp.vercel.app |
| Repository | https://github.com/smitrajput/sacred-markets |
| Studio continuation | https://studio.arc.io/app/37c6c8dc-b313-49c9-9cbb-fe5f61673ab3?thread=868bf545-07ba-4ecd-a97c-b45762be5d3c |
| Studio judge access | Unverified. Signed-out workspace redirects to login; Share currently offers hosting. Ask Arc organizers which project URL/access route they accept. |
| Source and authorship proof | [BUILD_PROVENANCE.md](BUILD_PROVENANCE.md) |
| Architecture | [Architecture](ARCHITECTURE.md), [reusable SVG](diagrams/architecture.svg) |
| Visual technical guide | https://sacred-arc-mvp.vercel.app/guide.html |
| Browser receipts | [Hosted checkpoint](checkpoints/04-hosted.md#browser-wallet-rehearsal-complete) |
| Video | Pending founder recording and upload; [three-minute script](DEMO.md) |
| Presentation | Six-slide Sacred deck prepared in Spaces; export/share from the deck UI and add the judge-accessible link. |
| Screenshots | [Earn](screenshots/hosted-earn-desktop.jpg), [Trade](screenshots/hosted-trade-desktop.jpg), [mobile Trade](screenshots/hosted-trade-mobile.jpg), [Activity](screenshots/hosted-activity-desktop.jpg). These are public-read captures, not wallet-signing proof. |

## Limitations to state

- This is a testnet prototype with test assets. No audit, production-readiness or Shariah-certification claim.
- The price is an operator-controlled fixture. Its expiry is visible in the application. Repayment and already-reserved claims remain available after expiry.
- The pool is thin. After the successful browser purchase, another 0.10 opening quoted below 190% coverage and was correctly blocked. The demo uses the completed receipts rather than implying every later quote is executable.
- The authorized keeper completed 60 checks, submitted one FIFO transaction and stopped. There is no continuous hosting or verified heartbeat; manual permissionless controls remain.
- Fourteen-day maturity was tested using local time warp; no claim that the live position aged fourteen days during the hackathon.

## Final founder actions

1. Confirm the accepted Studio sharing/access route with Arc and record the answer.
2. Record the three-minute walkthrough, including the signed-in Studio workspace and the actual completed receipts; upload and test the link signed out.
3. Export/share the prepared presentation and add its accessible link.
4. Confirm the selected bounty/track, prior-work disclosure and final submission form fields; submit before November 7, 09:30 IST.
5. If submitting a Uniswap integration prize, complete the developer feedback form using [the prepared feedback](../FEEDBACK.md) and its current prize requirements.

Nothing in this file is evidence that a submission or feedback form has already been sent.
