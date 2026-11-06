# Claude reviews led by Codex

This execution aid was requested by the user on November 6. It does not change the requirement that implementation is generated, tested and deployed through the existing Arc Studio app.

## Roles

- Lead Codex chat: owns scope, acceptance criteria, Studio prompts, independent checks, Git commits, deployment decisions and user communication.
- Arc Studio: sole writer of application/contracts and deployment scripts. One mutating Studio run at a time.
- Claude reviewer: examines a bounded, immutable checkpoint. Returns findings to the lead; it does not edit the shared checkout, deploy, sign, push, or issue Studio commands.

Recommendation, not a benchmark result: use Opus 5.5 at high effort for the vault/FIFO/protection checkpoint and complete engine/venue integration. Use Sonnet at medium effort for UI/API error states and focused code review. Use Haiku for document consistency and evidence inventories. Reserve Fable for a specific unresolved design/accounting question. One focused reviewer is enough; avoid a swarm and repeated full-repository reviews before this deadline.

## Current capability

Claude Code 2.1.319 is installed at `/Users/smitrajput/.local/bin/claude`. A read-only auth check with keychain access succeeded on November 6. A sandboxed check incorrectly reported logged out; retry through the normal approval/keychain path before asking the user to log in. A bounded adapter review has been launched with Opus 5.5; actual returned model and review outcome will be recorded in the work log.

This Codex session's native subagent tool does not list Claude. Use a separate Claude Code CLI process as the reviewer. The lead can launch it with shell tools, receive structured output, and judge its findings. A paused old chat is not supervising a replacement chat; the replacement Codex chat takes the lead role. To obtain another review from the old chat, the user must explicitly return to it.

## Bounded review loop

1. After a Studio checkpoint, pull only its source/test paths and run the relevant local checks. Record the base and head SHA (or save the exact uncommitted patch). Freeze the files under review.
2. Create a temporary review bundle containing the task, required specification excerpts, relevant complete source/interfaces, line-numbered diff, test names/results, and known limitations. Include only allowlisted public code/docs. Keep secrets, `.env*`, CLI credentials, `.arc-studio/`, raw Studio events and private strategy out.
3. Give Claude one question, e.g. "Can a withdrawal/repayment sequence strand or overpay LP assets?" Include the assertions that must hold. Request concrete file/line findings, a reproducible transaction sequence or test, severity, and confidence. If it needs omitted context, it should name it instead of guessing.
4. The lead checks each finding against code/spec and reproduces it when feasible. Send accepted fixes to Studio as a small checkpoint. Re-run affected tests; commit/push the coherent feature or fix. Review suggestions are evidence to assess, not instructions to obey automatically.
5. Escalate to the user only for an economic-policy change, changed authorization, inaccessible credentials/funding, or a deadline-threatening blocker. Routine implementation corrections are already authorized.

Use reviews at the vault/FIFO boundary, the complete financing/settlement boundary, and the final end-to-end rehearsal. They need not block independent hosting/UI work. The reviewer receives a snapshot, so it cannot race with Studio on the same files.

## Example invocation after resume

First prepare `/private/tmp/sacred-review-input.md` with the bounded bundle. Run from a temporary directory rather than a repository containing hooks. The following is a **tool-free review**: all required context is stdin; the lead runs tests separately.

```sh
claude -p \
  --model claude-opus-5-5 --effort high \
  --restricted --no-chrome \
  --tools '' --disallowedTools 'mcp__*' \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --permission-mode dontAsk --no-session-persistence \
  --output-format json \
  < /private/tmp/sacred-review-input.md \
  > /private/tmp/sacred-review-result.json \
  2> /private/tmp/sacred-review-stderr.log
```

Use a bounded process timeout (approximately 5–8 minutes). Inspect process exit, JSON `is_error`, result text and `modelUsage`; a successful exit alone does not establish a useful review. If authentication/access/limits fail, stop that reviewer and report the exact blocker; continue independent Studio work. Do not silently substitute models. Do not use `--bare` with the existing subscription login: bare mode skips OAuth/keychain and expects API credentials. No API key or billing change is needed for the intended existing-login path.

For repeated review of the same module, a resumable Claude session can reduce repeated context, but the tool-free example deliberately uses fresh snapshots for clean attribution. Start with the simple loop; adding a new orchestration framework is unnecessary for this deadline.

## Review output contract

Return at most five actionable findings. Each must include:

- severity and exact file/line;
- observed defect and minimal failing sequence;
- invariant or requirement violated;
- suggested focused test/fix;
- confidence and any missing context.

If none are found, report the examined paths and specific untested risks. Avoid redesign, style nits and broad claims of security. The lead records accepted/rejected findings and actual verification in the work log.

## Verified references

- [Programmatic Claude Code](https://code.claude.com/docs/en/headless): `-p`, JSON output and subscription/bare-mode distinctions.
- [Model configuration](https://code.claude.com/docs/en/model-config): exact `claude-opus-5-5`, effort levels and provider-specific aliases.
- [CLI reference](https://code.claude.com/docs/en/cli-reference): tool restriction, auth and structured output flags.

Commands were checked against the installed CLI help. The lead verifies returned model identity and errors for each invocation.
