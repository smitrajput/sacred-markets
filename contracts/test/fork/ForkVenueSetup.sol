// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";

import {V4SpotVenue} from "../../src/V4SpotVenue.sol";
import {ForkBase} from "./ForkBase.sol";

/// @notice Deploys V4SpotVenue on the pinned Arc Testnet fork, initializes and seeds the real USDC/cirBTC pool through
/// the real PositionManager (full range, ticks aligned to spacing 60), binds the engine once, and funds the engine
/// (fork-only, see ForkBase). Concrete subclasses pick the pool depth and trade size.
abstract contract ForkVenueSetup is ForkBase {
    using PoolIdLibrary for PoolKey;

    V4SpotVenue internal venue;
    PoolKey internal key;
    address internal engine;
    address internal attacker;
    uint256 internal seedLiquidityBefore;

    /// @dev USDC atoms (6 decimals) seeded on the USDC side. The cirBTC side is the same value at the fixture price.
    function _seedUsdc() internal pure virtual returns (uint256);
    /// @dev USDC atoms of the buy used by the scenarios.
    function _tradeUsdc() internal pure virtual returns (uint256);

    function setUp() public virtual {
        _fork();
        key = _sacredKey();
        engine = makeAddr("sacredEngine");
        attacker = makeAddr("attacker");

        uint256 seed0 = _seedUsdc();
        uint256 seed1 = _btcAtomsForUsdc(seed0);
        seedLiquidityBefore =
            _initializeAndSeed(key, _initialSqrtPrice(), MIN_USABLE_TICK, MAX_USABLE_TICK, seed0, seed1);

        // This test contract is the deployer and binds the engine exactly once.
        venue = new V4SpotVenue(POOL_MANAGER, USDC, CIRBTC, FEE, SPACING, address(this));
        venue.bindEngine(engine);

        _forkOnlyFund(USDC, engine, _tradeUsdc() * 20);
        _forkOnlyFund(CIRBTC, engine, _btcAtomsForUsdc(_tradeUsdc() * 20));
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

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 600;
    }

    function _buy(uint256 usdcIn) internal returns (uint256 out) {
        uint256 q = _quote(key, true, usdcIn);
        vm.prank(engine);
        out = venue.buyCirBtc(usdcIn, q, _deadline());
        assertEq(out, q, "executed buy must equal the Quoter simulation");
    }

    function _sell(uint256 btcIn) internal returns (uint256 out) {
        uint256 q = _quote(key, false, btcIn);
        vm.prank(engine);
        out = venue.sellCirBtc(btcIn, q, _deadline());
        assertEq(out, q, "executed sell must equal the Quoter simulation");
    }
}
