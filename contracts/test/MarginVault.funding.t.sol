// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarginVault} from "../src/MarginVault.sol";
import {TestMarginEngine} from "./mocks/TestMarginEngine.sol";
import {VaultBase} from "./VaultBase.sol";

/// @notice Origination limits, commitments, protection seeding, caps, pause and queue gates, principal return.
contract MarginVaultFundingTest is VaultBase {
    function _fundedVault() internal {
        _deposit(alice, 100 * USDC1);
        _seedTargets();
    }

    /// @dev A vault with its own sizing, funded with `nav` USDC and seeded exactly to target.
    function _vault(uint256 ceiling, uint256 cap, uint256 nav) internal returns (MarginVault v, TestMarginEngine e) {
        (v, e) = _deployVault(ceiling, cap);
        _seed(v, (ceiling * 40) / 10_000, (ceiling * 60) / 10_000);
        _depositTo(v, alice, nav);
    }

    // ---------------------------------------------------------------- engine binding and authority

    function test_engineBinding_isDeployerOnlyAndOneShot_andOriginationNeedsIt() public {
        MarginVault v = new MarginVault(
            usdc, guardian, treasury, deployer, CEILING, CAP
        );
        vm.expectRevert(MarginVault.NotEngine.selector);
        vm.prank(address(engine));
        v.reserveOpen(1, trader1, 1 * USDC1);

        vm.prank(alice);
        vm.expectRevert(MarginVault.NotDeployer.selector);
        v.bindEngine(alice);
        vm.startPrank(deployer);
        vm.expectRevert(MarginVault.InvalidEngine.selector);
        v.bindEngine(address(0));
        v.bindEngine(address(engine));
        vm.expectRevert(MarginVault.EngineAlreadyBound.selector);
        v.bindEngine(alice);
        vm.stopPrank();
        assertEq(v.engine(), address(engine));
    }

    function test_engineOnlyFunctions_rejectEveryoneElse() public {
        _fundedVault();
        _open(1, trader1, 10 * USDC1);
        address[3] memory callers = [alice, guardian, treasury];
        for (uint256 i; i < callers.length; i++) {
            vm.startPrank(callers[i]);
            vm.expectRevert(MarginVault.NotEngine.selector);
            vault.reserveOpen(2, trader2, 1);
            vm.expectRevert(MarginVault.NotEngine.selector);
            vault.confirmOpen(1);
            vm.expectRevert(MarginVault.NotEngine.selector);
            vault.cancelOpen(1);
            vm.expectRevert(MarginVault.NotEngine.selector);
            vault.repayPrincipal(1, 1);
            vm.expectRevert(MarginVault.NotEngine.selector);
            vault.creditLpMarkup(1);
            vm.expectRevert(MarginVault.NotEngine.selector);
            vault.writeOffPrincipal(1, 1);
            vm.expectRevert(MarginVault.NotEngine.selector);
            vault.finalizePosition(1);
            vm.stopPrank();
        }
    }

    // ---------------------------------------------------------------- protection seeding

    function test_protectionTargets_areFractionsOfTheImmutableCeiling() public {
        assertEq(vault.primaryTarget(), 400_000); // 0.4% of 100 USDC
        assertEq(vault.tailTarget(), 600_000); // 0.6% of 100 USDC
        (MarginVault v,) = _deployVault(1 * USDC1, 100_000);
        assertEq(v.primaryTarget(), 4_000); // 0.004 USDC
        assertEq(v.tailTarget(), 6_000); // 0.006 USDC
    }

    function test_seedProtection_isTreasuryOnly_andTouchesOnlyItsBucket() public {
        _deposit(alice, 50 * USDC1);
        usdc.mint(treasury, 10 * USDC1);
        vm.prank(treasury);
        usdc.approve(address(vault), type(uint256).max);

        vm.prank(alice);
        vm.expectRevert(MarginVault.NotTreasury.selector);
        vault.seedProtection(MarginVault.ProtectionKind.Primary, 1);

        vm.startPrank(treasury);
        vm.expectRevert(MarginVault.ZeroAmount.selector);
        vault.seedProtection(MarginVault.ProtectionKind.Primary, 0);
        vault.seedProtection(MarginVault.ProtectionKind.Primary, 400_000);
        vault.seedProtection(MarginVault.ProtectionKind.Tail, 600_000);
        vault.seedProtection(MarginVault.ProtectionKind.Backstop, 2 * USDC1);
        vm.stopPrank();

        MarginVault.VaultState memory s = vault.vaultState();
        assertEq(s.primaryReserve, 400_000);
        assertEq(s.tailReserve, 600_000);
        assertEq(s.pilotBackstop, 2_000_000);
        assertEq(s.nav, 50_000_000); // seeding is not LP money
        assertEq(s.totalShares, 50_000_000);
        assertEq(vault.sharesOf(treasury), 0);
        assertEq(usdc.balanceOf(address(vault)), 53_000_000);
        assertTrue(vault.isFullyBacked());
    }

    function test_seedProtection_rejectsShortTransfer() public {
        usdc.mint(treasury, 1 * USDC1);
        vm.startPrank(treasury);
        usdc.approve(address(vault), type(uint256).max);
        usdc.setFeeBps(100);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.TransferShort.selector, 1_000_000, 990_000));
        vault.seedProtection(MarginVault.ProtectionKind.Primary, 1 * USDC1);
        vm.stopPrank();
    }

    function test_origination_requiresBothReserveTargets_andBackstopDoesNotCount() public {
        _deposit(alice, 100 * USDC1);

        vm.expectRevert(abi.encodeWithSelector(MarginVault.ReservesUnderfunded.selector, 0, 0));
        engine.reserveOpen(1, trader1, 1 * USDC1);

        _seed(vault, 400_000, 0);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.ReservesUnderfunded.selector, 400_000, 0));
        engine.reserveOpen(1, trader1, 1 * USDC1);

        usdc.mint(treasury, 50 * USDC1);
        vm.startPrank(treasury);
        usdc.approve(address(vault), type(uint256).max);
        vault.seedProtection(MarginVault.ProtectionKind.Backstop, 50 * USDC1); // large optional backstop
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(MarginVault.ReservesUnderfunded.selector, 400_000, 0));
        engine.reserveOpen(1, trader1, 1 * USDC1);

        _seed(vault, 0, 599_999); // one atom short of the tail target
        vm.expectRevert(abi.encodeWithSelector(MarginVault.ReservesUnderfunded.selector, 400_000, 599_999));
        engine.reserveOpen(1, trader1, 1 * USDC1);

        _seed(vault, 0, 1);
        engine.reserveOpen(1, trader1, 1 * USDC1); // exactly at both targets
        assertEq(vault.commitments(), 1 * USDC1);
    }

    function test_reserveTargetsAtTheSmallerDemoCeiling() public {
        (MarginVault v, TestMarginEngine e) = _deployVault(1 * USDC1, 100_000);
        _depositTo(v, alice, 10 * USDC1);
        _seed(v, 3_999, 6_000);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.ReservesUnderfunded.selector, 3_999, 6_000));
        e.reserveOpen(1, trader1, 100_000);
        _seed(v, 1, 0);
        e.reserveOpen(1, trader1, 100_000);
        assertEq(v.commitments(), 100_000);
    }

    // ---------------------------------------------------------------- opening flow and cash

    function test_open_fundsGrossFromIdleFirst_thenReceivesEquityOnConfirm() public {
        _fundedVault();
        assertEq(usdc.balanceOf(address(vault)), 101_000_000); // 100 LP + 1 reserves
        assertEq(usdc.balanceOf(address(engine)), 0); // the engine holds nothing: no equity exists before the reserve

        engine.reserveOpen(1, trader1, 10 * USDC1);
        // The vault alone paid the gross 20 out of recorded depositor idle cash.
        assertEq(usdc.balanceOf(address(vault)), 81_000_000);
        assertEq(usdc.balanceOf(address(engine)), 20_000_000);
        MarginVault.VaultState memory s = vault.vaultState();
        assertEq(s.commitments, 10_000_000);
        assertEq(s.pendingGrossCash, 20_000_000);
        assertEq(s.pendingOpens, 1);
        assertEq(s.outstandingPrincipal, 0);
        assertEq(s.depositorIdleCash, 100_000_000); // recorded idle, hence NAV, are preserved through the pending open
        assertEq(s.nav, 100_000_000);
        assertEq(vault.accountExposure(trader1), 10_000_000);
        assertTrue(vault.isFullyBacked());

        // The engine acquires the collateral with the gross cash, THEN the trader's equity arrives, THEN confirm pulls it.
        engine.acquire(1);
        assertEq(usdc.balanceOf(address(engine)), 0);
        engine.receiveEquity(1);
        engine.confirmOpen(1);
        s = vault.vaultState();
        assertEq(usdc.balanceOf(address(vault)), 91_000_000); // equity 10 received
        assertEq(s.commitments, 0);
        assertEq(s.pendingGrossCash, 0);
        assertEq(s.pendingOpens, 0);
        assertEq(s.outstandingPrincipal, 10_000_000);
        assertEq(s.depositorIdleCash, 90_000_000); // net idle fell by P, not 2P
        assertEq(s.nav, 100_000_000);
        assertEq(s.livePositions, 1);
        assertTrue(vault.isFullyBacked());
    }

    // ---------------------------------------------------------------- 01a lead-review regressions

    function test_regression_idle15_principal10_rejects_evenWithEveryOtherSourceOfCash() public {
        (MarginVault v, TestMarginEngine e) = _deployVault(CEILING, CAP);
        _depositTo(v, alice, 15 * USDC1);
        _seed(v, 400_000, 600_000); // reserve targets met
        // other segregated cash: a backstop and a donation
        usdc.mint(treasury, 3 * USDC1);
        vm.startPrank(treasury);
        usdc.approve(address(v), type(uint256).max);
        v.seedProtection(MarginVault.ProtectionKind.Backstop, 3 * USDC1);
        vm.stopPrank();
        usdc.mint(carol, 50 * USDC1);
        vm.prank(carol);
        usdc.transfer(address(v), 50 * USDC1); // donation
        usdc.mint(address(e), 100 * USDC1); // engine/trader funds sitting in the engine

        assertGt(usdc.balanceOf(address(v)), 65 * USDC1); // plenty of physical cash, none of it lendable
        vm.expectRevert(abi.encodeWithSelector(MarginVault.GrossCashUnavailable.selector, 15_000_000, 20_000_000));
        e.reserveOpen(1, trader1, 10 * USDC1);
        assertEq(v.commitments(), 0);
        assertEq(v.pendingGrossCash(), 0);
    }

    function test_regression_idle20_principal10_opens_withoutPriorEquity_thenConfirmReceives10() public {
        (MarginVault v, TestMarginEngine e) = _deployVault(CEILING, CAP);
        _depositTo(v, alice, 20 * USDC1);
        _seed(v, 400_000, 600_000);
        assertEq(usdc.balanceOf(address(e)), 0);

        e.reserveOpen(1, trader1, 10 * USDC1); // succeeds with no equity anywhere
        assertEq(usdc.balanceOf(address(e)), 20_000_000);
        assertEq(v.pendingGrossCash(), 20_000_000);

        // Without the engine's equity the confirm cannot complete.
        e.acquire(1);
        vm.expectRevert();
        e.confirmOpen(1);
        assertEq(v.outstandingPrincipal(), 0);

        e.receiveEquity(1);
        uint256 before = usdc.balanceOf(address(v));
        e.confirmOpen(1);
        assertEq(usdc.balanceOf(address(v)) - before, 10_000_000); // confirm receives exactly the equity, 10
        assertEq(v.depositorIdleCash(), 10_000_000);
        assertEq(v.outstandingPrincipal(), 10_000_000);
        assertEq(v.nav(), 20_000_000);
    }

    function test_regression_cancelledPendingPurchase_returnsTheFullGross20() public {
        _fundedVault();
        uint256 before = usdc.balanceOf(address(vault));
        engine.reserveOpen(1, trader1, 10 * USDC1);
        assertEq(usdc.balanceOf(address(vault)), before - 20_000_000);

        engine.cancelOpen(1);
        MarginVault.VaultState memory s = vault.vaultState();
        assertEq(usdc.balanceOf(address(vault)), before); // all 20 came back
        assertEq(usdc.balanceOf(address(engine)), 0);
        assertEq(s.commitments, 0);
        assertEq(s.pendingGrossCash, 0);
        assertEq(s.pendingOpens, 0);
        assertEq(s.depositorIdleCash, 100_000_000);
        assertEq(vault.accountExposure(trader1), 0);
        assertTrue(vault.isFullyBacked());
        vm.expectRevert(abi.encodeWithSelector(MarginVault.WrongPositionStatus.selector, 1, MarginVault.PositionStatus.Cancelled));
        engine.confirmOpen(1);
    }

    function test_regression_failedEquityReceipt_rollsBackTheAtomicOpen() public {
        _fundedVault();
        uint256 vaultCash = usdc.balanceOf(address(vault));
        MarginVault.VaultState memory before = vault.vaultState();
        vm.expectRevert(); // equity is never delivered, so the final pull fails
        engine.openAtomicWithoutEquity(1, trader1, 10 * USDC1);

        MarginVault.VaultState memory after_ = vault.vaultState();
        assertEq(usdc.balanceOf(address(vault)), vaultCash);
        assertEq(usdc.balanceOf(address(engine)), 0);
        assertEq(after_.commitments, before.commitments);
        assertEq(after_.pendingGrossCash, 0);
        assertEq(after_.pendingOpens, 0);
        assertEq(after_.depositorIdleCash, before.depositorIdleCash);
        assertEq(after_.livePositions, 0);
        assertEq(vault.accountExposure(trader1), 0);
        (MarginVault.PositionStatus st,,,,) = vault.positions(1);
        assertEq(uint8(st), uint8(MarginVault.PositionStatus.None)); // the id was never consumed
        engine.openFull(1, trader1, 10 * USDC1); // and the same id opens fine afterwards
    }

    function test_open_rejectsBadInputs() public {
        _fundedVault();
        vm.expectRevert(MarginVault.ZeroAmount.selector);
        engine.reserveOpen(1, trader1, 0);
        vm.expectRevert(MarginVault.ZeroAddress.selector);
        engine.reserveOpen(1, address(0), 1 * USDC1);
        _open(1, trader1, 1 * USDC1);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.PositionExists.selector, 1));
        engine.reserveOpen(1, trader2, 1 * USDC1);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.UnknownPosition.selector, 99));
        engine.confirmOpen(99);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.WrongPositionStatus.selector, 1, MarginVault.PositionStatus.Live));
        engine.confirmOpen(1);
    }



    // ---------------------------------------------------------------- limits

    function test_ceiling_isInclusive() public {
        (MarginVault v, TestMarginEngine e2) = _vault(100 * USDC1, 100 * USDC1, 1_000 * USDC1);
        e2.openFull(1, trader1, 100 * USDC1); // exposure == ceiling is allowed
        assertEq(v.outstandingPrincipal(), 100_000_000);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.CeilingExceeded.selector, 100_000_001, 100_000_000));
        e2.reserveOpen(2, trader2, 1);
    }

    function test_utilisation_stopsAtNinetyFivePercentOfNav() public {
        // The vault funds every 2P purchase from idle cash, so 95% is reached in steps that each leave idle >= 2P.
        (MarginVault v, TestMarginEngine e) = _vault(100 * USDC1, 100 * USDC1, 100 * USDC1);
        e.openFull(1, trader1, 50 * USDC1); // idle 100 -> 50
        e.openFull(2, trader1, 25 * USDC1); // idle 50 -> 25
        e.openFull(3, trader1, 12_500_000); // idle 25 -> 12.5
        e.openFull(4, trader1, 5 * USDC1); // idle 12.5 -> 7.5
        e.openFull(5, trader1, 2_500_000); // idle 7.5 -> 5.0 : outstanding exactly 95, idle exactly 5% of NAV
        assertEq(v.outstandingPrincipal(), 95_000_000);
        assertEq(v.depositorIdleCash(), 5_000_000);
        assertEq(v.nav(), 100_000_000);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.UtilisationExceeded.selector, 95_000_001, 100_000_000));
        e.reserveOpen(6, trader2, 1);
    }

    function test_utilisationLimit_rejectsAnOpeningThatCrossesNinetyFive() public {
        (, TestMarginEngine e) = _vault(100 * USDC1, 100 * USDC1, 100 * USDC1);
        e.openFull(1, trader1, 50 * USDC1);
        e.openFull(2, trader1, 25 * USDC1);
        e.openFull(3, trader1, 12_500_000);
        e.openFull(4, trader1, 5 * USDC1); // outstanding 92.5, idle 7.5
        vm.expectRevert(abi.encodeWithSelector(MarginVault.UtilisationExceeded.selector, 95_000_001, 100_000_000));
        e.reserveOpen(5, trader1, 2_500_001);
    }

    function test_perAccountCap_isPerAccount_andFreesOnRepayment() public {
        _fundedVault();
        _open(1, trader1, 10 * USDC1); // exactly the cap
        vm.expectRevert(abi.encodeWithSelector(MarginVault.AccountCapExceeded.selector, trader1, 10_000_001));
        engine.reserveOpen(2, trader1, 1);
        _open(3, trader2, 10 * USDC1); // another account is unaffected

        engine.repayPrincipal(1, 4 * USDC1);
        assertEq(vault.accountExposure(trader1), 6_000_000);
        _open(4, trader1, 4 * USDC1);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.AccountCapExceeded.selector, trader1, 10_000_001));
        engine.reserveOpen(5, trader1, 1);
    }

    function test_commitmentsCountTowardLimits_beforeConfirmation() public {
        (MarginVault v, TestMarginEngine e) = _vault(100 * USDC1, 100 * USDC1, 1_000 * USDC1);
        e.reserveOpen(1, trader1, 60 * USDC1);
        e.reserveOpen(2, trader2, 40 * USDC1); // 100 of commitments = the ceiling
        vm.expectRevert(abi.encodeWithSelector(MarginVault.CeilingExceeded.selector, 100_000_001, 100_000_000));
        e.reserveOpen(3, carol, 1);
        assertEq(v.commitments(), 100_000_000);
        assertEq(v.pendingGrossCash(), 200_000_000);

        e.cancelOpen(2);
        e.reserveOpen(3, carol, 40 * USDC1); // freed capacity can be reserved again
        assertEq(v.commitments(), 100_000_000);
    }

    function test_pendingGrossCash_countsAgainstFreeCashOfLaterOpens() public {
        (MarginVault v, TestMarginEngine e) = _vault(100 * USDC1, 100 * USDC1, 100 * USDC1);
        e.reserveOpen(1, trader1, 30 * USDC1); // 60 of the 100 idle is now advanced and pending
        assertEq(v.depositorIdleCash(), 100_000_000);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.GrossCashUnavailable.selector, 40_000_000, 50_000_000));
        e.reserveOpen(2, trader2, 25 * USDC1); // would need 50 but only 40 is free
        e.reserveOpen(2, trader2, 20 * USDC1); // 40 fits exactly
        assertEq(v.pendingGrossCash(), 100_000_000);
    }

    function test_financingHeadroom_matchesTheBindingLimit() public {
        _fundedVault();
        assertEq(vault.financingHeadroom(), 50_000_000); // cash binds: idle 100 funds a 2P purchase of at most 100
        _open(1, trader1, 10 * USDC1);
        assertEq(vault.financingHeadroom(), 45_000_000); // idle 90 -> 45
        (MarginVault v,) = _vault(30 * USDC1, 10 * USDC1, 100 * USDC1);
        assertEq(v.financingHeadroom(), 30_000_000); // ceiling binds
    }

    function test_maxLivePositions_countsReservations_andOnlyFinalizationFreesASlot() public {
        _fundedVault();
        for (uint256 i = 1; i <= 32; i++) {
            engine.openFull(i, address(uint160(0x1000 + i)), 1 * USDC1);
        }
        assertEq(vault.liveCount(), 32);
        vm.expectRevert(MarginVault.TooManyPositions.selector);
        engine.reserveOpen(33, trader1, 1 * USDC1);

        engine.repayPrincipal(7, 1 * USDC1); // principal fully repaid, but the position is still live
        assertEq(vault.liveCount(), 32);
        vm.expectRevert(MarginVault.TooManyPositions.selector);
        engine.reserveOpen(33, trader1, 1 * USDC1);

        engine.finalizePosition(7); // closure frees the slot
        assertEq(vault.liveCount(), 31);
        engine.reserveOpen(33, trader1, 1 * USDC1); // reserved, not yet live
        vm.expectRevert(MarginVault.TooManyPositions.selector);
        engine.reserveOpen(34, trader2, 1 * USDC1); // 31 live + 1 pending = 32
    }

    // ---------------------------------------------------------------- queue and pause gates

    function test_unfilledQueue_blocksNewFinance_butNotConfirmOrRepay() public {
        _fundedVault();
        engine.reserveOpen(1, trader1, 10 * USDC1);
        vm.prank(alice);
        vault.requestWithdraw(1 * USDC1);

        vm.expectRevert(MarginVault.WithdrawalQueueNotEmpty.selector);
        engine.reserveOpen(2, trader2, 1 * USDC1);
        engine.completeOpen(1); // a reservation made earlier can still complete
        engine.repayPrincipal(1, 3 * USDC1);
        assertEq(vault.outstandingPrincipal(), 7_000_000);
    }

    function test_pause_blocksNewFinance_butRepaymentAndCompletionStayOpen() public {
        _fundedVault();
        engine.reserveOpen(1, trader1, 10 * USDC1);
        _open(2, trader2, 10 * USDC1);

        vm.prank(guardian);
        vault.setFundingPaused(true);
        vm.expectRevert(MarginVault.FundingIsPaused.selector);
        engine.reserveOpen(3, carol, 1 * USDC1);
        engine.completeOpen(1); // completes the earlier reservation
        engine.repayPrincipal(2, 10 * USDC1); // repayment and release are never paused
        engine.finalizePosition(2);
        assertEq(vault.liveCount(), 1);
        assertEq(vault.outstandingPrincipal(), 10_000_000);

        vm.prank(guardian);
        vault.setFundingPaused(false);
        _open(4, carol, 1 * USDC1); // financing resumes
        assertEq(vault.liveCount(), 2);
    }

    // ---------------------------------------------------------------- principal return and write-off

    function test_repayPrincipal_partial_thenFullRepayKeepsThePositionLive() public {
        _fundedVault();
        _open(1, trader1, 10 * USDC1);
        _open(2, trader2, 10 * USDC1);

        engine.repayPrincipal(1, 4 * USDC1);
        MarginVault.VaultState memory s = vault.vaultState();
        assertEq(s.outstandingPrincipal, 16_000_000);
        assertEq(s.depositorIdleCash, 84_000_000);
        assertEq(s.nav, 100_000_000);
        (, , , uint256 remaining,) = vault.positions(1);
        assertEq(remaining, 6_000_000);

        engine.repayPrincipal(1, 6 * USDC1); // principal is now zero, but markup may still be owed
        s = vault.vaultState();
        assertEq(s.outstandingPrincipal, 10_000_000);
        assertEq(s.livePositions, 2, "P=0 position must stay live");
        assertEq(vault.accountExposure(trader1), 0, "exposure cap is freed");
        (MarginVault.PositionStatus st,,, uint256 rem,) = vault.positions(1);
        assertEq(uint8(st), uint8(MarginVault.PositionStatus.Live));
        assertEq(rem, 0);
        assertTrue(vault.isFullyBacked());
    }

    function test_repayPrincipal_rejectsBadAmounts_andReservedPositions() public {
        _fundedVault();
        _open(1, trader1, 10 * USDC1);
        vm.expectRevert(MarginVault.ZeroAmount.selector);
        engine.repayPrincipal(1, 0);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.AmountExceedsRemaining.selector, 1, 10_000_001, 10_000_000));
        engine.repayPrincipal(1, 10 * USDC1 + 1);

        engine.reserveOpen(2, trader2, 5 * USDC1);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.WrongPositionStatus.selector, 2, MarginVault.PositionStatus.Reserved));
        engine.repayPrincipal(2, 1);
    }

    function test_writeOff_lowersNavWithoutMovingCash_andLeavesThePositionLiveAtZero() public {
        _fundedVault();
        _open(1, trader1, 10 * USDC1);
        uint256 cash = usdc.balanceOf(address(vault));
        engine.writeOffPrincipal(1, 3 * USDC1);
        assertEq(usdc.balanceOf(address(vault)), cash);
        assertEq(vault.nav(), 97_000_000);
        assertEq(vault.outstandingPrincipal(), 7_000_000);
        assertEq(vault.accountExposure(trader1), 7_000_000);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.AmountExceedsRemaining.selector, 1, 7_000_001, 7_000_000));
        engine.writeOffPrincipal(1, 7 * USDC1 + 1);
        engine.writeOffPrincipal(1, 7 * USDC1);
        assertEq(vault.liveCount(), 1);
        assertEq(vault.nav(), 90_000_000);
        assertTrue(vault.isFullyBacked());
    }

    // ---------------------------------------------------------------- finalization (01a lead-review regression)

    function test_finalize_requiresZeroPrincipal_removesExactlyOnce_andFixesSwappedIndexes() public {
        _fundedVault();
        _open(1, trader1, 5 * USDC1);
        _open(2, trader2, 5 * USDC1);
        _open(3, carol, 5 * USDC1);
        assertEq(vault.liveCount(), 3);

        vm.expectRevert(abi.encodeWithSelector(MarginVault.PrincipalOutstanding.selector, 1, 5_000_000));
        engine.finalizePosition(1);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.UnknownPosition.selector, 99));
        engine.finalizePosition(99);

        engine.repayPrincipal(1, 5 * USDC1);
        assertEq(vault.liveCount(), 3); // P=0 and M>0: still live
        engine.finalizePosition(1);
        assertEq(vault.liveCount(), 2);
        assertEq(vault.liveIdAt(0), 3); // id 3 was swapped into slot 0
        assertEq(vault.liveIdAt(1), 2);
        (MarginVault.PositionStatus st,,,,) = vault.positions(1);
        assertEq(uint8(st), uint8(MarginVault.PositionStatus.Closed));

        vm.expectRevert(abi.encodeWithSelector(MarginVault.WrongPositionStatus.selector, 1, MarginVault.PositionStatus.Closed));
        engine.finalizePosition(1); // duplicate closure fails
        vm.expectRevert(abi.encodeWithSelector(MarginVault.WrongPositionStatus.selector, 1, MarginVault.PositionStatus.Closed));
        engine.repayPrincipal(1, 1);

        // The swapped-in entry must now finalize correctly too.
        engine.writeOffPrincipal(3, 5 * USDC1);
        engine.finalizePosition(3);
        assertEq(vault.liveCount(), 1);
        assertEq(vault.liveIdAt(0), 2);
        engine.repayPrincipal(2, 5 * USDC1);
        engine.finalizePosition(2);
        assertEq(vault.liveCount(), 0);
    }

    function test_finalize_rejectsReservedPositions_andIgnoresStalePrices() public {
        _fundedVault();
        engine.reserveOpen(1, trader1, 5 * USDC1);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.WrongPositionStatus.selector, 1, MarginVault.PositionStatus.Reserved));
        engine.finalizePosition(1);
        engine.completeOpen(1);
        _open(2, trader2, 5 * USDC1);

        engine.setStale(1, true);
        engine.setStale(2, true);
        engine.setValue(1, 1); // impaired and stale: neither blocks repayment or finalization
        engine.repayPrincipal(1, 5 * USDC1);
        engine.finalizePosition(1);
        assertEq(vault.liveCount(), 1);
    }

    function test_openIdRejectedAfterFinalization() public {
        _fundedVault();
        _open(1, trader1, 5 * USDC1);
        engine.repayPrincipal(1, 5 * USDC1);
        engine.finalizePosition(1);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.PositionExists.selector, 1));
        engine.reserveOpen(1, trader1, 1 * USDC1);
    }
}
