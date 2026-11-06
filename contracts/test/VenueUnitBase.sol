// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {V4SpotVenue} from "../src/V4SpotVenue.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";

/// @notice Shared unit-test setup. token0 plays USDC, token1 plays cirBTC; the PoolManager is an
/// inventory-backed unit-test mock (never used in fork tests). Fixed rate: buy out = in * 3 / 2, sell out = in * 2 / 3.
abstract contract VenueUnitBase is Test {
    TestERC20 internal usdc;
    TestERC20 internal btc;
    MockPoolManager internal pm;
    V4SpotVenue internal venue;

    address internal deployer = makeAddr("deployer");
    address internal engine = makeAddr("engine");
    address internal attacker = makeAddr("attacker");

    uint256 internal constant INVENTORY = 1e18;
    uint256 internal constant ENGINE_FUNDS = 1e15;

    function setUp() public virtual {
        TestERC20 a = new TestERC20("Token0", "T0", 6);
        TestERC20 b = new TestERC20("Token1", "T1", 8);
        (usdc, btc) = address(a) < address(b) ? (a, b) : (b, a);
        pm = new MockPoolManager();
        pm.setRate(3, 2);
        venue = _newVenue();

        usdc.mint(address(pm), INVENTORY);
        btc.mint(address(pm), INVENTORY);
        usdc.mint(engine, ENGINE_FUNDS);
        btc.mint(engine, ENGINE_FUNDS);
        vm.startPrank(engine);
        usdc.approve(address(venue), type(uint256).max);
        btc.approve(address(venue), type(uint256).max);
        vm.stopPrank();

        vm.prank(deployer);
        venue.bindEngine(engine);
    }

    function _newVenue() internal returns (V4SpotVenue) {
        return new V4SpotVenue(IPoolManager(address(pm)), address(usdc), address(btc), 3000, 60, deployer);
    }

    function _expectedBuy(uint256 inAmt) internal pure returns (uint256) {
        return (inAmt * 3) / 2;
    }

    function _expectedSell(uint256 inAmt) internal pure returns (uint256) {
        return (inAmt * 2) / 3;
    }

    struct Balances {
        uint256 engUsdc;
        uint256 engBtc;
        uint256 pmUsdc;
        uint256 pmBtc;
        uint256 venueUsdc;
        uint256 venueBtc;
        uint256 supplyUsdc;
        uint256 supplyBtc;
    }

    function _balances() internal view returns (Balances memory b) {
        b.engUsdc = usdc.balanceOf(engine);
        b.engBtc = btc.balanceOf(engine);
        b.pmUsdc = usdc.balanceOf(address(pm));
        b.pmBtc = btc.balanceOf(address(pm));
        b.venueUsdc = usdc.balanceOf(address(venue));
        b.venueBtc = btc.balanceOf(address(venue));
        b.supplyUsdc = usdc.totalSupply();
        b.supplyBtc = btc.totalSupply();
    }

    function _assertUnchanged(Balances memory a) internal view {
        Balances memory b = _balances();
        assertEq(b.engUsdc, a.engUsdc, "engine usdc");
        assertEq(b.engBtc, a.engBtc, "engine btc");
        assertEq(b.pmUsdc, a.pmUsdc, "pm usdc");
        assertEq(b.pmBtc, a.pmBtc, "pm btc");
        assertEq(b.venueUsdc, 0, "venue usdc");
        assertEq(b.venueBtc, 0, "venue btc");
    }

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 600;
    }
}
