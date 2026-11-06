// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarginVault} from "../src/MarginVault.sol";
import {TradeEngine} from "../src/TradeEngine.sol";
import {EngineBase} from "./EngineBase.sol";

contract TradeEngineLifecycleTest is EngineBase {
    function test_repay_principalFirst_thenMarkup_keepsCollateral_andPrincipalZeroStaysLive() public {
        uint256 id = _open(trader, E_DEMO);
        _pay(stranger, id, 100_100); // 100_000 principal, then 100 of the 383 markup

        TradeEngine.Position memory p = engine.getPosition(id);
        assertEq(p.principal, 0);
        assertEq(p.markup, 283);
        assertEq(p.collected, 100);
        assertEq(p.lpAllocation, 77, "floor(100 * 0.77), mirrors the vault; the engine does not split again");
        assertEq(p.collateral, 200, "a partial repayment keeps all collateral");
        assertEq(uint8(p.status), uint8(TradeEngine.Status.Active));

        (MarginVault.PositionStatus st,,, uint256 remaining,) = vault.positions(id);
        assertEq(uint8(st), uint8(MarginVault.PositionStatus.Live), "P = 0 with markup owed stays live");
        assertEq(remaining, 0);
        assertEq(vault.liveCount(), 1);
        assertEq(vault.depositorIdleCash(), 10 * USDC1 + 77, "LP markup share raised idle/NAV");
        assertEq(vault.managerCash(), 23, "manager part of the first payment");
        (uint256 net, bool fresh) = engine.positionValue(id);
        assertEq(net, 194_000);
        assertTrue(fresh, "freshness is still reported for a P = 0 position");
        _assertEngineClean();
    }

    function test_repay_splitRounding_acrossPayments_gives_LP294_manager89_atP100000() public {
        uint256 id = _open(trader, E_DEMO);
        _pay(stranger, id, 100_100);
        uint256 traderBtc = btc.balanceOf(trader);
        _pay(makeAddr("friend"), id, 283); // a different third party pays the rest

        assertEq(vault.depositorIdleCash(), 10 * USDC1 + 294, "total LP markup = floor(383 * 0.77) = 294");
        assertEq(vault.managerCash(), 89, "manager = 383 - 294");
        assertEq(btc.balanceOf(trader) - traderBtc, 200, "all pledged BTC returns to the ORIGINAL trader");
        assertEq(btc.balanceOf(stranger), 0);
        assertEq(uint8(engine.getPosition(id).status), uint8(TradeEngine.Status.Closed));
        assertEq(vault.liveCount(), 0, "finalized in the vault exactly once");
        assertEq(engine.activeCount(), 0);
        _assertEngineClean();

        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TradeEngine.NotActive.selector, id));
        engine.repay(id, 1);
        vm.stopPrank();
    }

    function test_repay_rejectsOverpaymentZeroAndShortTransfers_andUsesOnlyTheCallersFunds() public {
        uint256 id = _open(trader, E_DEMO);
        usdc.mint(stranger, 500_000);
        vm.startPrank(stranger);
        usdc.approve(address(engine), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(TradeEngine.AmountExceedsDebt.selector, 100_384, 100_383));
        engine.repay(id, 100_384);
        vm.expectRevert(TradeEngine.ZeroAmount.selector);
        engine.repay(id, 0);
        vm.expectRevert(abi.encodeWithSelector(TradeEngine.DebtChanged.selector, 100_000, 100_383));
        engine.repayAndRelease(id, 100_000);
        vm.stopPrank();

        usdc.setFeeBps(100);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TradeEngine.TransferShort.selector, 1_000, 990));
        engine.repay(id, 1_000);
        usdc.setFeeBps(0);

        uint256 traderUsdc = usdc.balanceOf(trader);
        uint256 allowance = usdc.allowance(trader, address(engine));
        uint256 strangerUsdc = usdc.balanceOf(stranger);
        vm.prank(stranger);
        engine.repay(id, 50_000);
        assertEq(usdc.balanceOf(stranger), strangerUsdc - 50_000, "exactly the amount left the payer");
        assertEq(usdc.balanceOf(trader), traderUsdc, "the trader's money was never touched");
        assertEq(usdc.allowance(trader, address(engine)), allowance, "nor the trader's allowance");
    }

    function test_pausedFunding_andStalePrice_doNotBlockFullRepaymentAndRelease() public {
        uint256 id = _open(trader, E_DEMO);
        vm.prank(guardian);
        vault.setFundingPaused(true);
        vm.warp(block.timestamp + 3 days); // the reference price is now stale
        assertFalse(guard.fresh());

        usdc.mint(stranger, 100_383);
        vm.startPrank(stranger);
        usdc.approve(address(engine), 100_383);
        engine.repayAndRelease(id, 100_383);
        vm.stopPrank();

        assertEq(btc.balanceOf(trader), 200);
        assertEq(vault.liveCount(), 0);
        _assertEngineClean();
    }

    function test_principalZeroPosition_vaultScanIsFreshOnly_andRepayStillWorksWhenStale() public {
        uint256 id = _open(trader, E_DEMO);
        _pay(stranger, id, 100_000); // P = 0, M = 383 still owed
        usdc.mint(alice, 1 * USDC1);
        vm.startPrank(alice);
        usdc.approve(address(vault), 1 * USDC1);
        bytes32 mandate = vault.MANDATE_HASH();
        vault.deposit(1 * USDC1, 0, mandate); // fresh price: the P = 0 position passes the scan
        vm.warp(block.timestamp + 86_401);
        usdc.mint(alice, 1 * USDC1);
        usdc.approve(address(vault), 1 * USDC1);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.StalePrice.selector, id));
        vault.deposit(1 * USDC1, 0, mandate);
        vm.stopPrank();
        _pay(stranger, id, 383); // oracle-independent, releases
        assertEq(vault.liveCount(), 0);
    }

    function test_ownerClose_repaysPrincipalThenMarkup_andReturnsTheSurplusToTheTrader() public {
        uint256 id = _open(trader, E_DEMO);
        _price(150_000e6); // 200 atoms are now worth 300,000
        uint256 traderBefore = usdc.balanceOf(trader);

        vm.prank(stranger);
        vm.expectRevert(TradeEngine.NotTrader.selector);
        engine.ownerClose(id, 0, _deadline());
        vm.startPrank(trader);
        vm.expectRevert(); // caller floor above what the sale delivers
        engine.ownerClose(id, 300_001, _deadline());
        vm.expectRevert(abi.encodeWithSelector(TradeEngine.Expired.selector, block.timestamp - 1));
        engine.ownerClose(id, 0, block.timestamp - 1);
        engine.ownerClose(id, 300_000, _deadline());
        vm.stopPrank();

        assertEq(usdc.balanceOf(trader) - traderBefore, 300_000 - 100_383, "surplus after principal and markup");
        assertEq(vault.depositorIdleCash(), 10 * USDC1 + 294);
        assertEq(vault.managerCash(), 89);
        assertEq(vault.liveCount(), 0);
        assertEq(btc.balanceOf(address(engine)), 0);
        _assertEngineClean();

        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(TradeEngine.NotActive.selector, id));
        engine.ownerClose(id, 0, _deadline());
    }

    function test_sales_failClosedOnAStalePrice() public {
        uint256 id = _open(trader, E_DEMO);
        vm.warp(block.timestamp + 86_401);
        vm.prank(trader);
        vm.expectRevert(TradeEngine.StalePrice.selector);
        engine.ownerClose(id, 0, block.timestamp + 1 hours);
        vm.expectRevert(TradeEngine.StalePrice.selector);
        engine.rebalance(id, 0, block.timestamp + 1 hours);
        assertEq(engine.activeCount(), 1, "nothing changed");
    }

    function test_settleMatured_isPermissionless_onlyAtMaturity_andOnlyOnce() public {
        uint256 id = _open(trader, E_DEMO);
        uint256 matures = engine.getPosition(id).maturesAt;
        vm.warp(matures - 1);
        _price(P100K);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(TradeEngine.NotMatured.selector, matures));
        engine.settleMatured(id, 0, _deadline());

        vm.warp(matures);
        _price(P100K);
        uint256 traderBefore = usdc.balanceOf(trader);
        vm.prank(keeper);
        engine.settleMatured(id, 0, _deadline());
        assertEq(usdc.balanceOf(trader) - traderBefore, 200_000 - 100_383);
        assertEq(vault.liveCount(), 0);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(TradeEngine.NotActive.selector, id));
        engine.settleMatured(id, 0, _deadline());
    }

    function test_fifoIntegration_repaymentFundsTheQueueHead_andTheClaimsAreExact() public {
        uint256 id = _open(trader, E_DEMO);
        vm.prank(alice);
        vault.requestWithdraw(10 * USDC1);
        vault.processWithdrawals(4); // only the idle 9.9 USDC can be paid now
        assertEq(vault.claimable(alice), 9_900_000);
        (, uint256 left) = vault.withdrawalRequests(0);
        assertEq(left, 100_000, "the head request is partially filled and keeps its place");

        _pay(stranger, id, 100_383); // full repayment releases cash for the head
        vault.processWithdrawals(4);
        assertEq(vault.claimable(alice), 9_900_000 + 100_294, "principal back plus the LP markup share");
        vm.prank(alice);
        vault.claim();
        assertEq(usdc.balanceOf(address(vault)), vault.primaryReserve() + vault.tailReserve() + vault.managerCash());
        assertEq(vault.managerCash(), 89);
    }
}

