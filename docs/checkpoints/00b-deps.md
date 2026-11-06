# Checkpoint 00b-deps: Uniswap v4 dependency and interface validation

Date: 2026-11-06. Chain 5042002 (Arc Testnet), RPC https://rpc.testnet.arc.io, head at check time 71,017,780.
Scope: read-only. No transaction was sent, nothing deployed.
Note: the Uniswap skill and public Uniswap tables label these addresses Arc mainnet (5042) and call Arc testnet unsupported.
Code presence is not testnet provenance. This run only proves runtime-code identity with the pinned sources.

## Pins (contracts/deps/v4-manifest.json, installed by scripts/install-v4-deps.sh into lib/)

| Dependency | Commit | Installed subset |
| --- | --- | --- |
| Uniswap/v4-core | 59d3ecf53afa9264a16bba0e38f4c5d2231f80bc (2025-05-13) | src interfaces, libraries, types, PoolManager and bases; licenses/ |
| Uniswap/v4-periphery | 3779387e5d296f39df543d23524b050f89a62917 (2025-11-05, no upstream tags) | src; LICENSE |
| Uniswap/permit2 | cc56ad0f3439c502c246fc5cfcc3db92bb8b7219 | src; LICENSE |
| transmissions11/solmate | 4b47a19038b798b4a33d9749d25e570443520647 | src auth, tokens, utils; LICENSE |
| foundry-rs/forge-std | unchanged, lib/forge-std 1.16.2 | n/a |

Not vendored: openzeppelin-contracts dbb6104 (only needed to compile upstream PositionManager/Descriptor).
Project compiler unchanged: solc 0.8.28, evm cancun. Upstream builds with solc 0.8.26, via_ir, bytecode_hash none.
v4-core PoolManager.sol has an exact `pragma solidity 0.8.26`: it cannot be imported into a 0.8.28 unit.
Contracts use interfaces and libraries only (pragmas ^0.8.x). Tests needing a PoolManager use the Arc fork.
Original licenses and SPDX headers are preserved.

## Runtime identity (compiled in /tmp, solc 0.8.26, upstream profile; immutable slots masked)

| Contract | Address | Result |
| --- | --- | --- |
| PoolManager | 0x8366a39CC670B4001A1121B8F6A443A643e40951 | 24,009 bytes; 19 differing bytes = the inlined self address only. Identical output from v4-core v4.0.0 (e50237c) and 59d3ecf. |
| PositionManager | 0x6049c9a0e26405C0985f9E3685C87d0aE917f82B | 23,877 bytes; 0 differing bytes outside immutables (periphery 3779387 profile, optimizer_runs 30000) |
| V4Quoter | 0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94 | 6,118 bytes; 0 differing bytes outside immutables |
| StateView | 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b | 3,531 bytes; 0 differing bytes outside immutables |

UniversalRouter 0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1 has code (24,546 bytes). The skill lists this address as router 2.1.1.
The financing adapter does not use it and its source was not compared. Permit2 has code (9,152 bytes), canonical address.

## Live read-only checks (cast / fork)

- `poolManager()` on PositionManager, V4Quoter and StateView returns the PoolManager above. `permit2()` on PositionManager returns canonical Permit2.
- PoolManager owner 0x9701fb0aDe1E269c8f64Ec0C7b3cfADB31A13A52, protocolFeeController is zero.
- poolId keccak(abi.encode(USDC, cirBTC, 3000, 60, 0x0)) = 0xf4e18ec2...0cde4. It matches the brief, and USDC < cirBTC as an address.
- USDC/cirBTC 3000/60 pool: getSlot0 all zero, getLiquidity 0, so the pool is **uninitialized**. The Quoter reverts with a wrapped `PoolNotInitialized()` (0x486aa307).
- USDC/EURC 500/10 pool (EURC 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a): initialized, tick -1816, lpFee 500, protocolFee 0, liquidity 151,438,096.
  `quoteExactInputSingle` of 1 USDC returned 828,554 EURC atoms (gasEstimate 37,181). The Quoter ABI works end to end.
- cirBTC: 8 decimals, total supply 178,019,682,103 atoms. It is an upgradeable proxy: owner 0xf2e323A5F154D4FeD1D6be14c75A130fDa540bd5, masterMinter 0x03d5Df8c0216bCE0Bf6Eb3438B75f66B50E172c6, not paused.

## Tests

`forge test --match-path contracts/test/V4Interface.t.sol` forks Arc at block 71,017,780: 8 passed, 0 failed.
It covers code presence, getters, poolId derivation and tick alignment, uninitialized Sacred pool,
live USDC/EURC state and quote, and PoolManager/PositionManager selectors. These are scaffold fork tests, not live receipts.

## Seed arithmetic (for the next step; nothing computed on chain)

Initial price needs a cirBTC/USD reference. Per the brief, sqrtPriceX96 = sqrt(cirBTC atoms / USDC atoms) * 2^96 (token1 over token0 atoms).
Seed need depends on the trade scale: about 716 USDC per side for E=10, or 7.17 per side for E=0.10, before safety margin.
The 3% friction target needs about 716 USDC per side for the 20-USDC buy, so the preferred scale is likely infeasible.
The 0.10 scale needs about 7.17 USDC per side (target 10).

## Access report (deployment wallet, no secrets)

- Platform deployer wallet (testnet-only, shared across Arc Studio users): 0x5B12Ce46C7194aD57d143bC22847224047b1Ef42.
  Balance 1,427.463999 USDC (ERC-20 view 1,427,463,999 atoms; native view 1,427.463999e18 is the same funds), cirBTC 0, nonce 1.
  This wallet is shared, not yours. Do not send funds to it, and it cannot be funded or withdrawn by you.
  The deploy tool can deploy from it but cannot send arbitrary transactions (pool initialize, mint position, swaps).
- No Circle API key, entity secret or deployer private key is set in the sandbox.
- Netlify, Hugging Face and Vercel: not connected.
- **cirBTC is the blocker for seeding.** It is a permissioned mintable token (masterMinter above). The faucet tool drips only USDC/EURC/native.
  Neither the shared wallet nor the sandbox holds any. Needed before the smoke step: a funded, signable wallet holding the cirBTC amount calculated from the chosen seed value and reference price.
  At the 0.10 scale about 10 USDC of cirBTC per side is only on the order of 10,000 atoms.
  Also needed: a way to sign transactions (own EOA key supplied through .env, or a Circle developer-controlled wallet with your approval).

## Reproduce

`bash scripts/install-v4-deps.sh` then `forge test --match-path contracts/test/V4Interface.t.sol -vv`.

## Independent local verification and funding correction

Codex ran the pinned installer and the eight fork interface tests locally: all passed, Solc 0.8.28. The dependency source trees are ignored and reproducible from the tracked manifest/installer; forge-std stays a pinned submodule. These interface checks do not replace the adapter swap tests.

Circle's [public faucet](https://faucet.circle.com/) lists cirBTC, USDC and EURC as of November 6. The Studio faucet tool's narrower support does not establish that cirBTC funding is unavailable. A dedicated signable testnet wallet and the applicable faucet/network selection are still needed.
