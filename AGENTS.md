# Sacred MVP project memory

Sacred is deployed on Arc Testnet with Earn, Trade, Activity, a read-only API and four contracts. The founder completed the browser lifecycle with separate depositor and trader wallets. Current app implementation checkpoint: 9bf75bd (Opus-directed brand refinement); wallet behavior was previously verified at d71ddbd. Read `README.md` for public links, `docs/checkpoints/04-hosted.md` for the nine browser/keeper receipts and `docs/BUILD_PROVENANCE.md` for Studio/source evidence.

## Working rules

- Implementation is authored through the same Arc Studio app. Codex directs scoped prompts, pulls, reviews, tests, documents and records small sequential commits on main. Before implementation, read `docs/STUDIO_GIT_WORKFLOW.md` and the relevant checkpoint in `docs/checkpoints/`.
- Preserve existing protocol economics and the distinction between prior Sacred design and this new MVP. Read `docs/spec.md` before changing financial behavior; deployment policy and actual addresses are authoritative in `deployments/arc-testnet.json`.
- After a fix, run the focused checks that exercise the failure plus required lint/typecheck/build checks. Repeat contract money flows only when a change or new unresolved concern requires it.
- User browser actions are signed by the user. Studio operator keys stay in ignored sandbox environment files; the Vercel host has no signing key. Read `docs/ARCHITECTURE.md` before changing custody, roles or operational assumptions.
- The authorized 60-check keeper episode completed and stopped. It is not continuous hosting or permission for another episode. `processWithdrawals` and eligible settlement calls remain permissionless; the read API reports no verified heartbeat.
- USDC uses six ERC-20 decimals and eighteen native-gas decimals over the same balance. cirBTC uses eight decimals. Keep protocol calculations in integer units.
- Keep quote and coverage gates intact. The later controlled price-rise demo opened and owner-closed position 4, realizing 0.0118450485625 test USDC after all trader gas. Its operator restored the real pool near 80k, bought toward 100k and then updated the separate fixture. That bounded episode is complete; do not replay its preparation or price move. Read docs/review/PROFIT_CLOSE_VERIFICATION.json and the hosted checkpoint. Use completed receipts for the recording; all new browser transactions require the user to sign.

## Verification and delivery

For contract evidence, read `docs/review/CORE_LIVE_VERIFICATION.md`. For browser behavior, read `docs/review/UI_API_REVIEW.md` and `docs/review/BROWSER_WALLET_REVIEW.md`. Tests, builds and startup commands are listed in `package.json`.

For the final demo, read `docs/DEMO.md`. The founder chose the existing Studio app URL plus the public Vercel URL, supported by Studio history, code and runtime traces in the demo. Do not keep organizer confirmation as a blocker or ask for it again without new evidence. Judge access remains unverified; this decision does not establish public conversation access. The actual video and presentation sharing remain delivery gates. Keep `AI_WORKLOG.md` and checkpoint documents factual about the actor, source, checks and limitations.

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.
