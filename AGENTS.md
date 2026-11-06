# Sacred

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Sacred: USDC Earn and cirBTC spot financing on Arc Testnet. Checkpoint 00a (scaffold) is done: app shell, `contracts/foundry.toml`, and `deployments/arc-testnet.json`. No application contracts exist yet.

- cirBTC: `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` (8 decimals). USDC ERC20: 6 decimals; native gas USDC is 18 decimals and is the same balance, so protocol accounting uses ERC20 units.
- `deployments/arc-testnet.json` is the source of truth for addresses. Verified external tokens are separate from Sacred contracts (status `undeployed`, address `null`). Roles are unset. Update it only from real deploy results.
- Contract sources go in `contracts/src`, tests in `contracts/test`. Root `foundry.toml` and `contracts/foundry.toml` share one layout and output dir `contracts/out`.
- `bun run verify:onchain` rechecks the manifest against the live chain.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.

## To Run

```bash
bun install
bun run dev
```

## Checkpoint 00b-deps

Pinned Uniswap v4 sources live in `lib/` (manifest: `contracts/deps/v4-manifest.json`, installer: `scripts/install-v4-deps.sh`). Evidence: `docs/checkpoints/00b-deps.md`. Fork interface test: `contracts/test/V4Interface.t.sol`. No Sacred contracts are deployed yet.

## Checkpoint 00b-adapter

`contracts/src/V4SpotVenue.sol` implements `ISpotVenue` against the existing v4 PoolManager (fixed USDC/cirBTC 3000/60 pool, one-time engine binding). Tests: `contracts/test/*.t.sol` (unit, mock PoolManager; `forge test`) and `contracts/test/fork/` (pinned Arc fork, real contracts, fork-only balances; run with `bash scripts/test-arc-fork.sh`, which installs Circle's arc-foundry v0.8.0-4 into `.tools/`). Evidence: `docs/checkpoints/00b-adapter.md`. Nothing is deployed.

## Checkpoint 00c

Read-only health API: `GET /api/health` and `/health`, code in `server/` (route table `server/routes.ts`) with the Vercel entry `api/health.ts`; `vercel.json` configures hosting. Demo wallets (testnet-only): public addresses in `deployments/demo-wallets.json`, keys in the ignored `.env` as `SACRED_*_PRIVATE_KEY`. Vercel deploy is initiated from the Studio Integrations menu; no hosted URL recorded yet. Evidence: `docs/checkpoints/00c-hosting.md`.
