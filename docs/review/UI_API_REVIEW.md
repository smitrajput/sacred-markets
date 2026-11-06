# Frontend/API independent review — November 6, 2026

Reviewer: Codex, fresh execution chat; application author: Arc Studio. No contract changes or repeat live money-flow rehearsal were required.

## Accepted findings and corrections

1. Activity's capped rows advanced to the oldest scanned window, skipping truncated rows. Studio changed continuation to an opaque block/log-index cursor, including pages with more than 120 events in one block.
2. Historical cache boundaries moved with the head. Studio aligned completed 1000-block windows and bounded log concurrency to two; timestamp reads are bounded and cached.
3. Receipt timeouts lost the main hash and allowed resubmission. Main and approval hashes now remain separate, persisted pending records block new sends, and recovery reads the existing hash.
4. Different-call replacements were reported as success. Only same-intent repricing is accepted; replaced/cancelled outcomes stop the requested operation and approval sequence.
5. Receipt success preceded authoritative refresh, and failed refetches could resolve silently. Codex reproduced a real QueryClient case with a successful public vault read and failed owner positions still at block 76. Studio now checks active vault/position query status and observedBlock, with confirmed-but-outdated and refresh-only recovery.
6. The saved lock cleared before refresh, so remounting could reopen submission on stale state. Confirmed refresh records now survive remount and clear only after refresh succeeds. Storage adapter failures retain hashes; the memory fallback cannot survive a full page reload when sessionStorage is unavailable.
7. A keeper without its own positions could not act. The bounded public positions API and Keeper panel now support others' eligible positions. Owner repayment/close remain on owner cards.
8. Opening ignored exposure-query loading/errors; repayments ignored the gas reserve. Both are guarded. Terms acceptance, financing labels and queue freshness explanation were corrected.
9. Studio's test lint exceptions hid unsafe casts. The local original strict configuration was retained; Studio removed the casts and unnecessary import.

## Actual independent checks

- First corrected snapshot: 42 app tests passed (API/policy/transaction/journal).
- Final refresh/persistence change: 20 transaction and real QueryClient refresh tests passed. Nine are new; unchanged tests were not repeated merely to produce another full-suite count. This covers the final 51-case app suite across the focused runs.
- Final `bun run check`: passed, no lint warnings/errors and typecheck clean.
- Final `bun run build`: passed. Existing dependency annotation and bundle-size warnings remain; no compilation failure.
- Browser: actual Earn/Trade at 1280 and 390 CSS pixels, no horizontal overflow. Final hosted screenshots and wallet receipts belong in checkpoint 04.
- Public default RPC intermittently rate-limited Activity. Arc's [official alternative endpoints](https://docs.arc.io/arc/references/connect-to-arc) were tested. Blockdaemon returned chain 5042002, all 27 historical events across two pages (1.337s + 0.699s) and live vault/positions (0.697s / 0.715s). The new Vercel project's read RPC is configured to this public endpoint; no private key or Studio proxy token was exported.

Studio traces: `01a1b12a-d668-723f-86ef-90802b04ced3` (initial corrections), `01a1b133-cbcb-73a4-bb8d-dcb03e627d24` (refresh/persistence follow-up). Allowance after final correction: 42% used.

A proposed tool-free Claude review was rejected by automatic approval review because it lacked sufficiently explicit authorization for transmitting the source snapshot. No Claude review result exists for this checkpoint; the independent checks above are Codex's. The completed core's earlier external reviews remain separate evidence.

## Practical limits

No production safety claim. No browser-wallet signature has been verified at this checkpoint. No continuous keeper heartbeat is published. Public RPC availability is not guaranteed. A replaced transaction whose original hash never receives a receipt may remain unresolved after a reload; the UI must not blindly resend it. Contract-level money flows remain supported by the prior independent live evidence.
