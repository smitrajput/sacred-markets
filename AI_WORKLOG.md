# Sacred AI work log

This log distinguishes observed contributions. It was assembled by Codex on November 6, 2026 from the current conversation and artifacts; earlier work is not backdated here.

## Current evidence

- **User:** supplied the Sacred website/docs and organiser screenshots and implementation constraints; specified deadline, simplicity, priority of an end-to-end demo, Fable review before implementation, and small sequential commits.
- **Existing Sacred material:** public design/site and older repository code existed beforehand. Their complete authorship history has not been reconstructed in this log.
- **Codex:** researched current public protocol and integration documentation; drafted the specification and staged prompts; checked arithmetic examples; incorporated an internal consistency review; prepared plan, commit and Fable-review handoffs. These artifacts are AI-assisted, not presented as solely human-authored.
- **Claude Fable:** review supplied by the user on November 6,2026; identified integration, sizing, hosting, queue and Git issues. See review dispositions for accepted changes and corrections.
- **Arc Studio:** generated the scaffold, adapter, vault, price fixture, financing engine, frontend, read API, tests and operator scripts; deployed and rehearsed the core through the same app. Codex deployed the downloaded frontend/read API to Vercel.
- **Verification so far:** specification arithmetic; 70 adapter checks; 138 vault/engine tests; two real Arc-fork engine cases; 12 earlier pool-smoke receipts; all 29 core receipts and live repayment, keeper and FIFO accounting; app checks, responsive browser reads and public hosted API. Browser-wallet end-to-end verification remains upcoming.

## Update format

For each real checkpoint record: date/time; actor/tool; feature or decision; source/prompt/review reference; actual validation; commit SHA; Studio trace/project URL when available. Record human understanding and review through concrete decisions and feedback, not invented line-of-code percentages.

## Review checkpoint

Fable review: received. Codex dispositions: complete. Final specification: v0.3 pinned for implementation preflight. See docs/review/REVIEW_STATUS.json.

## November 6 review integration

- User requested ETHSkills, design resources and selected Matt Pocock skills. Codex installed pinned upstream revisions; installed sources and scope are documented in SKILLS.md.
- Codex independently checked Arc Testnet block 71009777: contract bytecode, three PoolManager identity getters, existing EURC pool liquidity and uninitialized cirBTC pool. No transaction was sent.
- Codex corrected reserve/trade requirements, the integer partial-sale scaling factor and dust-limited coverage bands. Kept an independent admin-controlled testnet fixture and preserved primary/tail/backstop ordering.
- Codex revised specification, prompts, local Git workflow and public plan; application generation remains a later Studio step. Skills installed locally do not imply they ran inside Studio.

## Reviewed handoff commits

Signed planning commits in `sacred-markets`, branch `codex/arc-mvp`, based on `b5b8906`:

| SHA | Change | Changed lines |
| --- | --- | --- |
| af8fecb | docs: establish MVP plan and contribution record | 86 |
| 2dd0a22 | docs: specify reviewed sale financing MVP | 297 |
| 20624d2 | docs: record review fixes and verification evidence | 119 |
| be337f2 | docs: define Studio checkpoint and local Git workflow | 110 |
| 3873e13 | docs: add contract and integration build checkpoints | 29 |
| e5b0119 | docs: add app verification and delivery checkpoints | 32 |
| 4ac4e30 | docs: document installed MVP engineering and design skills | 54 |

Validation: reviewed spec hash matches both copies; all seven prompts fit the10,000-character cap and select one checkpoint; root document links resolve; public handoff excludes internal strategy; arithmetic and read-only RPC checks are documented. Application tests and deployments have not run.

## Browser handoff correction — November6

The user supplied a Studio screenshot showing a10,000-character rejection for the1,984-character first prompt with the37,650-character spec attached. Earlier validation checked prompt files alone and did not establish browser attachment behavior. Codex replaced attachment-dependent prompts with self-contained messages below8,500 UTF-16 units, corrected the instructions and kept protocol requirements. The screenshot confirms rejection; the exact browser counting mechanism and corrected send acceptance are not yet independently observed.

## Checkpoint 00a — 2026-11-06T16:20+05:30

Arc Studio generated the scaffold and corrected unused starter tooling after Codex reproduced a local typecheck failure. Codex pulled and reviewed the files, pinned the byte-identical forge-std release as a submodule, normalized trailing blank lines in five exported config/entry files, preserved prior-work documentation and performed the checks in [CHECKPOINT_00A.md](docs/review/CHECKPOINT_00A.md).

