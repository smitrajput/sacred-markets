# Engine review and predeployment checks — November6

Codex reviewed the complete engine and received a bounded, tool-free Claude Opus5.5 review. The review is not an audit.

## Reproduced and corrected

**Caller floor could force overselling.** In the first engine pass, `_plan` used the caller's minimum output to decide whether a partial sale left enough principal. At195 BTC atoms, an80k reference and debt100383 USDC atoms, the intrinsic plan sold52 BTC atoms. A caller floor of91000 switched the plan to selling all195 and succeeded. Codex reproduced the full closure in a temporary local test. Studio corrected the planner: only position state and the independent oracle floor select mode and amount; the caller floor can only tighten execution. Regression/property tests cover0,40352,91000 and maximal floors and prove unchanged mode/quantity and rollback on an unachievable floor.

**Rounded small opens.** The independent combined suite found135passes and one legitimate `InitialCoverage` rejection inside a fuzz setup. Initial coverage is reachable even at zero venue fees: at a100k reference, E10486 buys20atoms and meets190%; E10487 buys the same20atoms but falls below190%. This is correct contract behavior. Studio added explicit boundary/rollback cases and classified those inputs in the rebalance property tests, without weakening the guard or hiding failures with a new random seed. Codex then independently passed all138 vault/engine tests using the exact seed that had exposed the failure.

## Additional Opus findings: lead disposition

- **32-slot availability limit:** accepted pilot limitation, not a new accounting defect. Bounded scans deliberately cap live positions. The review's claim that a principal-zero position can only leave at maturity is incorrect: any payer can repay its remaining markup and release it through the existing API. The vault also has a per-account principal cap, although repayment frees that capacity. Cheap repeated slot occupation remains a public-testnet availability risk; the UI must show a full market. No late allowlist or changed economics is introduced.
- **Origination gate ordering:** verified in code. The scan runs before recording the new reservation and iterates only previously-live IDs. The engine creates its active position before confirmation. Regression tests cover an existing position plus a new open and recovery after repayment.
- **Push payouts and issuer restrictions:** accepted limitation for the faucet-only pilot. A recipient blocked by the configured token can block its release or a close with surplus; issuer/network controls are outside this MVP. Pull-based trader-surplus claims are a production hardening item. No claim of permissionless availability under token sanctions is made.

## Independent evidence

- All138 final vault/engine tests passed locally, including adversarial callback attempts during buy/sell and the caller-floor invariance regression.
- Two real Arc-fork engine integration cases passed locally: open→third-party repayment→release; and an engine-sized partial sale through the actual v4 pool/adapter.
- TypeScript typecheck passed for the explicit price refresh script.
- Static analysis and detector dispositions are recorded separately in `STATIC_ANALYSIS.md`.
- No live vault/engine deployment at this review checkpoint. Deployment requires the corrected suite to pass and the actual manifest/wiring to be verified.
