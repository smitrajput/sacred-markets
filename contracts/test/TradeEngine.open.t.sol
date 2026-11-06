// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {MarginVault} from "../src/MarginVault.sol";
import {TradeEngine} from "../src/TradeEngine.sol";
import {DemoPriceGuard} from "../src/DemoPriceGuard.sol";
import {ISpotVenue} from "../src/interfaces/ISpotVenue.sol";
import {IDemoPriceGuard} from "../src/interfaces/IDemoPriceGuard.sol";
import {EngineBase} from "./EngineBase.sol";

contract DemoPriceGuardTest is EngineBase {
    function test_onlyThePriceAdminUpdates_keepersAndEveryoneElseCannot() public {
        vm.startPrank(keeper);
        vm.expectRevert(DemoPriceGuard.NotPriceAdmin.selector);
        guard.update(P100K, block.timestamp);
        vm.stopPrank();
        vm.expectRevert(DemoPriceGuard.NotPriceAdmin.selector);
        guard.update(P100K, block.timestamp);
        assertEq(guard.price(), P100K, "rejected calls changed nothing");
    }

    function test_priceDomain_isEnforcedAtBothEnds() public {
        vm.startPrank(priceAdmin);
        vm.expectRevert(abi.encodeWithSelector(DemoPriceGuard.PriceOutOfDomain.selector, 0));
        guard.update(0, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(DemoPriceGuard.PriceOutOfDomain.selector, 1e6 - 1));
        guard.update(1e6 - 1, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(DemoPriceGuard.PriceOutOfDomain.selector, 1e13 + 1));
        guard.update(1e13 + 1, block.timestamp);
        guard.update(1e6, block.timestamp);
        assertEq(guard.price(), 1e6);
        guard.update(1e13, block.timestamp);
        assertEq(guard.price(), 1e13);
        vm.stopPrank();
    }

    function test_timestamps_futureAndBackwardsAreRejected_andFreshnessEdgesAreExact() public {
        vm.warp(START + 1_000);
        vm.startPrank(priceAdmin);
        vm.expectRevert(abi.encodeWithSelector(DemoPriceGuard.FutureTimestamp.selector, block.timestamp + 1, block.timestamp));
        guard.update(P100K, block.timestamp + 1);
        guard.update(P100K, block.timestamp - 100);
        vm.expectRevert(abi.encodeWithSelector(DemoPriceGuard.TimestampWentBackwards.selector, block.timestamp - 101, block.timestamp - 100));
        guard.update(P100K, block.timestamp - 101);
        vm.stopPrank();
        uint256 t = guard.timestamp();
        vm.warp(t + 86_400);
        assertTrue(guard.fresh(), "age == maxAge is fresh");
        vm.warp(t + 86_401);
        assertFalse(guard.fresh(), "one second older is stale");
        (uint256 p, uint256 ts, bool f) = guard.read();
        assertEq(p, P100K);
        assertEq(ts, t);
        assertFalse(f);
    }

    function test_aNeverUpdatedGuard_isNotFresh_andConfigIsValidated() public {
        DemoPriceGuard g = new DemoPriceGuard(priceAdmin, 86_400);
        assertFalse(g.fresh());
        vm.expectRevert(DemoPriceGuard.InvalidConfig.selector);
        new DemoPriceGuard(address(0), 86_400);
        vm.expectRevert(DemoPriceGuard.InvalidConfig.selector);
        new DemoPriceGuard(priceAdmin, 0);
        vm.expectRevert(DemoPriceGuard.InvalidConfig.selector);
        new DemoPriceGuard(priceAdmin, 1 days + 1);
    }
}

