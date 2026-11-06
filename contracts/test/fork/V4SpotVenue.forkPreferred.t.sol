// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ForkScenarioBase} from "./ForkScenarioBase.sol";

/// @notice Preferred demo scale: a 20 USDC buy. The pool is seeded at 800 USDC per side (above the ~716 USDC per side
/// full-range requirement at 300 bps). The seed is fork-only; it says nothing about funds available on the live chain.
contract V4SpotVenueForkPreferredTest is ForkScenarioBase {
    function _seedUsdc() internal pure override returns (uint256) {
        return 800e6;
    }

    function _tradeUsdc() internal pure override returns (uint256) {
        return 20e6;
    }
}
