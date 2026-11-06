// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {V4SpotVenue} from "../../src/V4SpotVenue.sol";
import {ForkBase} from "./ForkBase.sol";

/// @notice Real USDC and cirBTC, real PoolManager and PositionManager, on a liquidity-limited pool.
/// The Sacred pool (3000/60) is full range and can never be partially filled. This test therefore uses the same two
/// real tokens in a different, otherwise-unused pool (fee 500, tick spacing 10) seeded over about +-6% of price. The
/// venue code is identical; only the immutable pool parameters differ. A swap larger than the range can absorb is a
/// genuine partial fill from the real PoolManager, and the whole operation must roll back, including the USDC input
/// that was already pulled and the native-backed USDC movements.
contract V4SpotVenueForkRealTokensNarrowTest is ForkBase {
    uint24 internal constant NARROW_FEE = 500;
    int24 internal constant NARROW_SPACING = 10;

    PoolKey internal key;
    V4SpotVenue internal venue;
    address internal engine;

    function setUp() public {
        _fork();
        key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(CIRBTC),
            fee: NARROW_FEE,
            tickSpacing: NARROW_SPACING,
            hooks: IHooks(address(0))
        });
        uint160 sqrtP = _initialSqrtPrice();
        int24 center = TickMath.getTickAtSqrtPrice(sqrtP);
        center = (center / NARROW_SPACING) * NARROW_SPACING;
        _initializeAndSeed(key, sqrtP, center - 600, center + 600, 10e6, _btcAtomsForUsdc(10e6));

        engine = makeAddr("engine");
        venue = new V4SpotVenue(POOL_MANAGER, USDC, CIRBTC, NARROW_FEE, NARROW_SPACING, address(this));
        venue.bindEngine(engine);
        _forkOnlyFund(USDC, engine, 5_000e6);
        _forkOnlyFund(CIRBTC, engine, 5e6);
        vm.startPrank(engine);
        IERC20(USDC).approve(address(venue), type(uint256).max);
        IERC20(CIRBTC).approve(address(venue), type(uint256).max);
        vm.stopPrank();
    }

    struct Snap {
        uint256 engUsdc;
        uint256 engBtc;
        uint256 pmUsdc;
        uint256 pmBtc;
        uint256 venueUsdc;
        uint256 venueBtc;
    }

    function _snap() internal view returns (Snap memory s) {
        s.engUsdc = IERC20(USDC).balanceOf(engine);
        s.engBtc = IERC20(CIRBTC).balanceOf(engine);
        s.pmUsdc = IERC20(USDC).balanceOf(address(POOL_MANAGER));
        s.pmBtc = IERC20(CIRBTC).balanceOf(address(POOL_MANAGER));
        s.venueUsdc = IERC20(USDC).balanceOf(address(venue));
        s.venueBtc = IERC20(CIRBTC).balanceOf(address(venue));
    }

    function _assertSame(Snap memory x, Snap memory y) internal pure {
        assertEq(x.engUsdc, y.engUsdc, "engine USDC");
        assertEq(x.engBtc, y.engBtc, "engine cirBTC");
        assertEq(x.pmUsdc, y.pmUsdc, "PoolManager USDC");
        assertEq(x.pmBtc, y.pmBtc, "PoolManager cirBTC");
        assertEq(x.venueUsdc, y.venueUsdc, "venue USDC");
        assertEq(x.venueBtc, y.venueBtc, "venue cirBTC");
        assertEq(x.venueUsdc + x.venueBtc, 0, "venue empty");
    }

    function _dl() internal view returns (uint256) {
        return block.timestamp + 600;
    }

    function test_control_inRangeBuyAndSellSucceed() public {
        uint256 qBuy = _quote(key, true, 100_000);
        vm.prank(engine);
        uint256 got = venue.buyCirBtc(100_000, qBuy, _dl());
        assertEq(got, qBuy);
        uint256 qSell = _quote(key, false, got);
        vm.prank(engine);
        assertEq(venue.sellCirBtc(got, qSell, _dl()), qSell);
    }

    function test_buyBeyondRange_partialFillRevertsAndRollsBackUsdcAndCirBtc() public {
        Snap memory b = _snap();
        uint256 huge = 1_000e6; // 100x the USDC side of the pool
        vm.prank(engine);
        vm.expectPartialRevert(V4SpotVenue.IncompleteInput.selector);
        venue.buyCirBtc(huge, 1, _dl());
        _assertSame(_snap(), b);
    }

    function test_sellBeyondRange_partialFillRevertsAndRollsBackUsdcAndCirBtc() public {
        Snap memory b = _snap();
        uint256 huge = _btcAtomsForUsdc(1_000e6);
        vm.prank(engine);
        vm.expectPartialRevert(V4SpotVenue.IncompleteInput.selector);
        venue.sellCirBtc(huge, 1, _dl());
        _assertSame(_snap(), b);
    }

    function testFuzz_oversizedInputAlwaysRollsBack(uint256 amount, bool buy) public {
        // anything from 50x the pool side up to 4,000 USDC worth is far past the usable range
        uint256 usdcAmt = bound(amount, 500e6, 4_000e6);
        Snap memory b = _snap();
        vm.prank(engine);
        vm.expectPartialRevert(V4SpotVenue.IncompleteInput.selector);
        if (buy) venue.buyCirBtc(usdcAmt, 1, _dl());
        else venue.sellCirBtc(_btcAtomsForUsdc(usdcAmt), 1, _dl());
        _assertSame(_snap(), b);
    }
}
