// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";

import {ISpotVenue} from "./interfaces/ISpotVenue.sol";

/// @title V4SpotVenue
/// @notice Fixed-pool, exact-input USDC/cirBTC spot venue on an existing Uniswap v4 PoolManager.
/// @dev Trust model:
///  - The pool (currencies, fee, tick spacing, no hooks) and the PoolManager are immutable.
///  - One engine address is bound exactly once by the deployer. Only that engine can trade.
///  - The engine is the only payer (input pulled with `transferFrom`) and the only recipient
///    (output `take`n straight to it). Tokens move only engine -> venue -> PoolManager -> engine.
///  - `unlockCallback` accepts only the PoolManager, only while one pending operation exists, and
///    only the exact bytes of that operation. The pending hash is cleared on entry, so a second
///    callback with the same data reverts.
///  - Every swap checks complete input consumption, `minOut`, the engine's measured balance
///    delta, the PoolManager's measured input delta, a zero venue balance delta, and zero
///    outstanding PoolManager deltas for this contract.
contract V4SpotVenue is ISpotVenue, IUnlockCallback {
    using SafeERC20 for IERC20;

    /// @dev Exact data handed to `PoolManager.unlock`; authenticated by hash in the callback.
    struct Operation {
        bool zeroForOne;
        uint128 amountIn;
        uint128 minOut;
    }

    uint256 internal constant MAX_AMOUNT = uint256(uint128(type(int128).max));

    IPoolManager public immutable poolManager;
    address public immutable override usdc;
    address public immutable override cirBtc;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;
    /// @notice The only address allowed to call `bindEngine`.
    address public immutable deployer;

    address public override engine;

    bytes32 private _pending;
    bool private _busy;

    event EngineBound(address indexed engine);
    event Swapped(bool indexed buy, uint256 amountIn, uint256 amountOut);

    error InvalidConfig();
    error NotDeployer();
    error EngineAlreadyBound();
    error InvalidEngine();
    error EngineNotBound();
    error NotEngine();
    error Reentrancy();
    error Expired(uint256 deadline, uint256 timestamp);
    error ZeroAmount();
    error ZeroMinOut();
    error AmountTooLarge();
    error NotPoolManager();
    error NoPendingOperation();
    error CallbackNotExecuted();
    error InputNotReceived(uint256 expected, uint256 received);
    error IncompleteInput(int256 expectedDelta, int256 actualDelta);
    error InsufficientOutput(uint256 out, uint256 minOut);
    error SettleMismatch(uint256 expected, uint256 paid);
    error OutstandingDelta(address currency, int256 delta);
    error EngineInputMismatch(uint256 expected, uint256 actual);
    error EngineOutputMismatch(uint256 reported, uint256 received);
    error PoolManagerAccountingMismatch();
    error VenueBalanceChanged();

    constructor(
        IPoolManager poolManager_,
        address usdc_,
        address cirBtc_,
        uint24 fee_,
        int24 tickSpacing_,
        address deployer_
    ) {
        if (
            address(poolManager_).code.length == 0 || usdc_ == address(0) || cirBtc_ == address(0)
                || uint160(usdc_) >= uint160(cirBtc_) // currency0 = USDC, currency1 = cirBTC, strictly sorted
                || fee_ >= 1_000_000 // static fee below 100%; also excludes the dynamic-fee flag
                || tickSpacing_ <= 0 || deployer_ == address(0)
        ) revert InvalidConfig();
        poolManager = poolManager_;
        usdc = usdc_;
        cirBtc = cirBtc_;
        fee = fee_;
        tickSpacing = tickSpacing_;
        deployer = deployer_;
    }

    // ------------------------------------------------------------------ binding

    /// @notice Bind the single authorized engine. Deployer only, exactly once.
    function bindEngine(address engine_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (engine != address(0)) revert EngineAlreadyBound();
        if (
            engine_ == address(0) || engine_ == address(this) || engine_ == address(poolManager) || engine_ == deployer
                || engine_ == usdc || engine_ == cirBtc
        ) revert InvalidEngine();
        engine = engine_;
        emit EngineBound(engine_);
    }

    // ------------------------------------------------------------------ trading (engine only)

    /// @inheritdoc ISpotVenue
    function buyCirBtc(uint256 usdcIn, uint256 minCirBtcOut, uint256 deadline) external returns (uint256) {
        uint256 out = _swapExactIn(true, usdcIn, minCirBtcOut, deadline);
        emit Swapped(true, usdcIn, out);
        return out;
    }

    /// @inheritdoc ISpotVenue
    function sellCirBtc(uint256 cirBtcIn, uint256 minUsdcOut, uint256 deadline) external returns (uint256) {
        uint256 out = _swapExactIn(false, cirBtcIn, minUsdcOut, deadline);
        emit Swapped(false, cirBtcIn, out);
        return out;
    }

    /// @dev Balances observed before a swap, used to verify the swap from actual deltas.
    struct Snapshot {
        uint256 venueIn;
        uint256 venueOut;
        uint256 pmIn;
        uint256 pmOut;
        uint256 engIn;
        uint256 engOut;
    }

    /// @dev token0 = USDC, token1 = cirBTC. `zeroForOne` means a buy (USDC in, cirBTC out).
    function _swapExactIn(bool zeroForOne, uint256 amountIn, uint256 minOut, uint256 deadline)
        internal
        returns (uint256 reported)
    {
        address eng = engine;
        if (eng == address(0)) revert EngineNotBound();
        if (msg.sender != eng) revert NotEngine();
        if (_busy) revert Reentrancy();
        if (block.timestamp > deadline) revert Expired(deadline, block.timestamp);
        if (amountIn == 0) revert ZeroAmount();
        if (minOut == 0) revert ZeroMinOut();
        if (amountIn > MAX_AMOUNT || minOut > MAX_AMOUNT) revert AmountTooLarge();
        _busy = true;

        (IERC20 tIn, IERC20 tOut) = zeroForOne ? (IERC20(usdc), IERC20(cirBtc)) : (IERC20(cirBtc), IERC20(usdc));
        Snapshot memory before = _snapshot(tIn, tOut, eng);

        // Payer is always the engine.
        tIn.safeTransferFrom(eng, address(this), amountIn);
        uint256 received = tIn.balanceOf(address(this)) - before.venueIn;
        if (received != amountIn) revert InputNotReceived(amountIn, received);

        // Only this exact operation can be executed by the callback.
        bytes memory data =
            abi.encode(Operation({zeroForOne: zeroForOne, amountIn: uint128(amountIn), minOut: uint128(minOut)}));
        _pending = keccak256(data);
        bytes memory ret = poolManager.unlock(data);
        if (_pending != bytes32(0)) revert CallbackNotExecuted();
        reported = abi.decode(ret, (uint256));

        _verify(before, tIn, tOut, eng, amountIn, minOut, reported);
        _busy = false;
    }

    function _snapshot(IERC20 tIn, IERC20 tOut, address eng) internal view returns (Snapshot memory s) {
        address pm = address(poolManager);
        s.venueIn = tIn.balanceOf(address(this));
        s.venueOut = tOut.balanceOf(address(this));
        s.pmIn = tIn.balanceOf(pm);
        s.pmOut = tOut.balanceOf(pm);
        s.engIn = tIn.balanceOf(eng);
        s.engOut = tOut.balanceOf(eng);
    }

    /// @dev Independent accounting from actual balances, not from PoolManager return values.
    function _verify(
        Snapshot memory b,
        IERC20 tIn,
        IERC20 tOut,
        address eng,
        uint256 amountIn,
        uint256 minOut,
        uint256 reported
    ) internal view {
        address pm = address(poolManager);
        uint256 engOutDelta = tOut.balanceOf(eng) - b.engOut;
        if (engOutDelta != reported) revert EngineOutputMismatch(reported, engOutDelta);
        if (engOutDelta < minOut) revert InsufficientOutput(engOutDelta, minOut);
        uint256 engInAfter = tIn.balanceOf(eng);
        if (engInAfter + amountIn != b.engIn) revert EngineInputMismatch(amountIn, b.engIn - engInAfter);
        if (tIn.balanceOf(pm) - b.pmIn != amountIn || b.pmOut - tOut.balanceOf(pm) != engOutDelta) {
            revert PoolManagerAccountingMismatch();
        }
        if (tIn.balanceOf(address(this)) != b.venueIn || tOut.balanceOf(address(this)) != b.venueOut) {
            revert VenueBalanceChanged();
        }
    }

    // ------------------------------------------------------------------ PoolManager callback

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        bytes32 pending = _pending;
        if (pending == bytes32(0) || keccak256(data) != pending) revert NoPendingOperation();
        _pending = bytes32(0); // single use: a repeated callback finds nothing pending

        Operation memory op = abi.decode(data, (Operation));
        PoolKey memory key = _poolKey();
        (Currency cIn, Currency cOut) = op.zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);

        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: op.zeroForOne,
                amountSpecified: -int256(uint256(op.amountIn)),
                sqrtPriceLimitX96: op.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        int128 dIn = op.zeroForOne ? delta.amount0() : delta.amount1();
        int128 dOut = op.zeroForOne ? delta.amount1() : delta.amount0();

        // The whole input must be consumed, and something must come out.
        if (dIn != -int128(op.amountIn)) revert IncompleteInput(-int256(uint256(op.amountIn)), int256(dIn));
        if (dOut <= 0 || uint128(dOut) < op.minOut) revert InsufficientOutput(dOut <= 0 ? 0 : uint128(dOut), op.minOut);
        uint256 amountOut = uint128(dOut);

        // Settle the input: sync -> transfer -> settle.
        poolManager.sync(cIn);
        IERC20(Currency.unwrap(cIn)).safeTransfer(address(poolManager), op.amountIn);
        uint256 paid = poolManager.settle();
        if (paid != op.amountIn) revert SettleMismatch(op.amountIn, paid);

        // Take the output straight to the engine.
        poolManager.take(cOut, engine, amountOut);

        _requireZeroDelta(key.currency0);
        _requireZeroDelta(key.currency1);
        return abi.encode(amountOut);
    }

    // ------------------------------------------------------------------ views / helpers

    /// @notice The fixed pool key.
    function poolKey() external view returns (PoolKey memory) {
        return _poolKey();
    }

    function _poolKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(usdc),
            currency1: Currency.wrap(cirBtc),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(0))
        });
    }

    function _requireZeroDelta(Currency currency) internal view {
        int256 d = TransientStateLibrary.currencyDelta(poolManager, address(this), currency);
        if (d != 0) revert OutstandingDelta(Currency.unwrap(currency), d);
    }
}
