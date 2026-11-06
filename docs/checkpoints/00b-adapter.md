# Checkpoint 00b-adapter: fixed-pool v4 spot venue

Status: complete for this checkpoint (fork tests corrected: native-coin shim removed, Arc-aware Foundry used). Local and fork work only. No deployment, wallet creation or live transaction; no transaction hashes.

## Engine/venue interface (fixed before coding)

`contracts/src/interfaces/ISpotVenue.sol`. Vault/engine work should depend on this and nothing else.

| Function | Meaning |
| --- | --- |
| `buyCirBtc(usdcIn, minCirBtcOut, deadline) returns (cirBtcOut)` | Exact-input USDC to cirBTC. Engine only. |
| `sellCirBtc(cirBtcIn, minUsdcOut, deadline) returns (usdcOut)` | Exact-input cirBTC to USDC. Engine only. |
| `engine()`, `usdc()`, `cirBtc()` | Read the bound engine and the fixed currencies. |

Rules the engine can rely on:
- The engine is payer and recipient. It approves the venue for exactly the input; there are no payer, recipient, pool or calldata arguments.
- Token movement is only engine to venue, venue to PoolManager, PoolManager to engine.
- Positive input and positive `minOut` are required. Expired deadlines revert. Partial fills revert.
- The returned amount equals the engine's measured balance increase. The venue keeps no balance.
- The engine address is bound once by the deployer (`bindEngine`). Before binding, every swap reverts.
- The 300-bps demo and 460-bps cap on execution friction are engine policy: the engine derives `minOut` and passes it in.
  The venue enforces only the `minOut` it is given.

## Implementation

| Path | Role |
| --- | --- |
| `contracts/src/interfaces/ISpotVenue.sol` | Engine/venue interface above |
| `contracts/src/V4SpotVenue.sol` | Fixed-pool venue (280 lines; runtime 7,230 bytes) |

Design points:
- Immutable PoolManager, currencies (USDC = currency0, cirBTC = currency1, constructor requires strict ordering), fee, tick spacing, hooks = none, and `deployer`.
- `bindEngine` is deployer-only and one-shot. It rejects zero, the venue, the PoolManager, the deployer and both tokens. Before binding every swap reverts `EngineNotBound`.
- Swap flow: checks caller, deadline, positive input and `minOut`, then `transferFrom(engine -> venue)` and `PoolManager.unlock(Operation)`.
  `Operation` is `(zeroForOne, amountIn, minOut)` and the callback accepts only the exact bytes whose hash is pending.
  The hash is cleared on entry, so a repeated or altered callback reverts `NoPendingOperation`.
- Callback: swap exact-input with the extreme price limit, require input delta == `-amountIn` (`IncompleteInput` otherwise) and output >= `minOut`,
  then `sync -> transfer -> settle` (paid must equal input), `take` to the bound engine, and zero outstanding delta for both currencies.
- After `unlock`, accounting is re-derived from actual balances: engine output delta == reported == at least `minOut`, engine input delta == `amountIn`,
  PoolManager input delta == `amountIn` and output delta == engine output, and the venue's balances are back to their prior values.
- Tokens move only engine -> venue -> PoolManager -> engine. No payer, recipient, pool or calldata argument exists.
- Not in the venue (engine policy): the 300-bps demo bound, the 460-bps cap, oracle deviation. The venue enforces only the `minOut` it receives.

## Tests (all executed)

Default `forge test` (standard Forge 1.7.1): **40 passed**. It skips `contracts/test/fork/` by configuration.
`bash scripts/test-arc-fork.sh` (Arc-aware Forge, `--network arc`): **68 passed, 0 failed**, all suites below.

