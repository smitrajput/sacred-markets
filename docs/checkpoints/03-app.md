# Checkpoint 03: Earn / Trade / Activity app, read API, keeper, journal recovery

Contracts, deployments and live receipts are untouched. No contract suite was rerun. No mainnet, host, database, auth or paid resource. The keeper is NOT started or hosted. Stopped for independent browser review.

## Changed paths

- Read API: `server/chain.ts`, `server/reads.ts`, `server/handlers/{common,chainApi}.ts`, `server/manifest.ts`, `server/http.ts` (bigint-safe JSON, `apiError`), `server/routes.ts`, `api/{config,vault,positions,activity}.ts`.
- ABIs: `scripts/gen-abis.ts` -> `src/contracts/abis.ts` (generated from the compiled artifacts).
- App: `src/App.tsx`, `src/components/{Header,EarnTab,TradeTab,ActivityTab,ui}.tsx`, `src/hooks/{useAction,useWallet}.ts`, `src/lib/{policy,format,txRunner,api,contracts,text}.ts`, `src/config.ts` (Arc Testnet + injected only; mainnet/ENS removed), `src/index.css`, `tailwind.config.js` (Sacred tokens).
- Keeper and journal: `scripts/keeper.ts`, `scripts/core/journal.ts` (hardened, injectable), `scripts/core/journal.test.ts`.
- Tests: `server/api.test.ts`, `src/lib/policy.test.ts`, `src/lib/txRunner.test.ts` (health tests updated for the deployed manifest and new routes).
- Docs: this file, `AGENTS.md` (stale checkpoint facts replaced; share-link rules kept), `README.md`, `docs/checkpoints/02-live.md` (guard expiry corrected). `public/guide.html` and its SVGs were not touched; Help links to `/guide.html`.

## Read API

`GET /api/health`, `/api/config`, `/api/vault?owner=`, `/api/positions?owner=`, `/api/activity?cursor=`. Every response is JSON with `chainId`, `observedBlock`, `observedAt` and `manifestPolicyHash`; every uint is a decimal string. Reads are pinned to one observed block. Owner is validated (400), the cursor is a bounded block number inside the deployment history (400), upstream failure is an actionable 503 with `retry-after` (never an empty 200, no URL leaked). Live positions are read from the engine's bounded `activeIds` (at most 32), the queue from head to tail (at most 64). Activity scans at most 8 windows of 1,000 blocks per request, newest first, never below the deployment block (the public Arc RPC accepted 1,000-block `eth_getLogs` and rejected 10,000), returns at most 120 rows, an opaque `nextCursor` (see Review corrections), and dedupes by chain/tx/logIndex. Ephemeral per-instance caching: vault/positions 5 s, config 30 s, old log windows 10 min. Utilities live in `server/`, not `api/`. JSON batching is enabled on the RPC transport: a burst of 36 uncached calls hit the public RPC rate limit once (`Request exceeds defined limit`), and with batching and spacing 16/16 then succeeded; a hosted deployment should set `RPC_URL_Arc_Testnet` to its own provider URL.

## App

- Tabs Earn / Trade / Activity, header with Sacred, permanent Arc Testnet badge, wallet control and Help (`/guide.html`); two columns on desktop, one at 390px. Tokens as specified (paper/panel/raised/ink, accent, 3px corners, rules not shadows, serif headings, tabular numbers). Keyboard focus ring, labelled fields, aria-live statuses, arrow keys move between tabs. No injected wallet: a clear message says to open the hosted app in a wallet-enabled browser.
- Wallet action state machine (`src/lib/txRunner.ts`): switch to Arc 5042002 > FRESH allowance read > exact-amount approval only if needed (vault for Earn, engine for Trade) > simulate > sign > pending > successful receipt > authoritative refresh (waits until the API has observed the receipt block, then refetches). Rejection, revert, replacement/cancel, timeout and chain errors are distinct and recoverable; each action has its own state; a second click while one is running is ignored.
- Earn: balance, shares, NAV value, liquidity, primary/tail reserves, queued shares, reserved claim cash, deposit with mandate acceptance and a minimum-shares quote (0.5% below the NAV quote), withdrawal by SHARES with estimate, queue place and remaining shares, permissionless process (16) and claim; blockers are explained from live state (pause, queue, stale price, impairment, reserves).
- Trade: 0.10 USDC default, fixed 2x, cap and headroom, P/M/D (383 atoms shows as 0.000383), 14-day maturity, zero early rebate, accepted terms hash, reference floor, ACTUAL Uniswap quote through the Quoter, execution minimum, and initial coverage measured on the quoted output (E=10,487 buying 20 atoms is rejected before signing with a recoverable message). Positions show principal, markup, debt, pledged BTC, maturity, coverage, freshness; repayAndRelease, partial repay, ownerClose, and manual rebalance / settleMatured when eligible. Repay needs no fresh price. The oracle fixture, its timestamp and expiry (UTC and IST) are shown; users cannot update it.
- Activity: real bounded events (acquisition > sale > pledge, repayments and markup splits, queue fills and claims, reserves and losses, closure) with explorer links, block and time, verified contract addresses, honest loading/empty/error states, load-older paging; keeper scheduling is shown as external and unverified.

