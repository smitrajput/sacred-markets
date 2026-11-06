# Checkpoint 02 live: core deployment and rehearsal (Arc Testnet 5042002)

Only the three approved dedicated faucet wallets were used (`deployments/demo-wallets.json`); keys stayed inside the processes, nothing was printed, and no shared, existing or mainnet wallet was touched. No UI work. No time travel: the 14-day maturity path is covered by the existing warp tests only. Everything below is read back from the chain at the receipt block; the public journal is `deployments/core-state.json`, the addresses are in `deployments/arc-testnet.json`.

## Contracts (new; the smoke venue `0x1eaE39A7…37E4` stays separate, bound to the trader EOA)

| Contract | Address | Deploy tx | Block | Runtime bytes | Code hash |
| --- | --- | --- | --- | --- | --- |
| DemoPriceGuard | [0x4d84bf470b6916d97ec719a5398d534c1adb1d57](https://explorer.testnet.arc.io/address/0x4d84bf470b6916d97ec719a5398d534c1adb1d57) | [0xab0bba55f9…](https://explorer.testnet.arc.io/tx/0xab0bba55f9e9d30dc48879249e13195f4cc017ba28fb895a63dd4c283b576d13) | 71033361 | 937 | `0x9b8f9f58bf7dadcb…` |
| MarginVault | [0xf3fbda5c4354c9c3d384cfeed90aacdde28c6450](https://explorer.testnet.arc.io/address/0xf3fbda5c4354c9c3d384cfeed90aacdde28c6450) | [0xdb8b3c987a…](https://explorer.testnet.arc.io/tx/0xdb8b3c987ac926e5c076930822bf9a63eea261c4d6f971716377ad59ee7072a1) | 71033370 | 13,678 | `0x5e50630020121c47…` |
| V4SpotVenue (production) | [0x4e733fffbe2acc8b5849fa2cb7c1ac3f4a342519](https://explorer.testnet.arc.io/address/0x4e733fffbe2acc8b5849fa2cb7c1ac3f4a342519) | [0x19147c9050…](https://explorer.testnet.arc.io/tx/0x19147c9050966415be5ad7e6762bc5d9090bc654fc9a91e5aea16831179ab1bd) | 71033381 | 7,230 | `0xeaca07679f2d89ce…` |
| TradeEngine | [0xac836824231ae77874d0ca293bd749ffe6c0d00f](https://explorer.testnet.arc.io/address/0xac836824231ae77874d0ca293bd749ffe6c0d00f) | [0x04dc650517…](https://explorer.testnet.arc.io/tx/0x04dc6505179eac18e73f5e2a0f07b957e8fbf0edb4fc1b6ea4aab89c53e23b71) | 71033391 | 14,753 | `0xfe0ba291ca7629d9…` |

Policy as deployed: vault ceiling 1,000,000 atoms (1 USDC), per-account cap 100,000, guardian = treasury = deployer, primary 4,000 and tail 6,000 seeded; engine friction 300 bps, dust 10,000, term 1,209,600 s, markup 1,000 bps, LP 7,700 bps, trigger 16,000, restore 19,000; guard admin = deployer (the keeper holds no role), max age 86,400. Terms hash `0xb3dc89d6be33479580f5bc183906c6d7d1b67559167252edd086af824733e8b7`. Constructor and wiring assertions ran before anything was recorded as actual: guard admin and max age, vault getters and targets, venue getters and unbound start, engine getters and policy, then both `bindEngine` calls (vault tx `0x1eb45d214e297b7303a87cf4dc5699061ce14c697fbe7ca78e39353a38bc70b6`, venue tx `0xf0969b4820319b869701a6f74edda9402fca6d67d73a4242c4ae75da8c79ae4e`) and `engine.isWired()`. Identity: each deployed runtime equals its compiled runtime with immutable slots masked (all four match). `bun run verify:onchain` passes for every address and code hash.

## Transaction journal (all `confirmed`, status success re-read from the chain; gas in native USDC, 18 decimals)

| Step | Wallet | Action | Tx | Block | Gas cost |
| --- | --- | --- | --- | --- | --- |
| `deploy.guard` | deployer | Deploy DemoPriceGuard | [0xab0bba55f9…](https://explorer.testnet.arc.io/tx/0xab0bba55f9e9d30dc48879249e13195f4cc017ba28fb895a63dd4c283b576d13) | 71033361 | 0.006153 |
| `deploy.vault` | deployer | Deploy MarginVault | [0xdb8b3c987a…](https://explorer.testnet.arc.io/tx/0xdb8b3c987ac926e5c076930822bf9a63eea261c4d6f971716377ad59ee7072a1) | 71033370 | 0.074509 |
| `deploy.venue` | deployer | Deploy V4SpotVenue (production) | [0x19147c9050…](https://explorer.testnet.arc.io/tx/0x19147c9050966415be5ad7e6762bc5d9090bc654fc9a91e5aea16831179ab1bd) | 71033381 | 0.040530 |
| `deploy.engine` | deployer | Deploy TradeEngine | [0x04dc650517…](https://explorer.testnet.arc.io/tx/0x04dc6505179eac18e73f5e2a0f07b957e8fbf0edb4fc1b6ea4aab89c53e23b71) | 71033391 | 0.081885 |
| `wire.venue` | deployer | Venue bindEngine(engine) | [0xf0969b4820…](https://explorer.testnet.arc.io/tx/0xf0969b4820319b869701a6f74edda9402fca6d67d73a4242c4ae75da8c79ae4e) | 71033401 | 0.001138 |
| `wire.vault` | deployer | Vault bindEngine(engine) | [0x1eb45d214e…](https://explorer.testnet.arc.io/tx/0x1eb45d214e297b7303a87cf4dc5699061ce14c697fbe7ca78e39353a38bc70b6) | 71033410 | 0.001137 |
| `guard.update` | deployer | DemoPriceGuard.update(100000 USDC per BTC) | [0x180695cd20…](https://explorer.testnet.arc.io/tx/0x180695cd20811d74901af0a4588dc8e70d26898ceec96e87fe28006ea610a042) | 71033496 | 0.001694 |
| `seed.approve` | deployer | USDC approve(vault, 10000) | [0x052b2e5734…](https://explorer.testnet.arc.io/tx/0x052b2e573404cd5bb7c6eb4ed5174869434ac9494ac3d3662b0249feffe10d6c) | 71033505 | 0.001386 |
| `seed.primary` | deployer | seedProtection(Primary, 4000) | [0x93c2fc80a4…](https://explorer.testnet.arc.io/tx/0x93c2fc80a47b7e2c2671a583739be1fa4dcbd0d5e9dcbdd7a3f8e915d936892d) | 71033514 | 0.002145 |
| `seed.tail` | deployer | seedProtection(Tail, 6000) | [0xc51ef0cb6f…](https://explorer.testnet.arc.io/tx/0xc51ef0cb6f9d654203ffd46cdba274881ce88bb08ea7fa35acc9669243625724) | 71033522 | 0.002026 |
| `lp.approve` | deployer | USDC approve(vault, 1000000) | [0x31d4be52fa…](https://explorer.testnet.arc.io/tx/0x31d4be52fa971c051007cca4c302f1f4d7c765986d444d451043047da81e68d3) | 71033532 | 0.001386 |
| `lp.deposit` | deployer | Vault deposit 1 USDC | [0x7728c79ee1…](https://explorer.testnet.arc.io/tx/0x7728c79ee18ee27e4c45a5e1df84d1ea45179edd7c781a074b74ae81910878ec) | 71033541 | 0.003492 |
| `f1.approve` | trader | trader approve engine 100000 (exact) | [0xd3ec3d603d…](https://explorer.testnet.arc.io/tx/0xd3ec3d603d0497961351837fc18d92b9efb67456405a4d9dc3bda4ef38a470fb) | 71033745 | 0.001382 |
| `f1.open` | trader | engine.open(E=100000) | [0xeebbcf401e…](https://explorer.testnet.arc.io/tx/0xeebbcf401e8d46112e9062962cd3a4d2a1f2793b756da94ecaa36a5610326e79) | 71033753 | 0.019605 |
| `f1.approveRepay` | trader | trader approve engine 100383 (exact) | [0xd62a1ad631…](https://explorer.testnet.arc.io/tx/0xd62a1ad6318b1ee027bd152b5df2ef28668aeecefb1c3869d6e4b72ea4d7312d) | 71033768 | 0.001386 |
| `f1.repay` | trader | engine.repayAndRelease(id, 100383) | [0x853aff671d…](https://explorer.testnet.arc.io/tx/0x853aff671d5661b68e902fc506ecec71ad45d039cf915d06e5ef040e005c14c5) | 71033777 | 0.008024 |
| `prep2.approve` | trader | trader approve smoke venue 195 cirBTC atoms (exact) | [0x8667abdb24…](https://explorer.testnet.arc.io/tx/0x8667abdb2440c4e5290b01a72f45d2e2d7a9a9f7f2d194e1c997fb23d07e3790) | 71033802 | 0.001388 |
| `prep2.sell` | trader | smoke venue: sell released BTC back to the pool | [0xf67142726f…](https://explorer.testnet.arc.io/tx/0xf67142726f91e13750e3bbc07eb948d4e50df21ccfa7f49a726c682c9cad7b06) | 71033811 | 0.004633 |
| `f2.approve` | trader | trader approve engine 100000 (exact) | [0x6d0a89c92d…](https://explorer.testnet.arc.io/tx/0x6d0a89c92dde48129fdcde75b5e2f664a79b03db52e94f09cc34edea5ee196aa) | 71033833 | 0.001386 |
| `f2.open` | trader | engine.open(E=100000) | [0x46bb917630…](https://explorer.testnet.arc.io/tx/0x46bb917630154d3a20facd0034692e17b62e6f69caec85f16d156ce40187bd29) | 71033842 | 0.019200 |
| `f2.moveApprove` | trader | trader approve smoke venue 1161 cirBTC atoms (exact) | [0x0f5d53edc2…](https://explorer.testnet.arc.io/tx/0x0f5d53edc2305b6a0b751d1e7d88ac761ecfb22d22edbbe1bc9ed959221f62c5) | 71033856 | 0.001388 |
| `f2.moveSell` | trader | smoke venue: sell trader reserve to move the pool | [0xf833247cb8…](https://explorer.testnet.arc.io/tx/0xf833247cb8dea4decf90c0cb272d824c35f317c10a7afcc7b484395a4b4ef627) | 71033865 | 0.004631 |
| `f2.move2Approve` | trader | trader approve smoke venue 223 cirBTC atoms (exact) | [0x22c303b193…](https://explorer.testnet.arc.io/tx/0x22c303b1938675e6bd03fb5b568870d0e780588a6e69283526425be31d764e09) | 71033970 | 0.001110 |
| `f2.move2Sell` | trader | smoke venue: sell trader reserve to move the pool | [0x9c36b76c9d…](https://explorer.testnet.arc.io/tx/0x9c36b76c9d50e005eeee53768b3f7b9e930a9e2172372ccf6d438ec643896cdc) | 71033979 | 0.003703 |
| `f2.oracle` | deployer | DemoPriceGuard.update(80000 USDC per BTC) | [0xe295caf072…](https://explorer.testnet.arc.io/tx/0xe295caf072acf1201ee6666d403338b6f9a2cf63300cacaddec22d0fbd1a7461) | 71033988 | 0.000671 |
| `f2.rebalance` | keeper | engine.rebalance(id) by the keeper | [0xc7afcee5e1…](https://explorer.testnet.arc.io/tx/0xc7afcee5e170601d01468b8acef07f62439b49404a31dbe553b770dd4a783f78) | 71033997 | 0.006169 |
| `fifo.request` | deployer | deployer requestWithdraw(100000 shares) | [0xfca7f5078c…](https://explorer.testnet.arc.io/tx/0xfca7f5078cc107233b6f57664c0b7adca50e75e4f4b0c3ab46454f7a539f8e58) | 71034025 | 0.002826 |
| `fifo.process` | keeper | keeper processWithdrawals(1) (permissionless) | [0x8be5d0517b…](https://explorer.testnet.arc.io/tx/0x8be5d0517b2ca62e0dc9842ad506533fb3ad67b2c663943f9932750e1f17ed55) | 71034033 | 0.002960 |
| `fifo.claim` | deployer | deployer claim() | [0xb4b830b521…](https://explorer.testnet.arc.io/tx/0xb4b830b521adcdbae48815d193479531aa48a60669d349faf0502b9c72b9b5f3) | 71034046 | 0.001087 |

Gas spent: deployer 0.222065, trader 0.067835, keeper 0.009129 USDC. Every approval was the exact amount needed (no perpetual approvals); `maxFeePerGas` was at least 20 gwei and twice the base fee.

## Flow 1: LP deposit, open, repayAndRelease

- LP: deployer deposited 1,000,000 atoms with the actual mandate hash for 1,000,000 shares (1:1); primary 4,000 and tail 6,000 seeded; the seeds are not NAV.
- Open E = 100,000 at reference 100,000 USDC/BTC: events in order AssetAcquired, DisclosedSaleAgreed, Pledged, Opened (log indexes 36, 37, 38, 45). Position 1: P 100,000, M 383, D 100,383, gross cost 200,000, collateral 195 cirBTC atoms (real pool quote 195, initial coverage 19,425 bps), matures at unix 1795180284. Trader before: native 19,987,340,982,417,600,000 wei / ERC20 19,987,340 / cirBTC 10,000. After open: ERC20 19,866,353, cirBTC 10,000; engine holds 195 atoms and no USDC; vault idle 900,000, outstanding 100,000, NAV 1,000,000.
- repayAndRelease(1, 100,383): events Repaid (principal 100,000, markup 383) and Released (195 atoms). Vault after: idle 1,000,294, managerCash 89, outstanding 0, live 0, NAV 1,000,294, shares 1,000,000. LP markup 294 and manager 89 as predicted; the 195 atoms went to the trader (cirBTC 10,195); engine BTC and USDC are 0. The trader's native balance moved from 19,866,353,817,129,650,000 to 19,756,560,867,129,650,000 wei, which is the 100,383 repayment plus gas; the ERC20 view floors to 6 decimals.

## Pool preparation (no guards loosened, no spot copied into the oracle)

- Restore: the released 195 atoms were sold back through the existing smoke venue with a real quote (197,955 atoms of USDC) and an independent fixture floor of 189,150: pool back to 100,058.9 USDC/BTC (tx `0xf67142726f91e13750e3bbc07eb948d4e50df21ccfa7f49a726c682c9cad7b06`).
- Flow 2 opened position 2 (same numbers: P 100,000, M 383, 195 atoms, coverage 19,425 bps at 100,000). The pool was then moved with the trader's cirBTC reserve through the smoke venue: the first sale (1,161 atoms, quote 1,077,148) was sized relative to the post-open spot, which the open itself had raised about 4%, and landed at 83,269 USDC/BTC (408 bps from the 80,000 target). The script stopped on its own tolerance; a second sale (223 atoms, quote 181,187, independent floor 173,048) landed at 79,995.3 USDC/BTC. The operator then set the reference to 80,000 separately (`f2.oracle`); coverage 15,540 bps, inside the 155% to 160% band.

## Flow 2: engine-chosen rebalance by the keeper

`quoteRebalance`: eligible, partial, V 156,000, D 100,383, g 41,196, sell 52 atoms, minUsdc 40,352 (the named micro vector exactly). The keeper simulated and sent `rebalance` with the engine's own floor. Result: sold 52 atoms for 40,612 USDC atoms (floor 40,352), principal 100,000 to 59,388, markup 383 untouched, collateral 143, coverage 19,139 bps (strict, no tolerance), vault outstanding 59,388, engine USDC 0, keeper reward 0. Position 2 is the clean active demo position (collateral 143 atoms, debt 59,771).

## FIFO claim rehearsal (deployer as LP, keeper processed)

Request of 100,000 shares (10%): shares and NAV unchanged, 100,000 locked. `processWithdrawals(1)` by the keeper: shares 1,000,000 to 900,000, NAV 1,000,294 to 900,265, idle 940,906 to 840,877, claimable 100,029 reserved separately (floor(100,000 x 1,000,294 / 1,000,000)). `claim()`: claimable 0, NAV and shares unchanged (not debited again), deployer received 100,029 less 1,087 atoms of gas. Position 2 stayed live and 900,000 shares remain.

## State now

| Wallet | Native / ERC20 USDC | cirBTC atoms |
| --- | --- | --- |
| deployer | 8.809264 | 0 |
| trader | 21.075412 | 8,616 |
| keeper | 19.990871 | 0 |

(Use per wallet stays far below the 20 USDC and 0.001 cirBTC caps; each wallet keeps well over the 2 USDC gas reserve. The trader's USDC rose because it sold cirBTC reserve into the pool.) Vault: idle 840,877, outstanding 59,388, NAV 900,265, shares 900,000, manager cash 89, primary 4,000, tail 6,000, claimable 0. Engine holds 143 atoms. Pool at about 80,000 USDC/BTC with the reference at 80,000.

## Operator reset guide

- Inspect: `bun run core:status` (steps, balances, vault state).
- Close the demo position: `bun run core:release 2` (trader approves the exact debt, `repayAndRelease`). Written and type-checked, not run (the position is being kept for the demo).
- Reference price: it goes stale 86,400 s after its timestamp (set at unix 1793970799, so stale after unix 1794057199, 18:43:19 IST on Nov 7). Refresh with `bun run price:push -- --guard 0x4d84bf470b6916d97ec719a5398d534c1adb1d57 --price <USDC per BTC>` (dry run) and add `--broadcast`; never copy pool spot automatically. Opens, sales and the vault scan fail closed when stale; repayment, release and claims do not.
- Move the pool back toward 100,000: sell/buy through the smoke venue with real quotes (see `scripts/core/rehearse.ts`), then set the reference separately.
- Journal: `deployments/core-state.json`. Re-running a core command resumes: confirmed steps are re-read from the chain, an unconfirmed step is looked up by hash. The scripts STOP (and say so) if the signer's nonce advanced without a known hash or a transaction is pending ambiguously.

## Journal helper (repaired pattern) and its limits

`scripts/core/journal.ts` signs locally, computes the hash from the signed bytes and writes intent, chain, signer, nonce, calldata hash and tx hash to the journal BEFORE `sendRawTransaction`; the raw transaction and keys are never stored. One transaction at a time; a step is done only after its receipt is re-read with status success, and recorded success is itself re-verified on resume. Not exercised live: the nonce-advanced STOP and the byte-identical resend path (no failure injection on a live chain). Two script faults occurred and were fixed without any resend: a bigint serialization error after the deployment steps (the journal resumed from the confirmed receipts) and an assertion that was not resume-aware. The sandbox read proxy rejects raw sends, so broadcasts and nonce checks use the public Arc RPC; reads are pinned to the receipt block.

## Limits and honesty notes

- The reference price is an operator fixture. The oracle was set to 80,000 after the pool measured 79,995 (consistent, but operator-chosen).
- The first flow-2 pool move landed 408 bps off target because of a sizing error in my script (relative to the post-open spot); it was corrected with a second real, quoted sale, and nothing was faked or loosened.
- Direct donations were not repeated live (covered by the vault invariant suites).
- Position 1 round trip cost the trader 100,383 repayment and gas; the BTC restored to the pool cost a measured friction (quote 197,955 vs 200,000 paid).
