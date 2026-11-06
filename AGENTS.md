# Sacred MVP project memory

Sacred is deployed on Arc Testnet with Earn, Trade, Activity, a read-only API and four contracts. The founder completed the browser lifecycle with separate depositor and trader wallets. Current implementation checkpoint: d71ddbd. Read `README.md` for public links, `docs/checkpoints/04-hosted.md` for the nine browser/keeper receipts and `docs/BUILD_PROVENANCE.md` for Studio/source evidence.

## Working rules

- Implementation is authored through the same Arc Studio app. Codex directs scoped prompts, pulls, reviews, tests, documents and records small sequential commits on main. Before implementation, read `docs/STUDIO_GIT_WORKFLOW.md` and the relevant checkpoint in `docs/checkpoints/`.
- Preserve existing protocol economics and the distinction between prior Sacred design and this new MVP. Read `docs/spec.md` before changing financial behavior; deployment policy and actual addresses are authoritative in `deployments/arc-testnet.json`.
- After a fix, run the focused checks that exercise the failure plus required lint/typecheck/build checks. Repeat contract money flows only when a change or new unresolved concern requires it.
- User browser actions are signed by the user. Studio operator keys stay in ignored sandbox environment files; the Vercel host has no signing key. Read `docs/ARCHITECTURE.md` before changing custody, roles or operational assumptions.
- The authorized 60-check keeper episode completed and stopped. It is not continuous hosting or permission for another episode. `processWithdrawals` and eligible settlement calls remain permissionless; the read API reports no verified heartbeat.
- USDC uses six ERC-20 decimals and eighteen native-gas decimals over the same balance. cirBTC uses eight decimals. Keep protocol calculations in integer units.
- Keep quote and coverage gates intact. After the verified browser purchase, the thin pool blocked another 0.10 opening below 190% coverage. Use the recorded receipts when demonstrating that completed lifecycle.

## Verification and delivery

For contract evidence, read `docs/review/CORE_LIVE_VERIFICATION.md`. For browser behavior, read `docs/review/UI_API_REVIEW.md` and `docs/review/BROWSER_WALLET_REVIEW.md`. Tests, builds and startup commands are listed in `package.json`.

For the final demo, read `docs/DEMO.md`. Judge access to Studio and the actual video remain separate delivery gates: source hashes and a public Vercel app do not establish judge access to the Studio conversation. Keep `AI_WORKLOG.md` and checkpoint documents factual about the actor, source, checks and limitations.

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.