| File | Tests | Scope |
| --- | --- | --- |
| `V4Interface.t.sol` | 8 | Unchanged from 00b-deps |
| `V4SpotVenue.access.t.sol` | 15 | Constructor validation, binding (deployer-only, once, invalid engines, swaps before bind), unauthorized swaps, callback authentication, repeated and tampered callback, zero input/minOut, int128 bound, deadline (incl. fuzz). Unchanged |
| `V4SpotVenue.swap.t.sol` | 17 | Unit tests with an inventory-backed mock PoolManager (`contracts/test/mocks`, unit only). Unchanged |
| `fork/V4SpotVenue.forkPreferred.t.sol` | 6 | Real USDC and cirBTC, real PoolManager/PositionManager/Permit2/Quoter. 800 USDC per side, 20 USDC buy |
| `fork/V4SpotVenue.forkFallback.t.sol` | 6 | Same, 10 USDC per side, 0.20 USDC buy |
| `fork/V4SpotVenue.forkAdversarial.t.sol` | 7 | Unauthorized swap, bind, callback, PoolManager impersonation without pending op, stranger unlock, expiry/zero input, donated balances |
| `fork/V4SpotVenue.forkRealTokensNarrow.t.sol` | 4 | Real USDC and cirBTC in a liquidity-limited pool (fee 500, spacing 10): genuine partial fill, full rollback, fuzz |
| `fork/V4SpotVenue.forkRealPool.t.sol` | 5 | Generic ERC-20s on the real PoolManager and PositionManager (kept; narrow range, fuzz of amount/minOut) |

Each pool-scale suite (6 tests) covers: buy then normal close, coverage sale after a price drop, fuzz (Quoter equality and minOut boundary, both directions),
and full-rollback tests for a failed buy by minOut, a failed sell by minOut, and an expired deadline.

Full rollback assertions (`_assertSnapEq`, no snapshot before asserting): after each failed buy or sell, engine, venue and PoolManager balances of **both** USDC and cirBTC
equal their pre-call values and the venue holds nothing. The minOut-plus-one fuzz asserts the same in both directions.
Incomplete-input rollback with real tokens is in `forkRealTokensNarrow` (the tested full-range scenarios do not exhaust the available range; a deliberately narrow pool exercises partial fills).
Trace of `test_buyBeyondRange_partialFillRevertsAndRollsBackUsdcAndCirBtc`: USDC `transferFrom(engine -> venue, 1,000 USDC)` executes through the real native-coin precompile,
the real PoolManager fills only 10.275148 USDC of it, the venue reverts `IncompleteInput`, and every balance returns to its starting value. That is the native-USDC runtime rollback.

Fuzz default 256 runs. Earlier unit runs at 2,000 runs passed (unit code unchanged).

Mutation check against the final suite (Arc-aware Forge, 11 hand-made faults, source restored and diff verified): 10 killed, 1 survived.
Killed: engine check, incomplete-input check, pending-hash clear, deadline check, recipient-delta check, bind-once, PoolManager check, input-received check,
wrong take recipient, zero-delta check. Survivor: removing the callback's own `minOut` check, an equivalent mutant because the outer balance-delta check enforces the same
`minOut` and reverts the same way (the callback check is an earlier, cheaper exit). The previous run killed it only because of the removed shim's non-rollback.

## Real fork results (pinned block 71,017,780, fixture price 1 cirBTC = 100,000 USDC)

Friction = shortfall in bps against the pool's fee-free spot output at execution time (includes the 0.3% fee, price impact and atom rounding; excludes oracle deviation).
Executed output equalled the V4Quoter simulation exactly in every case (asserted).

| Scenario | Input | Output | Friction |
| --- | --- | --- | --- |
| Preferred buy (800 USDC/side) | 20.000000 USDC | 19,455 cirBTC atoms | 273 bps |
| Preferred normal close | 19,455 cirBTC atoms | 19.880913 USDC | 273 bps |
| Preferred coverage sale after ~10% cirBTC reserve sold into the pool | 19,455 atoms | 16.402297 USDC | 251 bps |
| Fallback buy (10 USDC/side) | 0.200000 USDC | 195 atoms | 202 bps |
| Fallback normal close | 195 atoms | 0.197898 USDC | 245 bps |
| Fallback coverage sale after price drop | 195 atoms | 0.163343 USDC | 227 bps |

All are under the 300-bps budget. At the fallback scale one atom is about 51 bps, so atom rounding is a material share of the budget; at the preferred scale it is under 1 bp.
The 800-per-side seed is consistent with the 716 USDC per side requirement in the brief. These are fork numbers, not live receipts.

## Fork tooling and fixtures (clearly not live)

