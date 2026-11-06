# Sacred demo runbook

Target: three minutes. Use the redesigned public app and the existing six-slide presentation. The completed browser receipts below are the evidence; no new transaction is required for the recording. All amounts are test assets.

## Before recording

- Open the [public app](https://sacred-arc-mvp.vercel.app), the signed-in [Studio continuation](https://studio.arc.io/app/37c6c8dc-b313-49c9-9cbb-fe5f61673ab3?thread=868bf545-07ba-4ecd-a97c-b45762be5d3c) and the presentation.
- Keep Studio's environment and secret files closed. Show the build conversation, current code, working preview and runtime traces.
- Keep the two accounts identified: depositor `0x5B93…2659`, trader `0xAA46…dEcC`. The founder signed every browser transaction. Position 4 is now closed; show its actual receipts or the recorded before/after screens, not an invented active position.
- The price-rise scenario was controlled: a separate operator traded in the real test pool, then updated the separate reference fixture. State this explicitly. Operator costs are excluded from trader P&L.
- Keep slide 3 and the operator-buy explorer receipt ready for the price-rise segment. Show the prepared pool price and the price after the operator buy as historical checkpoints, not a live price ticker. The opening trade happened between those checkpoints.
- The 60-check keeper ran in Studio's remote sandbox and stopped. Manual queue processing remains available. Do not claim continuous cloud hosting.

## Three-minute narrative

**0:00–0:30: Product and build.** “Sacred finances a real cirBTC spot purchase with fixed debt on Arc Testnet. Arc Studio implemented the contracts, app, API and operator scripts in this workspace. Codex reviewed and verified them; Opus directed the visual design. Our prior protocol design and brand predate this MVP.” Show the build history, current code and preview traces. Use both the Studio URL and public app URL in the submission. [Provenance](BUILD_PROVENANCE.md).

**0:30–0:55: Earn.** Show the vault and the [0.10 USDC deposit](https://explorer.testnet.arc.io/tx/0xee5a1b2847299604da329322f857ed90fd3fe3d87822438a61c0edeac2b22baf). “Depositors receive shares at NAV and share collected markup. This is not a promised APY. We rehearsed with separate depositor and trader wallets.”

**0:55–1:15: Open the financed purchase.** Show [Position 4 opening](https://explorer.testnet.arc.io/tx/0x75b67561be287fad78b9af2baec55df4a5ebeb0ac30f307eb850d3fedd99c750). “The trader contributed 0.10; the vault acquired 0.20 of cirBTC through Uniswap v4. That bought 247 cirBTC sats, with fixed debt of 0.100383 USDC.”

**1:15–1:35: Show the price increase.** Hold slide 3's price comparison on screen, then show the successful [operator market buy](https://explorer.testnet.arc.io/tx/0x1e1a581514c172e13e43fbc693bbae677214d146595a0d226603db141569e4c5). “A separate operator bought cirBTC with 2.761982 test USDC to simulate demand. From our prepared starting point, the actual pool price rose from about 79,998 to 100,378 USDC per cirBTC: 25.47%. We then updated the separate test reference to 100,000.” Keep the label **Controlled testnet scenario** visible. The reference update alone would not increase the pool's sale proceeds.

**1:35–1:55: Close and show the profit.** Show [owner close](https://explorer.testnet.arc.io/tx/0xe2f98645857130e922c46f053ea1444b5704e8a8dc6fc66bc5bdd40b79bd9ad0), followed by slide 3's results. “The sale returned 0.242270 USDC. After debt, the trader received 0.141887. That's 41.89% profit before gas, or 11.85% after all three wallet fees, on the original 0.10 contribution.” [Full accounting](review/PROFIT_CLOSE_VERIFICATION.json).

**1:55–2:25: Protection and withdrawal.** Show the earlier [coverage-sale receipt](https://explorer.testnet.arc.io/tx/0xc7afcee5e170601d01468b8acef07f62439b49404a31dbe553b770dd4a783f78): 52 cirBTC sats sold, restoring coverage to 191.39%. Label it the earlier operator rehearsal. Then show the depositor's [FIFO fill](https://explorer.testnet.arc.io/tx/0xcb4125096e937bad51fe05641370f2a5dc5c3c09e32fc4f979a18461034e3855) and [claim](https://explorer.testnet.arc.io/tx/0x72683156f818699601f9d43bf96118ebe38cc34018e120a2153dc9dcf04835c4): “The keeper reserved 0.100028 in FIFO order. The depositor claimed it without a second NAV charge.”

**2:25–3:00: Architecture and boundaries.** Show the editable architecture. “The API reads; wallets sign. Sacred uses existing Uniswap v4 contracts and a pool we initialized and seeded. We have fixed 2x financing, a fourteen-day term and no late debt growth. This is a testnet prototype with an operator price fixture and limited liquidity, not an audit or Shariah certification.” The full repayment/BTC release path also passed in the earlier Position 3 rehearsal; maturity was tested with local time warp, not fourteen elapsed live days.

## Price-rise recording reference

| On-screen label | Verified value | Meaning |
|---|---:|---|
| Prepared pool price | 79,997.77 USDC/cirBTC | Before the trader opened Position 4 |
| Pool after operator buy | 100,377.57 USDC/cirBTC | After a real 2.761982 USDC purchase; +25.47% against the prepared starting point |
| Separate reference fixture | 80,000 → 100,000 USDC/cirBTC | Coverage input updated after the pool swap; +25.00% |
| Trader profit before gas | +0.041887 USDC (+41.89%) | After fixed debt and original contribution |
| Trader profit after gas | +0.011845 USDC (+11.85%) | Also deducts approval, opening and closing fees |

Use a before/after comparison, not an invented continuous price chart. Price checkpoints are pool spot prices, not the trader's average entry or exit execution prices. The 25.47% pool move includes the intervening trader opening. Percentages are rounded; [raise verification](review/PROFIT_RAISE_VERIFICATION.json), [close verification](review/PROFIT_CLOSE_VERIFICATION.json) and [hosted checkpoint](checkpoints/04-hosted.md) retain the evidence. Operator funds and gas are separate from trader P&L. Recording this completed scenario requires no new trade or price update.

## Submission checks

Include the Studio and public app URLs, public repository, demo video, presentation and frontend/backend architecture. For Uniswap, [README source pointers](../README.md#uniswap-v4-integration) and [FEEDBACK.md](../FEEDBACK.md) are ready; the developer feedback form still needs submission. Judge access to the Studio conversation remains unverified; the founder selected the two URLs plus a direct Studio demonstration.
