# Checkpoint 00b smoke: live v4 route on Arc Testnet

Chain 5042002, run 2026-11-06 (blocks 71,025,359 to 71,025,510). Dedicated testnet wallets only; faucet funds only; no mainnet, no shared platform wallet, no new wallets.
Keys were read inside the process from the ignored `.env` and never printed or passed as arguments. No Sacred vault or engine was deployed.

## Immutable pool and existing v4 deployment (not deployed by Sacred)

| Item | Value |
| --- | --- |
| currency0 | USDC `0x3600000000000000000000000000000000000000` (6 decimals) |
| currency1 | cirBTC `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` (8 decimals) |
| fee / tickSpacing / hooks | 3000 / 60 / none |
| poolId | `0xf4e18ec272549ab0140d43d33a7ba93768ecaec4dee4a7fb4f2c9af00950cde4` |
| PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| PositionManager | `0x6049c9a0e26405C0985f9E3685C87d0aE917f82B` |
| V4Quoter | `0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94` |
| StateView | `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

Pre-checks before any signature: chain id 5042002, code at all seven addresses, `poolManager()` of PositionManager and StateView, pool uninitialized (sqrtPrice 0).
Runtime identity of the contracts against pinned sources is in `00b-deps.md`. Uniswap lists these addresses under Arc mainnet (5042); that table is not a testnet provenance claim.

## Funded and remaining balances (read from the chain)

| Wallet | Funded (faucet receipts supplied by Codex) | Remaining after smoke |
| --- | --- | --- |
| deployer `0xafC5b06665e9b99669027C18E82014916778734E` | 20 USDC, 10,000 cirBTC atoms | 9.941299825 USDC (native 9,941,299,825,000,000,000 wei), 0 cirBTC |
| trader `0xbcA3D93DE6932535A117588744557537694A3e6c` | 20 USDC, 10,000 cirBTC atoms | 19.987340982417600000 USDC, 10,000 cirBTC atoms |
| keeper `0x60579fc93E6B7f2377dd952e1FD4c58C2e3Ca373` | 20 USDC | 20 USDC, untouched |

Deployer keeps well over the 2 USDC reserve. Native balance and ERC-20 USDC are the same funds (18 vs 6 decimals); ERC-20 figures are the native figure divided by 1e12, rounded down.
Per-wallet use stayed inside the caps: deployer 10.058700 USDC (seed 9.999976 plus 0.058724 gas) and 0.0001 cirBTC; trader 0.012659 USDC (0.002102 swap cost plus 0.010557 gas) and 0 cirBTC net.

## Pool initialization and seed

Fixture price 100,000 USDC per whole cirBTC, computed as `sqrt(token1 atoms / token0 atoms) * 2^96` = sqrt(1e8 / 1e11) with the pinned Uniswap math (not human-unit prices): `sqrtPriceX96 = 2505414483750479311864138015`, tick -69,082.
The seed math ran through the pinned libraries via `eth_call` (`contracts/script/SeedMath.sol`, never deployed).

| Item | Value |
| --- | --- |
| Position NFT id | 21533 (owner: deployer) |
| Ticks | -887220 to 887220 (aligned to spacing 60, full range) |
| Liquidity | 316,227 (read back from PositionManager and matches the plan) |
| Deposited into PoolManager | 9,999,976 USDC atoms (9.999976 USDC) and 10,000 cirBTC atoms (0.0001), from the mint transaction's ERC-20 Transfer logs |
| Pool liquidity afterwards | 316,227 |

Approvals were exact: token to Permit2 for 10,000,000 USDC atoms and 10,000 cirBTC atoms, then Permit2 to PositionManager for the same amounts, expiring in one hour.
The trader's separate 10,000 cirBTC atoms were not used for seeding.

## Smoke venue

`V4SpotVenue` at `0x1eaE39A746C49708696FBA57CE4a1948eA4337E4`, SMOKE-ONLY. Immutables checked after deployment: PoolManager, USDC, cirBTC, fee 3000, spacing 60, binder = deployer.
Engine bound exactly once to the trader wallet. The production venue will be bound to the real engine later.

## Executed transactions (all status success; gas in USDC)

| Step | Tx | Block | Gas used | Gas cost |
| --- | --- | --- | --- | --- |
| deployer approves Permit2, USDC 10,000,000 | `0x157ce0d20e57591373627949c6430702d7928f5c40f8abb29d7fa235f24709b7` | 71025359 | 55,378 | 0.00138445 |
| Permit2 to PositionManager, USDC | `0x183b6dfe8fd744fc40b3fad76358af80b8c5fe364423adc07bb5d354a23b6392` | 71025363 | 47,362 | 0.00118405 |
| deployer approves Permit2, cirBTC 10,000 | `0x88c8c04732148f4c4e661e494497b7d338c23ad5586924fb22bbb3dbe9188b2c` | 71025374 | 55,463 | 0.001386575 |
| Permit2 to PositionManager, cirBTC | `0x0d57df27cc046f10b15bb66a39b9775cec7e336535b086e01120ca6176493832` | 71025379 | 47,578 | 0.00118945 |
| initializePool | `0x2ff48c1584ef2c6ba20b98cd9ae28d6af80985f41bdb6646dd795a736d2f8773` | 71025382 | 56,266 | 0.00140665 |
| mint full-range position (NFT 21533) | `0xb28fb9412913d4d9fdc26bbd8f3f710baad01a97e14ee20ee25660faf4e4b497` | 71025386 | 420,200 | 0.010505 |
| deploy smoke venue | `0x8faecb724a50a74708ee46910a9fed96c72b5f520c7fc010e455acfdd281a503` | 71025406 | 1,621,189 | 0.040529725 |
| bindEngine(trader) | `0xf00127c8798bdde002c8720e87cc07974158e74dac12aad9717dd7846ff1cfbe` | 71025411 | 45,531 | 0.001138275 |
| trader approves venue, 200,000 USDC atoms | `0xb8e209542507715e0d10bfcbcf1dcec2b31bb805fbe3b45833e0fb9a95cbf9b4` | 71025436 | 55,438 | 0.0011226195 |
| buyCirBtc(200000, minOut 195) | `0x289c319043fa4a7dc274b0e847f5ed78d21a642114c9ff5672116fac57d301d8` | 71025440 | 192,834 | 0.0039048885 |
| trader approves venue, 195 cirBTC atoms | `0xe4538e64fd12ae1b18886cf94812653a4115969dabdcb54b9fb116644b5baf2f` | 71025506 | 55,511 | 0.0012062318 |
| sellCirBtc(195, minOut 197898) | `0x6e4b39f8e75bc52540494fe83715112cf1c3adf5a91e124c22859bd81eef30f2` | 71025510 | 198,958 | 0.0043232778 |

Fees: every transaction used `maxFeePerGas` of at least 20 gwei (the larger of 20 gwei and twice the current base fee) and gas estimated with a 20% margin. Each transaction was simulated with `eth_call` first.

## Real buy and sell (0.20 USDC)

| Leg | Input | Quoter simulation | Fixture value / 300 bps floor | minOut sent | Actual output |
| --- | --- | --- | --- | --- | --- |
| Buy | 200,000 USDC atoms (0.20) | 195 cirBTC atoms | 200 / 194 | 195 (the stricter, equal to the quote) | 195 cirBTC atoms (matches the `Swapped` event and the balance change) |
| Sell | 195 cirBTC atoms (all acquired) | 197,898 USDC atoms | 195,000 / 189,150 | 197,898 | 197,898 USDC atoms (0.197898) |

- Actual output equalled the Quoter simulation in both legs. Buy friction against the fixture price was 250 bps (195 vs 200 atoms, including pool fee, price impact and atom rounding), inside the 300-bps budget. The sell cleared above the fixture value because the buy had moved the pool price up.
- Round trip: paid 200,000 USDC atoms, received 197,898, a swap cost of 2,102 atoms (0.002102 USDC). Trader gas for its four transactions was 0.010557017582 USDC, accounted separately. The trader's native balance change (-0.012659017582 USDC) equals the swap cost plus gas exactly (verified in 18-decimal units).
- Venue held 0 USDC and 0 cirBTC afterwards. Trader cirBTC returned to 10,000 atoms. Allowances to the venue were exact and are fully consumed.
- Pool afterwards: tick -69,085, liquidity 316,227. The large coverage price drop was not run live; it is reserved for a real financed position (the pinned fork already covered it).

## Test additions (Arc-aware Forge, `--threads 1`)

| Test | Result |
| --- | --- |
| `test_callback_tamperedFirstCall_isRejectedAndNothingMoves` (unit, mock PoolManager) | passes under standard Forge: altered amount, minOut or direction on the FIRST callback while the real operation is pending reverts `NoPendingOperation`, balances and approval unchanged, venue not wedged |
| `test_fractionalNativeDustAndUsdcAtomDonation_doNotAffectExactInputAccounting` (fork, real USDC and cirBTC) | passes: fractional native dust on engine, venue and PoolManager plus a one-atom USDC donation to the venue; exact-input buy and sell succeed, ERC-20 deltas exact, all fractional dust and the donation unchanged |

Commands run: `forge test --match-test test_callback_tamperedFirstCall` and `bash scripts/test-arc-fork.sh --threads 1 --match-test test_fractionalNativeDust`. No full-suite repeat, no mutation run.

## Scripts and how to reproduce

- `forge build`, then `bun run smoke:status` (read-only), `smoke:seed` (`bun scripts/smoke/run.ts seed --dry` prints the plan only), `smoke:venue`, `smoke:trade`, and `bun scripts/smoke/run.ts manifest`.
- State is `deployments/smoke-state.json` (public: hashes, gas, records, no secrets). Re-running resumes from it: recorded steps are never resent, the position record stops reseeding, an initialized pool with foreign liquidity or an inconsistent price stops the script.
- Safety checks in code: chain id verified before signing, simulation before every send, fee floor, balance budget with the 2 USDC deployer reserve, exact approvals, output floors, error output strips URLs.
- Reads go through the sandbox RPC proxy; broadcasts go through the public Arc RPC because the proxy answers HTTP 403 to `eth_sendRawTransaction` (the first approval attempt failed that way before anything was signed on chain; deployer nonce stayed 0).

## Issues met and how they were handled

- The first `trade` run executed the buy successfully, then stopped in its own post-trade balance check: a "latest" read from the load-balanced RPC lagged the receipt and showed no gain. The swap itself was fine (receipt success, `Swapped` event 195).
  The script now reads balances at exact receipt blocks. The buy plan record was restored from the first run's printed values and the quote and `minOut` of 195 verified from the sent calldata, then the run resumed.
- The sell leg's first verification compared the USDC ERC-20 balance, which also pays gas (it differed by 4,324 atoms). Verification now uses the native 18-decimal balance with gas added back, which matches exactly. The sell transaction itself had already succeeded.
- No transaction reverted and no step was sent twice. Final nonces: deployer 8, trader 4 (re-running the scripts left them unchanged).

## Not done here

No Sacred vault or engine deployment, no coverage price drop live, no keeper activity (keeper wallet untouched), no further faucet requests. Manifest: `deployments/arc-testnet.json` now lists the existing v4 addresses, the pool, the position, the smoke venue and trade hashes; `sacredContracts` stay undeployed with null addresses.
