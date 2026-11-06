// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {V4SpotVenue} from "../../src/V4SpotVenue.sol";
import {TestERC20} from "../mocks/TestERC20.sol";
import {ForkBase} from "./ForkBase.sol";

/// @notice The same V4SpotVenue against the REAL PoolManager and PositionManager, on a fresh pool of two generic
/// ERC-20s whose balance changes roll back normally on revert. This covers what the USDC fork cannot: true rollback
/// of failed swaps, and a genuine partial fill from a liquidity-limited (narrow range) real pool. No mock swap anywhere.
contract V4SpotVenueForkRealPoolTest is ForkBase {
    TestERC20 internal t0;
    TestERC20 internal t1;
    PoolKey internal key;
    V4SpotVenue internal venue;
    address internal engine;

    int24 internal constant LOWER = -600; // multiples of 60, about +-6% around price 1
    int24 internal constant UPPER = 600;
    uint256 internal constant SEED = 1e12;
    uint256 internal constant ENGINE_FUNDS = 1e15;

    function setUp() public {
        _fork();
        TestERC20 a = new TestERC20("Token0", "T0", 6);
        TestERC20 b = new TestERC20("Token1", "T1", 8);
        (t0, t1) = address(a) < address(b) ? (a, b) : (b, a);
        key = PoolKey({
            currency0: Currency.wrap(address(t0)),
            currency1: Currency.wrap(address(t1)),
            fee: FEE,
            tickSpacing: SPACING,
            hooks: IHooks(address(0))
        });
        _initializeAndSeed(key, TickMath.getSqrtPriceAtTick(0), LOWER, UPPER, SEED, SEED);

        engine = makeAddr("engine");
        venue = new V4SpotVenue(POOL_MANAGER, address(t0), address(t1), FEE, SPACING, address(this));
        venue.bindEngine(engine);
        t0.mint(engine, ENGINE_FUNDS);
        t1.mint(engine, ENGINE_FUNDS);
        vm.startPrank(engine);
        t0.approve(address(venue), type(uint256).max);
        t1.approve(address(venue), type(uint256).max);
        vm.stopPrank();
    }

    struct Snap {
        uint256 e0;
        uint256 e1;
        uint256 pm0;
        uint256 pm1;
        uint256 v0;
        uint256 v1;
    }

    function _snap() internal view returns (Snap memory s) {
        s.e0 = t0.balanceOf(engine);
        s.e1 = t1.balanceOf(engine);
        s.pm0 = t0.balanceOf(address(POOL_MANAGER));
        s.pm1 = t1.balanceOf(address(POOL_MANAGER));
        s.v0 = t0.balanceOf(address(venue));
        s.v1 = t1.balanceOf(address(venue));
    }

    function _assertSame(Snap memory x, Snap memory y) internal pure {
        assertEq(x.e0, y.e0, "engine t0");
        assertEq(x.e1, y.e1, "engine t1");
        assertEq(x.pm0, y.pm0, "pm t0");
        assertEq(x.pm1, y.pm1, "pm t1");
        assertEq(x.v0, 0, "venue t0");
        assertEq(x.v1, 0, "venue t1");
    }

    function _dl() internal view returns (uint256) {
        return block.timestamp + 600;
    }

    function test_control_inRangeSwapsSucceedBothWays() public {
        uint256 qBuy = _quote(key, true, 1e9);
        Snap memory s0 = _snap();
        vm.prank(engine);
        uint256 got = venue.buyCirBtc(1e9, qBuy, _dl());
        assertEq(got, qBuy);
        Snap memory s1 = _snap();
        assertEq(s0.e0 - s1.e0, 1e9);
        assertEq(s1.e1 - s0.e1, got);
        assertEq(s1.pm0 - s0.pm0, 1e9);
        assertEq(s0.pm1 - s1.pm1, got);

        uint256 qSell = _quote(key, false, got);
        vm.prank(engine);
        uint256 back = venue.sellCirBtc(got, qSell, _dl());
        assertEq(back, qSell);
        assertLt(back, 1e9);
        Snap memory s2 = _snap();
        assertEq(s2.v0 + s2.v1, 0);
        assertEq(s2.e0 + s2.pm0, s0.e0 + s0.pm0);
        assertEq(s2.e1 + s2.pm1, s0.e1 + s0.pm1);
    }

    function test_incompleteInputFromLiquidityLimitedRealPool_revertsAndRollsBack() public {
        // The seeded range absorbs only a few percent of price; this input runs past its edge, the real PoolManager
        // consumes only part of it at the price limit, and the venue must refuse the partial fill.
        Snap memory b = _snap();
        uint256 tooBig = SEED * 10;
        vm.startPrank(engine);
        vm.expectPartialRevert(V4SpotVenue.IncompleteInput.selector);
        venue.buyCirBtc(tooBig, 1, _dl());
        vm.expectPartialRevert(V4SpotVenue.IncompleteInput.selector);
        venue.sellCirBtc(tooBig, 1, _dl());
        vm.stopPrank();
        _assertSame(_snap(), b);
    }

    function test_minOutAboveRealQuote_revertsAndRollsBack() public {
        Snap memory b = _snap();
        uint256 qb = _quote(key, true, 1e9);
        uint256 qs = _quote(key, false, 1e9);
        vm.startPrank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.InsufficientOutput.selector, qb, qb + 1));
        venue.buyCirBtc(1e9, qb + 1, _dl());
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.InsufficientOutput.selector, qs, qs + 1));
        venue.sellCirBtc(1e9, qs + 1, _dl());
        vm.stopPrank();
        _assertSame(_snap(), b);
    }

    function test_expiredDeadline_revertsAndRollsBack() public {
        Snap memory b = _snap();
        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.Expired.selector, block.timestamp - 1, block.timestamp));
        venue.buyCirBtc(1e9, 1, block.timestamp - 1);
        _assertSame(_snap(), b);
    }

    function testFuzz_realPool_boundsAndConservation(uint256 amount, uint256 slack, bool buy) public {
        amount = bound(amount, 1e3, 5e10); // stays inside the seeded range
        uint256 q = _quote(key, buy, amount);
        vm.assume(q > 0);
        Snap memory b = _snap();

        // minOut anywhere above the simulated output reverts with the exact values and changes nothing
        uint256 tooHigh = q + bound(slack, 1, 1e9);
        vm.startPrank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.InsufficientOutput.selector, q, tooHigh));
        if (buy) venue.buyCirBtc(amount, tooHigh, _dl());
        else venue.sellCirBtc(amount, tooHigh, _dl());
        _assertSame(_snap(), b);

        // any minOut in [1, q] succeeds with exactly q
        uint256 minOut = bound(slack, 1, q);
        uint256 out = buy ? venue.buyCirBtc(amount, minOut, _dl()) : venue.sellCirBtc(amount, minOut, _dl());
        vm.stopPrank();
        assertEq(out, q);

        Snap memory a = _snap();
        assertEq(a.v0 + a.v1, 0, "venue keeps nothing");
        assertEq(a.e0 + a.pm0, b.e0 + b.pm0, "token0 conserved");
        assertEq(a.e1 + a.pm1, b.e1 + b.pm1, "token1 conserved");
        if (buy) {
            assertEq(b.e0 - a.e0, amount);
            assertEq(a.e1 - b.e1, out);
        } else {
            assertEq(b.e1 - a.e1, amount);
            assertEq(a.e0 - b.e0, out);
        }
    }
}