## Keeper (`scripts/keeper.ts`)

Sequential loop (12 s, no overlap), bounded scan of live ids, simulate one eligible action (rebalance, settleMatured, then queue processing), send one transaction and confirm before the next. Keeper key only; gas budget 0.5 USDC per journal on top of the 2 USDC reserve. Durable step ids `keeper.<n>.<action>.<id>` (n advances only on confirmed steps); the exact calldata is saved so a resume rebuilds identical bytes. Verified read-only: `bun run keeper:dry` against the live chain reported block, 1 live position, fresh reference 80,000, "nothing eligible". Not started; no claim that it runs anywhere.

## Journal hardening (`scripts/core/journal.ts`)

Resume now requires the saved chain, role, destination, calldata hash and the ACTUAL loaded signer to match. A retried signed transaction needs latest nonce == pending nonce == saved nonce, and only the byte-identical transaction (same hash) is retransmitted; an unexplained nonce advance, a lagging nonce or a pending ambiguity STOPS. Intent, nonce and hash are written before broadcast; raw bytes and keys are never stored. The runner is injectable; seven mocked tests (confirmed resume, chain-disagreement stop, unknown nonce advance, pending ambiguity x3, identical-hash resend, destination/calldata/signer mismatch, durable keeper ids, write-ahead order) pass. No live failure injection.

## Checks actually run

| Check | Result |
| --- | --- |
| `bun run test:app` (server API 5 + health 8, UI arithmetic 8, transaction runner 7, journal 7) | 35 pass, 0 fail |
| `bun run check` (oxlint type-aware + tsc) | 0 errors (1 pre-existing unused-import warning in a test) |
| `bun run build` | passes |
| Live API through the route table (config, vault, positions, activity) | all 200, `application/json`, real chain values |
| Bundled Vercel entries (`bun build api/*.ts --target=node`) executed with Node | GET and HEAD return JSON; 16/16 paced requests succeeded after enabling RPC batching |
| Server-render of Header, Earn, Trade, Activity from the real API responses | rendered with live values (NAV 0.900265, reserves 0.004/0.006, reference 80,000, activity rows) |
| `bun run keeper:dry` | runs, "nothing eligible", no transaction |

## Limitations

- A real browser render at 1280px and 390px was NOT possible here: the headless browser in the sandbox lacks system libraries (libnspr4 and others) and there is no package access. Layout, wallet connection and the signing flows still need your independent browser review. Wallet transactions from the UI were not executed.
- The first request on a cold serverless instance has no cache; the public RPC rate-limits bursts. Set `RPC_URL_Arc_Testnet` on the host.
- The reference price is an operator fixture: it expires 2026-11-07 13:13:19 UTC = 18:43:19 IST. After that opens, sales, rebalances and the vault deposit scan fail closed until `bun run price:push` refreshes it (repay, release and claims still work).
- The keeper needs the ignored `.env` and a shell; it is not deployed. The Vercel deployment itself was not redone in this checkpoint.
- Vault queue positions use ids from the API; the "place in line" for a new request is tail - head + 1.

## Review corrections (lead findings 1 to 7)

