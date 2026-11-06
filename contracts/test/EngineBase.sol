// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MarginVault} from "../src/MarginVault.sol";
import {TradeEngine} from "../src/TradeEngine.sol";
import {DemoPriceGuard} from "../src/DemoPriceGuard.sol";
import {ISpotVenue} from "../src/interfaces/ISpotVenue.sol";
import {IDemoPriceGuard} from "../src/interfaces/IDemoPriceGuard.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockSpotVenue} from "./mocks/MockSpotVenue.sol";

/// @notice Real MarginVault + real TradeEngine + real DemoPriceGuard with the narrow mock venue.
/// Demo sizing by default: ceiling 1 USDC, per-account cap 0.10, friction 300 bps, dust 0.01.
abstract contract EngineBase is Test {
    uint256 internal constant USDC1 = 1e6;
    uint256 internal constant P100K = 100_000e6; // 100,000 USDC per BTC, micro-USDC per whole BTC
    uint256 internal constant E_DEMO = 100_000; // 0.10 USDC equity
    uint256 internal constant START = 1_800_000_000;

    TestERC20 internal usdc;
    TestERC20 internal btc;
    MockSpotVenue internal venue;
    DemoPriceGuard internal guard;
    MarginVault internal vault;
    TradeEngine internal engine;
    bytes32 internal terms; // read once so it is never evaluated between a prank and the call it targets

    address internal deployer = makeAddr("deployer");
    address internal guardian = makeAddr("guardian");
    address internal treasury = makeAddr("treasury");
    address internal priceAdmin = makeAddr("priceAdmin");
    address internal keeper = makeAddr("keeper");
    address internal alice = makeAddr("alice"); // LP
    address internal trader = makeAddr("trader");
    address internal stranger = makeAddr("stranger");

    function setUp() public virtual {
        vm.warp(START);
        _stack(1 * USDC1, 100_000, 300, 10_000);
        _lp(10 * USDC1);
        _price(P100K);
        _trader(trader, 100 * USDC1);
    }

    /// @dev Builds the whole stack; engine is bound to both vault and venue exactly once.
    function _stack(uint256 ceiling, uint256 cap, uint256 friction, uint256 dust) internal {
        usdc = new TestERC20("USDC", "USDC", 6);
        btc = new TestERC20("cirBTC", "cirBTC", 8);
        venue = new MockSpotVenue(usdc, btc);
        guard = new DemoPriceGuard(priceAdmin, 86_400);
        vault = new MarginVault(IERC20(address(usdc)), guardian, treasury, deployer, ceiling, cap);
        engine = new TradeEngine(vault, ISpotVenue(address(venue)), IDemoPriceGuard(address(guard)), friction, dust);
        terms = engine.termsHash();
        venue.bindEngine(address(engine));
        vm.prank(deployer);
        vault.bindEngine(address(engine));
        usdc.mint(address(venue), 1e15); // venue USDC inventory for sells
        // reserves at target
        uint256 pT = vault.primaryTarget();
        uint256 tT = vault.tailTarget();
        usdc.mint(treasury, pT + tT);
        vm.startPrank(treasury);
        usdc.approve(address(vault), pT + tT);
        vault.seedProtection(MarginVault.ProtectionKind.Primary, pT);
        vault.seedProtection(MarginVault.ProtectionKind.Tail, tT);
        vm.stopPrank();
    }

    function _lp(uint256 amount) internal {
        usdc.mint(alice, amount);
        vm.startPrank(alice);
        usdc.approve(address(vault), amount);
        vault.deposit(amount, 0, vault.MANDATE_HASH());
        vm.stopPrank();
    }

    function _trader(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(engine), type(uint256).max);
    }

    /// @dev Reference price and matching venue execution (no extra friction).
    function _price(uint256 p) internal {
        vm.prank(priceAdmin);
        guard.update(p, block.timestamp);
        venue.set(p, 0);
    }

    function _open(address who, uint256 equity) internal returns (uint256 id) {
        vm.prank(who);
        id = engine.open(equity, 0, block.timestamp + 1 hours, terms);
    }

    /// @dev Independent arithmetic (does not use EngineMath): the BTC the venue returns for the gross purchase at
    /// `price` with `feeBps` of execution cost, and the initial coverage the engine must then measure.
    function _expectedInitialCoverage(uint256 equity, uint256 price, uint256 feeBps)
        internal
        pure
        returns (uint256 atoms, uint256 bps)
    {
        atoms = ((2 * equity * 1e8) / price) * (10_000 - feeBps) / 10_000;
        uint256 markup = (equity * 1_000 * 1_209_600) / (10_000 * 31_536_000);
        bps = ((atoms * price / 1e8) * 10_000) / (equity + markup);
    }

    struct Rollback {
        uint256 idle;
        uint256 traderUsdc;
        uint256 venueUsdc;
        uint256 btcSupply;
        uint256 active;
    }

    function _rollbackSnapshot(address who) internal view returns (Rollback memory r) {
        r = Rollback(vault.depositorIdleCash(), usdc.balanceOf(who), usdc.balanceOf(address(venue)), btc.totalSupply(), engine.activeCount());
    }

    function _assertRolledBack(address who, Rollback memory r) internal view {
        assertEq(vault.depositorIdleCash(), r.idle, "idle cash");
        assertEq(vault.pendingGrossCash(), 0, "no gross left pending");
        assertEq(vault.commitments(), 0, "no commitment left");
        assertEq(vault.pendingOpens(), 0, "no pending open");
        assertEq(usdc.balanceOf(who), r.traderUsdc, "trader paid nothing");
        assertEq(usdc.balanceOf(address(venue)), r.venueUsdc, "the purchase was undone");
        assertEq(btc.totalSupply(), r.btcSupply, "no BTC was kept");
        assertEq(btc.balanceOf(address(engine)), _pledged(), "engine BTC is only pledged collateral");
        assertEq(engine.activeCount(), r.active);
        assertEq(usdc.balanceOf(address(engine)), 0);
    }

    function _pledged() internal view returns (uint256 sum) {
        uint256[] memory ids = engine.activeIds();
        for (uint256 i; i < ids.length; i++) sum += engine.getPosition(ids[i]).collateral;
    }

    /// @dev Opens when the independently computed initial coverage from the ACTUAL fixture execution is at least 190%;
    /// otherwise asserts the exact InitialCoverage revert with a full rollback and reports `opened = false`.
    function _openChecked(address who, uint256 equity) internal returns (bool opened, uint256 id) {
        (, uint256 bps) = _expectedInitialCoverage(equity, guard.price(), venue.feeBps());
        if (bps < 19_000) {
            Rollback memory r = _rollbackSnapshot(who);
            vm.prank(who);
            vm.expectRevert(abi.encodeWithSelector(TradeEngine.InitialCoverage.selector, bps));
            engine.open(equity, 0, _deadline(), terms);
            _assertRolledBack(who, r);
            return (false, 0);
        }
        return (true, _open(who, equity));
    }

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 1 hours;
    }

    function _debt(uint256 id) internal view returns (uint256 total) {
        (,, total) = engine.debtOf(id);
    }

    function _pay(address payer, uint256 id, uint256 amount) internal {
        usdc.mint(payer, amount);
        vm.startPrank(payer);
        usdc.approve(address(engine), amount);
        engine.repay(id, amount);
        vm.stopPrank();
    }

    function _assertEngineClean() internal view {
        assertEq(usdc.balanceOf(address(engine)), 0, "engine holds no stranded USDC");
        uint256 sum;
        uint256[] memory ids = engine.activeIds();
        for (uint256 i; i < ids.length; i++) sum += engine.getPosition(ids[i]).collateral;
        assertEq(btc.balanceOf(address(engine)), sum, "engine BTC equals pledged collateral");
        assertEq(vault.liveCount(), ids.length, "vault and engine agree on live positions");
    }
}
