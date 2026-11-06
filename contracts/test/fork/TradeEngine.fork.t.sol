// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MarginVault} from "../../src/MarginVault.sol";
import {TradeEngine} from "../../src/TradeEngine.sol";
import {DemoPriceGuard} from "../../src/DemoPriceGuard.sol";
import {V4SpotVenue} from "../../src/V4SpotVenue.sol";
import {ISpotVenue} from "../../src/interfaces/ISpotVenue.sol";
import {IDemoPriceGuard} from "../../src/interfaces/IDemoPriceGuard.sol";
import {ForkBase} from "./ForkBase.sol";

/// @notice Integration of the real MarginVault + TradeEngine + DemoPriceGuard with the real fixed V4SpotVenue on a pinned
/// Arc fork, using the real PoolManager/PositionManager and the real USDC and cirBTC. Balance setup is FORK-ONLY
/// (native deal for USDC, storage deal for cirBTC). Run only with scripts/test-arc-fork.sh. No live transactions.
contract TradeEngineForkTest is ForkBase {
    uint256 internal constant P100K = 100_000e6;

    V4SpotVenue internal venue;
    DemoPriceGuard internal guard;
    MarginVault internal vault;
    TradeEngine internal engine;
    address internal priceAdmin = makeAddr("priceAdmin");
    address internal treasury = makeAddr("treasury");
    address internal lp = makeAddr("lp");
    address internal trader = makeAddr("trader");
    address internal payer = makeAddr("payer");
    address internal keeper = makeAddr("keeper");
    bytes32 internal terms;

    function setUp() public {
        _fork();
        // 10 USDC + the matching cirBTC, full range, at the 100,000 USDC per BTC fixture
        _initializeAndSeed(_sacredKey(), _initialSqrtPrice(), MIN_USABLE_TICK, MAX_USABLE_TICK, 10 * 1e6, _btcAtomsForUsdc(10 * 1e6));

        venue = new V4SpotVenue(POOL_MANAGER, USDC, CIRBTC, FEE, SPACING, address(this));
        guard = new DemoPriceGuard(priceAdmin, 86_400);
        vault = new MarginVault(IERC20(USDC), makeAddr("guardian"), treasury, address(this), 1e6, 100_000);
        engine = new TradeEngine(vault, ISpotVenue(address(venue)), IDemoPriceGuard(address(guard)), 300, 10_000);
        terms = engine.termsHash();
        venue.bindEngine(address(engine));
        vault.bindEngine(address(engine));

        // fork-only funding
        _forkOnlyFund(USDC, treasury, 11_000); // never drain a nonce-0 account to exactly zero: Arc rejects "clear balance of empty account"
        _forkOnlyFund(USDC, lp, 11 * 1e6);
        _forkOnlyFund(USDC, trader, 1e6);
        _forkOnlyFund(USDC, payer, 1e6);
        vm.startPrank(treasury);
        IERC20(USDC).approve(address(vault), 10_000);
        vault.seedProtection(MarginVault.ProtectionKind.Primary, 4_000);
        vault.seedProtection(MarginVault.ProtectionKind.Tail, 6_000);
        vm.stopPrank();
        vm.startPrank(lp);
        IERC20(USDC).approve(address(vault), 10 * 1e6);
        vault.deposit(10 * 1e6, 0, vault.MANDATE_HASH());
        vm.stopPrank();
        vm.prank(trader);
        IERC20(USDC).approve(address(engine), type(uint256).max);
        vm.prank(priceAdmin);
        guard.update(P100K, block.timestamp);
    }

    function _open() internal returns (uint256 id) {
        vm.prank(trader);
        id = engine.open(100_000, 0, block.timestamp + 1 hours, terms);
    }

    function test_fork_open_fullRepaymentByAThirdParty_releasesTheBtcToTheTrader() public {
        uint256 id = _open();
        TradeEngine.Position memory p = engine.getPosition(id);
        assertGe(p.collateral, 194, "the real pool delivered at least the oracle minimum");
        assertEq(IERC20(CIRBTC).balanceOf(address(engine)), p.collateral, "BTC is custodied by the engine");
        assertEq(IERC20(USDC).balanceOf(address(engine)), 0);
        assertEq(IERC20(USDC).balanceOf(address(venue)), 0, "the venue holds nothing");
        assertEq(vault.outstandingPrincipal(), 100_000);
        assertEq(vault.pendingGrossCash(), 0);
        assertTrue(vault.isFullyBacked());

        uint256 debt = 100_383;
        vm.startPrank(payer);
        IERC20(USDC).approve(address(engine), debt);
        engine.repayAndRelease(id, debt);
        vm.stopPrank();

        assertEq(IERC20(CIRBTC).balanceOf(trader), p.collateral, "all pledged BTC returned to the original trader");
        assertEq(IERC20(CIRBTC).balanceOf(address(engine)), 0);
        assertEq(vault.liveCount(), 0);
        assertEq(vault.depositorIdleCash(), 10 * 1e6 + 294);
        assertEq(vault.managerCash(), 89);
        assertTrue(vault.isFullyBacked());
        assertEq(IERC20(USDC).balanceOf(address(engine)), 0);
    }

    function test_fork_coverageRebalance_sellsEnginePickedQuantity_throughTheRealPool() public {
        uint256 id = _open();
        uint256 collBefore = engine.getPosition(id).collateral;
        // the reference price falls to 80,000; the real pool is untouched, so the sale executes far above the oracle floor
        vm.prank(priceAdmin);
        guard.update(80_000e6, block.timestamp);
        (TradeEngine.Plan memory pl,) = engine.quoteRebalance(id, 0);
        assertTrue(pl.eligible);
        assertTrue(pl.isPartial);

        vm.prank(keeper);
        engine.rebalance(id, 0, block.timestamp + 1 hours);

        TradeEngine.Position memory p = engine.getPosition(id);
        assertEq(uint8(p.status), uint8(TradeEngine.Status.Active));
        assertEq(p.collateral, collBefore - pl.sellAtoms, "the engine chose the quantity");
        uint256 repaid = 100_000 - p.principal;
        assertGe(repaid, pl.minUsdc, "actual proceeds met the independent floor");
        assertGe(p.principal, 10_000, "left at least dust");
        assertEq(vault.outstandingPrincipal(), p.principal);
        assertGe((p.collateral * 80_000e6 / 1e8) * 10_000, (p.principal + p.markup) * 19_000, "back above 190%");
        assertEq(IERC20(CIRBTC).balanceOf(address(engine)), p.collateral);
        assertEq(IERC20(USDC).balanceOf(address(engine)), 0);
        assertEq(IERC20(USDC).balanceOf(address(keeper)), 0, "no keeper reward");
        assertTrue(vault.isFullyBacked());
    }
}
