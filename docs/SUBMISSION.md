# Sacred submission package

Prepared November 6, 2026. The application and browser rehearsal are complete. The founder selected the existing Studio app URL and public Vercel URL, supported by Studio history/code/runtime traces in the demo. Organizer confirmation is no longer a blocker. The final video URL and presentation sharing/export remain.

## Project title and short description

**Sacred: fixed-markup spot financing on Arc**

Deposit test USDC into a NAV-priced vault or finance a cirBTC spot purchase with fixed debt. Built in Arc Studio, with real Uniswap v4 execution, separate protection reserves and FIFO withdrawals on Arc Testnet.

## Project description

Sacred demonstrates a sale-financing structure for a single cirBTC market. A trader supplies half the purchase price. The vault first funds the full acquisition through Uniswap v4; the engine records acquisition, the disclosed fixed-markup sale and the pledge before collecting the trader's contribution. Principal and markup are fixed at opening, with no late growth or rollover. Full repayment returns all remaining pledged BTC.

Depositors receive non-transferable shares at NAV and participate in collected markup. Their return is not a promised APY. USDC accounting separates LP cash, outstanding principal, primary and tail protection, manager cash and reserved withdrawals. Withdrawals preserve FIFO priority; anyone can process eligible requests, and depositors pull their reserved cash with Claim.

The public MVP includes Earn, Trade and Activity, a read-only API, four deployed contracts and a separate gas-funded keeper. The founder completed a real MetaMask rehearsal using separate depositor and trader accounts: 0.10 test-USDC deposit, a 0.10 trader contribution, repayment of 0.100383 debt, release of 246 cirBTC atoms, and a 0.100028-USDC withdrawal claim. All nine approval/action/keeper receipts were independently verified. The claim payout is before wallet gas, not a net-profit claim.

A second browser scenario demonstrated a realized trading exit: 0.10 test USDC financed a 0.20 purchase of 247 cirBTC sats. After a disclosed operator-controlled testnet pool rise of 25.47%, the trader sold the pledge through v4, repaid 0.100383 debt and received 0.141887. The net wallet gain was 0.0118450485625 after all approval/open/close gas. Operator market-moving costs are separate. [Verified owner close](https://explorer.testnet.arc.io/tx/0xe2f98645857130e922c46f053ea1444b5704e8a8dc6fc66bc5bdd40b79bd9ad0).

## How it was built

Arc Studio authored and tested the contracts, frontend, read API and operator scripts in one persistent app. Codex directed scoped checkpoints through the Studio CLI, reviewed downloaded files, independently tested critical behavior and verified public chain receipts. Codex also maintained small sequential Git commits and deployed the Studio-generated frontend/API through the authenticated Vercel CLI. Claude assisted bounded reviews, the explanatory guide and the final brand design direction; Studio implemented the UI changes. The prior Sacred design, brand and website predate this MVP and are disclosed in the repository.

The historical wallet checkpoint d71ddbd comparison covers 81 source/configuration files: 79 exact matches and two trailing-whitespace differences. The final UI checkpoint 9bf75bd has a separate [23-path comparison](review/STUDIO_UI_SOURCE_MATCH.json): 22 exact content/hash matches and one trailing-blank-line normalization. Studio font hashes verify the original brand binaries despite a CLI download defect. The repository includes prompts, sanitized checkpoint references, source hashes, review dispositions and transaction evidence. The video must show the actual Studio conversation and current source.

## Integration and qualification

The strongest technical fit is Arc's **Best DeFi / Onchain Finance App Built End to End in Arc Studio** bounty. Confirm the founder's registered track and chosen bounty in the final form; do not claim eligibility for the Continuity Track without that registration. [Official requirements](https://ethglobal.com/events/mumbai/prizes/arc).

Actual integrations are Arc Testnet, USDC for settlement and native gas, cirBTC and the real Uniswap v4 PoolManager/Quoter. Circle's Arc-aware Foundry was used for real native-USDC fork checks. The MVP does not claim Gateway, CCTP, Circle Wallets, Marketplace Discovery or Bridge Kit integration.

The Uniswap entry is **Build with Uniswap**, through the v4 AMM integration. Sacred uses existing v4 infrastructure and initialized/seeded the USDC/cirBTC 0.30% pool itself, with no custom hook. [Source pointers and pool receipts](../README.md#uniswap-v4-integration) identify the real integration. The [official requirements](https://ethglobal.com/events/mumbai/prizes/uniswap-foundation) also require public open-source code, FEEDBACK.md and the developer feedback form containing its link. The prepared feedback file is present; form submission remains pending. The separate Continuity prize is not claimed without confirmed track registration.

## Links for the form

| Field | Link or state |
| --- | --- |
| Public app and read API | https://sacred-arc-mvp.vercel.app |
| Repository | https://github.com/smitrajput/sacred-markets |
| Studio app for submission | https://studio.arc.io/app/37c6c8dc-b313-49c9-9cbb-fe5f61673ab3 |
| Studio continuation for the demo | https://studio.arc.io/app/37c6c8dc-b313-49c9-9cbb-fe5f61673ab3?thread=868bf545-07ba-4ecd-a97c-b45762be5d3c |
| Studio access note | Judge access is unverified; signed-out workspace redirects to login. Founder chose both existing URLs plus a direct Studio demonstration. Organizer confirmation is not a blocker. |
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
- The pool is thin and quotes can fail the 190% coverage gate. The later profit demo deliberately moved the actual testnet pool using a separate operator wallet. It demonstrates execution and accounting, not organic demand or expected returns.
- The authorized keeper completed 60 checks, submitted one FIFO transaction and stopped. There is no continuous hosting or verified heartbeat; manual permissionless controls remain.
- Fourteen-day maturity was tested using local time warp; no claim that the live position aged fourteen days during the hackathon.

## Final founder actions

1. Include both the Studio app URL and public Vercel URL in the submission. Show the Studio build conversation, current code and runtime traces in the video; do not describe judge permissions as verified.
2. Record the three-minute walkthrough, including the signed-in Studio workspace and the actual completed receipts; upload and test the link signed out.
3. Export/share the prepared presentation and add its accessible link.
4. Confirm the selected bounty/track, prior-work disclosure and final submission form fields; submit before November 7, 09:30 IST.
5. If submitting a Uniswap integration prize, complete the developer feedback form using [the prepared feedback](../FEEDBACK.md) and its current prize requirements.

Nothing in this file is evidence that a submission or feedback form has already been sent.
