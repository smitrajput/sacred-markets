// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ISpotVenue
/// @notice Narrow spot-execution interface the Sacred engine/vault uses to trade USDC against cirBTC.
/// @dev The caller is always the single authorized engine. The engine is both payer and recipient:
///      it must approve the venue for the exact input amount, the input is pulled from `msg.sender`,
///      and the output is delivered to `msg.sender`. There is no payer, recipient, pool or calldata argument.
///      Both functions are exact-input, revert unless the whole input is consumed, and revert when the
///      engine's measured output balance increase is below `minOut`.
interface ISpotVenue {
    /// @notice Spend exactly `usdcIn` USDC (6 decimals) from the engine; deliver cirBTC (8 decimals) to the engine.
    /// @param usdcIn Exact USDC input in ERC-20 atoms. Must be positive.
    /// @param minCirBtcOut Minimum cirBTC atoms the engine must receive. Must be positive.
    /// @param deadline Unix timestamp (seconds). The call reverts when `block.timestamp > deadline`.
    /// @return cirBtcOut cirBTC atoms actually received by the engine.
    function buyCirBtc(uint256 usdcIn, uint256 minCirBtcOut, uint256 deadline) external returns (uint256 cirBtcOut);

    /// @notice Spend exactly `cirBtcIn` cirBTC from the engine; deliver USDC (ERC-20 view) to the engine.
    /// @param cirBtcIn Exact cirBTC input in atoms. Must be positive.
    /// @param minUsdcOut Minimum USDC atoms the engine must receive. Must be positive.
    /// @param deadline Unix timestamp (seconds). The call reverts when `block.timestamp > deadline`.
    /// @return usdcOut USDC atoms actually received by the engine.
    function sellCirBtc(uint256 cirBtcIn, uint256 minUsdcOut, uint256 deadline) external returns (uint256 usdcOut);

    /// @notice The single address allowed to trade, or zero before it is bound.
    function engine() external view returns (address);

    /// @notice USDC ERC-20 address (pool currency0).
    function usdc() external view returns (address);

    /// @notice cirBTC address (pool currency1).
    function cirBtc() external view returns (address);
}
