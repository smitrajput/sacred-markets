// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarginVault} from "../src/MarginVault.sol";
import {TestMarginEngine} from "./mocks/TestMarginEngine.sol";
import {VaultBase} from "./VaultBase.sol";

/// @notice 01c: collected-markup accounting (77/23, manager part refills protection) and the final-loss waterfall.
/// Numbers are worked out by hand from each test's inputs; the markup figure comes from the economics, not the vault.
contract MarginVaultProtectionTest is VaultBase {
    MarginVault internal v; // ceiling 1000, per-account cap 500: targets primary 4 and tail 6
    TestMarginEngine internal e;
    uint256 internal donated;

    event MarkupCollected(
        uint256 indexed id,
        uint256 payment,
        uint256 lpIncrement,
        uint256 toPrimary,
        uint256 toTail,
        uint256 toManagerCash
    );
    event FinalLossSettled(
        uint256 indexed id,
        uint256 grossLoss,
        uint256 fromPrimary,
        uint256 fromTail,
        uint256 fromBackstop,
        uint256 uncoveredLpLoss
    );

    function setUp() public override {
        super.setUp();
        (v, e) = _deployVault(1_000 * USDC1, 500 * USDC1);
    }

    function _fund(uint256 lp, uint256 primary, uint256 tail, uint256 backstop) internal {
        _seed(v, primary, tail);
        if (backstop > 0) {
            usdc.mint(treasury, backstop);
            vm.prank(treasury);
            v.seedProtection(MarginVault.ProtectionKind.Backstop, backstop);
        }
        _depositTo(v, alice, lp);
    }

    /// @dev Independent economics: 10% annual, 14 days (1,209,600 s), 365-day year, floored.
    function _markup(uint256 principal) internal pure returns (uint256) {
        return (principal * 1_000 * 1_209_600) / (10_000 * 31_536_000);
    }

    function _assertCustody() internal view {
        assertEq(
            usdc.balanceOf(address(v)),
            v.depositorIdleCash() + v.primaryReserve() + v.tailReserve() + v.pilotBackstop() + v.managerCash()
                + v.claimableWithdrawals() + donated,
            "custody equals recorded buckets plus donations"
        );
    }

    // ---------------------------------------------------------------- targets

    function test_targets_atCeiling1000_areFourAndSix() public view {
        assertEq(v.primaryTarget(), 4 * USDC1);
        assertEq(v.tailTarget(), 6 * USDC1);
    }

    // ---------------------------------------------------------------- final loss waterfall

    function test_finalLoss_principal500_proceeds480_gross20_primaryTailBackstopCover15_lpLoses5() public {
        _fund(1_100 * USDC1, 4 * USDC1, 6 * USDC1, 5 * USDC1);
        e.openFull(1, trader1, 500 * USDC1);
        assertEq(v.depositorIdleCash(), 600_000_000);

        vm.expectEmit(true, false, false, true, address(v));
        emit FinalLossSettled(1, 20 * USDC1, 4 * USDC1, 6 * USDC1, 5 * USDC1, 5 * USDC1);
        e.finalLoss(1, 480 * USDC1); // 480 returned as principal, 20 left as the gross shortfall

        MarginVault.VaultState memory s = v.vaultState();
        assertEq(s.primaryReserve, 0);
        assertEq(s.tailReserve, 0);
        assertEq(s.pilotBackstop, 0);
        assertEq(s.outstandingPrincipal, 0);
        assertEq(s.depositorIdleCash, 1_095_000_000); // 600 + 480 returned + 15 covered
        assertEq(s.nav, 1_095_000_000); // LPs lost exactly 5 of 1100
        assertEq(s.totalShares, 1_100_000_000);
        assertEq(s.managerCash, 0); // markup was 0
        assertEq(v.markupCollected(1), 0);
        (MarginVault.PositionStatus st,,, uint256 remaining,) = v.positions(1);
        assertEq(uint8(st), uint8(MarginVault.PositionStatus.Live)); // closed only by explicit finalization
        assertEq(remaining, 0);
        assertEq(usdc.balanceOf(address(v)), 1_095_000_000); // reserves left the buckets by moving into idle, not out
        _assertCustody();

        e.finalizePosition(1);
        assertEq(v.liveCount(), 0);
    }

    function test_finalLoss_fullyCovered_stillEmitsEveryBucket_andLpsLoseNothing() public {
        _fund(1_100 * USDC1, 4 * USDC1, 6 * USDC1, 200 * USDC1);
        e.openFull(1, trader1, 50 * USDC1);
        uint256 navBefore = v.nav();

        vm.expectEmit(true, false, false, true, address(v));
        emit FinalLossSettled(1, 50 * USDC1, 4 * USDC1, 6 * USDC1, 40 * USDC1, 0);
        e.settleFinalLoss(1);

        assertEq(v.nav(), navBefore, "protection absorbed everything");
        assertEq(v.pilotBackstop(), 160 * USDC1);
        assertEq(v.primaryReserve() + v.tailReserve(), 0);
        assertEq(v.depositorIdleCash(), 1_100_000_000); // 1050 idle after lending + 50 covered
        _assertCustody();
    }

    function test_finalLoss_withNoProtectionLeft_fallsOnLpsInFull() public {
        _fund(1_100 * USDC1, 4 * USDC1, 6 * USDC1, 0);
        e.openFull(1, trader1, 100 * USDC1);
        e.openFull(2, trader2, 100 * USDC1);

        e.settleFinalLoss(1); // covers 10 of 100: LPs lose 90
        assertEq(v.nav(), 1_010_000_000);
        vm.expectEmit(true, false, false, true, address(v));
        emit FinalLossSettled(2, 100 * USDC1, 0, 0, 0, 100 * USDC1);
        e.settleFinalLoss(2); // nothing left to draw: LPs lose all 100
        assertEq(v.nav(), 910_000_000);
        assertEq(v.depositorIdleCash(), 910_000_000);
        assertEq(v.outstandingPrincipal(), 0);
        _assertCustody();
    }

    function test_finalLoss_neverTouchesManagerCash() public {
        _fund(1_100 * USDC1, 4 * USDC1, 6 * USDC1, 0);
        e.openFull(1, trader1, 100 * USDC1);
        e.openFull(2, trader2, 100 * USDC1);
        e.recordCollectedMarkup(1, 10 * USDC1); // manager part 2.3 locked
        assertEq(v.managerCash(), 2_300_000);
        e.settleFinalLoss(2);
        e.settleFinalLoss(1);
        assertEq(v.managerCash(), 2_300_000);
        _assertCustody();
    }

    function test_depletedTargets_blockFunding_untilTheTreasurySeeds_withoutTouchingNavOrShares() public {
        _fund(1_100 * USDC1, 4 * USDC1, 6 * USDC1, 0);
        e.openFull(1, trader1, 100 * USDC1);
        e.openFull(2, trader2, 100 * USDC1);
        e.recordCollectedMarkup(1, 10 * USDC1); // manager cash 2.3 exists
        e.settleFinalLoss(2); // protection spent
        assertEq(v.primaryReserve() + v.tailReserve(), 0);

        vm.expectRevert(abi.encodeWithSelector(MarginVault.ReservesUnderfunded.selector, 0, 0));
        e.reserveOpen(3, trader1, 10 * USDC1); // manager cash does not satisfy the minimum
        uint256 nav = v.nav();
        uint256 shares = v.totalShares();

        _seed(v, 4 * USDC1, 0);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.ReservesUnderfunded.selector, 4 * USDC1, 0));
        e.reserveOpen(3, trader1, 10 * USDC1);
        _seed(v, 0, 6 * USDC1);
        assertEq(v.nav(), nav, "seeding is not LP money");
        assertEq(v.totalShares(), shares);
        assertEq(v.managerCash(), 2_300_000);
        e.openFull(3, trader1, 10 * USDC1); // financing resumes
        _assertCustody();
    }

    // ---------------------------------------------------------------- collected markup, 77/23

    function test_markup_fullCollectionOnP500_splitsLp1476712_manager441096() public {
        _fund(1_100 * USDC1, 4 * USDC1, 6 * USDC1, 0);
        e.openFull(1, trader1, 500 * USDC1);
        uint256 payment = _markup(500 * USDC1);
        assertEq(payment, 1_917_808); // 500 * 10% * 14 / 365 = 1.917808...
        uint256 cashBefore = usdc.balanceOf(address(v));
        uint256 navBefore = v.nav();

        vm.expectEmit(true, false, false, true, address(v));
        emit MarkupCollected(1, 1_917_808, 1_476_712, 0, 0, 441_096);
        e.recordCollectedMarkup(1, payment);

        assertEq(usdc.balanceOf(address(v)) - cashBefore, 1_917_808, "exactly the payment arrives");
        assertEq(v.nav() - navBefore, 1_476_712, "LP share raises NAV");
        assertEq(v.managerCash(), 441_096, "reserves were full, so the manager part is locked");
        assertEq(v.markupCollected(1), 1_917_808);
        assertEq(v.lpMarkupAllocated(1), 1_476_712);
        _assertCustody();
    }

    function test_markup_roundingIsCumulativeAcrossPayments() public {
        _fund(1_100 * USDC1, 4 * USDC1, 6 * USDC1, 0);
        e.openFull(1, trader1, 500 * USDC1);
        uint256 idle0 = v.depositorIdleCash();

        e.recordCollectedMarkup(1, 1_000_000);
        assertEq(v.depositorIdleCash() - idle0, 770_000);
        assertEq(v.managerCash(), 230_000);
        e.recordCollectedMarkup(1, 500_000); // cumulative 1.5e6 -> LP total 1_155_000
        assertEq(v.depositorIdleCash() - idle0, 1_155_000);
        assertEq(v.managerCash(), 345_000);
        e.recordCollectedMarkup(1, 417_808); // cumulative 1_917_808 -> LP total 1_476_712, exactly the one-shot answer
        assertEq(v.depositorIdleCash() - idle0, 1_476_712);
        assertEq(v.managerCash(), 441_096);

        // atom-level rounding: 3 then 3 -> LP 2 then 2, manager 1 then 1
        e.openFull(2, trader2, 100 * USDC1);
        uint256 idle1 = v.depositorIdleCash();
        uint256 cash1 = v.managerCash();
        e.recordCollectedMarkup(2, 3);
        assertEq(v.depositorIdleCash() - idle1, 2);
        assertEq(v.managerCash() - cash1, 1);
        e.recordCollectedMarkup(2, 3);
        assertEq(v.depositorIdleCash() - idle1, 4); // floor(6 * 0.77) = 4
        assertEq(v.managerCash() - cash1, 2);
        _assertCustody();
    }

    function test_markup_managerPartRefillsPrimaryThenTailThenLocksTheExcess() public {
        _fund(1_100 * USDC1, 4 * USDC1, 6 * USDC1, 0);
        e.openFull(1, trader1, 100 * USDC1);
        e.openFull(2, trader2, 10 * USDC1);
        e.settleFinalLoss(2); // 10 of loss is fully covered: primary and tail are now empty
        assertEq(v.primaryReserve() + v.tailReserve(), 0);

        // payment 20: LP 15.4, manager 4.6 -> primary 4 (full), tail 0.6, nothing locked
        vm.expectEmit(true, false, false, true, address(v));
        emit MarkupCollected(1, 20 * USDC1, 15_400_000, 4 * USDC1, 600_000, 0);
        e.recordCollectedMarkup(1, 20 * USDC1);
        assertEq(v.primaryReserve(), 4 * USDC1);
        assertEq(v.tailReserve(), 600_000);
        assertEq(v.managerCash(), 0);

        // second 20: manager 4.6 all to tail (needs 5.4) -> tail 5.2, nothing locked
        e.recordCollectedMarkup(1, 20 * USDC1);
        assertEq(v.primaryReserve(), 4 * USDC1);
        assertEq(v.tailReserve(), 5_200_000);
        assertEq(v.managerCash(), 0);

        // third 20: tail needs 0.8, the remaining 3.8 is locked manager cash
        vm.expectEmit(true, false, false, true, address(v));
        emit MarkupCollected(1, 20 * USDC1, 15_400_000, 0, 800_000, 3_800_000);
        e.recordCollectedMarkup(1, 20 * USDC1);
        assertEq(v.tailReserve(), 6 * USDC1);
        assertEq(v.managerCash(), 3_800_000);
        _assertCustody();
    }

    function test_markup_atAPartiallyDepletedPrimary_fillsOnlyTheDeficit() public {
        _fund(1_100 * USDC1, 4 * USDC1, 6 * USDC1, 0);
        e.openFull(1, trader1, 100 * USDC1);
        e.openFull(2, trader2, 100 * USDC1);
        e.finalLoss(2, 100 * USDC1 - 3 * USDC1); // gross 3: primary pays 3 of its 4, tail is untouched
        assertEq(v.primaryReserve(), 1 * USDC1);
        assertEq(v.tailReserve(), 6 * USDC1);

        // payment 20: LP 15.4, manager 4.6 -> primary deficit 3 is refilled, tail is full, 1.6 is locked
        vm.expectEmit(true, false, false, true, address(v));
        emit MarkupCollected(1, 20 * USDC1, 15_400_000, 3 * USDC1, 0, 1_600_000);
        e.recordCollectedMarkup(1, 20 * USDC1);
        assertEq(v.primaryReserve(), 4 * USDC1);
        assertEq(v.tailReserve(), 6 * USDC1);
        assertEq(v.managerCash(), 1_600_000);
        _assertCustody();
    }

    function test_markup_onAPrincipalZeroPosition_isStillCollectedAndSplit() public {
        _fund(1_100 * USDC1, 4 * USDC1, 6 * USDC1, 0);
        e.openFull(1, trader1, 100 * USDC1);
        e.repayPrincipal(1, 100 * USDC1); // P = 0, markup still owed
        uint256 idle0 = v.depositorIdleCash();
        e.recordCollectedMarkup(1, 383_562); // a payment on a position whose principal is already zero
        assertEq(v.depositorIdleCash() - idle0, 295_342); // floor(383_562 * 0.77) = 295_342.74
        assertEq(v.managerCash(), 88_220);
        _assertCustody();
    }

    // ---------------------------------------------------------------- authority, lifecycle, exact transfers

    function test_engineOnly_andTheLifecycleCannotBeReplayed() public {
        _fund(1_100 * USDC1, 4 * USDC1, 6 * USDC1, 0);
        e.openFull(1, trader1, 10 * USDC1);
        vm.startPrank(alice);
        vm.expectRevert(MarginVault.NotEngine.selector);
        v.recordCollectedMarkup(1, 1);
        vm.expectRevert(MarginVault.NotEngine.selector);
        v.settleFinalLoss(1);
        vm.expectRevert(MarginVault.NotEngine.selector);
        v.finalizePosition(1);
        vm.stopPrank();
        uint256 nav = v.nav();
        assertEq(v.markupCollected(1), 0);
        assertEq(v.nav(), nav); // the rejected calls changed nothing

        vm.expectRevert(MarginVault.ZeroAmount.selector);
        e.recordCollectedMarkup(1, 0);
        e.settleFinalLoss(1);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.NoShortfall.selector, 1));
        e.settleFinalLoss(1); // a loss cannot be booked twice
        e.finalizePosition(1);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.WrongPositionStatus.selector, 1, MarginVault.PositionStatus.Closed));
        e.finalizePosition(1); // double finalization
        vm.expectRevert(abi.encodeWithSelector(MarginVault.WrongPositionStatus.selector, 1, MarginVault.PositionStatus.Closed));
        e.recordCollectedMarkup(1, 1); // nothing is collected after closure
        vm.expectRevert(abi.encodeWithSelector(MarginVault.WrongPositionStatus.selector, 1, MarginVault.PositionStatus.Closed));
        e.settleFinalLoss(1);
    }

    function test_markupAndLoss_requireALivePosition() public {
        _fund(1_100 * USDC1, 4 * USDC1, 6 * USDC1, 0);
        e.reserveOpen(1, trader1, 10 * USDC1); // only reserved
        vm.expectRevert(abi.encodeWithSelector(MarginVault.WrongPositionStatus.selector, 1, MarginVault.PositionStatus.Reserved));
        e.recordCollectedMarkup(1, 1);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.WrongPositionStatus.selector, 1, MarginVault.PositionStatus.Reserved));
        e.settleFinalLoss(1);
        e.cancelOpen(1);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.WrongPositionStatus.selector, 1, MarginVault.PositionStatus.Cancelled));
        e.recordCollectedMarkup(1, 1);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.UnknownPosition.selector, 99));
        e.recordCollectedMarkup(99, 1);
    }

    function test_markup_andRepayment_requireTheExactAmountToArrive() public {
        _fund(1_100 * USDC1, 4 * USDC1, 6 * USDC1, 0);
        e.openFull(1, trader1, 100 * USDC1);
        uint256 nav = v.nav();
        usdc.setFeeBps(100); // a token that keeps 1% of every transfer
        vm.expectRevert(abi.encodeWithSelector(MarginVault.TransferShort.selector, 1_000_000, 990_000));
        e.recordCollectedMarkup(1, 1_000_000);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.TransferShort.selector, 1_000_000, 990_000));
        e.repayPrincipal(1, 1_000_000);
        usdc.setFeeBps(0);
        assertEq(v.markupCollected(1), 0);
        assertEq(v.nav(), nav);
        assertEq(v.managerCash(), 0);
    }

    function test_pauseStaleAndImpairment_doNotBlockRepaymentMarkupLossOrFinalization() public {
        _fund(1_100 * USDC1, 4 * USDC1, 6 * USDC1, 0);
        e.openFull(1, trader1, 100 * USDC1);
        e.openFull(2, trader2, 100 * USDC1);
        e.openFull(3, carol, 100 * USDC1);
        vm.prank(guardian);
        v.setFundingPaused(true);
        e.setStale(1, true);
        e.setValue(2, 1);

        e.repayPrincipal(1, 100 * USDC1);
        e.recordCollectedMarkup(1, 1 * USDC1);
        e.settleFinalLoss(2);
        e.finalizePosition(2);
        e.recordCollectedMarkup(3, 1 * USDC1);
        e.finalizePosition(1);
        assertEq(v.liveCount(), 1);
        _assertCustody();
    }

    function test_donations_neverEnterAnyBucket() public {
        _fund(1_100 * USDC1, 4 * USDC1, 6 * USDC1, 0);
        e.openFull(1, trader1, 100 * USDC1);
        usdc.mint(carol, 30 * USDC1);
        vm.prank(carol);
        usdc.transfer(address(v), 30 * USDC1);
        donated += 30 * USDC1;
        uint256 nav = v.nav();
        e.settleFinalLoss(1);
        e.recordCollectedMarkup(1, 5 * USDC1);
        assertEq(v.nav(), nav - 90_000_000 + 3_850_000); // loss 100 less 10 of protection, plus the LP markup share
        _assertCustody();
    }

    // ---------------------------------------------------------------- demo scale (ceiling 1 USDC)

    function test_demoCeiling1_targetsMarkupAndLossAtTheSmallScale() public {
        (MarginVault d, TestMarginEngine de) = _deployVault(1 * USDC1, 100_000);
        assertEq(d.primaryTarget(), 4_000); // 0.004
        assertEq(d.tailTarget(), 6_000); // 0.006
        _seed(d, 4_000, 6_000);
        _depositTo(d, alice, 10 * USDC1);
        de.openFull(1, trader1, 100_000); // principal 0.10
        de.openFull(2, trader2, 100_000);

        // 0.10 USDC at 10% for 14 days is 383.56 atoms of markup: LP floor(383 * 0.77) = 294, manager 89
        assertEq(_markup(100_000), 383);
        de.recordCollectedMarkup(1, 383);
        assertEq(d.depositorIdleCash(), 9_800_000 + 294); // 10 USDC less the 0.2 lent
        assertEq(d.managerCash(), 89);

        // principal 0.10, proceeds 0.09 -> gross shortfall 0.01: primary 0.004 and tail 0.006 cover all of it
        vm.expectEmit(true, false, false, true, address(d));
        emit FinalLossSettled(2, 10_000, 4_000, 6_000, 0, 0);
        de.finalLoss(2, 90_000);
        assertEq(d.primaryReserve() + d.tailReserve(), 0);
        assertEq(d.nav(), 10_000_000 + 294, "the LPs lost nothing; they only earned their markup share");
        assertEq(
            usdc.balanceOf(address(d)),
            d.depositorIdleCash() + d.managerCash() + d.claimableWithdrawals(),
            "demo-scale custody"
        );
    }
}
