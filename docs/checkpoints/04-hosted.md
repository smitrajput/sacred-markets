# Checkpoint 04: public frontend and read API

Public app: **https://sacred-arc-mvp.vercel.app**. Source checkpoint: `1737996`. Deployment: `dpl_H9Nz4TLBMP7fbfLzEET2hyCB5xFd`, Vercel project `sacred-arc-mvp` in `smit-rajputs-projects`. Codex deployed the downloaded Studio application through the authenticated Vercel CLI; contract generation/deployment remained in Studio. This host deployment created no contracts or chain transactions.

## Verified

- Anonymous GET requests to `/`, `/guide.html`, `/api/health`, `/api/config`, `/api/vault?owner=0x5B935E09b4749efbE9AA9855ac049d7cacE32659`, `/api/positions` and `/api/activity` returned HTTP 200. API responses are JSON and contain real Arc Testnet state. HEAD `/api/vault` also returned 200.
- Health reports chain 5042002, reachable RPC, deployed contracts, read-only operation and no host signing. Requests took approximately 1–1.65 seconds in this check. [Captured public responses](../review/HOSTED_API_VERIFICATION.json).
- Production uses the public `https://rpc.blockdaemon.testnet.arc.io` read endpoint. The default shared endpoint had intermittently rate-limited log reads; its earlier 503 evidence is retained in [local verification](../review/API_LOCAL_VERIFICATION.json).
- Activity's first page can be empty when no events fall in the latest eight 1000-block windows. Its older-history cursor returned the 27 earlier events; an empty recent page is not a claim that the deployment has no history.
- The final local app passed lint/typecheck/build and focused application checks. Independent responsive Earn/Trade inspection passed at 1280 and 390 CSS pixels with no horizontal overflow. [Review](../review/UI_API_REVIEW.md).
- Upload exclusions omit wallet/environment files, Studio metadata, source-only contract/dependency directories and generated build caches. The host contains no wallet private keys or Studio proxy credentials.

## Browser captures

Public hosted reads, with no injected wallet in the verification browser: [Earn desktop](../screenshots/hosted-earn-desktop.jpg), [Trade desktop](../screenshots/hosted-trade-desktop.jpg), [Trade mobile](../screenshots/hosted-trade-mobile.jpg), [loaded Activity history](../screenshots/hosted-activity-desktop.jpg). The real quote for a 0.10 contribution showed 246 cirBTC atoms and 196.04% initial coverage. These captures verify rendering and public reads, not browser-wallet transactions.

## Browser-wallet rehearsal: pending

The founder must sign approval/deposit, opening, repayment and withdrawal actions through the hosted UI. No browser-wallet receipt is claimed yet. Prior script-driven live contract receipts remain valid separate evidence in [checkpoint 02](02-live.md).

The keeper is an external process and has no published heartbeat. It is not scheduled on Vercel. The app's manual permissionless controls remain available. Studio project access for judges and the recorded demonstration are still pending; see [provenance](../BUILD_PROVENANCE.md) and [demo runbook](../DEMO.md).
