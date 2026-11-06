// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Pure policy arithmetic for the TradeEngine. Every product goes through Math.mulDiv (full precision).
/// Units: USDC in micro-USDC (6 decimals), BTC in atoms (8 decimals), price in micro-USDC per whole BTC.
library EngineMath {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant ATOMS_PER_BTC = 1e8;
    uint256 internal constant TERM = 1_209_600; // 14 days in seconds
    uint256 internal constant YEAR = 31_536_000; // 365 days in seconds
    uint256 internal constant ANNUAL_MARKUP_BPS = 1_000;
    uint256 internal constant LP_MARKUP_BPS = 7_700;
    uint256 internal constant TRIGGER_BPS = 16_000; // rebalance becomes possible at or below 160% coverage
    uint256 internal constant RESTORE_BPS = 19_000; // a rebalance restores 190% coverage
    uint256 internal constant INITIAL_COVERAGE_BPS = 19_000;
    uint256 internal constant MAX_FRICTION_BPS = 460;

    /// @dev M = floor(P * 1000 * 1209600 / (10000 * 31536000)); fixed at open.
    function markupFor(uint256 principal) internal pure returns (uint256) {
        return Math.mulDiv(principal, ANNUAL_MARKUP_BPS * TERM, BPS * YEAR);
    }

    function atomsForUsdc(uint256 usdc, uint256 price) internal pure returns (uint256) {
        return Math.mulDiv(usdc, ATOMS_PER_BTC, price);
    }

    /// @dev Gross reference value of `atoms` in micro-USDC, floored.
    function valueOf(uint256 atoms, uint256 price) internal pure returns (uint256) {
        return Math.mulDiv(atoms, price, ATOMS_PER_BTC);
    }

    /// @dev Reference value less the friction budget, floored. Used for the conservative position value and sale floors.
    function afterFriction(uint256 value, uint256 frictionBps) internal pure returns (uint256) {
        return Math.mulDiv(value, BPS - frictionBps, BPS);
    }

    /// @dev Independent minimum for a sale of `atoms`: floor(floor(atoms * price / 1e8) * (B - f) / B).
    function saleFloor(uint256 atoms, uint256 price, uint256 frictionBps) internal pure returns (uint256) {
        return afterFriction(valueOf(atoms, price), frictionBps);
    }

    /// @dev denom = R * (B - f) - B * B, strictly positive for every friction up to the 460 bps cap.
    function rebalanceDenominator(uint256 frictionBps) internal pure returns (uint256) {
        return RESTORE_BPS * (BPS - frictionBps) - BPS * BPS;
    }

    /// @dev g = ceil((R * D - B * V) * B / denom): the reference value to sell so that, after friction, coverage is 190%.
    /// Caller guarantees V * B <= D * trigger, hence R * D > B * V.
    function rebalanceGross(uint256 debt, uint256 value, uint256 frictionBps) internal pure returns (uint256) {
        return Math.mulDiv(
            RESTORE_BPS * debt - BPS * value, BPS, rebalanceDenominator(frictionBps), Math.Rounding.Ceil
        );
    }

    function atomsToSell(uint256 grossValue, uint256 price) internal pure returns (uint256) {
        return Math.mulDiv(grossValue, ATOMS_PER_BTC, price, Math.Rounding.Ceil);
    }

    function lpAllocation(uint256 cumulativeCollected) internal pure returns (uint256) {
        return Math.mulDiv(cumulativeCollected, LP_MARKUP_BPS, BPS);
    }

    function coverageBps(uint256 value, uint256 debt) internal pure returns (uint256) {
        return debt == 0 ? type(uint256).max : Math.mulDiv(value, BPS, debt);
    }
}
