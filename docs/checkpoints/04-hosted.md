# Checkpoint 04: public frontend and read API

Public app: **https://sacred-arc-mvp.vercel.app**. Current UI implementation checkpoint: `9bf75bd`; wallet-verified financial behavior checkpoint: `d71ddbd`. Current deployment: `dpl_AzbYyczGB3yrEh1KYbq4xLyZLGCi`, built from `9bf75bd`, Vercel project `sacred-arc-mvp` in `smit-rajputs-projects`. Codex deployed the Studio-authored refinement with self-hosted Sacred brand fonts and the updated guide. The public JS/CSS, all eight fonts, logo and guide match the reviewed local bytes; the API reports healthy read-only service with no signing. [Current hosted verification](../review/UI_REFINEMENT_HOSTED_VERIFICATION.json), [UI review](../review/OPUS_UI_REFINEMENT.md). Earlier guide-only deployment evidence below remains historical. These host deployments created no contracts or chain transactions.

## Verified

- Anonymous GET requests to `/`, `/guide.html`, `/api/health`, `/api/config`, `/api/vault?owner=0x5B935E09b4749efbE9AA9855ac049d7cacE32659`, `/api/positions` and `/api/activity` returned HTTP 200. API responses are JSON and contain real Arc Testnet state. HEAD `/api/vault` also returned 200.
- Health reports chain 5042002, reachable RPC, deployed contracts, read-only operation and no host signing. Requests took approximately 1–1.65 seconds in this check. [Captured public responses](../review/HOSTED_API_VERIFICATION.json).
- Production uses the public `https://rpc.blockdaemon.testnet.arc.io` read endpoint. The default shared endpoint had intermittently rate-limited log reads; its earlier 503 evidence is retained in [local verification](../review/API_LOCAL_VERIFICATION.json).
- Activity's first page can be empty when no events fall in the latest eight 1000-block windows. Its older-history cursor returned the 27 earlier events; an empty recent page is not a claim that the deployment has no history.
- The final local app passed lint/typecheck/build and focused application checks. Independent responsive Earn/Trade inspection passed at 1280 and 390 CSS pixels with no horizontal overflow. [Review](../review/UI_API_REVIEW.md).
- Upload exclusions omit wallet/environment files, Studio metadata, source-only contract/dependency directories and generated build caches. The host contains no wallet private keys or Studio proxy credentials.

## Browser captures

Public hosted reads, with no injected wallet in the verification browser: [Earn desktop](../screenshots/hosted-earn-desktop.jpg), [Trade desktop](../screenshots/hosted-trade-desktop.jpg), [Trade mobile](../screenshots/hosted-trade-mobile.jpg), [loaded Activity history](../screenshots/hosted-activity-desktop.jpg). The real quote for a 0.10 contribution showed 246 cirBTC atoms and 196.04% initial coverage. These captures verify rendering and public reads, not browser-wallet transactions.

## Browser-wallet rehearsal: complete

