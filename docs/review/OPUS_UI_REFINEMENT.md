# Opus-directed UI refinement

November 6, 2026. The founder requested a major visual and usability refinement using the existing sacred.markets brand kit. A bounded, tool-free Claude Code run returned the actual model `claude-opus-5-5` and a concrete design brief. Arc Studio implemented the reviewed brief in the same Sacred app; Codex reviewed and independently verified the downloaded source.

## Scope

- Authentic Sacred logo and self-hosted Libertinus Serif, Sans and Mono assets from the preexisting brand kit; paper `#F4F0E7`, ink `#1B1915`, red `#B5321F`. These brand assets predate the MVP.
- Task-first Earn layout, clearer quote/debt rows, always-visible coverage status, larger inputs and controls, native disclosures for secondary details, accessible keyboard tabs, and cleaner Activity receipts.
- A second Studio pass corrected small-screen numeric wrapping and block metadata wrapping.
- No new financial policy, contract, custody, approval or wallet behavior. No transaction was signed by the design workflow.

## Independent verification

- 36 existing wallet, transaction, refresh and policy tests passed. Lint, TypeScript and production build passed. Existing dependency annotation and chunk-size warnings remain.
- 44 extracted action, calculation and gating expressions are AST-identical to wallet-verified checkpoint `d71ddbd`. This is a scoped source check, not a claim of a new security audit. [Comparison](UI_BEHAVIOR_COMPARISON.json).
- Desktop 1280px and mobile 390px Earn/Trade/Activity inspected; Trade additionally checked at 360px. No horizontal overflow observed. Debt, markup and cirBTC quote/minimum values remain on one line after the fix. Keyboard Home/End moved both selected tab and focus.
- The live quote changed during operator preparation and the new UI reflected the new value without hardcoding.
- 23 scoped paths checked: 22 exact content/hash matches and one trailing-blank-line normalization in src/main.tsx. The scope contains 10 app/configuration files and 13 existing brand assets. [Source comparison](STUDIO_UI_SOURCE_MATCH.json). The earlier 81-file checkpoint remains historical evidence of the wallet-verified build.

Studio implementation trace: `01a1b1a9-3400-73dd-aaea-5bc62dd6101b`. Mobile correction trace: `01a1b1b1-56eb-7348-97e3-6ec341069218`. The design skill launcher was unavailable; review used the supplied brand kit, source and rendered screenshots.

A fresh visual reviewer found that the inherited fixed Studio badge obscured financial terms on phones. Studio moved the same attribution/logo/link into normal document flow after the footer; a second screenshot review marked that finding resolved. The final badge trace is `01a1b1b6-af84-73da-8a74-88adbd28d2f0`.

CLI pull corrupted binary TTF files through UTF-8 decoding. Before deployment, Codex restored the exact original brand font binaries. Studio read-only trace `01a1b1b9-7e61-745c-8e16-9a2e58aea066` confirmed all eight remote SHA-256 hashes match the originals. Independent SFNT table bounds and checksums passed; browser font status was loaded and font checks returned true for Sans, Serif and Mono. [Font validation](UI_FONT_VERIFICATION.json). The font license is preserved verbatim, including a preexisting trailing space.