contract TradeEngineOpenTest is EngineBase {
    function test_open_atDemoScale_recordsThePolicyNumbers_andSplitsCustodyCorrectly() public {
        uint256 traderBefore = usdc.balanceOf(trader);
        uint256 id = _open(trader, E_DEMO);

        TradeEngine.Position memory p = engine.getPosition(id);
        assertEq(p.trader, trader);
        assertEq(uint8(p.status), uint8(TradeEngine.Status.Active));
        assertEq(p.principal0, 100_000);
        assertEq(p.markup0, 383, "100000 * 10% * 14/365 floored");
        assertEq(p.grossCost, 200_000);
        assertEq(p.collateral, 200, "200000 micro-USDC at 100,000 USDC per BTC");
        assertEq(p.maturesAt, p.openedAt + 1_209_600);
        assertEq(p.termsHash, engine.policyTermsHash());
        (,, uint256 total) = engine.debtOf(id);
        assertEq(total, 100_383);

        assertEq(usdc.balanceOf(trader), traderBefore - E_DEMO, "the trader paid exactly E");
        assertEq(btc.balanceOf(address(engine)), 200, "pledged BTC is custodied by the engine");
        assertEq(usdc.balanceOf(address(venue)), 1e15 + 200_000, "the gross purchase went to the venue");
        MarginVault.VaultState memory s = vault.vaultState();
        assertEq(s.outstandingPrincipal, 100_000);
        assertEq(s.depositorIdleCash, 10 * USDC1 - 100_000, "net idle falls by P only");
        assertEq(s.nav, 10 * USDC1, "opening does not move NAV");
        assertEq(vault.commitments(), 0);
        assertEq(vault.pendingGrossCash(), 0);
        assertTrue(vault.isFullyBacked());
        assertEq(engine.activeCount(), 1);
        _assertEngineClean();
    }

    function test_open_recordsAcquisitionThenDisclosureThenPledge_inThatOrder() public {
        vm.recordLogs();
        _open(trader, E_DEMO);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32[4] memory want = [
            TradeEngine.AssetAcquired.selector,
            TradeEngine.DisclosedSaleAgreed.selector,
            TradeEngine.Pledged.selector,
            TradeEngine.Opened.selector
        ];
        uint256 k;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(engine)) continue;
            if (k < 4 && logs[i].topics[0] == want[k]) k++;
        }
        assertEq(k, 4, "AssetAcquired, DisclosedSaleAgreed, Pledged, Opened in order");
    }

    function test_open_vaultFundsTheFullGross_beforeAnyTraderEquityIsCollected() public {
        venue.watch(trader, vault);
        uint256 traderBefore = usdc.balanceOf(trader);
        _open(trader, E_DEMO);
        assertEq(venue.vaultPendingGrossAtBuy(), 200_000, "the vault had already advanced 2P when the purchase ran");
        assertEq(venue.traderUsdcAtBuy(), traderBefore, "the trader had not paid anything yet");
    }

    function test_open_failedEquityCollection_rollsBackTheWholeSequence() public {
        address broke = makeAddr("broke");
        usdc.mint(broke, 50_000); // less than E, and no allowance
        vm.prank(broke);
        usdc.approve(address(engine), type(uint256).max);
        uint256 idle = vault.depositorIdleCash();
        uint256 venueUsdc = usdc.balanceOf(address(venue));
        uint256 vaultCash = usdc.balanceOf(address(vault));
        vm.prank(broke);
        vm.expectRevert(); // ERC20InsufficientBalance when equity is pulled after the acquisition
        engine.open(E_DEMO, 0, _deadline(), terms);

        assertEq(vault.depositorIdleCash(), idle);
        assertEq(vault.pendingGrossCash(), 0);
        assertEq(vault.commitments(), 0);
        assertEq(vault.pendingOpens(), 0);
        assertEq(usdc.balanceOf(address(venue)), venueUsdc, "the purchase was undone");
        assertEq(usdc.balanceOf(address(vault)), vaultCash);
        assertEq(btc.balanceOf(address(engine)), 0);
        assertEq(engine.activeCount(), 0);
        assertEq(uint8(engine.getPosition(1).status), uint8(TradeEngine.Status.None));
    }

    function test_open_failedVenue_rollsBackTheReservation() public {
        venue.setFailBuy(true);
        uint256 idle = vault.depositorIdleCash();
        vm.prank(trader);
        vm.expectRevert(MockSpotVenueForced);
        engine.open(E_DEMO, 0, _deadline(), terms);
        assertEq(vault.depositorIdleCash(), idle);
        assertEq(vault.pendingGrossCash(), 0);
        assertEq(vault.pendingOpens(), 0);
        assertEq(usdc.balanceOf(trader), 100 * USDC1);
    }

    function test_open_validation_termsDeadlineDustAndStalePrice() public {
        bytes32 h = terms;
        vm.startPrank(trader);
        vm.expectRevert(abi.encodeWithSelector(TradeEngine.TermsMismatch.selector, h, bytes32(uint256(1))));
        engine.open(E_DEMO, 0, _deadline(), bytes32(uint256(1)));
        vm.expectRevert(abi.encodeWithSelector(TradeEngine.Expired.selector, block.timestamp - 1));
        engine.open(E_DEMO, 0, block.timestamp - 1, h);
        vm.expectRevert(abi.encodeWithSelector(TradeEngine.BelowDust.selector, 9_999, 10_000));
        engine.open(9_999, 0, _deadline(), h);
        vm.expectRevert(abi.encodeWithSelector(TradeEngine.BelowDust.selector, 0, 10_000));
        engine.open(0, 0, _deadline(), h);
        vm.stopPrank();

        vm.warp(block.timestamp + 86_401); // price is now stale
        vm.prank(trader);
        vm.expectRevert(TradeEngine.StalePrice.selector);
        engine.open(E_DEMO, 0, block.timestamp + 1 hours, h);
    }

    function test_open_termsHashBindsChainAddressAndPolicy() public {
        TradeEngine other = new TradeEngine(vault, ISpotVenue(address(venue)), IDemoPriceGuard(address(guard)), 300, 10_000);
        TradeEngine looser = new TradeEngine(vault, ISpotVenue(address(venue)), IDemoPriceGuard(address(guard)), 460, 10_000);
        assertTrue(other.termsHash() != engine.termsHash(), "bound to the engine address");
        assertTrue(looser.termsHash() != other.termsHash(), "bound to the friction policy");
    }

    function test_open_strictestMinimumWins_andAnUnwiredEngineRefuses() public {
        // oracle minimum is 194 atoms; the venue delivers 192 with a 400 bps cost -> the venue enforces the floor
        venue.set(P100K, 400);
        vm.prank(trader);
        vm.expectRevert();
        engine.open(E_DEMO, 0, _deadline(), terms);
        venue.set(P100K, 0);
        // a caller floor above what the venue can deliver also reverts
        vm.prank(trader);
        vm.expectRevert();
        engine.open(E_DEMO, 201, _deadline(), terms);

        TradeEngine unwired = new TradeEngine(vault, ISpotVenue(address(venue)), IDemoPriceGuard(address(guard)), 300, 10_000);
        bytes32 h = unwired.termsHash();
        vm.prank(trader);
        vm.expectRevert(TradeEngine.NotWired.selector);
        unwired.open(E_DEMO, 0, _deadline(), h);
    }

    function test_open_isBlockedByThePauseAndByAnUnfilledWithdrawalQueue_andRollsBackCleanly() public {
        vm.prank(guardian);
        vault.setFundingPaused(true);
        vm.prank(trader);
        vm.expectRevert(MarginVault.FundingIsPaused.selector);
        engine.open(E_DEMO, 0, _deadline(), terms);
        vm.prank(guardian);
        vault.setFundingPaused(false);

        vm.prank(alice);
        vault.requestWithdraw(1 * USDC1);
        vm.prank(trader);
        vm.expectRevert(MarginVault.WithdrawalQueueNotEmpty.selector);
        engine.open(E_DEMO, 0, _deadline(), terms);
        assertEq(engine.activeCount(), 0);
        assertEq(vault.pendingGrossCash(), 0);

        vault.processWithdrawals(1); // idle cash fills the request, the queue empties
        _open(trader, E_DEMO);
        assertEq(engine.activeCount(), 1);
    }

    function test_positionValue_isConservative_neverReverts_andDrivesTheVaultScan() public {
        uint256 id = _open(trader, E_DEMO);
        (uint256 net, bool fresh) = engine.positionValue(id);
        assertEq(net, 194_000, "floor(200 atoms at 100k = 200000 * 9700 / 10000)");
        assertTrue(fresh);

        // price falls so the conservative value drops below the remaining principal: deposits need settlement first
        _price(P100K / 3);
        (net, fresh) = engine.positionValue(id);
        assertEq(net, 64_666); // floor(66_666 * 0.97)
        assertTrue(fresh);
        usdc.mint(stranger, 1 * USDC1);
        vm.startPrank(stranger);
        usdc.approve(address(vault), 1 * USDC1);
        bytes32 mandate = vault.MANDATE_HASH();
        vm.expectRevert(abi.encodeWithSelector(MarginVault.AccountingNeedsSettlement.selector, id));
        vault.deposit(1 * USDC1, 0, mandate);
        vm.stopPrank();

        // stale: the view reports not-fresh without reverting, and the vault scan fails closed
        vm.warp(block.timestamp + 86_401);
        (, fresh) = engine.positionValue(id);
        assertFalse(fresh);
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.StalePrice.selector, id));
        vault.deposit(1 * USDC1, 0, mandate);
        vm.stopPrank();
        (net, fresh) = engine.positionValue(999);
        assertFalse(fresh, "unknown ids are reported not fresh, not reverted");
    }
    function test_open_isBlockedWhileAnExistingPositionIsImpaired_andRecoversAfterRepayment() public {
        uint256 id = _open(trader, E_DEMO);
        address t2 = makeAddr("t2");
        _trader(t2, 10 * USDC1);
        _price(40_000e6); // conservative value 77,600 against remaining principal 100,000
        bytes32 h = terms;
        vm.prank(t2);
        vm.expectRevert(abi.encodeWithSelector(MarginVault.AccountingNeedsSettlement.selector, id));
        engine.open(E_DEMO, 0, _deadline(), h);
        assertEq(engine.activeCount(), 1);
        assertEq(vault.pendingGrossCash(), 0);

        _pay(stranger, id, 25_000); // remaining 75,000 is covered by 77,600: the position is no longer impaired
        _open(t2, E_DEMO);
        assertEq(engine.activeCount(), 2);
    }
    /// @dev InitialCoverage is reachable at small equities: BTC atom rounding alone (zero execution cost) can leave the
    /// position under 190%. These boundaries are exact; rejections leave nothing behind.
    function test_initialCoverage_smallEquityBoundaries_validAndInvalid_withRollback() public {
        // E, expected atoms, coverage in bps (independently worked out) and whether open must succeed
        uint256[4] memory equities = [uint256(10_486), 10_487, 10_499, 10_500];
        uint256[4] memory atomsWant = [uint256(20), 20, 20, 21];
        uint256[4] memory bpsWant = [uint256(19_000), 18_998, 18_977, 19_924];
        bool[4] memory valid = [true, false, false, true];
        for (uint256 i; i < 4; i++) {
            (uint256 atoms, uint256 bps) = _expectedInitialCoverage(equities[i], P100K, 0);
            assertEq(atoms, atomsWant[i], "atoms");
            assertEq(bps, bpsWant[i], "coverage");
            Rollback memory r = _rollbackSnapshot(trader);
            if (valid[i]) {
                uint256 id = _open(trader, equities[i]);
                assertEq(engine.coverageBps(id), bpsWant[i]);
                assertEq(engine.getPosition(id).collateral, atomsWant[i]);
            } else {
                vm.prank(trader);
                vm.expectRevert(abi.encodeWithSelector(TradeEngine.InitialCoverage.selector, bpsWant[i]));
                engine.open(equities[i], 0, _deadline(), terms);
                _assertRolledBack(trader, r);
            }
        }
        assertEq(engine.activeCount(), 2, "only the two valid opens exist");
        _assertEngineClean();

        // the oracle minimum alone does not guarantee 190%: at E = 10,000 with a 300 bps venue cost the venue returns
        // 19 atoms, which meets the oracle minimum (19) but gives 18,928 bps (190,000,000 / 10,038)
        venue.set(P100K, 300);
        Rollback memory r2 = _rollbackSnapshot(trader);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(TradeEngine.InitialCoverage.selector, 18_928));
        engine.open(10_000, 0, _deadline(), terms);
        _assertRolledBack(trader, r2);
    }

    /// @dev A venue that calls back into the engine mid-purchase and mid-sale cannot reach any financial entry point.
    function test_reentrancy_nestedFinancialCallsDuringBuyAndSellAreRejected_outerCustodyIsCorrect() public {
        bytes4 guardSelector = bytes4(keccak256("ReentrancyGuardReentrantCall()"));
        bytes[2] memory nested = [
            abi.encodeCall(engine.open, (E_DEMO, 0, block.timestamp + 1 hours, terms)),
            abi.encodeCall(engine.repay, (uint256(1), uint256(1)))
        ];

        address t2 = makeAddr("t2");
        _trader(t2, 10 * USDC1);
        // (a) during the purchase of a real open: both nested calls are rejected, the outer open completes cleanly
        for (uint256 i; i < 2; i++) {
            venue.armReentry(address(engine), nested[i], false);
            uint256 before = venue.reentries();
            uint256 id = _open(i == 0 ? trader : t2, E_DEMO);
            assertEq(venue.reentries(), before + 1, "the venue did attempt the nested call");
            assertFalse(venue.lastReentryOk());
            assertEq(venue.lastReentrySelector(), guardSelector, "rejected by the reentrancy guard");
            assertEq(uint8(engine.getPosition(id).status), uint8(TradeEngine.Status.Active));
            _assertEngineClean();
            assertEq(vault.outstandingPrincipal(), E_DEMO * (i + 1));
        }

        // (b) during the sale of an owner close: nested repay on the same position and a nested close are rejected
        uint256 target = engine.activeIds()[0];
        bytes[2] memory nestedSell = [
            abi.encodeCall(engine.repay, (target, uint256(1))),
            abi.encodeCall(engine.ownerClose, (target, uint256(0), block.timestamp + 1 hours))
        ];
        for (uint256 j; j < 2; j++) {
            venue.armReentry(address(engine), nestedSell[j], false);
            uint256 live = engine.activeCount();
            address owner = engine.getPosition(target).trader;
            uint256 dl = _deadline();
            vm.prank(owner);
            engine.ownerClose(target, 0, dl);
            assertFalse(venue.lastReentryOk());
            assertEq(venue.lastReentrySelector(), guardSelector);
            assertEq(engine.activeCount(), live - 1, "the outer close completed exactly once");
            assertEq(uint8(engine.getPosition(target).status), uint8(TradeEngine.Status.Closed));
            _assertEngineClean();
            assertTrue(vault.isFullyBacked());
            if (j == 0) target = engine.activeIds()[0];
        }

        // (c) if the venue forwards the nested revert, the whole outer operation reverts and nothing is left behind
        venue.armReentry(address(engine), nested[0], true);
        Rollback memory r = _rollbackSnapshot(trader);
        vm.prank(trader);
        vm.expectRevert(guardSelector);
        engine.open(E_DEMO, 0, _deadline(), terms);
        _assertRolledBack(trader, r);
    }
}

/// @dev selector helper for the mock venue's forced failure
bytes4 constant MockSpotVenueForced = bytes4(keccak256("Forced()"));
