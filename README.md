# sacred-markets
Onchain shariah powered earn, leverage trade and borrow.

## Current build

Arc Testnet MVP: one cirBTC sale-financing market with Earn, Trade and Activity. Checkpoint 00a is implemented: a read-only app shell and verified token manifest. Application contracts are not deployed yet. Next: v4 integration preflight (00b).

- [Plan](PLANS.md) and [specification](docs/spec.md)
- [Start the Studio checkpoints](docs/README.md)
- [Studio → local Git workflow](docs/STUDIO_GIT_WORKFLOW.md)
- [Review decisions and verification](docs/review/REVIEW_DECISIONS.md)
- [AI contributions](AI_WORKLOG.md) and [skill sources](docs/SKILLS.md)

External deadline: November 7, 2026, 9:30 AM IST. Build/demo hard finish: November 6, 10:30 PM IST; submission package ready by 10:00 PM.

## Prior work

The [Sacred website and protocol design](https://sacred.markets/docs) and [prior repository](https://github.com/smitrajput/sacred-protocol) predate this implementation. Planning and review artifacts here are AI-assisted and attributed in AI_WORKLOG.md. New MVP implementation will be generated, tested and deployed through one Arc Studio app, with its URL and transaction evidence added as the work occurs. This repository does not claim the historical design/site as newly written code.

## Run the scaffold

Use Bun 1.3.14 and Foundry v1.7.1. Clone with `--recurse-submodules`, or initialize the pinned dependency:

```sh
git submodule update --init --recursive
bun install --frozen-lockfile
bun run check
bunx vite build
forge build --force
bun run verify:onchain
bun run dev
```

The development server prints its local URL. `verify:onchain` makes read-only Arc Testnet calls. Solidity compilation currently covers the starter tooling, not Sacred financial contracts.

[Arc Studio workspace](https://studio.arc.io/app/37c6c8dc-b313-49c9-9cbb-fe5f61673ab3) · [00a verification](docs/review/CHECKPOINT_00A.md). Judge-accessible sharing will be verified before submission.
