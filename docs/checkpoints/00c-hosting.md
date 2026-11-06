# Checkpoint 00c: health API, hosting config, testnet wallets

Date: 2026-11-06. No contract deployed. No transaction sent by this checkpoint.

## Public demo wallets (Arc Testnet 5042002, testnet-only)

Public file: `deployments/demo-wallets.json`. Private keys are in the ignored `.env` (mode 0600) under
`SACRED_DEPLOYER_PRIVATE_KEY`, `SACRED_TRADER_PRIVATE_KEY`, `SACRED_KEEPER_PRIVATE_KEY`. They were generated with a cryptographic RNG,
never printed, never passed as command arguments, and were not present before (nothing was overwritten). A repository scan found none of the three values outside `.env`.

| Role | Address | Intended use |
| --- | --- | --- |
| deployer | `0xafC5b06665e9b99669027C18E82014916778734E` | Deploys, treasury and price-admin for the pilot, demo LP |
| trader | `0xbcA3D93DE6932535A117588744557537694A3e6c` | Demo trader |
| keeper | `0x60579fc93E6B7f2377dd952e1FD4c58C2e3Ca373` | Gas-only keeper |

Bounds recorded in the file: faucet assets only, at most 20 test USDC and 0.001 test cirBTC per wallet, no mainnet.
`.gitignore` was created (it did not exist) and covers `.env*`, `.tools/`, `.vercel/`, Foundry output, `.circle/`, `recovery_file*` and runtime logs.

Funding status at 11:33 UTC, read from the chain: deployer 0 USDC and 10,000 cirBTC atoms (0.0001 cirBTC, funded outside this turn); trader and keeper hold nothing.
The Studio faucet tool refused a USDC request for the deployer: "Faucet drip requires the DEVELOPER_ADMIN_DEFAULT_ROLE on at least one available entity for this user."
No faucet request succeeded from this side. USDC for the three wallets must come from the public faucet (https://faucet.circle.com/).

## Health API

| Path | Role |
| --- | --- |
| `api/health.ts` | Vercel Function (`GET`, `HEAD`) |
| `server/routes.ts` | Single route table: `/api/health` and `/health`. Only GET and HEAD route; any other method gets 405. Later reads add entries here |
| `server/handlers/health.ts` | Health logic: API status, one batched RPC call (chain id and latest block), contract statuses from the public manifest, honest scheduler status |
| `server/rpc.ts`, `server/http.ts`, `server/manifest.ts` | Shared RPC resolution (override, then Studio proxy, then public RPC), HTTP helpers, manifest reader |
| `server/dev-plugin.ts` | Serves the same routes in the Vite dev server |
| `server/health.test.ts` | 8 handler tests |
| `vercel.json`, `.vercelignore` | Vite build to `dist`, functions config, `/health` rewrite |

Properties: read-only, no signing route, no key material. Responses are `cache-control: no-store`. RPC errors are reduced to fixed reason codes, so the RPC URL and any token never appear in a response (tested).
`status` is `degraded` when the RPC is unreachable or the chain id differs; HTTP stays 200 because the function itself is serving.
Scheduler is reported as `{ "status": "unavailable", "kind": "external" }`: the keeper is a separately run operator process and nothing is scheduled by this deployment.

## Checks actually run

| Check | Result |
| --- | --- |
| `bun test server` | 8 passed, 0 failed |
| `bun run check` (lint and typecheck) | passed, 0 errors |
| `bun run build` | passed |
| Vite dev server, `GET /api/health` | 200, `status: ok`, chain 5042002 reachable, latest block 71,022,114 |
| `GET /health`, `POST /api/health` | 200, 405 |
| Function bundled for Node (`bun build api/health.ts`) and `GET`/`HEAD` called under Node 24 | 200 `ok`, real block 71,022,162; HEAD returned an empty body |

Local response excerpt: `status ok`, `mode read-only`, `signing none`, `chain.rpc.status reachable`, `contracts.statuses` `usdcEarn` and `cirBtcSpotFinancing` both `undeployed`, `scheduler.status unavailable`.

## Vercel deployment: NOT done, exact missing step

- No health URL exists yet, so no hosted response is claimed. A static frontend response would not count.
- This agent session exposes no Vercel tool: it cannot confirm the integration state or trigger a deploy. The session's own integration list shows Vercel as not connected.
- Step for you: in Studio open the Integrations menu (top right of the workbench, or the + menu in the chat toolbar), choose Connect Vercel if needed, then Deploy to Vercel.
  The repository already contains `vercel.json`, `api/health.ts` and the build script. After the deploy, `GET <deployment URL>/api/health` should return the JSON above with `deployment.host: "vercel"`.
- Vercel-specific risks not exercisable here: the function's ESM import resolution on Vercel's builder (verified only with a local Node bundle) and the preview-protection setting
  (a protected preview returns an auth page, not JSON). If that happens, use the production URL or disable protection for this project in Vercel settings. Do not share bypass tokens.
- For sustained RPC use on Vercel, set `RPC_URL_Arc_Testnet` in Vercel's environment settings. Without it the API uses the public RPC and may be rate limited.

## Not in scope here

No financial UI, no contract deployment, no keeper process, no signing API. Adapter and test files were not edited.

## Independent local verification

Codex passed `bun run check`, all eight API handler tests and `bun run build` (existing bundle-size warnings only). Both `/api/health` and `/health` returned HTTP 200 with live Arc Testnet chain 5042002, block 71023182, `signing: none`, and external scheduler unavailable. Hosted Vercel deployment remains pending. Local `.gitignore` retains the repository-specific dependency and Studio state exclusions in addition to generated hosting exclusions. Prior-work disclosure was preserved in README.
