// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarginVault} from "../src/MarginVault.sol";
import {VaultBase} from "./VaultBase.sol";

/// @notice Deposits, share/NAV pricing, gates. Expectations are hand-computed from each test's own inputs.
contract MarginVaultDepositTest is VaultBase {
    // ---------------------------------------------------------------- initial funding and pricing

    function test_firstDeposit_mintsOneToOneInMicroUsdc() public {
        uint256 shares = _deposit(alice, 25 * USDC1);
        assertEq(shares, 25_000_000);
        assertEq(vault.sharesOf(alice), 25_000_000);
        assertEq(vault.totalShares(), 25_000_000);
        assertEq(usdc.balanceOf(address(vault)), 25_000_000);

        MarginVault.VaultState memory s = vault.vaultState();
        assertEq(s.depositorIdleCash, 25_000_000);
        assertEq(s.outstandingPrincipal, 0);
        assertEq(s.nav, 25_000_000);
        assertEq(s.totalShares, 25_000_000);
        assertEq(s.managerCash + s.primaryReserve + s.tailReserve + s.pilotBackstop + s.claimableWithdrawals, 0);
    }

    function test_secondDeposit_atParPricesOneToOne() public {
        _deposit(alice, 40 * USDC1);
        assertEq(_deposit(bob, 10 * USDC1), 10_000_000);
        assertEq(vault.totalShares(), 50_000_000);
        assertEq(vault.nav(), 50_000_000);
    }

    function test_deposit_afterCollectedMarkup_pricesAtPreDepositNav() public {
        _deposit(alice, 100 * USDC1);
        _seedTargets();
        _open(1, trader1, 10 * USDC1);
        engine.recordCollectedMarkup(1, 10 * USDC1); // 77% = 7.7 to LPs, 2.3 to the manager (reserves are full)
        assertEq(vault.nav(), 107_700_000);
        assertEq(vault.managerCash(), 2_300_000);
        // 21.54 USDC at 107.7 / 100 per share -> exactly 20 shares
        assertEq(_deposit(bob, 21_540_000), 20_000_000);
        assertEq(vault.totalShares(), 120_000_000);
        assertEq(vault.nav(), 129_240_000);
    }

    function test_deposit_afterPrincipalLoss_buysMoreSharesPerUsdc() public {
        _deposit(alice, 100 * USDC1);
        _seedTargets();
        _open(1, trader1, 10 * USDC1);
        engine.finalLoss(1, 0); // the whole 10 is lost; protection covers 1, LPs lose 9
        assertEq(vault.nav(), 91_000_000);
        assertEq(vault.liveCount(), 1); // still live at P = 0 until finalized
        // 9.1 USDC at 91 / 100 per share -> exactly 10 shares
        assertEq(_deposit(bob, 9_100_000), 10_000_000);
    }

    function test_deposit_roundsSharesDown_andHonoursMinShares() public {
        _deposit(alice, 100 * USDC1);
        _seedTargets();
        _open(1, trader1, 10 * USDC1);
        engine.recordCollectedMarkup(1, 3); // LP gets floor(3 * 0.77) = 2 atoms: NAV 100_000_002
        assertEq(vault.nav(), 100_000_002);
        usdc.mint(bob, 5);
        vm.startPrank(bob);
        usdc.approve(address(vault), 5);
        bytes32 m = vault.MANDATE_HASH();
        // floor(5 * 100e6 / 100_000_002) = 4 (4.9999999), not 5
        vm.expectRevert(abi.encodeWithSelector(MarginVault.SlippageExceeded.selector, 4, 5));
        vault.deposit(5, 5, m);
        assertEq(vault.deposit(5, 4, m), 4);
        vm.stopPrank();
    }

    function test_deposit_revertsWhenSharesWouldRoundToZero() public {
        _deposit(alice, 100 * USDC1);
        _seedTargets();
        _open(1, trader1, 10 * USDC1);
        engine.recordCollectedMarkup(1, 1_000 * USDC1); // LP share 770 USDC: NAV 870, shares 100
        assertEq(vault.nav(), 870_000_000);
        uint256 cash = usdc.balanceOf(address(vault));
        usdc.mint(bob, 1);
        vm.startPrank(bob);
        usdc.approve(address(vault), 1);
        bytes32 m = vault.MANDATE_HASH();
        vm.expectRevert(MarginVault.ZeroShares.selector);
        vault.deposit(1, 0, m); // floor(1 * 100e6 / 870e6) = 0
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(vault)), cash); // nothing taken
    }

    // ---------------------------------------------------------------- validation

    function test_deposit_rejectsWrongMandate_andZeroAmount() public {
        usdc.mint(alice, 10 * USDC1);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        bytes32 m = vault.MANDATE_HASH();
        vm.expectRevert(abi.encodeWithSelector(MarginVault.MandateMismatch.selector, m, bytes32(uint256(1))));
        vault.deposit(10 * USDC1, 0, bytes32(uint256(1)));
        vm.expectRevert(MarginVault.ZeroAmount.selector);
        vault.deposit(0, 0, m);
        vm.stopPrank();
        assertEq(vault.totalShares(), 0);
    }

    function test_mandateHash_commitsToTheFixedTerms() public view {
        bytes32 expected = keccak256(
            "sacred.mandate.v1|exposure=2x|term=1209600s|annualMarkupBps=1000|lpMarkupBps=7700|managerMarkupBps=2300|split=collected-markup-only|lateGrowth=none|traderProfitShare=none"
        );
        assertEq(vault.MANDATE_HASH(), expected);
    }

    function test_depositTransferShortfall_reverts() public {
        usdc.setFeeBps(100);
        usdc.mint(alice, 1 * USDC1);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        bytes32 m = vault.MANDATE_HASH();
        vm.expectRevert(abi.encodeWithSelector(MarginVault.TransferShort.selector, 1_000_000, 990_000));
        vault.deposit(1 * USDC1, 0, m);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- pause and queue

    function test_pause_isGuardianOnly_andBlocksDepositsUntilResumed() public {
        vm.prank(alice);
        vm.expectRevert(MarginVault.NotGuardian.selector);
        vault.setFundingPaused(true);

        vm.prank(guardian);
        vault.setFundingPaused(true);
        usdc.mint(alice, 10 * USDC1);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        bytes32 m = vault.MANDATE_HASH();
        vm.expectRevert(MarginVault.FundingIsPaused.selector);
        vault.deposit(10 * USDC1, 0, m);
        vm.stopPrank();

        vm.prank(guardian);
        vault.setFundingPaused(false);
        vm.prank(alice);
        assertEq(vault.deposit(10 * USDC1, 0, m), 10_000_000);
    }

    function test_unfilledWithdrawalQueue_blocksDeposits() public {
        _deposit(alice, 10 * USDC1);
        vm.prank(alice);
        uint256 requestId = vault.requestWithdraw(4 * USDC1);
        assertEq(requestId, 0);
        assertEq(vault.lockedShares(alice), 4_000_000);
        assertEq(vault.totalShares(), 10_000_000); // locked shares stay in supply until filled

        usdc.mint(bob, 1 * USDC1);
        vm.startPrank(bob);
        usdc.approve(address(vault), type(uint256).max);
        bytes32 m = vault.MANDATE_HASH();
        vm.expectRevert(MarginVault.WithdrawalQueueNotEmpty.selector);
        vault.deposit(1 * USDC1, 0, m);
        vm.stopPrank();
    }

    function test_requestWithdraw_onlyUnlockedShares() public {
        _deposit(alice, 10 * USDC1);
        vm.startPrank(alice);
        vault.requestWithdraw(4 * USDC1);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.InsufficientShares.selector, 6_000_000, 7_000_000));
        vault.requestWithdraw(7 * USDC1);
        vm.expectRevert(MarginVault.ZeroAmount.selector);
        vault.requestWithdraw(0);
        assertEq(vault.requestWithdraw(6 * USDC1), 1); // second request gets the next queue slot
        vm.stopPrank();
        (address owner, uint256 shares) = vault.withdrawalRequests(1);
        assertEq(owner, alice);
        assertEq(shares, 6_000_000);
        assertEq(vault.queueHead(), 0);
        assertEq(vault.queueTail(), 2);
    }

    // ---------------------------------------------------------------- donations

    function test_directDonation_changesNeitherNavNorSharePrice() public {
        _deposit(alice, 10 * USDC1);
        usdc.mint(carol, 7 * USDC1);
        vm.prank(carol);
        usdc.transfer(address(vault), 7 * USDC1); // unsolicited donation

        assertEq(usdc.balanceOf(address(vault)), 17_000_000);
        assertEq(vault.nav(), 10_000_000);
        assertEq(vault.totalShares(), 10_000_000);
        assertEq(vault.sharesOf(carol), 0);
        // bob is priced at recorded NAV, so he gets 10 shares for 10 USDC, not 10 * 10 / 17
        assertEq(_deposit(bob, 10 * USDC1), 10_000_000);
        assertTrue(vault.isFullyBacked());
    }

    function test_donation_isNeverLendable() public {
        _deposit(alice, 100 * USDC1);
        _seedTargets();
        uint256 headroomBefore = vault.financingHeadroom();
        usdc.mint(carol, 50 * USDC1);
        vm.prank(carol);
        usdc.transfer(address(vault), 50 * USDC1);
        assertEq(vault.financingHeadroom(), headroomBefore);
        // and the per-account cap still binds first
        vm.expectRevert(
            abi.encodeWithSelector(MarginVault.AccountCapExceeded.selector, trader1, CAP + 1)
        );
        engine.openFull(1, trader1, CAP + 1);
    }

    // ---------------------------------------------------------------- impairment gate

    function _twoLivePositions() internal {
        _deposit(alice, 100 * USDC1);
        _seedTargets();
        _open(1, trader1, 10 * USDC1);
        _open(2, trader2, 10 * USDC1);
    }

    function _bobTriesDeposit(uint256 amount) internal returns (bool ok, bytes memory ret) {
        usdc.mint(bob, amount);
        vm.startPrank(bob);
        usdc.approve(address(vault), type(uint256).max);
        (ok, ret) = address(vault).call(abi.encodeCall(MarginVault.deposit, (amount, 0, vault.MANDATE_HASH())));
        vm.stopPrank();
    }

    function test_gate_blocksDepositWhenAnyPositionIsBelowRemainingPrincipal() public {
        _twoLivePositions();
        engine.setValue(2, 10 * USDC1 - 1); // one atom below remaining principal
        (bool ok, bytes memory ret) = _bobTriesDeposit(5 * USDC1);
        assertFalse(ok);
        assertEq(bytes4(ret), MarginVault.AccountingNeedsSettlement.selector);
        assertEq(abi.decode(_args(ret), (uint256)), 2);
    }

    function test_gate_valueEqualToRemainingPrincipalPasses() public {
        _twoLivePositions();
        engine.setValue(1, 10 * USDC1);
        engine.setValue(2, 10 * USDC1);
        (bool ok,) = _bobTriesDeposit(5 * USDC1);
        assertTrue(ok);
    }

    function test_gate_stalePriceBlocksDeposit() public {
        _twoLivePositions();
        engine.setStale(1, true);
        (bool ok, bytes memory ret) = _bobTriesDeposit(5 * USDC1);
        assertFalse(ok);
        assertEq(bytes4(ret), MarginVault.StalePrice.selector);
        engine.setStale(1, false);
        (ok,) = _bobTriesDeposit(5 * USDC1);
        assertTrue(ok);
    }

    function test_gate_wallet_repayment_isNeverGated_andRestoresDepositsOnlyWhenValueCoversRemaining() public {
        _twoLivePositions();
        engine.setValue(2, 5 * USDC1); // worth half its 10 USDC principal
        (bool ok,) = _bobTriesDeposit(1 * USDC1);
        assertFalse(ok);

        engine.repayPrincipal(2, 5 * USDC1); // repayment goes through while impaired
        assertEq(vault.outstandingPrincipal(), 15_000_000);
        (ok,) = _bobTriesDeposit(1 * USDC1); // remaining 5 USDC is now covered by a value of 5 USDC
        assertTrue(ok);

        engine.setValue(2, 5 * USDC1 - 1); // value slips below the remaining 5 USDC again
        (bool blocked, bytes memory ret) = _bobTriesDeposit(1 * USDC1);
        assertFalse(blocked);
        assertEq(abi.decode(_args(ret), (uint256)), 2);
    }

    function test_gate_settlementThenDepositPricesAtPostLossNav() public {
        _twoLivePositions();
        engine.setValue(2, 5 * USDC1);
        (bool ok,) = _bobTriesDeposit(1);
        assertFalse(ok);

        engine.finalLoss(2, 5 * USDC1); // 5 returned, the other 5 lost: protection covers 1, LPs lose 4
        engine.finalizePosition(2);
        assertEq(vault.nav(), 96_000_000);
        assertEq(vault.liveCount(), 1);
        // 9.6 USDC at 96 / 100 per share -> exactly 10 shares
        usdc.mint(bob, 9_600_000);
        vm.startPrank(bob);
        usdc.approve(address(vault), 9_600_000);
        assertEq(vault.deposit(9_600_000, 0, vault.MANDATE_HASH()), 10_000_000);
        vm.stopPrank();
    }

    function test_gate_scansAllLivePositionsAfterEarlierOnesClose() public {
        _twoLivePositions();
        engine.repayPrincipal(1, 10 * USDC1);
        engine.finalizePosition(1); // id 2 is swap-popped into slot 0
        assertEq(vault.liveCount(), 1);
        assertEq(vault.liveIdAt(0), 2);
        engine.setValue(2, 1);
        (bool ok, bytes memory ret) = _bobTriesDeposit(1 * USDC1);
        assertFalse(ok);
        assertEq(abi.decode(_args(ret), (uint256)), 2);
    }

    function _args(bytes memory ret) internal pure returns (bytes memory out) {
        out = new bytes(ret.length - 4);
        for (uint256 i; i < out.length; i++) out[i] = ret[i + 4];
    }

    // ---------------------------------------------------------------- stale price on a principal-zero position

    function test_gate_scansPrincipalZeroPositionsToo_whileRepaymentFinalizationMarkupAndClaimsStayIndependent() public {
        _twoLivePositions();
        engine.repayPrincipal(1, 10 * USDC1); // position 1: P = 0, markup may still be owed, still live
        assertEq(vault.liveCount(), 2);
        // A reserved withdrawal exists before the price goes stale.
        vm.prank(alice);
        vault.requestWithdraw(5 * USDC1);
        engine.setValue(2, 10 * USDC1); // position 2 healthy
        vault.processWithdrawals(1);
        uint256 reserved = vault.claimable(alice);
        assertEq(reserved, 5_000_000);

        engine.setStale(1, true); // only the P = 0 position goes stale
        (bool ok, bytes memory ret) = _bobTriesDeposit(1 * USDC1);
        assertFalse(ok);
        assertEq(bytes4(ret), MarginVault.StalePrice.selector);
        assertEq(abi.decode(_args(ret), (uint256)), 1);

        vm.prank(alice);
        vault.requestWithdraw(1 * USDC1);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.StalePrice.selector, 1));
        vault.processWithdrawals(1); // no new cash is reserved on a stale scan

        // Everything that must not depend on the oracle still works.
        engine.repayPrincipal(2, 4 * USDC1);
        engine.recordCollectedMarkup(1, 1 * USDC1); // collected markup on the stale P = 0 position
        vm.prank(alice);
        assertEq(vault.claim(), reserved); // already-reserved cash
        engine.finalizePosition(1);
        assertEq(vault.liveCount(), 1);
    }
}
