// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarginVault} from "../src/MarginVault.sol";
import {VaultBase} from "./VaultBase.sol";

/// @notice One global FIFO queue: fills, partial fills, ordering, bounds, claims and the gates around them.
/// Every number is worked out by hand from the test's own inputs.
contract MarginVaultFifoTest is VaultBase {
    address internal keeper = makeAddr("keeper");

    event WithdrawalFilled(uint256 indexed requestId, address indexed owner, uint256 sharesBurned, uint256 payout);

    function _process(uint256 n) internal returns (uint256) {
        vm.prank(keeper); // permissionless: any account may run it
        return vault.processWithdrawals(n);
    }

    function _request(address who, uint256 shares) internal returns (uint256) {
        vm.prank(who);
        return vault.requestWithdraw(shares);
    }

    /// @dev Opens `count` positions of 10 USDC, one per account (the per-account cap is 10).
    function _openTens(uint256 count) internal {
        for (uint256 i; i < count; i++) engine.openFull(100 + i, address(uint160(0x7000 + i)), 10 * USDC1);
    }

    // ---------------------------------------------------------------- immediate fill and pricing

    function test_idleRequest_isFilledImmediatelyByTheSameProcessor() public {
        _deposit(alice, 100 * USDC1);
        _request(alice, 40 * USDC1);

        vm.expectEmit(true, true, false, true, address(vault));
        emit WithdrawalFilled(0, alice, 40_000_000, 40_000_000);
        assertEq(_process(1), 1);

        MarginVault.VaultState memory s = vault.vaultState();
        assertEq(vault.claimable(alice), 40_000_000);
        assertEq(s.claimableWithdrawals, 40_000_000);
        assertEq(s.depositorIdleCash, 60_000_000);
        assertEq(s.nav, 60_000_000);
        assertEq(s.totalShares, 60_000_000);
        assertEq(vault.sharesOf(alice), 60_000_000);
        assertEq(vault.lockedShares(alice), 0);
        assertEq(s.queueHead, 1);
        assertEq(s.activeRequests, 0);
        assertEq(usdc.balanceOf(address(vault)), 100_000_000); // cash is still in custody until claimed
        assertTrue(vault.isFullyBacked());
    }

    function test_claim_paysOnlyTheCallersReservedCash_andNeverDebitsNavAgain() public {
        _deposit(alice, 100 * USDC1);
        _deposit(bob, 50 * USDC1);
        _request(alice, 40 * USDC1);
        _process(1);
        uint256 navAfterFill = vault.nav();
        assertEq(navAfterFill, 110_000_000);

        vm.prank(bob);
        vm.expectRevert(MarginVault.NothingToClaim.selector); // bob has nothing reserved
        vault.claim();

        vm.prank(alice);
        assertEq(vault.claim(), 40_000_000);
        assertEq(usdc.balanceOf(alice), 40_000_000);
        assertEq(vault.claimable(alice), 0);
        assertEq(vault.claimableWithdrawals(), 0);
        assertEq(vault.nav(), navAfterFill, "claim must not touch NAV");
        assertEq(usdc.balanceOf(address(vault)), 110_000_000);
        assertTrue(vault.isFullyBacked());

        vm.prank(alice);
        vm.expectRevert(MarginVault.NothingToClaim.selector); // zeroed before the transfer
        vault.claim();
    }

    function test_payout_usesPreFillNav_afterMarkup() public {
        _deposit(alice, 100 * USDC1);
        engine.creditLpMarkup(5 * USDC1); // NAV 105, shares 100
        _request(alice, 20 * USDC1);
        _process(1);
        assertEq(vault.claimable(alice), 21_000_000); // 20 * 105 / 100
        assertEq(vault.nav(), 84_000_000);
        assertEq(vault.totalShares(), 80_000_000);
    }

    function test_directDonation_doesNotChangeAWithdrawalPayout() public {
        _deposit(alice, 100 * USDC1);
        usdc.mint(carol, 50 * USDC1);
        vm.prank(carol);
        usdc.transfer(address(vault), 50 * USDC1);
        _request(alice, 100 * USDC1);
        _process(1);
        assertEq(vault.claimable(alice), 100_000_000); // recorded NAV, not the 150 held
        vm.prank(alice);
        vault.claim();
        assertEq(usdc.balanceOf(address(vault)), 50_000_000); // the donation is simply left behind
        assertEq(vault.totalShares(), 0);
    }

    // ---------------------------------------------------------------- partial fills and strict ordering

    function test_partialFill_isLimitedByIdle_andRepaymentFundsTheHeadWithoutLosingPriority() public {
        _deposit(alice, 100 * USDC1);
        _seedTargets();
        _openTens(4); // idle 60, outstanding 40, NAV 100, shares 100
        _request(alice, 80 * USDC1);

        assertEq(_process(16), 0); // the head is partly filled, not completed
        assertEq(vault.claimable(alice), 60_000_000); // burn floor(60*100/100) = 60 shares, payout 60
        assertEq(vault.totalShares(), 40_000_000);
        assertEq(vault.nav(), 40_000_000);
        (, uint256 unfilled) = vault.withdrawalRequests(0);
        assertEq(unfilled, 20_000_000);
        assertEq(vault.queueHead(), 0);

        // No cash: the head waits, nothing moves.
        assertEq(_process(16), 0);
        assertEq(vault.claimable(alice), 60_000_000);

        engine.repayPrincipal(100, 10 * USDC1);
        engine.repayPrincipal(101, 5 * USDC1); // 15 of principal comes back: the head gets it
        assertEq(_process(16), 0);
        assertEq(vault.claimable(alice), 75_000_000); // burn min(20, floor(15*40/40)) = 15
        assertEq(vault.totalShares(), 25_000_000);
        assertEq(vault.nav(), 25_000_000);

        engine.repayPrincipal(101, 5 * USDC1);
        engine.repayPrincipal(102, 5 * USDC1); // 10 more
        assertEq(_process(16), 1);
        assertEq(vault.claimable(alice), 80_000_000); // burn min(5, floor(10*25/25)) = 5
        assertEq(vault.totalShares(), 20_000_000);
        assertEq(vault.queueHead(), 1);
        assertEq(vault.activeRequests(), 0);
        assertTrue(vault.isFullyBacked());
    }

    function test_fifo_oldestIsServedFirst_laterRequestsWaitBehindIt() public {
        _deposit(alice, 50 * USDC1);
        _deposit(bob, 30 * USDC1);
        _deposit(carol, 20 * USDC1);
        _seedTargets();
        _openTens(6); // idle 40, outstanding 60
        _request(alice, 30 * USDC1);
        _request(bob, 30 * USDC1);
        _request(carol, 20 * USDC1);

        assertEq(_process(16), 1); // alice completes, bob is partly filled, carol is not touched
        assertEq(vault.claimable(alice), 30_000_000);
        assertEq(vault.claimable(bob), 10_000_000);
        assertEq(vault.claimable(carol), 0);
        assertEq(vault.queueHead(), 1);
        assertEq(vault.lockedShares(carol), 20_000_000);
        (, uint256 bobLeft) = vault.withdrawalRequests(1);
        assertEq(bobLeft, 20_000_000);
        assertEq(vault.totalShares(), 60_000_000);
        assertEq(vault.nav(), 60_000_000);

        // New finance and deposits stay blocked while any request is unfilled.
        vm.expectRevert(MarginVault.WithdrawalQueueNotEmpty.selector);
        engine.reserveOpen(900, trader1, 1 * USDC1);
        usdc.mint(alice, 1 * USDC1);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        bytes32 m = vault.MANDATE_HASH();
        vm.expectRevert(MarginVault.WithdrawalQueueNotEmpty.selector);
        vault.deposit(1 * USDC1, 0, m);
        vm.stopPrank();

        engine.repayPrincipal(100, 10 * USDC1);
        engine.repayPrincipal(101, 10 * USDC1); // 20 comes back: all of it goes to bob, the head
        assertEq(_process(16), 1);
        assertEq(vault.claimable(bob), 30_000_000);
        assertEq(vault.claimable(carol), 0);
        assertEq(vault.queueHead(), 2);
    }

    // ---------------------------------------------------------------- bounds

    function _crowd(uint256 n) internal returns (address[] memory users) {
        users = new address[](n);
        for (uint256 i; i < n; i++) {
            users[i] = address(uint160(0x3000 + i));
            _deposit(users[i], 1 * USDC1);
        }
    }

    function test_process_isBoundedToSixteenAttemptsPerCall() public {
        address[] memory users = _crowd(20);
        for (uint256 i; i < 20; i++) _request(users[i], 1 * USDC1);

        vm.prank(keeper);
        vm.expectRevert(MarginVault.ZeroAmount.selector);
        vault.processWithdrawals(0);

        assertEq(_process(100), 16);
        assertEq(vault.queueHead(), 16);
        assertEq(vault.claimable(users[15]), 1_000_000);
        assertEq(vault.claimable(users[16]), 0);
        assertEq(_process(3), 3);
        assertEq(vault.queueHead(), 19);
        assertEq(_process(1), 1);
        assertEq(vault.queueHead(), 20);
        assertEq(_process(5), 0); // empty queue is a harmless no-op
    }

    function test_activeRequestCap_isSixtyFour_andFreesOnCompletion() public {
        address[] memory users = _crowd(65);
        for (uint256 i; i < 64; i++) _request(users[i], 1 * USDC1);
        assertEq(vault.activeRequests(), 64);
        vm.prank(users[64]);
        vm.expectRevert(MarginVault.TooManyRequests.selector);
        vault.requestWithdraw(1 * USDC1);

        assertEq(_process(16), 16);
        assertEq(vault.activeRequests(), 48);
        _request(users[64], 1 * USDC1); // a slot is free again
        assertEq(vault.activeRequests(), 49);
    }

    // ---------------------------------------------------------------- claims and gates are independent

    function test_claim_worksWhilePaused_stale_andImpaired() public {
        _deposit(alice, 100 * USDC1);
        _seedTargets();
        _open(1, trader1, 10 * USDC1);
        _request(alice, 30 * USDC1);
        _process(1);

        vm.prank(guardian);
        vault.setFundingPaused(true);
        engine.setStale(1, true);
        engine.setValue(1, 1);
        vm.prank(alice);
        assertEq(vault.claim(), 30_000_000);
    }

    function test_process_isBlockedByImpairmentAndStalePrices_butNotByPause() public {
        _deposit(alice, 100 * USDC1);
        _seedTargets();
        _open(1, trader1, 10 * USDC1);
        _request(alice, 30 * USDC1);

        engine.setValue(1, 10 * USDC1 - 1);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.AccountingNeedsSettlement.selector, 1));
        vault.processWithdrawals(1);
        engine.clearValue(1);
        engine.setStale(1, true);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.StalePrice.selector, 1));
        vault.processWithdrawals(1);
        assertEq(vault.claimable(alice), 0);
        assertEq(vault.totalShares(), 100_000_000);

        engine.setStale(1, false);
        vm.prank(guardian);
        vault.setFundingPaused(true); // pausing new finance never stops withdrawals
        assertEq(_process(1), 1);
        assertEq(vault.claimable(alice), 30_000_000);
    }

    function test_pendingOpen_blocksProcessingDepositsAndBurns_untilItResolves() public {
        _deposit(alice, 100 * USDC1);
        _seedTargets();
        engine.reserveOpen(1, trader1, 10 * USDC1); // gross advanced, not yet confirmed
        _request(alice, 10 * USDC1); // enqueueing only locks shares

        vm.prank(keeper);
        vm.expectRevert(MarginVault.PendingOpensBlockAccounting.selector);
        vault.processWithdrawals(1);

        engine.cancelOpen(1);
        assertEq(_process(1), 1);
        assertEq(vault.claimable(alice), 10_000_000);

        // deposits and burns are blocked by a pending open as well (queue is empty again here)
        engine.reserveOpen(2, trader1, 10 * USDC1);
        usdc.mint(bob, 1 * USDC1);
        vm.startPrank(bob);
        usdc.approve(address(vault), type(uint256).max);
        bytes32 m = vault.MANDATE_HASH();
        vm.expectRevert(MarginVault.PendingOpensBlockAccounting.selector);
        vault.deposit(1 * USDC1, 0, m);
        vm.expectRevert(MarginVault.PendingOpensBlockAccounting.selector);
        vault.burnWorthlessShares(1);
        vm.stopPrank();
    }

    function test_hostileCallers_cannotMoveCashOrChangeRequests() public {
        _deposit(alice, 100 * USDC1);
        _request(alice, 40 * USDC1);
        // a stranger can run the processor but cannot change who is paid
        _process(1);
        assertEq(vault.claimable(alice), 40_000_000);
        assertEq(vault.claimable(keeper), 0);
        assertEq(usdc.balanceOf(keeper), 0);
        vm.prank(keeper);
        vm.expectRevert(MarginVault.NothingToClaim.selector);
        vault.claim();
        // the request owner is fixed at creation: nobody else can lock or move alice's shares
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.InsufficientShares.selector, 0, 1));
        vault.requestWithdraw(1);
    }
}
