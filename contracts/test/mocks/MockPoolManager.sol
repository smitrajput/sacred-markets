// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @notice UNIT-TEST ONLY. Inventory-backed stand-in for the v4 PoolManager that reproduces its
/// flash-accounting rules (unlock, sync/settle/take, per-caller currency deltas) and can misbehave on demand.
/// It never appears in fork or deployment code paths.
contract MockPoolManager {
    // price: zeroForOne out = in * rateNum / rateDen ; oneForZero out = in * rateDen / rateNum
    uint256 public rateNum = 1;
    uint256 public rateDen = 1;

    // misbehavior switches
    uint256 public fillBps = 10_000; // share of the input actually consumed
    bool public callbackTwice; // call unlockCallback a second time inside the same unlock
    uint256 public takeShortfall; // deliver this much less than the debited take amount
    bool public reportNonzeroDelta; // exttload claims an outstanding delta
    bool public tamperSecondCall; // when callbackTwice, the second call carries altered data

    // accounting
    address private _unlocker;
    address private _syncedCurrency;
    uint256 private _syncedBalance;
    mapping(bytes32 => int256) private _delta;
    bytes32[] private _touched;

    bool public secondCallReverted;
    bytes public secondCallRevertData;
    uint256 public unlockCount;

    error AlreadyUnlocked();
    error ManagerLocked();
    error CurrencyNotSettled();

    function setRate(uint256 num, uint256 den) external {
        rateNum = num;
        rateDen = den;
    }

    function setFillBps(uint256 v) external {
        fillBps = v;
    }

    function setCallbackTwice(bool v) external {
        callbackTwice = v;
    }

    function setTakeShortfall(uint256 v) external {
        takeShortfall = v;
    }

    function setTamperSecondCall(bool v) external {
        tamperSecondCall = v;
    }

    function setReportNonzeroDelta(bool v) external {
        reportNonzeroDelta = v;
    }

    function unlock(bytes calldata data) external returns (bytes memory result) {
        if (_unlocker != address(0)) revert AlreadyUnlocked();
        _unlocker = msg.sender;
        unlockCount++;
        result = IUnlockCallback(msg.sender).unlockCallback(data);
        if (callbackTwice) {
            bytes memory second = data;
            if (tamperSecondCall) second[second.length - 1] = bytes1(uint8(second[second.length - 1]) ^ 1);
            try IUnlockCallback(msg.sender).unlockCallback(second) returns (bytes memory) {
                secondCallReverted = false;
            } catch (bytes memory reason) {
                secondCallReverted = true;
                secondCallRevertData = reason;
            }
        }
        for (uint256 i; i < _touched.length; i++) {
            if (_delta[_touched[i]] != 0) revert CurrencyNotSettled();
            delete _delta[_touched[i]];
        }
        delete _touched;
        _unlocker = address(0);
    }

    function swap(PoolKey memory key, SwapParams memory params, bytes calldata) external returns (BalanceDelta) {
        if (msg.sender != _unlocker) revert ManagerLocked();
        uint256 specified = uint256(-params.amountSpecified);
        uint256 consumed = (specified * fillBps) / 10_000;
        (Currency cIn, Currency cOut) =
            params.zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
        uint256 out = params.zeroForOne ? (consumed * rateNum) / rateDen : (consumed * rateDen) / rateNum;
        _add(msg.sender, cIn, -int256(consumed));
        _add(msg.sender, cOut, int256(out));
        return params.zeroForOne
            ? toBalanceDelta(-int128(int256(consumed)), int128(int256(out)))
            : toBalanceDelta(int128(int256(out)), -int128(int256(consumed)));
    }

    function sync(Currency currency) external {
        _syncedCurrency = Currency.unwrap(currency);
        _syncedBalance = IERC20(_syncedCurrency).balanceOf(address(this));
    }

    function settle() external payable returns (uint256 paid) {
        if (msg.sender != _unlocker) revert ManagerLocked();
        paid = IERC20(_syncedCurrency).balanceOf(address(this)) - _syncedBalance;
        _add(msg.sender, Currency.wrap(_syncedCurrency), int256(paid));
        _syncedCurrency = address(0);
    }

    function take(Currency currency, address to, uint256 amount) external {
        if (msg.sender != _unlocker) revert ManagerLocked();
        _add(msg.sender, currency, -int256(amount));
        IERC20(Currency.unwrap(currency)).transfer(to, amount - takeShortfall);
    }

    function exttload(bytes32 slot) external view returns (bytes32) {
        if (reportNonzeroDelta) return bytes32(uint256(1));
        return bytes32(uint256(_delta[slot]));
    }

    function _slot(address target, Currency currency) private pure returns (bytes32) {
        return keccak256(abi.encode(target, currency));
    }

    function _add(address target, Currency currency, int256 amount) private {
        bytes32 s = _slot(target, currency);
        if (_delta[s] == 0) _touched.push(s);
        _delta[s] += amount;
    }
}
