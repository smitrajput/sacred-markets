// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ForkScenarioBase} from "./ForkScenarioBase.sol";

/// @notice First fallback scale: a 0.20 USDC buy against 10 USDC per side (target of at least 10 per side).
contract V4SpotVenueForkFallbackTest is ForkScenarioBase {
    function _seedUsdc() internal pure override returns (uint256) {
        return 10e6;
    }

    function _tradeUsdc() internal pure override returns (uint256) {
        return 200_000;
    }
}
