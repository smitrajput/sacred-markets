// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IPoolInitializer_v4} from "@uniswap/v4-periphery/src/interfaces/IPoolInitializer_v4.sol";
import {IV4Quoter} from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import {IStateView} from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

interface IPermit2Approve {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @notice Shared plumbing for fork tests against the REAL Arc Testnet PoolManager, PositionManager, Permit2,
/// V4Quoter, StateView, USDC and cirBTC at a pinned block.
///
/// REQUIRES Circle's Arc-aware Foundry (`forge test --network arc`, see scripts/test-arc-fork.sh). Arc's USDC ERC-20 is
/// native-backed and moves value through system precompiles that standard Forge does not implement; this base fails
/// fast under standard Forge instead of silently running an unsupported fork. No precompile is etched or stubbed.
///
/// FORK-ONLY BALANCE FIXTURES: balances for the liquidity provider, the engine and the attacker are created with
/// `vm.deal` (native balance, 18 decimals, = USDC atoms * 1e12) and forge-std `deal` (cirBTC storage) on the forked
/// state. They are not live balances and prove nothing about any funded wallet. All swaps and mints run on the real
/// contracts' bytecode.
abstract contract ForkBase is Test {
    using PoolIdLibrary for PoolKey;

    uint256 internal constant FORK_BLOCK = 71_017_780;

    IPoolManager internal constant POOL_MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    IPositionManager internal constant POSM = IPositionManager(0x6049c9a0e26405C0985f9E3685C87d0aE917f82B);
    IV4Quoter internal constant QUOTER = IV4Quoter(0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94);
    IStateView internal constant STATE_VIEW = IStateView(0xF3334192D15450CdD385c8B70e03f9A6bD9E673b);
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    address internal constant CIRBTC = 0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF;

    uint24 internal constant FEE = 3000;
    int24 internal constant SPACING = 60;
    int24 internal constant MIN_USABLE_TICK = -887_220; // floor(MIN_TICK / 60) * 60
    int24 internal constant MAX_USABLE_TICK = 887_220;

    /// Fixture price: 1 cirBTC = 100,000 USDC. Test input only, not a market claim.
    uint256 internal constant FIXTURE_USDC_PER_BTC = 100_000;

    uint256 internal constant NATIVE_PER_USDC_ATOM = 1e12; // native view has 18 decimals, ERC-20 view 6

    function _fork() internal {
        vm.createSelectFork("arc_testnet", FORK_BLOCK);
        _requireArcRuntime();
    }

    /// @dev Proves the runtime executes Arc's native-USDC precompiles: a real USDC transfer must succeed.
    function _requireArcRuntime() internal {
        address a = address(uint160(uint256(keccak256("sacred.arc-probe.a"))));
        address b = address(uint160(uint256(keccak256("sacred.arc-probe.b"))));
        vm.deal(a, 2 * NATIVE_PER_USDC_ATOM);
        vm.prank(a);
        (bool ok,) = USDC.call(abi.encodeCall(IERC20.transfer, (b, 1)));
        require(
            ok && IERC20(USDC).balanceOf(b) == 1 && IERC20(USDC).balanceOf(a) == 1,
            "Arc native-USDC precompiles unavailable: run fork tests via scripts/test-arc-fork.sh (arc-foundry --network arc)"
        );
    }

    function _sacredKey() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(CIRBTC),
            fee: FEE,
            tickSpacing: SPACING,
            hooks: IHooks(address(0))
        });
    }

    /// @dev FORK-ONLY: writes a token balance into forked storage.
    ///      USDC is native-backed on Arc, so its balance is set through the native balance (18 decimals).
    ///      cirBTC is a normal FiatToken proxy, so its balance is written with `deal`. Fixture only.
    function _forkOnlyFund(address token, address to, uint256 amount) internal {
        if (token == USDC) {
            vm.deal(to, amount * NATIVE_PER_USDC_ATOM);
        } else {
            deal(token, to, amount, false);
        }
        assertEq(IERC20(token).balanceOf(to), amount, "fork-only funding failed");
    }

    /// @dev sqrtPriceX96 from token atoms: sqrt(token1Atoms / token0Atoms) * 2^96.
    function _sqrtPriceFromAtoms(uint256 token0Atoms, uint256 token1Atoms) internal pure returns (uint160) {
        return uint160(Math.sqrt(FullMath.mulDiv(token1Atoms, 1 << 192, token0Atoms)));
    }

    /// @dev cirBTC atoms (8 dec) worth `usdcAtoms` (6 dec) at the fixture price.
    function _btcAtomsForUsdc(uint256 usdcAtoms) internal pure returns (uint256) {
        return (usdcAtoms * 1e8) / (FIXTURE_USDC_PER_BTC * 1e6);
    }

    function _initialSqrtPrice() internal pure returns (uint160) {
        return _sqrtPriceFromAtoms(FIXTURE_USDC_PER_BTC * 1e6, 1e8);
    }

    /// @notice Initialize `key` at `sqrtPriceX96` and mint a position over [tickLower, tickUpper] through the real
    /// PositionManager, funded (fork-only) and owned by this contract.
    function _initializeAndSeed(
        PoolKey memory key,
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0,
        uint256 amount1
    ) internal returns (uint128 liquidity) {
        _fundAndApprove(key, amount0 * 2, amount1 * 2);
        int24 tick = IPoolInitializer_v4(address(POSM)).initializePool(key, sqrtPriceX96);
        assertTrue(tick != type(int24).max, "pool initialization failed");

        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            amount0,
            amount1
        );
        _mint(key, tickLower, tickUpper, liquidity, amount0 + 2, amount1 + 2);

        PoolId id = key.toId();
        (uint160 sp,,,) = STATE_VIEW.getSlot0(id);
        assertEq(sp, sqrtPriceX96, "initialized price");
        assertEq(STATE_VIEW.getLiquidity(id), liquidity, "active liquidity");
    }

    function _fundAndApprove(PoolKey memory key, uint256 amount0, uint256 amount1) internal {
        address t0 = Currency.unwrap(key.currency0);
        address t1 = Currency.unwrap(key.currency1);
        _forkOnlyFund(t0, address(this), amount0);
        _forkOnlyFund(t1, address(this), amount1);
        IERC20(t0).approve(PERMIT2, type(uint256).max);
        IERC20(t1).approve(PERMIT2, type(uint256).max);
        IPermit2Approve(PERMIT2).approve(t0, address(POSM), type(uint160).max, uint48(block.timestamp + 1 days));
        IPermit2Approve(PERMIT2).approve(t1, address(POSM), type(uint160).max, uint48(block.timestamp + 1 days));
    }

    function _mint(PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 max0, uint256 max1)
        internal
    {
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, tickLower, tickUpper, liquidity, uint128(max0), uint128(max1), address(this), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        POSM.modifyLiquidities(abi.encode(actions, params), block.timestamp + 600);
    }

    /// @dev Read-only quote through the real V4Quoter (non-view; executes as a simulation that always reverts internally).
    function _quote(PoolKey memory key, bool zeroForOne, uint256 amountIn) internal returns (uint256 amountOut) {
        (amountOut,) = QUOTER.quoteExactInputSingle(
            IV4Quoter.QuoteExactSingleParams({
                poolKey: key, zeroForOne: zeroForOne, exactAmount: uint128(amountIn), hookData: ""
            })
        );
    }

    /// @dev Fee-free output at the pool's current spot price.
    function _spotOut(PoolKey memory key, bool zeroForOne, uint256 amountIn) internal view returns (uint256) {
        (uint160 sp,,,) = STATE_VIEW.getSlot0(key.toId());
        uint256 priceX96 = FullMath.mulDiv(sp, sp, 1 << 96); // price * 2^96 (token1 per token0 atoms)
        return zeroForOne ? FullMath.mulDiv(amountIn, priceX96, 1 << 96) : FullMath.mulDiv(amountIn, 1 << 96, priceX96);
    }

    /// @dev Friction in bps (rounded up) of `out` against the fee-free spot output.
    function _frictionBps(uint256 spotOut, uint256 out) internal pure returns (uint256) {
        if (out >= spotOut) return 0;
        return Math.mulDiv(spotOut - out, 10_000, spotOut, Math.Rounding.Ceil);
    }
}
