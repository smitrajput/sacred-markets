// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Read surface of the testnet price fixture used by the TradeEngine.
interface IDemoPriceGuard {
    /// @return price micro-USDC per whole BTC (cirBTC has 8 decimals; 1 BTC = 1e8 atoms)
    /// @return timestamp the time the operator says the price was observed
    /// @return fresh true only when a price exists, is not in the future and is at most maxAge old
    function read() external view returns (uint256 price, uint256 timestamp, bool fresh);
}
