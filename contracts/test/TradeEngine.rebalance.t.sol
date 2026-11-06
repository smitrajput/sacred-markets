// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarginVault} from "../src/MarginVault.sol";
import {TradeEngine} from "../src/TradeEngine.sol";
import {EngineBase} from "./EngineBase.sol";

contract TradeEngineRebalanceTest is EngineBase {
    uint256 internal constant OPEN_PRICE = 102_564_102_564; // 200000 micro-USDC buys exactly 195 atoms
    uint256 internal constant P80K = 80_000e6;

    event Rebalanced(
        uint256 indexed id,
        uint256 atomsSold,
        uint256 proceeds,
        uint256 principalAfter,
        uint256 markupAfter,
        uint256 collateralAfter,
        bool dustFallback,
        bool toleranceUsed
    );
    event Closed(
        uint256 indexed id,
        TradeEngine.CloseKind kind,
        uint256 atomsSold,
        uint256 proceeds,
        uint256 surplusToTrader,
        uint256 grossPrincipalLoss,
        uint256 writtenOffMarkup
    );

    /// @dev Opens the micro-position: 195 BTC atoms for 200,000 micro-USDC, then the price falls to 80,000 USDC and the
    /// venue executes at exactly the 300 bps friction budget.
    function _microAt80k() internal returns (uint256 id) {
        _price(OPEN_PRICE);
        id = _open(trader, E_DEMO);
        assertEq(engine.getPosition(id).collateral, 195);
        _price(P80K);
        venue.set(P80K, 300);
    }

    function test_microVector_195atoms_at80k_sells52_leaves59648_143atoms_coverage19056() public {
        uint256 id = _microAt80k();
        (uint256 v,) = (engine.getPosition(id).collateral * P80K / 1e8, 0);
        assertEq(v, 156_000);
        assertEq(_debt(id), 100_383);

        (TradeEngine.Plan memory pl, bool fresh) = engine.quoteRebalance(id, 0);
        assertTrue(fresh);
        assertTrue(pl.eligible);
        assertTrue(pl.isPartial);
        assertEq(pl.sellAtoms, 52);
        assertEq(pl.minUsdc, 40_352);
        assertEq(pl.gross, 41_196, "ceil(347,277,000 * 10,000 / 84,300,000)");

        vm.expectEmit(true, false, false, true, address(engine));
        emit Rebalanced(id, 52, 40_352, 59_648, 383, 143, false, false);
        vm.prank(keeper);
        engine.rebalance(id, 0, _deadline());

        TradeEngine.Position memory p = engine.getPosition(id);
        assertEq(p.principal, 59_648);
        assertEq(p.markup, 383, "proceeds went to principal first; markup is untouched");
        assertEq(p.collateral, 143);
        assertEq(uint8(p.status), uint8(TradeEngine.Status.Active));
        uint256 value = 143 * P80K / 1e8;
        assertEq(value, 114_400);
        assertEq(value + 0, 114_400);
        assertEq(_debt(id), 60_031);
        assertEq(value * 10_000 / 60_031, 19_056, "restored to 190.56%");
        assertGe(value * 10_000, 60_031 * 19_000, "strictly at least 190%, no tolerance needed");
        assertEq(engine.coverageBps(id), 19_056);
        assertEq(vault.outstandingPrincipal(), 59_648);
        assertEq(usdc.balanceOf(keeper), 0, "no keeper reward from principal");
        _assertEngineClean();
    }

    function test_healthyPositionsAreRejected_andTheThresholdIsExact() public {
        uint256 id = _open(trader, E_DEMO);
        // V = 160,613 is just above 160% of 100,383 (160,612.8): healthy, though its floored bps reads 16,000
        _price(80_306_500_000);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(TradeEngine.PositionHealthy.selector, id, 16_000));
        engine.rebalance(id, 0, _deadline());
        // V = 160,612 -> V * 10000 <= D * 16000 holds: eligible
        _price(80_306_000_000);
        venue.set(80_306_000_000, 300);
        (TradeEngine.Plan memory pl,) = engine.quoteRebalance(id, 0);
        assertTrue(pl.eligible);
        assertEq(pl.value, 160_612);
        vm.prank(keeper);
        engine.rebalance(id, 0, _deadline());
        assertEq(engine.getPosition(id).collateral, 200 - pl.sellAtoms);
        assertGe(engine.coverageBps(id), 19_000);
    }

    function test_theCallerCanOnlyTightenTheFloor_andDeadlineAndFreshnessApply() public {
        uint256 id = _microAt80k();
        vm.startPrank(keeper);
        vm.expectRevert(); // 40,353 is above what a 300 bps sale delivers
        engine.rebalance(id, 40_353, _deadline());
        vm.expectRevert(abi.encodeWithSelector(TradeEngine.Expired.selector, block.timestamp - 1));
        engine.rebalance(id, 0, block.timestamp - 1);
        vm.stopPrank();
        assertEq(engine.getPosition(id).collateral, 195, "failed attempts changed nothing");
        vm.prank(keeper);
        engine.rebalance(id, 40_352, _deadline()); // an equal caller floor is fine
        assertEq(engine.getPosition(id).collateral, 143);
    }

    function test_dustFallback_betterThanMinimumExecution_sellsTheRestInTheSameTransaction() public {
        uint256 id = _microAt80k();
        venue.set(190_000e6, 0); // the venue pays far more than the oracle minimum; the reference stays at 80k
        uint256 traderBefore = usdc.balanceOf(trader);

        vm.expectEmit(true, false, false, true, address(engine));
        emit Rebalanced(id, 52, 98_800, 1_200, 383, 143, true, false);
        vm.expectEmit(true, false, false, true, address(engine));
        emit Closed(id, TradeEngine.CloseKind.CoverageDustFallback, 143, 271_700, 270_117, 0, 0);
        vm.prank(keeper);
        engine.rebalance(id, 0, _deadline());

        assertEq(usdc.balanceOf(trader) - traderBefore, 270_117, "surplus = 98,800 + 271,700 - 100,383");
        assertEq(uint8(engine.getPosition(id).status), uint8(TradeEngine.Status.Closed));
        assertEq(vault.liveCount(), 0);
        assertEq(vault.depositorIdleCash(), 10 * USDC1 + 294, "principal repaid in full plus the LP markup share");
        assertEq(vault.managerCash(), 89);
        assertEq(btc.balanceOf(address(engine)), 0);
        _assertEngineClean();
    }

    function test_dustFallback_secondLegFailure_revertsEverything() public {
        uint256 id = _microAt80k();
        venue.set(190_000e6, 0);
        venue.setFailSellOn(2);
        vm.prank(keeper);
        vm.expectRevert();
        engine.rebalance(id, 0, _deadline());
        TradeEngine.Position memory p = engine.getPosition(id);
        assertEq(p.principal, 100_000);
        assertEq(p.collateral, 195);
        assertEq(vault.outstandingPrincipal(), 100_000);
        assertEq(btc.balanceOf(address(engine)), 195);
    }

    function test_debtZeroAfterPartial_returnsTheRemainingBtcWithoutSellingIt() public {
        uint256 id = _microAt80k();
        venue.set(5_000_000e6, 0); // the 52-atom sale alone pays 2,600,000, far more than the debt
        uint256 traderUsdc = usdc.balanceOf(trader);
        vm.prank(keeper);
        engine.rebalance(id, 0, _deadline());

        assertEq(btc.balanceOf(trader), 143, "unsold BTC goes back to the trader");
        assertEq(usdc.balanceOf(trader) - traderUsdc, 2_600_000 - 100_383);
        assertEq(venue.sells(), 1, "no second sale");
        assertEq(vault.liveCount(), 0);
        _assertEngineClean();
    }

    function test_fullCloseWhenThePlanCannotRestoreCoverage_booksTheShortfallThroughTheCascade() public {
        uint256 id = _open(trader, E_DEMO);
        _price(40_000e6); // V = 80,000 against debt 100,383: g exceeds V
        venue.set(40_000e6, 300);
        (TradeEngine.Plan memory pl,) = engine.quoteRebalance(id, 0);
        assertFalse(pl.isPartial);
        assertEq(pl.sellAtoms, 200);
        uint256 nav = vault.nav();

        vm.expectEmit(true, false, false, true, address(engine));
        emit Closed(id, TradeEngine.CloseKind.Coverage, 200, 77_600, 0, 22_400, 383);
        vm.prank(keeper);
        engine.rebalance(id, 0, _deadline());

        assertEq(vault.primaryReserve() + vault.tailReserve(), 0, "4,000 + 6,000 of protection absorbed the first 10,000");
        assertEq(vault.nav(), nav - 12_400, "LPs lose the uncovered 12,400");
        assertEq(vault.liveCount(), 0);
        _assertEngineClean();
        assertTrue(vault.isFullyBacked());
    }

    function test_callerFloor_neverChangesModeOrQuantity_andAnOversizedFloorRevertsWithoutStateChange() public {
        uint256 id = _microAt80k();
        uint256[4] memory floors = [uint256(0), 40_352, 91_000, type(uint256).max];
        for (uint256 i; i < 4; i++) {
            (TradeEngine.Plan memory pl,) = engine.quoteRebalance(id, floors[i]);
            assertTrue(pl.eligible);
            assertTrue(pl.isPartial, "still the partial plan");
            assertEq(pl.sellAtoms, 52, "same quantity");
            assertEq(pl.gross, 41_196);
            assertEq(pl.minUsdc, floors[i] > 40_352 ? floors[i] : 40_352, "the floor is max(caller, oracle floor)");
        }
        // a 91,000 floor cannot be met by the 52-atom sale (it pays 40,352) -> the call reverts, it never upsizes to a
        // full sale (which could pay 151,320 and would have satisfied the floor)
        vm.prank(keeper);
        vm.expectRevert();
        engine.rebalance(id, 91_000, _deadline());
        TradeEngine.Position memory p = engine.getPosition(id);
        assertEq(p.principal, 100_000);
        assertEq(p.collateral, 195);
        assertEq(vault.outstandingPrincipal(), 100_000);
        assertEq(btc.balanceOf(address(engine)), 195);
        assertEq(venue.sells(), 0);
    }

    // ------------------------------------------------------------------ properties

    function testFuzz_rebalance_restores190_orClosesCleanly(uint256 eSeed, uint256 dropSeed) public {
        uint256 e = bound(eSeed, 10_000, 100_000);
        (bool opened, uint256 id) = _openChecked(trader, e);
        if (!opened) return; // an input that legitimately fails 190% initial coverage: rejected and rolled back above
        uint256 p1 = P100K * bound(dropSeed, 2_000, 8_030) / 10_000;
        _price(p1);
        venue.set(p1, 300); // worst case: the venue executes at exactly the friction budget
        (TradeEngine.Plan memory pl,) = engine.quoteRebalance(id, 0);
        if (!pl.eligible) return;
        uint256 collBefore = engine.getPosition(id).collateral;

        vm.prank(keeper);
        engine.rebalance(id, 0, _deadline());

        TradeEngine.Position memory p = engine.getPosition(id);
        if (pl.isPartial) {
            assertEq(uint8(p.status), uint8(TradeEngine.Status.Active));
            assertEq(p.collateral, collBefore - pl.sellAtoms, "the engine, not the caller, chose the quantity");
            assertGe(p.principal, 10_000, "never committed below dust");
            uint256 value = p.collateral * p1 / 1e8;
            uint256 debt = p.principal + p.markup;
            uint256 slack = (p1 + 1e8 - 1) / 1e8 + 1; // one BTC atom of reference value plus one USDC atom
            assertGe((value + slack) * 10_000, debt * 19_000, "within the documented one-atom tolerance of 190%");
        } else {
            assertEq(uint8(p.status), uint8(TradeEngine.Status.Closed));
            assertEq(p.collateral, 0);
        }
        _assertEngineClean();
        assertTrue(vault.isFullyBacked());
    }

    function testFuzz_modeAndQuantityIgnoreTheCallerFloor(uint256 eSeed, uint256 dropSeed, uint256 floorSeed) public {
        (bool opened, uint256 id) = _openChecked(trader, bound(eSeed, 10_000, 100_000));
        if (!opened) return;
        uint256 p1 = P100K * bound(dropSeed, 1_000, 8_030) / 10_000;
        _price(p1);
        (TradeEngine.Plan memory base,) = engine.quoteRebalance(id, 0);
        (TradeEngine.Plan memory withFloor,) = engine.quoteRebalance(id, floorSeed);
        assertEq(withFloor.eligible, base.eligible);
        assertEq(withFloor.isPartial, base.isPartial, "mode independent of the caller floor");
        assertEq(withFloor.sellAtoms, base.sellAtoms, "quantity independent of the caller floor");
        assertEq(withFloor.gross, base.gross);
        if (base.eligible) assertEq(withFloor.minUsdc, floorSeed > base.minUsdc ? floorSeed : base.minUsdc);
    }

    /// @dev Bounded random driver over open / repay / price moves / rebalance / close / maturity with funded actors.
    function testFuzz_conservation_acrossRandomLifecycles(uint256 seed) public {
        address[3] memory traders = [trader, makeAddr("t2"), makeAddr("t3")];
        _trader(traders[1], 10 * USDC1);
        _trader(traders[2], 10 * USDC1);
        for (uint256 i; i < 24; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 pick = r % 8;
            address t = traders[(r >> 8) % 3];
            uint256[] memory ids = engine.activeIds();
            uint256 id = ids.length == 0 ? 0 : ids[(r >> 16) % ids.length];
            if (pick <= 1) {
                vm.prank(t);
                try engine.open(10_000 + ((r >> 24) % 90_001), 0, block.timestamp + 1 hours, terms) {} catch {}
            } else if (pick == 2 && id != 0) {
                (,, uint256 d) = engine.debtOf(id);
                usdc.mint(stranger, d);
                vm.startPrank(stranger);
                usdc.approve(address(engine), d);
                try engine.repay(id, 1 + ((r >> 24) % d)) {} catch {}
                vm.stopPrank();
            } else if (pick == 3 && id != 0) {
                (,, uint256 d) = engine.debtOf(id);
                usdc.mint(stranger, d);
                vm.startPrank(stranger);
                usdc.approve(address(engine), d);
                try engine.repayAndRelease(id, d) {} catch {}
                vm.stopPrank();
            } else if (pick == 4) {
                _price(30_000e6 + ((r >> 24) % 120_000e6));
                venue.set(guard.price(), 300);
            } else if (pick == 5 && id != 0) {
                vm.prank(keeper);
                try engine.rebalance(id, 0, block.timestamp + 1 hours) {} catch {}
            } else if (pick == 6 && id != 0) {
                address owner = engine.getPosition(id).trader;
                vm.prank(owner);
                try engine.ownerClose(id, 0, block.timestamp + 1 hours) {} catch {}
            } else if (pick == 7) {
                vm.warp(block.timestamp + 4 days);
                _price(guard.price());
                if (id != 0) {
                    vm.prank(keeper);
                    try engine.settleMatured(id, 0, block.timestamp + 1 hours) {} catch {}
                }
            }
            _checkConservation();
        }
    }

    function _checkConservation() internal view {
        _assertEngineClean();
        uint256[] memory ids = engine.activeIds();
        uint256 sum;
        for (uint256 i; i < ids.length; i++) {
            (MarginVault.PositionStatus st,,, uint256 remaining,) = vault.positions(ids[i]);
            assertEq(uint8(st), uint8(MarginVault.PositionStatus.Live));
            (uint256 p,,) = engine.debtOf(ids[i]);
            assertEq(remaining, p, "vault and engine agree on remaining principal");
            sum += p;
        }
        assertEq(vault.outstandingPrincipal(), sum, "debt conservation");
        assertTrue(vault.isFullyBacked());
        assertEq(
            usdc.balanceOf(address(vault)),
            vault.depositorIdleCash() + vault.primaryReserve() + vault.tailReserve() + vault.pilotBackstop()
                + vault.managerCash() + vault.claimableWithdrawals(),
            "token conservation in the vault"
        );
        assertEq(vault.pendingGrossCash(), 0);
        assertEq(vault.commitments(), 0);
    }
}
