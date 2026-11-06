// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarginVault} from "../src/MarginVault.sol";
import {VaultBase} from "./VaultBase.sol";

/// @notice Rounding, dust and total-loss write-offs, legitimate waiting, worthless-share burns and the last-share
/// guard. Dust and waiting are tested separately: waiting for liquidity must never destroy redeemable shares.
contract MarginVaultGuardsTest is VaultBase {
    address internal keeper = makeAddr("keeper");

    event WithdrawalDustWrittenOff(uint256 indexed requestId, address indexed owner, uint256 sharesBurned);

    function _process(uint256 n) internal returns (uint256) {
        vm.prank(keeper);
        return vault.processWithdrawals(n);
    }

    function _request(address who, uint256 shares) internal returns (uint256) {
        vm.prank(who);
        return vault.requestWithdraw(shares);
    }

    /// @dev Alice holds 10 shares (10e6) backed by NAV 5e6: half the capital was lost on a position that is still
    /// live at zero principal. One share is worth half a micro-USDC.
    function _halfPriceVault() internal {
        _deposit(alice, 10 * USDC1);
        _seedTargets();
        _open(1, trader1, 5 * USDC1);
        _drainReserves(9001); // protection is spent first, so the next loss lands on LPs in full
        engine.settleFinalLoss(1);
        assertEq(vault.nav(), 5_000_000);
        assertEq(vault.totalShares(), 10_000_000);
    }

    // ---------------------------------------------------------------- dust write-off

    function test_dust_aWholeResidualWorthLessThanOneAtomIsWrittenOffByConsent() public {
        _halfPriceVault();
        _request(alice, 1); // floor(1 * 5e6 / 10e6) = 0
        vm.expectEmit(true, true, false, true, address(vault));
        emit WithdrawalDustWrittenOff(0, alice, 1);
        assertEq(_process(1), 1);

        assertEq(vault.claimable(alice), 0);
        assertEq(vault.totalShares(), 10_000_000 - 1);
        assertEq(vault.sharesOf(alice), 10_000_000 - 1);
        assertEq(vault.lockedShares(alice), 0);
        assertEq(vault.queueHead(), 1);
        assertEq(vault.activeRequests(), 0);
        assertEq(vault.nav(), 5_000_000, "dust burn moves no cash");
        assertEq(vault.depositorIdleCash(), 5_000_000);
    }

    function test_dust_isDecidedBeforeTheIdleCheck_soItWorksWithZeroIdle() public {
        _deposit(alice, 10 * USDC1);
        _deposit(bob, 10 * USDC1);
        _seedTargets();
        engine.openFull(1, trader1, 5 * USDC1);
        engine.openFull(2, trader2, 5 * USDC1); // idle 10, outstanding 10
        _drainReserves(9001);
        _request(alice, 10 * USDC1);
        assertEq(_process(1), 1); // alice takes all the idle cash
        engine.settleFinalLoss(1); // 5 lost with no protection left; outstanding 5 remains
        assertEq(vault.depositorIdleCash(), 0);
        assertEq(vault.nav(), 5_000_000); // NAV 5e6 over bob's 10e6 shares

        _request(bob, 1); // worth floor(1 * 5e6 / 10e6) = 0
        vm.expectEmit(true, true, false, true, address(vault));
        emit WithdrawalDustWrittenOff(1, bob, 1);
        assertEq(_process(1), 1); // written off even though there is no idle cash at all
        assertEq(vault.queueHead(), 2);
        assertEq(vault.sharesOf(bob), 10_000_000 - 1);
        assertEq(vault.claimable(bob), 0);
    }

    function test_dust_partialFillThatLeavesAnUnredeemableResidualIsFinishedInTheSameCall() public {
        _deposit(alice, 10 * USDC1);
        _seedTargets();
        _open(1, trader1, 2_500_000);
        _open(2, trader2, 1_250_000);
        _open(3, carol, 1_250_000);
        _drainReserves(9001);
        engine.settleFinalLoss(1);
        engine.settleFinalLoss(2);
        engine.settleFinalLoss(3); // 5e6 lost, nothing covered: NAV 5e6 = idle 5e6 over 10e6 shares
        _seedTargets(); // the treasury restores protection so financing can resume
        assertEq(vault.nav(), 5_000_000);
        assertEq(vault.depositorIdleCash(), 5_000_000);
        // Lend again so idle is 1.25e6: positions of 2.5e6 and 1.25e6 (each needs 2P of idle).
        _open(4, makeAddr("t4"), 2_500_000);
        _open(5, makeAddr("t5"), 1_250_000);
        assertEq(vault.depositorIdleCash(), 1_250_000);

        _request(alice, 2_500_001);
        // burn = min(2_500_001, floor(1.25e6 * 10e6 / 5e6) = 2_500_000), payout = 1.25e6; one share is left over
        assertEq(_process(1), 0);
        assertEq(vault.claimable(alice), 1_250_000);
        (, uint256 left) = vault.withdrawalRequests(0);
        assertEq(left, 1);
        // NAV is now 3.75e6 over 7.5e6 shares: the single residual share is worth floor(0.5) = 0, so it is written off
        assertEq(_process(1), 1);
        assertEq(vault.queueHead(), 1);
        assertEq(vault.activeRequests(), 0);
        assertEq(vault.lockedShares(alice), 0);
    }

    // ---------------------------------------------------------------- legitimate waiting is not corruption

    function test_waiting_zeroIdle_leavesTheRequestAndSharesUntouched() public {
        _deposit(alice, 10 * USDC1);
        _seedTargets();
        _open(1, trader1, 5 * USDC1);
        _request(alice, 10 * USDC1);
        _process(1); // pays the idle 5, leaves 5 shares queued behind outstanding principal
        uint256 shares = vault.totalShares();
        (, uint256 left) = vault.withdrawalRequests(0);

        assertEq(_process(16), 0);
        assertEq(vault.totalShares(), shares);
        (, uint256 left2) = vault.withdrawalRequests(0);
        assertEq(left2, left);
        assertEq(vault.lockedShares(alice), left);
        assertEq(vault.queueHead(), 0);
        assertEq(vault.claimable(alice), 5_000_000);
    }

    function test_waiting_whenIdleBuysLessThanOneShare_returnsWithoutMutation() public {
        // NAV exceeds the share count, so a single atom of idle cash is worth less than one whole share.
        _deposit(alice, 10 * USDC1);
        _deposit(bob, 10 * USDC1);
        _seedTargets();
        engine.openFull(1, trader1, 10 * USDC1);
        engine.recordCollectedMarkup(1, 26 * USDC1); // LP share 20.02 exactly: NAV 40.02, shares 20
        engine.openFull(2, trader2, 10 * USDC1);
        engine.openFull(3, carol, 10 * USDC1);
        assertEq(vault.depositorIdleCash(), 10_020_000);
        assertEq(vault.nav(), 40_020_000);

        _request(alice, 10 * USDC1);
        assertEq(_process(1), 0);
        // burn = min(10e6, floor(10_020_000 * 20e6 / 40_020_000)) = 5_007_496; payout = floor(5_007_496 * 2.001) = 10_019_999
        assertEq(vault.claimable(alice), 10_019_999);
        assertEq(vault.totalShares(), 14_992_504);
        assertEq(vault.depositorIdleCash(), 1); // one atom is left
        assertEq(vault.nav(), 30_000_001);

        uint256 supply = vault.totalShares();
        (, uint256 left) = vault.withdrawalRequests(0);
        assertEq(_process(16), 0); // floor(1 * 14_992_504 / 30_000_001) = 0 shares: wait, do not destroy anything
        assertEq(vault.totalShares(), supply);
        (, uint256 left2) = vault.withdrawalRequests(0);
        assertEq(left2, left);
        assertEq(vault.lockedShares(alice), left);
        assertEq(vault.depositorIdleCash(), 1);
        assertEq(vault.claimable(alice), 10_019_999);
        assertEq(vault.queueHead(), 0);
    }

    function test_rounding_favoursTheVault_andIsNotDust() public {
        _halfPriceVault();
        _request(alice, 3); // floor(3 * 5e6 / 10e6) = 1: redeemable, so it is paid rather than written off
        assertEq(_process(1), 1);
        assertEq(vault.claimable(alice), 1);
        assertEq(vault.totalShares(), 10_000_000 - 3);
        assertEq(vault.nav(), 4_999_999);
    }

    // ---------------------------------------------------------------- total loss and re-initialisation

    function test_totalLoss_writesOffTheResidual_underTheLastShareGuard_thenAllowsReinitialisation() public {
        _deposit(alice, 10 * USDC1);
        _seedTargets();
        _open(1, trader1, 5 * USDC1);
        _drainReserves(9001);
        _request(alice, 10 * USDC1);
        _process(1); // pays 5 of idle; 5e6 shares stay queued
        engine.settleFinalLoss(1); // NAV 0, position live at zero principal
        assertEq(vault.nav(), 0);
        assertEq(vault.totalShares(), 5_000_000);

        // zero NAV: the residual is burned for nothing, but one share must survive while a position is live
        assertEq(_process(1), 0);
        assertEq(vault.totalShares(), 1);
        assertEq(vault.sharesOf(alice), 1);
        assertEq(vault.queueHead(), 0);
        assertEq(_process(1), 0); // nothing more can burn yet
        assertEq(vault.totalShares(), 1);

        engine.finalizePosition(1);
        assertEq(_process(1), 1); // now the final worthless share goes
        assertEq(vault.totalShares(), 0);
        assertEq(vault.activeRequests(), 0);
        assertEq(vault.claimable(alice), 5_000_000); // only the real payout earlier

        // new initial funding: supply zero and nothing live
        assertEq(_deposit(bob, 7 * USDC1), 7_000_000);
        assertEq(vault.totalShares(), 7_000_000);
    }

    function test_worthlessBurn_onlyAtZeroNav_onlyOwnUnlockedShares_andNeverTheLastShareWhileLive() public {
        _deposit(alice, 10 * USDC1);
        _deposit(bob, 10 * USDC1);
        _seedTargets();
        engine.openFull(1, trader1, 10 * USDC1); // idle 10, outstanding 10
        _drainReserves(9001);
        _request(alice, 10 * USDC1);
        assertEq(_process(1), 1); // alice is paid the idle 10; bob keeps 10 shares behind the lent 10

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.NavNotZero.selector, 10_000_000));
        vault.burnWorthlessShares(1); // NAV is positive: shares are not worthless

        engine.settleFinalLoss(1); // NAV 0, position live at zero principal
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.InsufficientShares.selector, 0, 1));
        vault.burnWorthlessShares(1); // not a holder
        vm.startPrank(bob);
        vm.expectRevert(MarginVault.ZeroAmount.selector);
        vault.burnWorthlessShares(0);
        vm.expectRevert(MarginVault.LastShareGuard.selector);
        vault.burnWorthlessShares(10_000_000); // would orphan later markup while a position is live
        vault.burnWorthlessShares(10_000_000 - 1);
        vm.stopPrank();
        assertEq(vault.totalShares(), 1);
        assertEq(vault.sharesOf(bob), 1);

        engine.finalizePosition(1);
        vm.prank(bob);
        vault.burnWorthlessShares(1); // all positions closed: the final share can go
        assertEq(vault.totalShares(), 0);
    }

    function test_worthlessBurn_cannotTouchLockedShares() public {
        _deposit(alice, 10 * USDC1);
        _seedTargets();
        _open(1, trader1, 5 * USDC1);
        _drainReserves(9001);
        _request(alice, 10 * USDC1);
        _process(1);
        engine.settleFinalLoss(1); // NAV 0; 5e6 shares are locked in the queue
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.InsufficientShares.selector, 0, 1));
        vault.burnWorthlessShares(1);
    }

    // ---------------------------------------------------------------- last-share guard on regular fills

    function test_lastShare_principalRepaidWithMarkupOwed_thenFullWithdrawal_thenFinalMarkupAndClaim() public {
        _deposit(alice, 10 * USDC1);
        _seedTargets();
        _open(1, trader1, 5 * USDC1);
        engine.repayPrincipal(1, 5 * USDC1); // P = 0, markup still owed, position live
        assertEq(vault.liveCount(), 1);
        assertEq(vault.outstandingPrincipal(), 0);
        _request(alice, 10 * USDC1);

        assertEq(_process(1), 0); // the final share is held back while the position is live
        assertEq(vault.totalShares(), 1);
        assertEq(vault.claimable(alice), 9_999_999); // regular fill capped at totalShares - 1, payout recomputed
        (, uint256 left) = vault.withdrawalRequests(0);
        assertEq(left, 1);
        assertEq(vault.depositorIdleCash(), 1);
        assertEq(_process(1), 0); // still nothing more can burn
        assertEq(vault.totalShares(), 1);

        engine.recordCollectedMarkup(1, 100_000); // collected markup: LP share 77_000, manager 23_000
        assertEq(vault.nav(), 77_001);
        engine.finalizePosition(1); // debt settled, position closed
        assertEq(_process(1), 1);
        assertEq(vault.totalShares(), 0);
        assertEq(vault.claimable(alice), 10_077_000);

        vm.prank(alice);
        assertEq(vault.claim(), 10_077_000);
        assertEq(usdc.balanceOf(alice), 10_077_000);
        assertEq(vault.claimableWithdrawals(), 0);
        assertEq(usdc.balanceOf(address(vault)), 1_023_000); // protection reserves plus the manager's locked cash
    }

    function test_lastShare_withNoLivePosition_theFinalShareRedeemsNormally() public {
        _deposit(alice, 10 * USDC1);
        _request(alice, 10 * USDC1);
        assertEq(_process(1), 1);
        assertEq(vault.totalShares(), 0);
        assertEq(vault.claimable(alice), 10_000_000);
    }

    function test_lastShare_aSecondHolderKeepsThePoolAliveSoNoGuardIsNeeded() public {
        _deposit(alice, 10 * USDC1);
        _deposit(bob, 10 * USDC1);
        _seedTargets();
        _open(1, trader1, 5 * USDC1);
        engine.repayPrincipal(1, 5 * USDC1); // live at P=0
        _request(alice, 10 * USDC1);
        assertEq(_process(1), 1); // bob's shares keep supply above one, so alice redeems fully
        assertEq(vault.claimable(alice), 10_000_000);
        assertEq(vault.totalShares(), 10_000_000);
    }
}