Studio app: [Sacred](https://studio.arc.io/app/37c6c8dc-b313-49c9-9cbb-fe5f61673ab3). Cleanup thread: `868bf545-07ba-4ecd-a97c-b45762be5d3c`. All generation remains in that same app. No financial contracts, API or deployments are claimed for this checkpoint.

| SHA | Change | Changed lines |
| --- | --- | --- |
| e2caf62 | chore(deps): pin Studio scaffold packages and runtimes | 2361 |
| faadde8 | build(contracts): pin forge-std and align Foundry layouts | 114 |
| 917d040 | build(web): configure Vite TypeScript and lint checks | 238 |
| b92f89a | chore(studio): preserve generated chain metadata | 621 |
| 1a1a086 | chore(studio): preserve amount and receipt helpers | 590 |
| 5022713 | chore(studio): retain development transaction tracing | 501 |
| 4f87a59 | chore(studio): retain console capture and share integration | 378 |
| ef7f4d3 | feat(config): verify Arc token manifest with live reads | 140 |
| d378f7b | feat(scaffold): display live network and token status | 293 |

The 2,305-line generated Bun lockfile is kept in the dependency-only commit. Every remaining implementation/import commit is below 1,000 changed lines; the two Sacred-specific commits are 140 and 293 lines. Starter modules are labelled as imported Studio tooling, not newly designed protocol features.

## Automated execution and same-day finish — November 6

The user authorized Codex to prompt Studio directly for all remaining checkpoints and escalate blockers, and moved the hard finish to November 6 at 22:30 IST. Codex revised delivery gates and prompt timing without changing protocol economics. The first automated v4 dependency/interface checkpoint is running in the existing Studio app. Optional bridging is off the critical path.

00b dependency/interface checkpoint: Studio generated pinned dependency manifest, installer and fork checks. Codex independently installed dependencies and ran all eight fork tests successfully; preserved small commits 8c10f3e, a36897b, af609f3. Source-runtime comparison is recorded from Studio evidence in docs/checkpoints/00b-deps.md. No transaction broadcast.

The user connected Vercel and approved dedicated Studio testnet wallets, limited to Arc Testnet and at most 20 test USDC / 0.001 test cirBTC used per wallet for deployment, seeding and demos. Codex adjusted hosting to Vercel frontend/read functions; continuous keeper execution remains separate.

## Checkpoint 00b adapter — November 6

Studio generated the authenticated fixed-pool venue and tests. Codex reviewed the implementation, independently ran 32 unit tests, identified that standard Foundry cannot execute Arc native-USDC precompiles, and directed Studio to use Circle Arc Foundry v0.8.0-4. Studio removed its temporary shim and proved real native-USDC rollback. Codex independently passed all 68 tests across the initial run (65 pass, 3 RPC-rate-limit interruptions) and a serial retry of the affected three. Details: [adapter evidence](docs/checkpoints/00b-adapter.md). Implementation commits: 793db01, f330429, 185566b. No live transaction yet.

The user requested Claude models as bounded helpers. Codex launched a tool-free Opus 5.5 adapter review through the installed, authenticated Claude Code CLI; findings were reviewed; two focused regression additions were accepted and independently passed in the live-smoke checkpoint. Studio remains the application writer and Codex verifies accepted findings. [Reviewer workflow](docs/CLAUDE_REVIEW_WORKFLOW.md).

## Checkpoint 00c and main branch — November 6

Studio created isolated testnet wallets, a read-only health API and Vercel configuration. Codex independently passed eight API tests, lint/typecheck/build, and real local `/api/health` and `/health` requests. Studio CLI did not expose a Vercel deployment tool; hosted deployment is pending. The user explicitly requested merging to main and future direct pushes: Codex fast-forwarded origin/main to e8caa60, preserving all 33 sequential commits without squashing.

## Live swap and vault review — November 6

Studio initialized and seeded the fixed cirBTC/USDC pool, deployed a separate smoke adapter, and completed a 0.20-USDC purchase followed by sale of the acquired 195 cirBTC atoms. Codex independently verified all 12 receipts, decoded both swap calls/events, reconciled native-USDC balances including gas, and ran the two new regression tests. Code and evidence were pushed in six small commits through bd928d1. The scripts retain a documented broadcast/journal crash window that must be addressed before reuse for unattended deployment.

For the vault, Codex rejected two aspects of the first Studio pass despite green tests: equity received before acquisition and position removal at principal zero. Studio corrected both and implemented FIFO, dust handling and claims. Codex reviewed the code and independently passed all 76 vault tests. Protection accounting and the final invariant handler are in progress. The first-pass evidence remains explicitly historical; no chronology was fabricated.

The user requested a themed implementation guide. Claude Haiku 5.5 produced a bounded, tool-free HTML draft using an allowlisted factual brief. Codex corrected reserve-accounting, key-custody and repayment wording and is checking the rendered document. It remains marked as a draft until reconciled with final implementation.

## Checkpoint01c and visual guide — November6

Studio implemented cumulative collected-markup allocation, manager reserve replenishment and the final-loss waterfall. Codex synchronized the exact interface/fixtures and Studio’s deletion of the obsolete invariant test, independently passed all98 vault tests, and checked the handler call statistics. A bounded Claude Opus 5.5 review found one useful origination-hardening opportunity and a handler error-classification gap; the lead distinguished those from the reviewer’s overly broad reading of the withdrawal-reservation requirement. Dispositions and pending fixes: [vault review](docs/review/OPUS_VAULT_REVIEW.md). No deployment yet.

The user-requested master guide was drafted with Claude Haiku5.5, corrected by Codex and rendered in the browser. The guide includes five reusable SVG diagrams, depositor/trader/keeper journeys and worked accounting examples. Versioned in commit a79cbbf, with an explicit implementation-in-progress status pending final reconciliation. [Guide](docs/MASTER_GUIDE.md).

## Checkpoint02 engine — November6

Studio generated the price fixture, fixed-policy financing engine, operator refresh script and focused tests. Codex independently reproduced a keeper-sizing defect: caller minimum output could force a full sale in place of a partial one. Studio corrected it and added a mode/quantity invariance regression. Codex’s independent fuzz run then exposed a small-equity rounding boundary that the first passing seed missed; Studio corrected the test-domain assumptions, preserved the initial-coverage guard and added explicit boundary/reentrancy cases. The final independent run passed all138 vault/engine tests using the original failing seed. Two actual Arc-fork integration cases and TypeScript typecheck also passed. Slither0.11.6 findings were reviewed and dispositioned; Claude Opus 5.5 provided a bounded additional review. See [engine review](docs/review/ENGINE_REVIEW.md) and [static analysis](docs/review/STATIC_ANALYSIS.md). No production safety claim is made.

## Checkpoint 02 live — November 6, approximately 18:50 IST

Studio deployed the four core contracts, seeded protection and initial LP cash, and ran purchase → full repayment → BTC release, a separate keeper partial sale, and FIFO request → fill → claim. Codex independently matched deployed runtimes to local reviewed output, checked wiring / policy getters, and verified all 29 receipts against signer, nonce and calldata. The 55 read-only checks also verify repayment allocation, post-sale coverage of 191.39%, and claim payout net of gas without a second NAV debit. TypeScript passed locally after the pull. Source and journey evidence were committed separately: 224dd9d, 4b3f805, 9d373a7, 73d8158, 876b6db, fea6d30 and 363cbcb. No commit was backdated.

The visual guide now links deployed contracts and live participant journeys. Claude Haiku5.5 drafted it; Codex corrected and reconciled it against code and independent chain reads. Frontend / API descriptions remain labelled as pending implementation.

Checkpoint03 began in the same Studio app, exporting the actual ABIs and testing public RPC log bounds, then stopped at the per-user daily allowance. No claim is made that the unfinished frontend is functional. Recovery work will continue in the same app after the allowance is restored.

## Checkpoint 03 completion and hosting — November 6

After the user purchased one allowance increase, Studio completed Earn/Trade/Activity, read API, public keeper controls, exact approvals and transaction recovery. Codex independently found pagination gaps, receipt/replacement handling and authoritative-refresh/persistence defects; Studio corrected them in the same app. Traces, prompts and source comparison are in [build provenance](docs/BUILD_PROVENANCE.md). Codex retained strict lint configuration and independently passed 42 app cases, then the final 20 transaction/real QueryClient cases (nine new), lint/typecheck and production build. No contract money-flow suite was repeated. [Review and practical limits](docs/review/UI_API_REVIEW.md).

Application commits were small and sequential: 8ea6a47, abff0ce, 14f600b, 891cf83, 28afd9c, f9aaa83, a923dec, f89688e, c62b253, 0c8c040, 41768a1 and fbb9af3. Upload exclusions were committed separately in 1737996. Codex used the authenticated local Vercel CLI to deploy the Studio-generated frontend/read API to [sacred-arc-mvp.vercel.app](https://sacred-arc-mvp.vercel.app). Public checks returned 200 for the page, guide and all five API endpoints. Host RPC was changed to the public Blockdaemon Arc Testnet endpoint after the default shared RPC intermittently rate-limited logs. No wallet keys or Studio proxy credentials were exported.

The user asked for judge-verifiable Studio authorship. Codex freshly downloaded 78 scoped files: 76 matched repository bytes exactly, and the remaining two differed only in trailing whitespace. Evidence was published in 2d75612. The screenshot showed the original scaffold conversation; subsequent work is in the same app's continuation thread. Studio also repaired a stale IPv4 Vite/esbuild preview process, confirmed module/API HTTP 200 and changed no source files. The browser Tracing panel is runtime instrumentation, separate from build-run trace identifiers. Share currently exposes hosting choices; public judge access to the Studio project remains unverified.

## Browser-wallet preparation correction — November 6

The founder confirmed Studio preview and runtime tracing worked after the dev-server repair, then reported a connected MetaMask wallet receiving “Connect a wallet first” when attempting a 0.10 deposit. Read-only checks proved no approval or transaction had been sent. Studio reproduced the actual hook failure with a real Wagmi configuration and scripted wallet in a temporary DOM harness, corrected action-time signer resolution, and added eight deterministic connector regressions. Codex reviewed the exact downloaded code, independently passed 28 wallet/transaction/refresh tests plus lint/typecheck/build, and pushed d71ddbd. The same Vercel project was redeployed; the served bundle exactly matches the local tested build. A fresh Studio comparison covers 81 files: 79 exact and two trailing-whitespace differences. The founder’s retry succeeded, and Codex independently verified approval/deposit receipts, nonce order, exact amounts, minted shares and NAV accounting. Opening/repayment/withdrawal were still pending at this checkpoint and were completed below. [Incident review](docs/review/BROWSER_WALLET_REVIEW.md).

## Separate-wallet browser rehearsal — November 6, completed 20:53 IST

The founder used Chrome/MetaMask with separate depositor and trader accounts. After the deposit, the trader opened position 3 with a 0.10 test-USDC contribution and repaid the fixed 0.100383 debt; all 246 pledged cirBTC atoms returned to that trader. The depositor requested all 0.09997 shares, the dedicated keeper processed the FIFO request, and the depositor claimed 0.100028 USDC. Codex independently verified all nine receipts, exact approvals, event order, released balance and block-pinned NAV accounting. Fill reduced NAV once; claim did not reduce it again. The later thin-pool quote fell below the opening guard, and the UI correctly blocked another 0.10 opening. No price, pool or coverage threshold was changed to bypass it. [Hosted evidence](docs/checkpoints/04-hosted.md).

The user explicitly authorized a bounded keeper episode: at most 60 sequential checks with 12-second gaps and a 0.5 test-USDC journal gas budget. Studio ran it from 15:08:26Z to 15:21:38Z, sent one FIFO-processing transaction on tick 59, spent 0.00248956 test USDC in gas and exited after all 60 successful checks. A subsequent read-only Studio status check (trace `01a1b176-f78b-7618-999f-b706c7cd14c4`) confirmed completion. No restart occurred. This demonstrates one real automated action, not continuous keeper uptime. [Status](docs/review/STUDIO_KEEPER_EPISODE.json).

## Final guide and submission preparation — November 6, 21:14 IST

Codex reconciled the guide, project memory and demo script with the deployed application and completed browser receipts. The public guide was redeployed from documentation checkpoint 7170898; its bytes match the reviewed copy and the application bundle remains byte-identical to the wallet-verified build. All 81 previously compared implementation files are unchanged. Codex prepared a six-slide editable presentation in Spaces and the [submission draft](docs/SUBMISSION.md), with recording and Studio judge access left explicitly open. At the user's request, the separate local progress page was updated from four to seven verified milestones and fresh account-usage snapshots; it now displays independent timestamps and flags readings older than fifteen minutes. No implementation code or contract behavior changed.

## Founder submission-route decision — November 6

With the Arc team unavailable, the founder chose to submit the existing Studio app URL and public Vercel URL and show Studio history, current code and runtime traces in the demo. Codex recorded this as the selected submission approach and removed organizer confirmation as a blocker. Judge access remains unverified; no organizer approval or public conversation access is claimed. The founder also declined the optional DeltaV update; nothing was posted.

## November 6: brand UI refinement

At the founder's request, Claude Opus 5.5 directed a bounded design pass using the existing sacred.markets brand kit while presentation design ran separately. Arc Studio implemented the app refinements in the same workspace, then corrected two mobile numeric-wrapping defects found by Codex. Codex independently passed 36 focused wallet/transaction/policy/refresh cases, lint/typecheck/build and a 44-expression AST comparison against the wallet-verified behavior. Browser review covered desktop and mobile layouts, keyboard tabs and live quote updates. The final 23-path comparison records 22 exact content/hash matches and one trailing-blank-line normalization. A visual reviewer identified the inherited Studio badge covering phone copy; Studio moved it after the footer. Codex also corrected a CLI binary-download defect by restoring the exact original font binaries, whose hashes were independently confirmed in Studio. Preexisting brand assets are disclosed; no financial policy, signing flow or contracts changed. [Review](docs/review/OPUS_UI_REFINEMENT.md).

The refined UI was deployed from `9bf75bd` to the existing Vercel alias as deployment `dpl_AzbYyczGB3yrEh1KYbq4xLyZLGCi`. Public JavaScript/CSS, all eight font binaries, the authentic logo and updated guide match reviewed local bytes. Production health returned 200 with commit 9bf75bd and read-only/no-signing mode. Browser font checks confirmed loaded Libertinus families; the same Studio attribution remains after the footer and no longer overlays terms. [Hosted verification](docs/review/UI_REFINEMENT_HOSTED_VERIFICATION.json).

## November 6: controlled profit demonstration

The founder preferred a profitable owner sale after a simulated price rise and chose the least-work path without redeploying contracts. Codex checked the live pool, independently rehearsed existing deployed contracts on an Arc-aware local fork, and selected a nominal 25% fixture rise because gas can outweigh a 10% rise on the immutable 0.10 test-USDC account cap. Arc Studio authored a bounded operator script in the same app, then removed a gas-estimation fallback after Codex review. Three source files match the downloaded Studio bytes; five local focused checks and TypeScript passed.

The operator sold 547 cirBTC sats to restore the pool around 80k. The founder approved/opened position 4 with 0.10 contribution, 247 sats and 196.84% coverage. A separate operator buy of 2.761982 testUSDC moved the actual pool to 100,377.571825 (+25.47%); only then did the operator set the independent fixture to 100,000. The founder used ownerClose in the redesigned public app. Codex independently checked all eight new receipts, exact approvals, signers, call data, asset-event order, debt settlement and balances. The 0.141887 payout minus 0.10 equity and 0.0300419514375 total trader gas equals 0.0118450485625 net trader gain. Operator gas 0.0123200015 and market-moving funds are disclosed separately. No keeper restart or contract redeployment occurred. Evidence is in docs/review/PROFIT_* and the hosted checkpoint.

Claude Opus 5.5 separately designed the existing six-slide presentation using the Sacred brand kit; Codex applied and rendered it, preserved editable evidence/architecture, verified the actual live viewer fonts, and updated the deck with the independently verified profit result.

## November 7: visible price-rise demo evidence

At the founder's request, Codex made the historical pool-price comparison visible on slide 3: 79,997.77 to 100,377.57 test USDC/cirBTC (+25.47%). The same slide now distinguishes trader return before gas (+41.89%) from return after all three wallet fees (+11.85%), with the controlled operator buy and excluded operator costs disclosed. The six-slide deck retains its Opus-directed layout and brand typography; the changed slide was rendered and inspected. The demo runbook allocates 1:15–1:35 to the price checkpoints and actual operator-buy receipt, followed by the verified close. Notes distinguish the separate reference fixture from pool prices and explain that the baseline precedes the trader opening. These are completed historical transactions; no new trade, price update or keeper run occurred.

The founder then supplied exact cover copy for Sacred Markets, requested the price event between the financing and closing rows, and asked for clearer keeper and source-comparison labels. Codex applied these edits in the existing six-slide deck and inspected all four changed slides. The provenance slide now explicitly compares Studio files with the GitHub repository at the historical d71ddbd checkpoint and separately identifies the 23-path UI comparison at 9bf75bd. The keeper node identifies an Arc Studio cloud worker, with its completed 60-check status below. A read-only pool snapshot at block 71100245 reconciles both liquidity ranges to StateView and estimates 12.823013 test USDC plus 0.000102254840 cirBTC in principal, excluding accrued fees. The snapshot and dated slide notes distinguish this approximately 22.872113 test-USDC valuation from real-dollar TVL. No worker or transaction was started.

## November 7: self-service recording operator and final slide

The founder requested a fresh demo with a command they can execute after opening a trader position. Arc Studio implemented `bun run demo status / prepare / rise <positionId> / process` in the same app. Codex review identified reservation-vs-actual gas gaps, missing native-USDC spend in the reserve check, and interrupted-run recovery defects. Studio corrected those before any live operation (trace `01a1b3ca-f8a3-7590-b969-58acf9180ff7`). Codex independently passed 40 core tests, TypeScript, non-mutating type-aware lint and production build; seven downloaded source files match Studio exactly. Source checkpoint: `a503b78`; [comparison](docs/review/RECORDING_CLI_PROVENANCE.json). No contract, frontend financial behavior or deployed address changed.

Within the founder’s fresh-demo authorization, Studio ran preparation only (trace `01a1b3cf-e9f2-77f8-b219-267e2fbbb641`): exact approval and sale of 3,067 cirBTC sats through the existing demo venue, followed by the separate guard update to 80,000. Codex independently verified three successful receipts, signers, nonces, destinations, exact calldata, token transfers and gas. Sale proceeds were 2.710568 test USDC; gas was 0.006845775 test USDC. Pool spot became 79,999.395490, and the live 0.20 acquisition quotes 247 sats with 196.84% coverage. All readiness checks passed at block 71126462; the reference expires November 8 at 07:52:09 IST. [Verification](docs/review/RECORDING_PREP_VERIFICATION.json).

The new `deployments/demo-recording-20261107.json` preserves exact intents and receipts separately from the completed old episodes. A second prepare was a no-op; an old Position 4 rise plan was rejected. No rise, keeper loop, queue-processing transaction or browser action ran. The founder will open the new position, invoke the price rise in Studio Terminal, and owner-close in MetaMask. The one-shot process command is available for a later withdrawal request. Keys remain in ignored Studio environment files.

Codex updated the recording runbook and presentation notes for that sequence, retained the previous return figures as explicitly dated rehearsal evidence, and added the requested eleventh Thank you slide with the founder-supplied X avatar using a native circular crop and a clickable @smit__rajput link. The two changed visual slides were rendered and inspected.


## November 7: completed rehearsal and separate final recording

The founder completed the self-service rehearsal as Position 5. Codex verified the exact approval, opening and owner-close; 247 cirBTC sats sold for 0.242272 test USDC, settling 0.100383 fixed debt and returning 0.141889 to the trader. Profit was 0.041889 before gas and 0.0101442 after all 0.0317448 trader gas. The separate operator buy moved the prepared pool from 79,999.395490 to 100,377.611901. The depositor completed FIFO withdrawal and claimed 0.100028. All seven operator receipts were checked; operator costs remain separate. See `docs/review/SELF_SERVICE_REHEARSAL_VERIFICATION.json`.

For the requested actual recording, Studio added a second fixed `bun run demo:record` entrypoint, preserving the rehearsal journal and shared operator lock. It reuses the same planner, budgets and transaction recovery. Fresh preparation requires the completed rehearsal, closed Position 5, no active browser position and an empty queue. Codex corrected a test that depended on real journal contents and pinned prerequisite reads to one block. All 44 core tests, TypeScript, non-mutating lint and build passed. Source commit `afb3486`; eight files match Studio hashes in `docs/review/FINAL_RECORDING_CLI_PROVENANCE.json`.

Studio prepared only the final episode (trace `01a1b3ee-7be2-70f8-bcb9-fc2d27e4ec63`): exact approval and sale of 3,067 sats, then guard update to 80,000. Three receipts cost 0.006845775 test USDC in gas, with earlier journals preserved and a second prepare a no-op. No final price rise, browser transaction or keeper loop ran. The runbook and presentation's demo notes now use `demo:record`; the founder will open the actual new position, trigger the price rise and sign the owner close.


## November 7: shortened recording scope

At the founder’s urgent request, the recording now shows depositor and trader transactions only. The runbook uses opening followed by repay-and-release, then withdrawal request, depositor-triggered permissionless queue processing and claim. Price-rise commands and profit claims were removed from the active recording sequence; historical journals remain intact. No new transactions, implementation changes or tests were needed.
