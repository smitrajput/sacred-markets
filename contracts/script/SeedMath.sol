// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

/// @notice Read-only math helper for the live seeding script. It is never deployed: the script runs its runtime code
/// through `eth_call` with a state override so the pinned Uniswap libraries (not a TypeScript port) do the arithmetic.
contract SeedMath {
    /// @dev sqrtPriceX96 = sqrt(token1Atoms / token0Atoms) * 2^96, floored. Same formula the fork tests use.
    function sqrtPriceFromAtoms(uint256 token0Atoms, uint256 token1Atoms) external pure returns (uint160) {
        return uint160(Math.sqrt(FullMath.mulDiv(token1Atoms, 1 << 192, token0Atoms)));
    }

    /// @return liquidity Liquidity the amounts support over [tickLower, tickUpper] at `sqrtPriceX96`.
    /// @return need0 Token0 atoms the position consumes (rounded up, as the PositionManager does).
    /// @return need1 Token1 atoms the position consumes (rounded up).
    function seedQuote(uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper, uint256 amount0, uint256 amount1)
        external
        pure
        returns (uint128 liquidity, uint256 need0, uint256 need1)
    {
        uint160 sqrtLo = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtHi = TickMath.getSqrtPriceAtTick(tickUpper);
        liquidity = LiquidityAmounts.getLiquidityForAmounts(sqrtPriceX96, sqrtLo, sqrtHi, amount0, amount1);
        need0 = SqrtPriceMath.getAmount0Delta(sqrtPriceX96, sqrtHi, liquidity, true);
        need1 = SqrtPriceMath.getAmount1Delta(sqrtLo, sqrtPriceX96, liquidity, true);
    }

    function tickAtSqrtPrice(uint160 sqrtPriceX96) external pure returns (int24) {
        return TickMath.getTickAtSqrtPrice(sqrtPriceX96);
    }
}
