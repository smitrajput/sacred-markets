// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IV4Quoter} from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import {IStateView} from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";

/// @notice Read-only validation of the pinned v4 interfaces against the live Arc Testnet deployment.
/// Forks Arc Testnet at a pinned block and sends no transaction to the network.
/// Scaffold test: this is NOT a live receipt.
contract V4InterfaceTest is Test {
    using PoolIdLibrary for PoolKey;

    uint256 internal constant FORK_BLOCK = 71_017_780;
    uint256 internal constant CHAIN_ID = 5_042_002;

    IPoolManager internal constant POOL_MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    IPositionManager internal constant POSITION_MANAGER = IPositionManager(0x6049c9a0e26405C0985f9E3685C87d0aE917f82B);
    IV4Quoter internal constant QUOTER = IV4Quoter(0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94);
    IStateView internal constant STATE_VIEW = IStateView(0xF3334192D15450CdD385c8B70e03f9A6bD9E673b);
    address internal constant UNIVERSAL_ROUTER = 0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    address internal constant CIRBTC = 0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF;
    address internal constant EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;

    bytes32 internal constant SACRED_POOL_ID = 0xf4e18ec272549ab0140d43d33a7ba93768ecaec4dee4a7fb4f2c9af00950cde4;

    function setUp() public {
        vm.createSelectFork("arc_testnet", FORK_BLOCK);
    }

    function _sacredKey() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(CIRBTC),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
    }

    function _usdcEurcKey() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(EURC),
            fee: 500,
            tickSpacing: 10,
            hooks: IHooks(address(0))
        });
    }

    function _hasSelector(address target, bytes4 sel) internal view returns (bool) {
        bytes memory code = target.code;
        for (uint256 i = 0; i + 4 < code.length; i++) {
            // PUSH4 <selector>
            if (code[i] == 0x63 && code[i + 1] == sel[0] && code[i + 2] == sel[1] && code[i + 3] == sel[2] && code[i + 4] == sel[3]) {
                return true;
            }
        }
        return false;
    }

    function test_chainAndCode() public view {
        assertEq(block.chainid, CHAIN_ID);
        assertEq(block.number, FORK_BLOCK);
        assertGt(address(POOL_MANAGER).code.length, 0);
        assertGt(address(POSITION_MANAGER).code.length, 0);
        assertGt(address(QUOTER).code.length, 0);
        assertGt(address(STATE_VIEW).code.length, 0);
        assertGt(UNIVERSAL_ROUTER.code.length, 0);
        assertGt(PERMIT2.code.length, 0);
    }

    function test_peripheryPoolManagerGetters() public view {
        assertEq(address(POSITION_MANAGER.poolManager()), address(POOL_MANAGER));
        assertEq(address(STATE_VIEW.poolManager()), address(POOL_MANAGER));
        // V4Quoter inherits ImmutableState via BaseV4Quoter.
        (bool ok, bytes memory ret) = address(QUOTER).staticcall(abi.encodeWithSignature("poolManager()"));
        assertTrue(ok);
        assertEq(abi.decode(ret, (address)), address(POOL_MANAGER));
        (bool ok2, bytes memory ret2) = address(POSITION_MANAGER).staticcall(abi.encodeWithSignature("permit2()"));
        assertTrue(ok2);
        assertEq(abi.decode(ret2, (address)), PERMIT2);
    }

    function test_currencyOrderAndPoolId() public pure {
        PoolKey memory key = _sacredKey();
        assertLt(uint160(USDC), uint160(CIRBTC), "currency0 must be USDC");
        assertEq(Currency.unwrap(key.currency0), USDC);
        assertEq(Currency.unwrap(key.currency1), CIRBTC);
        assertEq(PoolId.unwrap(key.toId()), SACRED_POOL_ID);
        // tick spacing alignment for full range
        int24 minUsable = (TickMath.MIN_TICK / key.tickSpacing) * key.tickSpacing;
        int24 maxUsable = (TickMath.MAX_TICK / key.tickSpacing) * key.tickSpacing;
        assertEq(minUsable, -887_220);
        assertEq(maxUsable, 887_220);
    }

    function test_sacredPoolIsUninitializedAtPinnedBlock() public {
        PoolId id = _sacredKey().toId();
        (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee) = STATE_VIEW.getSlot0(id);
        assertEq(sqrtPriceX96, 0);
        assertEq(tick, 0);
        assertEq(protocolFee, 0);
        assertEq(lpFee, 0);
        assertEq(STATE_VIEW.getLiquidity(id), 0);

        // Quoter must revert (PoolNotInitialized wrapped) rather than return a number.
        vm.expectRevert();
        QUOTER.quoteExactInputSingle(
            IV4Quoter.QuoteExactSingleParams({poolKey: _sacredKey(), zeroForOne: true, exactAmount: 1e6, hookData: ""})
        );
    }

    function test_liveUsdcEurcPoolQuotesAndState() public {
        PoolKey memory key = _usdcEurcKey();
        PoolId id = key.toId();
        (uint160 sqrtPriceX96,, uint24 protocolFee, uint24 lpFee) = STATE_VIEW.getSlot0(id);
        assertGt(sqrtPriceX96, 0, "pool should be initialized");
        assertEq(lpFee, 500);
        assertEq(protocolFee, 0);
        assertGt(STATE_VIEW.getLiquidity(id), 0, "pool should hold liquidity");

        (uint256 amountOut, uint256 gasEstimate) = QUOTER.quoteExactInputSingle(
            IV4Quoter.QuoteExactSingleParams({poolKey: key, zeroForOne: true, exactAmount: 1e6, hookData: ""})
        );
        assertGt(amountOut, 0);
        assertGt(gasEstimate, 0);
        // Price sanity: ~0.83 EURC per USDC with a 0.05% fee; allow a wide band so the check is not brittle.
        assertGt(amountOut, 700_000);
        assertLt(amountOut, 1_000_000);
    }

    function test_poolManagerSelectorsAndUnlockCallback() public view {
        address pm = address(POOL_MANAGER);
        assertTrue(_hasSelector(pm, IPoolManager.unlock.selector), "unlock");
        assertTrue(_hasSelector(pm, IPoolManager.swap.selector), "swap");
        assertTrue(_hasSelector(pm, IPoolManager.sync.selector), "sync");
        assertTrue(_hasSelector(pm, IPoolManager.settle.selector), "settle");
        assertTrue(_hasSelector(pm, IPoolManager.take.selector), "take");
        assertTrue(_hasSelector(pm, IPoolManager.initialize.selector), "initialize");
        assertTrue(_hasSelector(pm, bytes4(keccak256("extsload(bytes32)"))), "extsload");
        // Callback ABI the PoolManager invokes during unlock.
        assertEq(IUnlockCallback.unlockCallback.selector, bytes4(keccak256("unlockCallback(bytes)")));
        // swap(PoolKey,SwapParams,bytes) signature of this pin, verified by selector against live code.
        assertEq(
            IPoolManager.swap.selector,
            bytes4(keccak256("swap((address,address,uint24,int24,address),(bool,int256,uint160),bytes)"))
        );
    }

    function test_positionManagerSelectorsAndActions() public view {
        address posm = address(POSITION_MANAGER);
        assertTrue(_hasSelector(posm, IPositionManager.modifyLiquidities.selector), "modifyLiquidities");
        assertTrue(_hasSelector(posm, IPositionManager.modifyLiquiditiesWithoutUnlock.selector), "withoutUnlock");
        assertTrue(_hasSelector(posm, bytes4(keccak256("initializePool((address,address,uint24,int24,address),uint160)"))), "initializePool");
        assertTrue(_hasSelector(posm, bytes4(keccak256("multicall(bytes[])"))), "multicall");
        // Action codes used for full-range mint + settle.
        assertEq(Actions.MINT_POSITION, 0x02);
        assertEq(Actions.SETTLE_PAIR, 0x0d);
    }

    function test_swapParamsShape() public pure {
        SwapParams memory p = SwapParams({zeroForOne: true, amountSpecified: -1e6, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1});
        assertTrue(p.zeroForOne);
        assertEq(p.amountSpecified, -1e6);
        BalanceDelta d;
        assertEq(BalanceDelta.unwrap(d), 0);
    }
}
