# How to verify Sacred was implemented in Arc Studio

Sacred's MVP application, contracts and operator scripts were generated in **one persistent Arc Studio app**. Codex directed scoped checkpoints, independently reviewed and tested downloaded code, and recorded small sequential commits. Hosting was completed with the local authenticated Vercel CLI using the Studio-generated app/API; this is disclosed separately from code authorship.

- Studio app: [Sacred](https://studio.arc.io/app/37c6c8dc-b313-49c9-9cbb-fe5f61673ab3)
- App ID: `37c6c8dc-b313-49c9-9cbb-fe5f61673ab3`
- [Continued Studio conversation](https://studio.arc.io/app/37c6c8dc-b313-49c9-9cbb-fe5f61673ab3?thread=868bf545-07ba-4ecd-a97c-b45762be5d3c): `868bf545-07ba-4ecd-a97c-b45762be5d3c`
- Source: [smitrajput/sacred-markets](https://github.com/smitrajput/sacred-markets)
- Current implementation checkpoint: [`1737996`](https://github.com/smitrajput/sacred-markets/commit/1737996)
- **Judge-accessible Share link: pending signed-out verification.** The workspace URL above requires login; it is not yet sufficient evidence of public judge access.

## Organizer requirement

The [official Arc prize page for ETHGlobal Mumbai](https://ethglobal.com/events/mumbai/prizes/arc), checked November 6, requires a shareable Studio project URL judges can open and Studio shown in the demo. Source hashes and a Vercel URL support the evidence but do not replace that requirement. Share currently prompts the founder to deploy to Vercel; the correct project-sharing route remains an open delivery item.

## Verification route for judges

1. Open the verified Share link once recorded above. Inspect the app's build conversation/code if that sharing mode exposes them. If sharing only exposes the running app, the founder should show the signed-in Studio workspace live or in the demo video as well.
2. Inspect the chronological [AI work log](../AI_WORKLOG.md), [milestone prompts](prompts/) and [Studio/local workflow](STUDIO_GIT_WORKFLOW.md). The build did not switch to a second app.
3. Compare the downloaded implementation with [source hashes](review/STUDIO_SOURCE_MATCH.json). A fresh scoped download compared 78 files at the recorded commit, including contract sources, application/API code, scripts, configuration and deployment manifest. 76 match the Studio bytes exactly. `src/main.tsx` and `tailwind.config.js` differ only in trailing whitespace; there are no implementation differences within the checked scope. Local-owned documentation and hosting exclusions are outside this comparison.
4. Inspect [sanitized CLI checkpoint results](review/STUDIO_CHECKPOINT_03_RESULTS.json). These preserve app/thread/trace identifiers and the reported checks, without raw event logs, preview credentials or environment values. Trace IDs are provenance references, not independently verifiable signatures; access to Studio and the code comparison are the stronger checks.
5. Follow the actual deployment and transaction evidence in [checkpoint 02](checkpoints/02-live.md), [core verification](review/CORE_LIVE_VERIFICATION.md) and the hosted checkpoint when published. Code generation claims and live-chain evidence are separate claims.

## Recorded frontend checkpoints

| Studio trace | Work |
| --- | --- |
| `01a1b117-c33f-744e-b5ba-18924f11cff2` | Completed Earn/Trade/Activity, read API, keeper and journal checkpoint |
| `01a1b12a-d668-723f-86ef-90802b04ced3` | Pagination, transaction recovery, public keeper and validation corrections |
| `01a1b133-cbcb-73a4-bb8d-dcb03e627d24` | Authoritative refresh, persisted confirmation state and strict test typing corrections |

Prompts: [first review corrections](prompts/03-review-corrections.txt), [follow-up integration corrections](prompts/03-refresh-integration-corrections.txt). Checks and dispositions: [independent UI/API review](review/UI_API_REVIEW.md).

## Attribution and prior work

The Sacred protocol design, brand and existing website predate this hackathon implementation. They are not presented as new Studio-generated work. The new MVP implementation is Studio-authored. Codex maintained planning/review/submission documents and Git history, normalized one trailing blank line and prepared upload exclusions. Claude assisted earlier bounded reviews and drafted the explanatory guide; it did not implement the application. No authorship percentage is estimated.

Keep the Studio build timeline and source visible in the recorded demo. A badge, a repository timestamp or a successful deployment alone does not prove where the code was authored.

## Browser panels and conversations

The original browser conversation (`d062f492-39f9-468e-9927-77a382ff05e4`) contains the early scaffold messages. The continuation linked above contains the subsequent CLI-directed checkpoints. They belong to the same app and share workspace files. An old conversation message is not an indication that the code panel is at that old checkpoint.

The browser **Tracing** panel displays runtime HTTP, JSON-RPC and injected-wallet events from an enabled development preview. It is separate from the CLI build-run trace identifiers above. `src/tracing.ts` supplies the runtime instrumentation and `src/main.tsx` imports it. A failed preview may emit no runtime events; the production Vercel app runs a production build with this development instrumentation disabled.

The founder’s Share-menu screenshot offers deployment to Netlify, Hugging Face or Vercel and describes a link to the running app. It does not show a public conversation-sharing control. A Vercel deployment must not be represented as proof of public access to Studio’s build conversation.

On November 6, Studio reproduced and repaired a preview-only failure: a stale IPv4 Vite process had lost its esbuild child, while a second IPv6 process still passed localhost probes. It restarted one server and observed HTTP 200 for the actual preview route’s page, App/Trade modules and health endpoint, with no source changes. [Sanitized operational result](review/STUDIO_PREVIEW_RECOVERY.json). The founder’s browser tracing display still needs a reload and visual confirmation.
