// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {V4SpotVenue} from "../src/V4SpotVenue.sol";
import {VenueUnitBase} from "./VenueUnitBase.sol";

/// @notice Unit tests (mock PoolManager): swap success, rollback on every failure mode, conservation, fuzzed bounds.
contract V4SpotVenueSwapTest is VenueUnitBase {
    event Swapped(bool indexed buy, uint256 amountIn, uint256 amountOut);

    // ---------------------------------------------------------------- success paths

    function test_buy_movesTokensOnlyBetweenEngineVenueAndPoolManager() public {
        Balances memory b = _balances();
        vm.expectEmit(true, false, false, true, address(venue));
        emit Swapped(true, 10_000, 15_000);
        vm.prank(engine);
        uint256 out = venue.buyCirBtc(10_000, 15_000, _deadline());
        assertEq(out, 15_000);

        Balances memory a = _balances();
        assertEq(b.engUsdc - a.engUsdc, 10_000, "engine paid exactly the input");
        assertEq(a.engBtc - b.engBtc, 15_000, "engine received exactly the output");
        assertEq(a.pmUsdc - b.pmUsdc, 10_000, "pool manager received the input");
        assertEq(b.pmBtc - a.pmBtc, 15_000, "pool manager paid the output");
        assertEq(a.venueUsdc, 0);
        assertEq(a.venueBtc, 0);
        assertEq(a.supplyUsdc, b.supplyUsdc, "usdc conserved");
        assertEq(a.supplyBtc, b.supplyBtc, "btc conserved");
    }

    function test_sell_movesTokensOnlyBetweenEngineVenueAndPoolManager() public {
        Balances memory b = _balances();
        vm.prank(engine);
        uint256 out = venue.sellCirBtc(9_000, 6_000, _deadline());
        assertEq(out, 6_000);
        Balances memory a = _balances();
        assertEq(b.engBtc - a.engBtc, 9_000);
        assertEq(a.engUsdc - b.engUsdc, 6_000);
        assertEq(a.pmBtc - b.pmBtc, 9_000);
        assertEq(b.pmUsdc - a.pmUsdc, 6_000);
        assertEq(a.venueUsdc, 0);
        assertEq(a.venueBtc, 0);
    }

    function test_roundTrip_returnsToEngineLessSpread() public {
        // rates 3/2 then 2/3 on integer atoms: 10_001 -> 15_001 -> 10_000 (one atom lost to rounding)
        vm.startPrank(engine);
        uint256 btcOut = venue.buyCirBtc(10_001, 1, _deadline());
        uint256 usdcBack = venue.sellCirBtc(btcOut, 1, _deadline());
        vm.stopPrank();
        assertEq(btcOut, 15_001);
        assertEq(usdcBack, 10_000);
        assertEq(usdc.balanceOf(address(venue)) + btc.balanceOf(address(venue)), 0);
    }

    // ---------------------------------------------------------------- rollback on failure

    function test_minOutAboveFill_revertsAndRollsBack() public {
        Balances memory b = _balances();
        vm.startPrank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.InsufficientOutput.selector, 15_000, 15_001));
        venue.buyCirBtc(10_000, 15_001, _deadline());
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.InsufficientOutput.selector, 6_666, 6_667));
        venue.sellCirBtc(10_000, 6_667, _deadline());
        vm.stopPrank();
        _assertUnchanged(b);
    }

    function test_incompleteInput_revertsAndRollsBack() public {
        Balances memory b = _balances();
        pm.setFillBps(5_000);
        vm.startPrank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.IncompleteInput.selector, -int256(10_000), -int256(5_000)));
        venue.buyCirBtc(10_000, 1, _deadline());
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.IncompleteInput.selector, -int256(10_000), -int256(5_000)));
        venue.sellCirBtc(10_000, 1, _deadline());
        vm.stopPrank();
        _assertUnchanged(b);
    }

    function test_zeroFill_reverts() public {
        pm.setFillBps(0);
        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.IncompleteInput.selector, -int256(10_000), int256(0)));
        venue.buyCirBtc(10_000, 1, _deadline());
    }

    function test_outputDustThatRoundsToZero_reverts() public {
        // sell 1 atom at rate 2/3 yields 0: never a free donation of the input
        Balances memory b = _balances();
        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.InsufficientOutput.selector, 0, 1));
        venue.sellCirBtc(1, 1, _deadline());
        _assertUnchanged(b);
    }

    function test_recipientShortDelivery_reverts() public {
        // pool manager debits `out` but the engine receives one atom less: measured balance delta catches it
        Balances memory b = _balances();
        pm.setTakeShortfall(1);
        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.EngineOutputMismatch.selector, 15_000, 14_999));
        venue.buyCirBtc(10_000, 1, _deadline());
        _assertUnchanged(b);
    }

    function test_outstandingDelta_reverts() public {
        Balances memory b = _balances();
        pm.setReportNonzeroDelta(true);
        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.OutstandingDelta.selector, address(usdc), int256(1)));
        venue.buyCirBtc(10_000, 1, _deadline());
        _assertUnchanged(b);
    }

    function test_feeOnTransferInput_reverts() public {
        // a token that burns 1% on transfer would leave the venue short of the amount it must settle
        usdc.setFeeBps(100);
        Balances memory b = _balances();
        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.InputNotReceived.selector, 10_000, 9_900));
        venue.buyCirBtc(10_000, 1, _deadline());
        usdc.setFeeBps(0);
        _assertUnchanged(b);
    }

    function test_insufficientAllowance_reverts() public {
        vm.prank(engine);
        usdc.approve(address(venue), 9_999);
        vm.prank(engine);
        vm.expectRevert();
        venue.buyCirBtc(10_000, 1, _deadline());
        // allowance is an exact bound: the venue never pulls more than the call's input
        vm.prank(engine);
        venue.buyCirBtc(9_999, 1, _deadline());
        assertEq(usdc.allowance(engine, address(venue)), 0);
    }

    function test_failedCallDoesNotLockVenue() public {
        pm.setFillBps(1);
        vm.startPrank(engine);
        vm.expectPartialRevert(V4SpotVenue.IncompleteInput.selector);
        venue.buyCirBtc(10_000, 1, _deadline());
        pm.setFillBps(10_000);
        assertEq(venue.buyCirBtc(10_000, 1, _deadline()), 15_000);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_buy_conservationAndExactDeltas(uint256 amountIn, uint256 minOutSeed) public {
        amountIn = bound(amountIn, 2, 1e12);
        uint256 expected = _expectedBuy(amountIn);
        uint256 minOut = bound(minOutSeed, 1, expected);
        Balances memory b = _balances();
        vm.prank(engine);
        uint256 out = venue.buyCirBtc(amountIn, minOut, _deadline());
        Balances memory a = _balances();
        assertEq(out, expected);
        assertEq(b.engUsdc - a.engUsdc, amountIn);
        assertEq(a.engBtc - b.engBtc, out);
        assertEq(a.pmUsdc - b.pmUsdc, amountIn);
        assertEq(b.pmBtc - a.pmBtc, out);
        assertEq(a.venueUsdc + a.venueBtc, 0);
        assertEq(a.engUsdc + a.pmUsdc, b.engUsdc + b.pmUsdc);
        assertEq(a.engBtc + a.pmBtc, b.engBtc + b.pmBtc);
    }

    function testFuzz_sell_conservationAndExactDeltas(uint256 amountIn, uint256 minOutSeed) public {
        amountIn = bound(amountIn, 3, 1e12);
        uint256 expected = _expectedSell(amountIn);
        uint256 minOut = bound(minOutSeed, 1, expected);
        Balances memory b = _balances();
        vm.prank(engine);
        uint256 out = venue.sellCirBtc(amountIn, minOut, _deadline());
        Balances memory a = _balances();
        assertEq(out, expected);
        assertEq(b.engBtc - a.engBtc, amountIn);
        assertEq(a.engUsdc - b.engUsdc, out);
        assertEq(a.venueUsdc + a.venueBtc, 0);
        assertEq(a.engUsdc + a.pmUsdc, b.engUsdc + b.pmUsdc);
        assertEq(a.engBtc + a.pmBtc, b.engBtc + b.pmBtc);
    }

    function testFuzz_minOutOneAboveFill_alwaysRevertsAndRollsBack(uint256 amountIn, bool buy) public {
        amountIn = bound(amountIn, 3, 1e12);
        uint256 expected = buy ? _expectedBuy(amountIn) : _expectedSell(amountIn);
        Balances memory b = _balances();
        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.InsufficientOutput.selector, expected, expected + 1));
        if (buy) venue.buyCirBtc(amountIn, expected + 1, _deadline());
        else venue.sellCirBtc(amountIn, expected + 1, _deadline());
        _assertUnchanged(b);
    }

    function testFuzz_partialFill_alwaysRevertsAndRollsBack(uint256 amountIn, uint256 fill, bool buy) public {
        amountIn = bound(amountIn, 3, 1e12);
        pm.setFillBps(bound(fill, 0, 9_999));
        Balances memory b = _balances();
        vm.prank(engine);
        vm.expectPartialRevert(V4SpotVenue.IncompleteInput.selector);
        if (buy) venue.buyCirBtc(amountIn, 1, _deadline());
        else venue.sellCirBtc(amountIn, 1, _deadline());
        _assertUnchanged(b);
    }

    function testFuzz_unauthorizedCallerNeverMovesFunds(address caller, uint256 amountIn, uint256 minOut, bool buy)
        public
    {
        vm.assume(caller != engine);
        Balances memory b = _balances();
        vm.prank(caller);
        vm.expectRevert(V4SpotVenue.NotEngine.selector);
        if (buy) venue.buyCirBtc(amountIn, minOut, _deadline());
        else venue.sellCirBtc(amountIn, minOut, _deadline());
        _assertUnchanged(b);
    }
}