The founder connected MetaMask and attempted a 0.10 deposit. The header and balance showed a connected account, but the action returned “Connect a wallet first” before any signing prompt. Read-only verification found zero allowance, zero latest/pending nonce and the original 20 test-USDC balance. Studio reproduced and corrected the wallet-client preparation defect. Codex passed 28 focused cases, lint/typecheck/build and redeployed. The public JavaScript bundle is byte-identical to the tested local build and health reports d71ddbd. The founder’s retry succeeded: [exact approval](https://explorer.testnet.arc.io/tx/0x12eab7381ba3ed5397c90bd5a808440080054402b7a414408d8806910afc1c0d) and [deposit](https://explorer.testnet.arc.io/tx/0xee5a1b2847299604da329322f857ed90fd3fe3d87822438a61c0edeac2b22baf). Independent receipt, calldata and accounting checks verify 0.10 test USDC deposited for 0.09997 shares, with NAV increasing by exactly 0.10. [Evidence](../review/BROWSER_DEPOSIT_VERIFICATION.json), [review](../review/BROWSER_WALLET_REVIEW.md), [host verification](../review/WALLET_FIX_HOSTED_VERIFICATION.json).

The founder used two separate Chrome/MetaMask accounts: depositor `0x5B935E09b4749efbE9AA9855ac049d7cacE32659` and trader `0xAA46220DfD751f915d9c802412eDaBC0aB69dEcC`. Both received official faucet test USDC. The founder signed every browser approval and action. The keeper used its separately authorized Studio gas wallet.

| Step | Actual result | Receipt / independent evidence |
| --- | --- | --- |
| Trader approval and open | Exact 0.10 approval; position 3, 0.10 principal + 0.000383 fixed markup; 246 cirBTC atoms pledged; 196.04% coverage at opening | [Approval](https://explorer.testnet.arc.io/tx/0xd535717d49077c3d6fce667a5a33103875553072aa552a5a1c7466d3739ace26), [open](https://explorer.testnet.arc.io/tx/0xa311d6e40c00a24e4d83434fa91733899b3f5235f46c7decaf38b34044400a20), [checks](../review/BROWSER_OPEN_VERIFICATION.json) |
| Trader approval and full repayment | Exact 0.100383 approval/payment; remaining principal and markup zero; position closed; 246 cirBTC atoms returned to trader | [Approval](https://explorer.testnet.arc.io/tx/0x5e3db337dc486027e9d99f7cba9dff8e8dc759ce640a72c6e3ef95fc0f5c7a8d), [repay and release](https://explorer.testnet.arc.io/tx/0x8e76a287a16c5ebe6d719298d0c4391f0035889037052f2e2999fb290d4bf12c), [checks](../review/BROWSER_REPAY_VERIFICATION.json) |
| Depositor withdrawal request | Request 1 locked all 99,970 share units | [Request](https://explorer.testnet.arc.io/tx/0xfa78120f24459fda306bfda954ce14f032cac2ce890754a815434d1216960815) |
| Keeper FIFO processing | Three blocks later, burned 99,970 units and reserved 0.100028 USDC; caller is dedicated keeper `0x60579…a373` | [Process](https://explorer.testnet.arc.io/tx/0xcb4125096e937bad51fe05641370f2a5dc5c3c09e32fc4f979a18461034e3855) |
| Depositor claim | Transferred 0.100028 USDC; shares, locked shares and claimable balance all zero; queue empty | [Claim](https://explorer.testnet.arc.io/tx/0x72683156f818699601f9d43bf96118ebe38cc34018e120a2153dc9dcf04835c4), [request/fill/claim checks](../review/BROWSER_WITHDRAWAL_VERIFICATION.json) |

All nine browser/keeper receipts succeeded. Raw calldata, signers, exact approvals, acquisition/sale/pledge event order and block-pinned state were checked independently. The withdrawal payout is `floor(99970 × 1000559 / 999970) = 100028` micro-USDC. Filling reduced NAV from 1.000559 to 0.900531; the later claim left NAV at 0.900531. The payout includes 0.000028 USDC above the deposit before wallet gas; it is not a net-profit claim.

After the trader's purchase, the thin pool quoted only 235 atoms for another 0.10 contribution, giving 187.28% initial coverage. The app correctly blocked that new opening below the 190% threshold and reference floor. Repayment releases BTC to the trader; it does not sell it back into the pool. Use the successful recorded receipts in the final walkthrough, and do not imply the same size remains executable at every later quote.

Prior script-driven live contract receipts remain separate evidence in [checkpoint 02](02-live.md).

## Bounded keeper episode

The user authorized at most 60 checks with 12-second gaps and a 0.5 test-USDC journal gas budget. The Studio wrapper ran from 15:08:26Z to 15:21:38Z on November 6, completed all 60 checks successfully and exited. Tick 59 submitted the single withdrawal-processing transaction above, spending 0.00248956 test USDC in gas. The final read-only Studio check confirmed that the wrapper no longer ran; no restart was performed. [Sanitized status](../review/STUDIO_KEEPER_EPISODE.json).

The keeper is an external process and has no published heartbeat. It is not scheduled on Vercel, and this completed episode is not continuous hosting. The app's manual permissionless controls remain available. The founder selected the existing Studio app URL plus the public Vercel URL, with Studio history/code/traces shown in the demo. Judge access remains unverified, and organizer confirmation is not a delivery blocker. The recorded demonstration remains pending; see [provenance](../BUILD_PROVENANCE.md) and [demo runbook](../DEMO.md).

## Controlled price-rise demo: position 4

Completed November 6 at 22:17 IST, with the same deployed contracts. The founder signed the browser approval, opening and owner close. The dedicated Studio operator restored the existing pool around 80,000 and then bought cirBTC to simulate demand; this was controlled testnet activity, not organic market performance. The actual pool moved from 79,997.772747 to 100,377.571825 USDC/cirBTC (+25.47%). The independent operator fixture moved from 80,000 to 100,000 only after the real swap.

| Item | Amount (USDC unless stated) |
| --- | ---: |
| Trader contribution | 0.100000 |
| cirBTC purchased and pledged | 247 cirBTC sats |
| Fixed debt | 0.100383 |
| Sale proceeds | 0.242270 |
| Payout after debt | 0.141887 |
| Trading profit before gas | 0.041887 |
| Approval + opening + closing gas | 0.0300419514375 |
| Net trader wallet gain | **0.0118450485625** |

The native-USDC balance reconciles exactly from 19.7763515 to 19.7881965485625. Position 4 has no debt or collateral left. The prior 246 cirBTC sats in the trader's wallet remain unchanged. LP NAV received 0.000294 and manager cash 0.000089 from the fixed markup.

[Opening](https://explorer.testnet.arc.io/tx/0x75b67561be287fad78b9af2baec55df4a5ebeb0ac30f307eb850d3fedd99c750) · [operator market buy](https://explorer.testnet.arc.io/tx/0x1e1a581514c172e13e43fbc693bbae677214d146595a0d226603db141569e4c5) · [owner close](https://explorer.testnet.arc.io/tx/0xe2f98645857130e922c46f053ea1444b5704e8a8dc6fc66bc5bdd40b79bd9ad0). Independent evidence: [prepare](../review/PROFIT_PREPARE_VERIFICATION.json), [open](../review/PROFIT_OPEN_VERIFICATION.json), [raise](../review/PROFIT_RAISE_VERIFICATION.json), [close and complete gas accounting](../review/PROFIT_CLOSE_VERIFICATION.json).

Operator costs are separate from trader P&L: one 547-sat restore sale, one 2.761982-USDC market buy, and 0.0123200015 USDC of operator gas across five transactions. The operator stayed below its 1,000-sat restore, 4-USDC buy and 0.2-USDC gas limits. No contracts were redeployed and no keeper was restarted. [Studio script comparison](../review/PROFIT_DEMO_SOURCE_MATCH.json).
