# Sacred implementation plan

Status: **REHEARSAL — core, frontend and read API deployed; browser-wallet rehearsal, judge access to Studio and final recording remain.** Arc Studio generated the contracts, frontend, read API and operator scripts. Independent checks cover 138 vault/engine tests, two Arc-fork cases, four deployed runtimes, 29 core receipts and the 51-case app suite across focused runs. The public app and all read endpoints return successful responses. External deadline **November 7, 2026, 9:30 AM IST**. Hard finish **November 6, 10:30 PM IST**.

- [Specification](docs/spec.md)
- [Prompt instructions](docs/README.md)
- [Studio/local Git workflow](docs/STUDIO_GIT_WORKFLOW.md) and [commit plan](docs/COMMIT_PLAN.md)
- [Review dispositions](docs/review/REVIEW_DECISIONS.md), [math checks](docs/review/SPEC_VERIFICATION.md), [status/hash](docs/review/REVIEW_STATUS.json)
- [Skills](docs/SKILLS.md), [organiser guidance](docs/ORGANISER_GUIDANCE.md), [AI work log](AI_WORKLOG.md)

## Decisions and sequence

1. User direction: current Sacred economics, small end-to-end demo, Fable review before implementation and clear sequential commits.
2. Codex specification and Fable review: complete. Codex incorporated justified findings, corrected review arithmetic and preserved the separate protection waterfall.
3. Scope: one cirBTC market, existing v4 pool infrastructure, Earn/Trade/Activity, NAV deposits, continuous FIFO, separate admin demo-price fixture, real read API, gas-funded keeper plus manual path. Optional bridge follows a passing core.
4. Implementation lives in `smitrajput/sacred-markets`, local sibling checkout `sacred-markets`. Codex sends each checkpoint directly through the authenticated Studio CLI, pulls the files, independently checks them, commits and pushes directly to `main` before the next dependent checkpoint. Escalate only user-dependent blockers.
5. First preflight proves affordable pool/position sizing, token funding, actual v4 execution and hosting access. Freeze actual amounts/roles in the deployment manifest.
6. November 6 targets: contracts and live swaps 18:30; deployed app/API and complete flow 20:00; feature freeze/rehearsal 21:00; recording and submission package 22:00; hard finish 22:30. Optional bridge is off the critical path. If a gate slips, prioritize core fixes and state the impact promptly.

Existing Sacred website/design/code predate this implementation. Preserve prior-work disclosure and real chronology. For each checkpoint record actor, decisions, actual tests, SHA and Studio trace in AI_WORKLOG.md. Plan files explain the process; they do not estimate a human/AI authorship percentage.

Execution: Studio CLI is the primary path; browser prompts remain a fallback. No manual copy/paste relay is required. Keep callbacks, accounting, real swaps and receipt checks intact when cutting optional scope.

Hosting: Vercel frontend plus read API functions, as connected by the user. Keeper runs separately for rehearsal and has a manual onchain fallback. The user authorized dedicated testnet-only signing wallets within stated faucet-asset limits; no existing wallet secrets or mainnet funds.
