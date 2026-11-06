// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {V4SpotVenue} from "../../src/V4SpotVenue.sol";
import {ForkVenueSetup} from "./ForkVenueSetup.sol";

/// @notice Real two-way swaps through V4SpotVenue on a pinned Arc Testnet fork (real PoolManager, PositionManager,
/// Permit2, V4Quoter, StateView, USDC and cirBTC bytecode). Friction is measured against the pool's fee-free spot price,
/// so it includes the 0.3% fee, price impact and atom rounding. Balances are fork-only (see ForkBase).
abstract contract ForkScenarioBase is ForkVenueSetup {
    uint256 internal constant MAX_FRICTION_BPS = 300;

    // ------------------------------------------------------------------ buy, normal close

    function test_buyThenNormalClose_withinFrictionBudget() public {
        uint256 trade = _tradeUsdc();
        Snap memory s0 = _snap();

        uint256 spotBuy = _spotOut(key, true, trade);
        uint256 btcOut = _buy(trade);
        uint256 buyFriction = _frictionBps(spotBuy, btcOut);
        emit log_named_uint("seed USDC atoms per side", _seedUsdc());
        emit log_named_uint("buy USDC atoms in", trade);
        emit log_named_uint("buy cirBTC atoms out", btcOut);
        emit log_named_uint("buy friction bps vs spot", buyFriction);
        assertGt(btcOut, 0);
        assertLe(buyFriction, MAX_FRICTION_BPS, "buy friction");

        Snap memory s1 = _snap();
        assertEq(s0.engUsdc - s1.engUsdc, trade, "engine paid exactly the input");
        assertEq(s1.engBtc - s0.engBtc, btcOut, "engine received exactly the output");
        assertEq(s1.pmUsdc - s0.pmUsdc, trade, "PoolManager received the input");
        assertEq(s0.pmBtc - s1.pmBtc, btcOut, "PoolManager paid the output");
        assertEq(s1.venueUsdc + s1.venueBtc, 0, "venue holds nothing");

        uint256 spotSell = _spotOut(key, false, btcOut);
        uint256 usdcBack = _sell(btcOut);
        uint256 sellFriction = _frictionBps(spotSell, usdcBack);
        emit log_named_uint("close USDC atoms out", usdcBack);
        emit log_named_uint("close friction bps vs spot", sellFriction);
        assertLe(sellFriction, MAX_FRICTION_BPS, "close friction");

        Snap memory s2 = _snap();
        assertEq(s2.engBtc, s0.engBtc, "all cirBTC sold");
        assertEq(s2.engUsdc, s0.engUsdc - trade + usdcBack);
        assertEq(s2.venueUsdc + s2.venueBtc, 0);
        // conservation across engine + PoolManager
        assertEq(s2.engUsdc + s2.pmUsdc, s0.engUsdc + s0.pmUsdc);
        assertEq(s2.engBtc + s2.pmBtc, s0.engBtc + s0.pmBtc);
        // a round trip can only lose value to the pool
        assertLt(usdcBack, trade);
    }

    // ------------------------------------------------------------------ prepared coverage sale

    /// @dev After the buy, an unrelated seller pushes the price down (the collateral-trigger situation). The engine's
    /// prepared coverage sale of the whole position still clears within the same friction budget at the lower price.
    function test_coverageSaleAfterPriceDrop_withinFrictionBudget() public {
        uint256 trade = _tradeUsdc();
        uint256 btcOut = _buy(trade);

        // Market mover: a second venue instance bound to another account sells cirBTC into the same real pool.
        address mover = makeAddr("priceMover");
        V4SpotVenue moverVenue = new V4SpotVenue(POOL_MANAGER, USDC, CIRBTC, FEE, SPACING, address(this));
        moverVenue.bindEngine(mover);
        uint256 moverBtc = _btcAtomsForUsdc(_seedUsdc()) / 10; // ~10% of the cirBTC reserve
        _forkOnlyFund(CIRBTC, mover, moverBtc);
        vm.startPrank(mover);
        IERC20(CIRBTC).approve(address(moverVenue), moverBtc);
        moverVenue.sellCirBtc(moverBtc, _quote(key, false, moverBtc), _deadline());
        vm.stopPrank();

        uint256 spot = _spotOut(key, false, btcOut);
        uint256 usdcOut = _sell(btcOut);
        uint256 friction = _frictionBps(spot, usdcOut);
        emit log_named_uint("coverage sale cirBTC atoms in", btcOut);
        emit log_named_uint("coverage sale USDC atoms out", usdcOut);
        emit log_named_uint("coverage friction bps vs spot", friction);
        assertGt(usdcOut, 0);
        assertLe(friction, MAX_FRICTION_BPS, "coverage friction");
        assertLt(usdcOut, trade, "price fell, proceeds are below the original spend");
        assertEq(IERC20(USDC).balanceOf(address(venue)) + IERC20(CIRBTC).balanceOf(address(venue)), 0);
    }

    // ------------------------------------------------------------------ fuzz: Quoter equals execution, minOut boundary

    function testFuzz_executionEqualsQuote_andMinOutBoundary(uint256 amount, bool buy) public {
        uint256 maxIn = buy ? _tradeUsdc() : _btcAtomsForUsdc(_tradeUsdc() * 5);
        uint256 minIn = buy ? 1e4 : 100; // 0.01 USDC or 100 cirBTC atoms
        amount = bound(amount, minIn, maxIn);
        uint256 q = _quote(key, buy, amount);
        vm.assume(q > 0);

        Snap memory before = _snap();
        // One atom above the simulated output must revert, and EVERY balance of both real tokens must be exactly
        // unchanged afterwards: engine, venue and PoolManager, USDC (native-backed) and cirBTC alike.
        vm.prank(engine);
        vm.expectPartialRevert(V4SpotVenue.InsufficientOutput.selector);
        if (buy) venue.buyCirBtc(amount, q + 1, _deadline());
        else venue.sellCirBtc(amount, q + 1, _deadline());
        _assertSnapEq(_snap(), before);

        // exactly the simulated output succeeds and matches
        vm.prank(engine);
        uint256 out = buy ? venue.buyCirBtc(amount, q, _deadline()) : venue.sellCirBtc(amount, q, _deadline());
        assertEq(out, q);
        Snap memory after_ = _snap();
        if (buy) {
            assertEq(before.engUsdc - after_.engUsdc, amount);
            assertEq(after_.engBtc - before.engBtc, out);
        } else {
            assertEq(before.engBtc - after_.engBtc, amount);
            assertEq(after_.engUsdc - before.engUsdc, out);
        }
        assertEq(after_.venueUsdc + after_.venueBtc, 0);
    }

    // ------------------------------------------------------------------ full rollback on failure (real USDC and cirBTC)

    function _assertSnapEq(Snap memory x, Snap memory y) internal pure {
        assertEq(x.engUsdc, y.engUsdc, "engine USDC");
        assertEq(x.engBtc, y.engBtc, "engine cirBTC");
        assertEq(x.pmUsdc, y.pmUsdc, "PoolManager USDC");
        assertEq(x.pmBtc, y.pmBtc, "PoolManager cirBTC");
        assertEq(x.venueUsdc, y.venueUsdc, "venue USDC");
        assertEq(x.venueBtc, y.venueBtc, "venue cirBTC");
        assertEq(x.venueUsdc + x.venueBtc, 0, "venue empty");
    }

    function test_failedBuy_rollsBackEverything_minOut() public {
        uint256 trade = _tradeUsdc();
        uint256 q = _quote(key, true, trade);
        Snap memory b = _snap();
        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.InsufficientOutput.selector, q, q + 1));
        venue.buyCirBtc(trade, q + 1, _deadline());
        _assertSnapEq(_snap(), b);
    }

    function test_failedSell_rollsBackEverything_minOut() public {
        uint256 btc = _btcAtomsForUsdc(_tradeUsdc());
        uint256 q = _quote(key, false, btc);
        Snap memory b = _snap();
        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.InsufficientOutput.selector, q, q + 1));
        venue.sellCirBtc(btc, q + 1, _deadline());
        _assertSnapEq(_snap(), b);
    }

    // A full-range position absorbs any input that fits in int128 without hitting the price limit, so a genuine partial
    // fill cannot be produced against the full-range Sacred pool. Incomplete-input rollback with real USDC and cirBTC
    // is covered in V4SpotVenue.forkRealTokensNarrow.t.sol on a liquidity-limited pool.

    function test_failedBuy_rollsBackEverything_expiredDeadline() public {
        Snap memory b = _snap();
        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.Expired.selector, block.timestamp - 1, block.timestamp));
        venue.buyCirBtc(_tradeUsdc(), 1, block.timestamp - 1);
        _assertSnapEq(_snap(), b);
    }
}