- Tool: Circle arc-foundry **v0.8.0-4** (https://github.com/circlefin/arc-foundry), `forge Version: 1.7.1-dev`, commit `3e95efaeaaaca64d6ac9c1ee988968683dbd0d22`.
  Standard Forge does not implement Arc's native-USDC system precompiles (`0x1800...0000`, `0x1800...0001`).
- Install: `bash scripts/install-arc-foundry.sh`. It downloads the pinned release asset, verifies SHA-256, and unpacks `forge`, `cast`, `anvil` under
  `.tools/arc-foundry/v0.8.0-4/` (add `.tools/` to the repository's ignore file). The standard `forge` on PATH is untouched.
  Linux x86_64 SHA-256 `78330505af7dc0d2c9b55fc1aed00d9d063581bb57054949d31ef1c1b4bdbc5e` (matched in this run);
  macOS arm64 SHA-256 `a99228f3403b3547e35c518387f9ad020e4293ac5e8ef4da7899a5495cf2e3e9` is pinned in the script, not run here. Asset names were checked against the release listing.
- Run: `bash scripts/test-arc-fork.sh [forge args]` (also `bun run contracts:test:arc-fork`). It runs `FOUNDRY_PROFILE=arcfork forge test --network arc`.
- Guardrails: the default profile excludes `contracts/test/fork/**`. If a fork test is forced under standard Forge, `ForkBase._requireArcRuntime()`
  fails `setUp` with a message naming the script. It performs a real 1-atom USDC transfer, so an unsupported runtime cannot pass silently.
- Nothing is etched or stubbed: the earlier `ArcNativeCoinShim` and its `etch`/`allowCheatcodes` calls are removed.
- Fixtures (fork state only, not live balances, no wallet involved): USDC via `vm.deal(native = USDC atoms * 1e12)`, cirBTC via forge-std `deal` on token storage.
  The pool is initialized and seeded in the test through the real PositionManager. On the live chain it is still uninitialized (checked in 00b-deps).
- Fork block pinned at 71,017,780 for every fork test.

## Known gaps and next-step notes

- No live proof yet: no transaction, deployment or wallet. The smoke step must run the real swaps with real USDC and cirBTC.
- No independent audit or Slither pass was run in this checkpoint. Local review is expected.
- The engine must approve the venue for exactly the input of each call and compute `minOut` (Quoter simulation off-chain, plus its reference-price bound).
- The venue trusts the PoolManager and the two tokens (no fee-on-transfer, rebasing or blocklist handling beyond the balance-delta checks).
- Production deployment: bind the engine once, before enabling swaps. A separate test harness is needed for pre-engine smoke tests, never an open production venue.
- Live seeding and the cirBTC source remain open from 00b-deps (public faucet may list cirBTC; not pursued here).

## Commands run

- `bash scripts/install-arc-foundry.sh` (SHA-256 verified, installed v0.8.0-4)
- `forge test` (standard, 40 passed, fork directory skipped)
- `bash scripts/test-arc-fork.sh` (68 passed, 0 failed)
- `bash scripts/test-arc-fork.sh --match-path "contracts/test/fork/*"` (28 passed)
- `forge test --match-path contracts/test/fork/V4SpotVenue.forkFallback.t.sol` under standard Forge fails fast with the Arc-runtime message, as intended
- Mutation harness (11 mutants, 10 killed, 1 equivalent), a temporary script that is not committed
- `bun run check`

## Independent local verification — November 6

Codex reviewed the final adapter and reran 32 unit tests successfully. Using the same pinned Arc Foundry release on macOS arm64, 65 of 68 tests passed on the initial complete run; three narrow-pool tests were interrupted by HTTP 429 responses from the public RPC. A serial `bash scripts/test-arc-fork.sh --rerun --threads 1 -v` reran exactly those three tests and all passed, including 256 oversized-input fuzz cases. Thus all 68 tests have independently passed across the initial run and targeted retry. No shim or precompile replacement is present. Local native-transfer probe also passed independently. macOS needs `libusb` for this binary; Homebrew libusb 1.0.30 was installed.

Adapter implementation/unit evidence commits: 793db01, f330429, 185566b. The raw local logs are temporary artifacts; the commands and observed counts above are the durable record. These remain fork proofs, not live-chain receipts.
