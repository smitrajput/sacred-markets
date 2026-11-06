// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISpotVenue} from "../../src/interfaces/ISpotVenue.sol";
import {MarginVault} from "../../src/MarginVault.sol";
import {TestERC20} from "./TestERC20.sol";

/// @notice Narrow mock of the fixed venue for engine unit tests: exact-input, engine-only, pulls from and pays the engine.
/// Execution price and fee are test controls; USDC inventory lives here, BTC is minted on buys. Unit tests only.
contract MockSpotVenue is ISpotVenue {
    TestERC20 public immutable usdcToken;
    TestERC20 public immutable btcToken;
    address public override engine;
    uint256 public execPrice; // micro-USDC per whole BTC
    uint256 public feeBps; // taken from the output
    bool public failBuy;
    uint256 public failSellOn; // 1-based index of the sell call that reverts (0 = never)
    uint256 public sells;
    // evidence captured at the moment of the buy
    address public watchTrader;
    MarginVault public watchVault;
    uint256 public vaultPendingGrossAtBuy;
    uint256 public traderUsdcAtBuy;
    // adversarial hook: a nested call made to `reenterTarget` while the engine is mid-operation
    address public reenterTarget;
    bytes public reenterData;
    bool public reenterBubble; // true: forward the nested revert to the engine
    uint256 public reentries;
    bool public lastReentryOk;
    bytes4 public lastReentrySelector;

    error NotEngine();
    error Forced();
    error Late();
    error InsufficientOutput(uint256 out, uint256 min);

    constructor(TestERC20 usdc_, TestERC20 btc_) {
        usdcToken = usdc_;
        btcToken = btc_;
    }

    function usdc() external view override returns (address) {
        return address(usdcToken);
    }

    function cirBtc() external view override returns (address) {
        return address(btcToken);
    }

    function bindEngine(address e) external {
        engine = e;
    }

    function set(uint256 price, uint256 fee) external {
        execPrice = price;
        feeBps = fee;
    }

    function setFailBuy(bool v) external {
        failBuy = v;
    }

    function setFailSellOn(uint256 n) external {
        failSellOn = n;
        sells = 0;
    }

    function armReentry(address target, bytes calldata data, bool bubble) external {
        reenterTarget = target;
        reenterData = data;
        reenterBubble = bubble;
    }

    function _maybeReenter() internal {
        if (reenterTarget == address(0)) return;
        reentries++;
        (bool ok, bytes memory ret) = reenterTarget.call(reenterData);
        lastReentryOk = ok;
        lastReentrySelector = ret.length >= 4 ? bytes4(ret) : bytes4(0);
        if (!ok && reenterBubble) {
            assembly ("memory-safe") {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    function watch(address trader, MarginVault v) external {
        watchTrader = trader;
        watchVault = v;
    }

    function buyCirBtc(uint256 usdcIn, uint256 minOut, uint256 deadline) external override returns (uint256 out) {
        if (msg.sender != engine) revert NotEngine();
        if (failBuy) revert Forced();
        if (block.timestamp > deadline) revert Late();
        if (address(watchVault) != address(0)) {
            vaultPendingGrossAtBuy = watchVault.pendingGrossCash();
            traderUsdcAtBuy = usdcToken.balanceOf(watchTrader);
        }
        _maybeReenter();
        usdcToken.transferFrom(msg.sender, address(this), usdcIn);
        out = (usdcIn * 1e8 / execPrice) * (10_000 - feeBps) / 10_000;
        if (out < minOut) revert InsufficientOutput(out, minOut);
        btcToken.mint(msg.sender, out);
    }

    function sellCirBtc(uint256 atoms, uint256 minOut, uint256 deadline) external override returns (uint256 out) {
        if (msg.sender != engine) revert NotEngine();
        if (++sells == failSellOn) revert Forced();
        if (block.timestamp > deadline) revert Late();
        _maybeReenter();
        btcToken.transferFrom(msg.sender, address(this), atoms);
        out = (atoms * execPrice / 1e8) * (10_000 - feeBps) / 10_000;
        if (out < minOut) revert InsufficientOutput(out, minOut);
        usdcToken.transfer(msg.sender, out);
    }
}
