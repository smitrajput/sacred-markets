# Developer feedback: Uniswap v4 on Arc Testnet

Sacred uses the existing v4 PoolManager to buy cirBTC for a fixed-markup sale and to sell collateral during settlement. The live demo uses the USDC/cirBTC 3000/60 pool with no hook. Deployment addresses and pinned source revisions are recorded in [the manifest](deployments/arc-testnet.json) and [dependency manifest](contracts/deps/v4-manifest.json).

## What worked

- The PoolManager unlock/callback model supported an adapter with fixed market parameters, exact delta settlement and explicit caller checks.
- Real Quoter results let the app enforce the initial-coverage requirement on actual expected BTC output rather than a reference-price estimate alone.
- The same adapter handled acquisition and an engine-sized partial coverage sale. The [real rebalance receipt](https://explorer.testnet.arc.io/tx/0xc7afcee5e170601d01468b8acef07f62439b49404a31dbe553b770dd4a783f78) sold 52 cirBTC atoms for 40,612 micro-USDC and restored coverage to 191.39%.

## Friction encountered

- Public deployment tables and the active network needed careful reconciliation. We verified code and identity on chain 5042002 and pinned source versions. A chain-specific deployment record with runtime hashes would reduce ambiguity.
- Standard Foundry could not reproduce Arc's native-USDC behavior. The real fork tests required Circle's Arc-aware Foundry build. A documented Arc/v4 fork example would help integrators avoid misleading ERC-20-only mocks.
- At small test amounts, cirBTC atom rounding matters. A reference-floor check alone can pass while the actual quoted output misses initial coverage. Worked small-unit examples would be useful alongside whole-token examples.
- Public RPC log requests needed 1000-block windows and later hit shared rate limits. Explicit endpoint limits and recommended indexing patterns would help browser-app builders.

## Integration source

- [Purchase and sale adapter](contracts/src/V4SpotVenue.sol)
- [Unlock callback authentication and settlement](contracts/src/V4SpotVenue.sol#L218)
- [Engine acquisition and sale agreement](contracts/src/TradeEngine.sol#L178)
- [Coverage rebalance](contracts/src/TradeEngine.sol#L414)
- [Real fork tests](contracts/test/fork/TradeEngine.fork.t.sol)
- [Live evidence](docs/checkpoints/02-live.md)

The [Uniswap developer feedback form](https://developers.uniswap.org/hackathon-feedback) still needs submission by the founder. This file records the feedback; it is not evidence that the form was sent.
