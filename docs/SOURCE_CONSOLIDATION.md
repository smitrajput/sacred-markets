# Source consolidation

Updated 28 November 2026.

The canonical repository is [sacred-markets](https://github.com/smitrajput/sacred-markets). Both histories are retained by a Git subtree merge.

| Source | Selected revision | Destination |
| --- | --- | --- |
| sacred-markets `app-redesign` | `55c2bc0` | Existing repository root |
| sacred-protocol `codex/hackathon-spec-review` | `81294ab65e4e402e7bae7463294d508c0d60491d` | `protocol/` |

Remote refs for both repositories were refreshed before selection. The source branch was one commit ahead of its remote, so the local tip was included. The two outstanding tracked Earn-copy edits were carried across separately. The source repository and its working edits remain intact.

Only tracked public source was imported. Dependency folders, local environment files, personal research, investor materials and corporate documents were excluded from the public import. Local research and outputs are preserved separately in ignored `protocol/_private/source-import/`. The active investor package stays in its existing private directory. The existing Arc app and the earlier protocol remain distinct implementations; no deployed financial behavior was changed by the import.

## Commands and hosting

- App: `bun run dev`, `bun run build`, `bun run test:app`, `bun run contracts:test`.
- Website/docs: install dependencies in `protocol/frontend`, then `bun run site:dev`, `bun run site:test`, `bun run site:build`.
- Earlier contracts: follow `protocol/README.md` from `protocol/contracts`; the historical dependencies are separate from the root MVP dependencies.
- Arc app hosting root: repository root, existing Vite/Vercel configuration.
- Landing/docs hosting root: `protocol/frontend`, Next.js, same repository.

The site's `/app` rewrite continues to serve the existing Arc app origin. Repository consolidation does not require a new contract deployment or keeper episode.

## Validation

The consolidated repository passed app lint/typecheck, app tests, the Vite build, 179 local contract tests, 37 website tests and the Next.js production build. The website has its own PostCSS configuration and tracing root so it does not inherit the root app build configuration. No contract deployment, signed transaction or keeper episode was run.
