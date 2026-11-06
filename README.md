# Sacred
USDC liquidity and fixed-markup cirBTC financing on Arc Testnet.

## Current build

Arc Testnet MVP: one cirBTC sale-financing market with Earn, Trade and Activity. The vault, financing engine, operator price fixture and fixed-pool Uniswap v4 adapter are deployed. The frontend and read API are public at **[sacred-arc-mvp.vercel.app](https://sacred-arc-mvp.vercel.app)**. Live contract opening, repayment, BTC release, a keeper coverage sale and FIFO withdrawal claim are independently verified; the separate browser-wallet rehearsal remains pending.

- [Arc Studio implementation provenance and source hashes](docs/BUILD_PROVENANCE.md): fresh comparison of 78 source/configuration files, 76 byte-identical and two with trailing-whitespace differences only.
- [Hosted deployment checks](docs/checkpoints/04-hosted.md) and [frontend/API review](docs/review/UI_API_REVIEW.md)
- [Architecture](docs/ARCHITECTURE.md) and [demo runbook](docs/DEMO.md)

- [Visual implementation guide and reusable diagrams](docs/MASTER_GUIDE.md)
- [Deployed contracts and live transaction walkthrough](docs/checkpoints/02-live.md)
- [Independent live verification](docs/review/CORE_LIVE_VERIFICATION.md): 55 checks and 29 successful core receipts; 138 vault/engine tests and two real Arc-fork cases passed.

- [Plan](PLANS.md) and [specification](docs/spec.md)
- [Start the Studio checkpoints](docs/README.md)
- [Studio → local Git workflow](docs/STUDIO_GIT_WORKFLOW.md)
- [Review decisions and verification](docs/review/REVIEW_DECISIONS.md)
- [AI contributions](AI_WORKLOG.md) and [skill sources](docs/SKILLS.md)

External deadline: November 7, 2026, 9:30 AM IST. Build/demo hard finish: November 6, 10:30 PM IST; submission package ready by 10:00 PM.

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

[Arc Studio workspace](https://studio.arc.io/app/37c6c8dc-b313-49c9-9cbb-fe5f61673ab3) · [00a verification](docs/review/CHECKPOINT_00A.md). Judge-accessible sharing will be verified before submission.

## Read API and hosting

Run `bun run test:api` for handler tests and `bun run build` for the frontend. The Vite development server serves `GET /api/health` and `/health` through the same handlers used by Vercel. The response includes the observed chain/block and explicit contract and external-keeper status. It has no signing endpoint.

Vercel configuration is in `vercel.json`; host-side `RPC_URL_Arc_Testnet` selects the read RPC. The public deployment uses the Arc Testnet Blockdaemon endpoint after the default shared endpoint rate-limited Activity. Studio proxy credentials remain sandbox-only. Keep wallet keys out of the host: signing belongs to the separate testnet operator. The hosted API reports the keeper as external and unverified; it is not scheduled by Vercel.