/// @notice The two named policy vectors at the larger scale (ceiling 1000, account cap 500).
contract TradeEnginePolicyVectorsTest is EngineBase {
    function setUp() public override {
        vm.warp(START);
        _stack(1_000 * USDC1, 500 * USDC1, 300, 10_000);
        usdc.mint(treasury, 5 * USDC1);
        vm.startPrank(treasury);
        usdc.approve(address(vault), 5 * USDC1);
        vault.seedProtection(MarginVault.ProtectionKind.Backstop, 5 * USDC1);
        vm.stopPrank();
        _lp(1_100 * USDC1);
        _price(P100K);
        _trader(trader, 1_000 * USDC1);
    }

    event Closed(
        uint256 indexed id,
        TradeEngine.CloseKind kind,
        uint256 atomsSold,
        uint256 proceeds,
        uint256 surplusToTrader,
        uint256 grossPrincipalLoss,
        uint256 writtenOffMarkup
    );

    function test_policy_P500_markup1917808_fullRepaymentSplitsLP1476712_manager441096() public {
        uint256 id = _open(trader, 500 * USDC1);
        TradeEngine.Position memory p = engine.getPosition(id);
        assertEq(p.markup0, 1_917_808, "500 * 10% * 14 / 365");
        assertEq(p.collateral, 1_000_000);

        _pay(stranger, id, 500 * USDC1 + 1_917_808);
        assertEq(vault.managerCash(), 441_096);
        assertEq(vault.depositorIdleCash(), 1_100 * USDC1 + 1_476_712, "all principal back plus the LP share of markup");
        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(vault.liveCount(), 0);
        assertEq(btc.balanceOf(trader), 1_000_000);
    }

    function test_policy_fullClose_P500_proceeds480_grossLoss20_primaryTailBackstopCover15_lpLoses5() public {
        uint256 id = _open(trader, 500 * USDC1);
        _price(48_000e6); // 1,000,000 atoms are worth 480 USDC; the venue fills at the same price
        uint256 nav = vault.nav();

        vm.expectEmit(true, false, false, true, address(engine));
        emit Closed(id, TradeEngine.CloseKind.Owner, 1_000_000, 480 * USDC1, 0, 20 * USDC1, 1_917_808);
        vm.prank(trader);
        engine.ownerClose(id, 0, _deadline());

        assertEq(vault.primaryReserve(), 0);
        assertEq(vault.tailReserve(), 0);
        assertEq(vault.pilotBackstop(), 0);
        assertEq(vault.nav(), nav - 5 * USDC1, "gross 20, protection covers 4 + 6 + 5, LPs lose 5");
        assertEq(vault.managerCash(), 0, "no markup was collected");
        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(vault.liveCount(), 0);
        assertEq(btc.balanceOf(address(engine)), 0);
        _assertEngineClean();
        assertTrue(vault.isFullyBacked());

        // financing is blocked until the treasury restores real protection
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.ReservesUnderfunded.selector, 0, 0));
        engine.open(100 * USDC1, 0, block.timestamp + 1 hours, terms);
    }
}
