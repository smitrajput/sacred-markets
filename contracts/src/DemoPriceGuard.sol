// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IDemoPriceGuard} from "./interfaces/IDemoPriceGuard.sol";

/// @title DemoPriceGuard
/// @notice TESTNET OPERATOR FIXTURE, not a production oracle. A single separate price admin pushes an explicit
/// micro-USDC-per-whole-BTC price and timestamp. Nothing reads pool spot, and no keeper can update it. Readers fail
/// closed: a missing, future-dated or older-than-maxAge price is reported as not fresh.
/// @dev Domain: price in [1e6, 1e13] micro-USDC per BTC (1 USDC to 10,000,000 USDC per BTC). With a 128-bit atom
/// quantity the largest intermediate product is below 2^128 * 1e13 < 2^177, and every conversion uses Math.mulDiv,
/// so no multiplication in the engine can overflow within this domain.
contract DemoPriceGuard is IDemoPriceGuard {
    uint256 public constant MIN_PRICE = 1e6;
    uint256 public constant MAX_PRICE = 1e13;
    uint256 public constant MAX_AGE_LIMIT = 1 days;

    address public immutable priceAdmin;
    uint256 public immutable maxAge;

    uint256 private _price;
    uint256 private _timestamp;

    event PriceUpdated(uint256 price, uint256 timestamp, address indexed admin);

    error NotPriceAdmin();
    error InvalidConfig();
    error PriceOutOfDomain(uint256 price);
    error FutureTimestamp(uint256 timestamp, uint256 nowTs);
    error TimestampWentBackwards(uint256 timestamp, uint256 previous);

    constructor(address priceAdmin_, uint256 maxAge_) {
        if (priceAdmin_ == address(0) || maxAge_ == 0 || maxAge_ > MAX_AGE_LIMIT) revert InvalidConfig();
        priceAdmin = priceAdmin_;
        maxAge = maxAge_;
    }

    /// @notice Explicit operator update. The timestamp may not be in the future or earlier than the stored one.
    function update(uint256 newPrice, uint256 newTimestamp) external {
        if (msg.sender != priceAdmin) revert NotPriceAdmin();
        if (newPrice < MIN_PRICE || newPrice > MAX_PRICE) revert PriceOutOfDomain(newPrice);
        if (newTimestamp > block.timestamp) revert FutureTimestamp(newTimestamp, block.timestamp);
        if (newTimestamp < _timestamp) revert TimestampWentBackwards(newTimestamp, _timestamp);
        _price = newPrice;
        _timestamp = newTimestamp;
        emit PriceUpdated(newPrice, newTimestamp, msg.sender);
    }

    function price() external view returns (uint256) {
        return _price;
    }

    function timestamp() external view returns (uint256) {
        return _timestamp;
    }

    function fresh() public view returns (bool) {
        return _price != 0 && _timestamp <= block.timestamp && block.timestamp - _timestamp <= maxAge;
    }

    function read() external view returns (uint256, uint256, bool) {
        return (_price, _timestamp, fresh());
    }
}