1. **Activity pagination** (`server/handlers/chainApi.ts`): the cursor is now opaque (base64url of block + logIndex) and means "resume strictly before this row". A truncated page (more than 120 rows) continues from the last returned row, even when the scan already reached the deployment block and even when 241 events share one block; otherwise it continues from the block below the scanned windows. Regressions in `server/api.test.ts`: 150 events over many blocks, 241 events in one block, cursor round trip and garbage rejection; each collects every page and proves no omission, no duplicate and termination.
2. **Window cache and speed**: windows are aligned to fixed 1,000-block boundaries (at most 8 per page, at most 1,000 blocks per RPC call, concurrency 2); settled windows have one stable key whatever the head, only the recent tail is refetched (tested: a head move refetches exactly one window). Timestamps are looked up once per distinct block of the returned page with bounded concurrency and cached. Measured through the bundled Vercel entry against the live RPC: 6 of 6 cold-process requests returned 200 in 2.2 to 2.4 s (warm 0.1 to 0.7 s), versus the 10 s function duration. Concurrency 4 had produced an upstream "Request exceeds defined limit" once, hence 2.
3. **Unknown confirmation** (`src/lib/txRunner.ts`, `src/lib/intent.ts`, `src/hooks/useAction.ts`): once a hash exists, a timeout or RPC failure while waiting is `unconfirmed`, never an unsent failure; the main hash and the approval hash are kept separately and shown with explorer links. An intent record (hash only) per chain and account is written to sessionStorage at send time and cleared on resolution, so a second submission is blocked while any transaction of that wallet is unresolved, also after a tab remount and from other buttons. "Check status" looks the hash up and resolves it; it never calls send. Approval timeouts resolve to "continue" with a fresh allowance check.
4. **Replacement**: only a `repriced` replacement counts as the intended success. `replaced` and `cancelled` report that the operation was NOT confirmed, refresh chain data and stop the approval sequence (the action is never sent). Tested for repriced, replaced and cancelled on both the approval and the action path.
5. **Refresh**: the runner reports `refreshing` (confirmed on chain) and keeps submission blocked until the API's observed block reaches the receipt block. If the API cannot catch up within its bounded wait (about 18 s) or throws, the state is `refresh-failed`: transaction confirmed, data may be outdated, receipt link kept, with a refresh-only button (no resend). Tested: duplicate start during refresh, stale or unavailable API until timeout, and refresh-only recovery.
6. **Keeper fallback**: `/api/positions` without `owner` returns the bounded public list of live positions (at most 32); a Keeper panel in Trade lists the ones eligible for rebalance or maturity with the permissionless buttons (and a truthful "none is eligible" message). Owner cards keep repay and ownerClose only. No keys or price controls in the browser or API.
7. **Trade validation and wording**: opening is disabled until the owner's exposure query has succeeded (loading or error explains why); full and partial repayment respect the 0.10 USDC gas reserve; the button reads "Open position and accept terms"; "vault lends" and "Lent out" are now "sale financing" / "Financed to traders"; the Earn text now says that processing the queue reserves cash and therefore, while positions are live, requires a fresh reference price and no unsettled impairment (`processWithdrawals` runs `_requireNoImpairment`), while claims of already reserved cash need no price (the Process button explains a stale or impaired block).

Checks after the corrections: `bun run test:app` 42 pass, 0 fail (server 16 incl. pagination and cache reuse, UI arithmetic 8, transaction runner 11, journal 7); `bun run check` 0 errors; `bun run build` passes; server render of Trade and Earn against live API data confirms the Keeper panel, the truthful empty state and the new labels. Contract suites were not repeated and the guide was not touched. A real-browser render is still pending for your review.

## Integration review fixes

- **Authoritative refresh** (`authoritativeRefresh` in `src/lib/api.ts`): success now requires every active vault and positions query (owner and public variants) to be in status "success" at `observedBlock >=` the receipt block, because TanStack swallows refetch errors; with none on screen the ownerless vault endpoint is checked. Bounded (12 attempts x 1.5 s); failure is confirmed-but-outdated with refresh-only recovery. Balances and other queries are refreshed with a capped wait; Activity and quotes can never block. Tests (`src/lib/refresh.test.ts`) use a real QueryClient with active QueryObservers, including the reproduced positions-error-at-block-76 case.
- **Confirmed intent persists** (`src/lib/intent.ts`, `src/lib/txRunner.ts`, `src/hooks/useAction.ts`): after a successful main receipt the record becomes kind `refresh` (hash + receipt block) and is cleared only when the refresh succeeds; a remount restores a refresh-only blocked state for every button. Foreign-intent recovery refreshes before writes are enabled. Approval semantics unchanged.
- **Failure safety:** the intent store never throws and falls back to memory (reload-limited, said so in the message); `persist` failures cannot lose the main or approval hash or look like an unsent error. Tested with a throwing adapter.
- **Lint:** the three test-rule exceptions were removed from `.oxlintrc.json`; `server/api.test.ts` uses typed shapes and no unused import.
- Checks: `bun run test:app` 51 pass, `bun run check` 0 errors and 0 warnings, `bun run build` passes. Contract and pagination suites were not rerun.
