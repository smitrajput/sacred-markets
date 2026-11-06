# Sacred
USDC liquidity and fixed-markup cirBTC financing on Arc Testnet.

## Current build

Arc Testnet MVP: one cirBTC sale-financing market with Earn, Trade and Activity. The vault, financing engine, operator price fixture and fixed-pool Uniswap v4 adapter are deployed. The frontend and read API are public at **[sacred-arc-mvp.vercel.app](https://sacred-arc-mvp.vercel.app)**. The founder completed the real MetaMask rehearsal with separate depositor and trader accounts: deposit, open, repay and release BTC, request withdrawal, keeper processing and claim. All nine receipts and the resulting accounting were independently verified. An earlier live keeper coverage sale is also verified.

- [Arc Studio implementation provenance and source hashes](docs/BUILD_PROVENANCE.md): historical 81-file wallet checkpoint plus the [current 23-path UI/brand comparison](docs/review/STUDIO_UI_SOURCE_MATCH.json), including verified font hashes.
- [Hosted deployment checks](docs/checkpoints/04-hosted.md) and [frontend/API review](docs/review/UI_API_REVIEW.md)
- [Architecture](docs/ARCHITECTURE.md) and [demo runbook](docs/DEMO.md)
- [Browser lifecycle evidence](docs/checkpoints/04-hosted.md#browser-wallet-rehearsal-complete)
- [Submission draft and remaining founder actions](docs/SUBMISSION.md)

- [Visual implementation guide and reusable diagrams](docs/MASTER_GUIDE.md)
- [Deployed contracts and live transaction walkthrough](docs/checkpoints/02-live.md)
- [Independent live verification](docs/review/CORE_LIVE_VERIFICATION.md): 55 checks and 29 successful core receipts; 138 vault/engine tests and two real Arc-fork cases passed.

- [Plan](PLANS.md) and [specification](docs/spec.md)
- [Start the Studio checkpoints](docs/README.md)
- [Studio → local Git workflow](docs/STUDIO_GIT_WORKFLOW.md)
- [Review decisions and verification](docs/review/REVIEW_DECISIONS.md)
- [AI contributions](AI_WORKLOG.md) and [skill sources](docs/SKILLS.md)

External deadline: November 7, 2026, 9:30 AM IST. Build/demo hard finish: November 6, 10:30 PM IST; submission package ready by 10:00 PM.

The later controlled price-rise rehearsal also completed: a 0.10 contribution opened position 4, a real operator swap moved the test pool upward, and an owner close realized **0.0118450485625 test USDC after all trader gas**. [Receipts and full accounting](docs/checkpoints/04-hosted.md#controlled-price-rise-demo-position-4).

## Uniswap v4 integration

Sacred integrates the existing Uniswap v4 AMM on Arc Testnet (chain 5042002). Its fixed-pool adapter executes real USDC/cirBTC purchases and collateral sales through `PoolManager`; the app uses the v4 Quoter for executable-output checks. The pool has a 0.30% fee, tick spacing 60 and no custom hook. This is an AMM integration under the [Build with Uniswap prize](https://ethglobal.com/events/mumbai/prizes/uniswap-foundation).

- [Purchase and sale entry points](contracts/src/V4SpotVenue.sol#L127), [authenticated unlock callback and swap settlement](contracts/src/V4SpotVenue.sol#L218)
- [Financed acquisition](contracts/src/TradeEngine.sol#L178), [owner sale and settlement](contracts/src/TradeEngine.sol#L322), [coverage rebalance](contracts/src/TradeEngine.sol#L414)
- [Live Quoter interface](src/lib/contracts.ts#L30), [actual Arc fork integration tests](contracts/test/fork/TradeEngine.fork.t.sol)
- [Deployment and pool manifest](deployments/arc-testnet.json), [runtime/source identity checks](docs/checkpoints/00b-deps.md)

The v4 infrastructure already existed; Sacred initialized and seeded this cirBTC/USDC pool inside its PoolManager. [Pool initialization](https://explorer.testnet.arc.io/tx/0x2ff48c1584ef2c6ba20b98cd9ae28d6af80985f41bdb6646dd795a736d2f8773) and [initial liquidity](https://explorer.testnet.arc.io/tx/0xb28fb9412913d4d9fdc26bbd8f3f710baad01a97e14ee20ee25660faf4e4b497) are public receipts. It is a testnet pool, not a claim of an established external market.

[FEEDBACK.md](FEEDBACK.md) records integration feedback. The required [developer feedback form](https://developers.uniswap.org/hackathon-feedback) remains pending; the file alone does not complete that requirement.

## Prior work

The [Sacred website and protocol design](https://sacred.markets/docs) and [prior repository](https://github.com/smitrajput/sacred-protocol) predate this implementation. Planning and review artifacts here are AI-assisted and attributed in AI_WORKLOG.md. MVP implementation was generated through one Arc Studio app; contracts were deployed there. Codex independently reviewed and verified downloaded code, recorded small Git commits and deployed the frontend/read API using the authenticated Vercel CLI. The Studio URL and actual transaction evidence are linked below. This repository does not claim the historical design/site as newly written code.

## Run locally

Use Bun 1.3.14 and Foundry v1.7.1. Clone with `--recurse-submodules`, or initialize the pinned dependency:

```sh
git submodule update --init --recursive
bun install --frozen-lockfile
bash scripts/install-v4-deps.sh
bun run check
bunx vite build
forge build --force
bun run verify:onchain
bun run dev
```

The development server prints its local URL. `verify:onchain` makes read-only Arc Testnet calls. The adapter suite includes real Arc native-USDC fork execution through `bash scripts/test-arc-fork.sh`. On macOS the pinned Arc binary also needs `libusb` (`brew install libusb`).

[Arc Studio workspace](https://studio.arc.io/app/37c6c8dc-b313-49c9-9cbb-fe5f61673ab3) · [00a verification](docs/review/CHECKPOINT_00A.md). Submission uses this Studio app URL plus the public Vercel URL; the demo will show the Studio build conversation, code and runtime traces. Judge access has not been independently verified.

## Read API and hosting

Run `bun run test:api` for handler tests and `bun run build` for the frontend. The Vite development server serves `GET /api/health` and `/health` through the same handlers used by Vercel. The response includes the observed chain/block and explicit contract and external-keeper status. It has no signing endpoint.

Vercel configuration is in `vercel.json`; host-side `RPC_URL_Arc_Testnet` selects the read RPC. The public deployment uses the Arc Testnet Blockdaemon endpoint after the default shared endpoint rate-limited Activity. Studio proxy credentials remain sandbox-only. Keep wallet keys out of the host: signing belongs to the separate testnet operator. The hosted API reports the keeper as external and unverified; it is not scheduled by Vercel.
