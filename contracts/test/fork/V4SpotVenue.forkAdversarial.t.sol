// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {V4SpotVenue} from "../../src/V4SpotVenue.sol";
import {ForkVenueSetup} from "./ForkVenueSetup.sol";

/// @notice Adversarial behavior of the deployed venue against the real USDC/cirBTC pool on the Arc fork.
/// Failed-swap rollback with full balance assertions lives in ForkScenarioBase (both pool scales) and in
/// V4SpotVenue.forkRealPool.t.sol (generic tokens on the real PoolManager).
contract V4SpotVenueForkAdversarialTest is ForkVenueSetup {
    function _seedUsdc() internal pure override returns (uint256) {
        return 10e6;
    }

    function _tradeUsdc() internal pure override returns (uint256) {
        return 200_000;
    }

    function test_unauthorizedCallersCannotSwapOrSpendEngineApproval() public {
        Snap memory b = _snap();
        address[3] memory callers = [attacker, address(this), address(POOL_MANAGER)];
        for (uint256 i; i < callers.length; i++) {
            vm.startPrank(callers[i]);
            vm.expectRevert(V4SpotVenue.NotEngine.selector);
            venue.buyCirBtc(100_000, 1, _deadline());
            vm.expectRevert(V4SpotVenue.NotEngine.selector);
            venue.sellCirBtc(100, 1, _deadline());
            vm.stopPrank();
        }
        Snap memory a = _snap();
        assertEq(a.engUsdc, b.engUsdc);
        assertEq(a.engBtc, b.engBtc);
        assertEq(a.pmUsdc, b.pmUsdc);
        assertEq(a.pmBtc, b.pmBtc);
    }

    function test_bindIsDeployerOnlyAndOneShot() public {
        vm.prank(attacker);
        vm.expectRevert(V4SpotVenue.NotDeployer.selector);
        venue.bindEngine(attacker);
        vm.expectRevert(V4SpotVenue.EngineAlreadyBound.selector);
        venue.bindEngine(attacker);
        assertEq(venue.engine(), engine);
    }

    function test_unboundVenueRefusesEveryone() public {
        V4SpotVenue fresh = new V4SpotVenue(POOL_MANAGER, USDC, CIRBTC, FEE, SPACING, address(this));
        vm.prank(engine);
        vm.expectRevert(V4SpotVenue.EngineNotBound.selector);
        fresh.buyCirBtc(100_000, 1, _deadline());
        vm.expectRevert(V4SpotVenue.EngineNotBound.selector);
        fresh.sellCirBtc(100, 1, _deadline());
    }

    function test_callbackRejectsOutsidersAndIdlePoolManager() public {
        bytes memory data = abi.encode(true, uint128(100_000), uint128(1));
        vm.prank(attacker);
        vm.expectRevert(V4SpotVenue.NotPoolManager.selector);
        venue.unlockCallback(data);
        vm.prank(engine);
        vm.expectRevert(V4SpotVenue.NotPoolManager.selector);
        venue.unlockCallback(data);
        // Even the PoolManager's own address is refused when no operation is pending (impersonated; the real PoolManager
        // only ever calls back into an unlocker it was invoked by).
        vm.prank(address(POOL_MANAGER));
        vm.expectRevert(V4SpotVenue.NoPendingOperation.selector);
        venue.unlockCallback(data);
    }

    function test_strangerUnlockingPoolManagerCannotReachVenue() public {
        // An attacker contract that unlocks the real PoolManager is called back itself, never the venue.
        Prober p = new Prober();
        vm.expectRevert(abi.encodeWithSelector(Prober.CalledBack.selector, address(p)));
        p.probe(address(POOL_MANAGER));
    }

    function test_expiredDeadlineAndZeroInputsRevertOnRealPool() public {
        Snap memory b = _snap();
        vm.startPrank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.Expired.selector, block.timestamp - 1, block.timestamp));
        venue.buyCirBtc(100_000, 1, block.timestamp - 1);
        vm.expectRevert(V4SpotVenue.ZeroAmount.selector);
        venue.buyCirBtc(0, 1, _deadline());
        vm.expectRevert(V4SpotVenue.ZeroMinOut.selector);
        venue.sellCirBtc(100, 0, _deadline());
        vm.stopPrank();
        Snap memory a = _snap();
        assertEq(a.engUsdc, b.engUsdc);
        assertEq(a.engBtc, b.engBtc);
    }

    /// @dev Tokens sent to the venue by a third party must not be swept into the engine's output or lost: accounting
    /// uses balance deltas, so the donation simply stays where it is.
    function test_donatedBalancesNeverLeakIntoExecution() public {
        _forkOnlyFund(CIRBTC, attacker, 7);
        vm.prank(attacker);
        IERC20(CIRBTC).transfer(address(venue), 7);
        assertEq(IERC20(CIRBTC).balanceOf(address(venue)), 7);

        uint256 q = _quote(key, true, 200_000);
        Snap memory b = _snap();
        vm.prank(engine);
        uint256 out = venue.buyCirBtc(200_000, q, _deadline());
        Snap memory a = _snap();
        assertEq(out, q, "output unaffected by the donation");
        assertEq(a.engBtc - b.engBtc, q);
        assertEq(IERC20(CIRBTC).balanceOf(address(venue)), 7, "donation untouched");
    }

    /// @dev Native-backed USDC has 18 decimals underneath its 6-decimal ERC-20 view. Engine, venue and PoolManager all
    /// carry fractional native dust, and a third party donates exactly one USDC atom to the venue. Exact-input swaps in
    /// both directions must succeed, the ERC-20 deltas must be exact, and every fractional remainder and the donation
    /// must be exactly where they started (nothing absorbed, swept or lost).
    function test_fractionalNativeDustAndUsdcAtomDonation_doNotAffectExactInputAccounting() public {
        uint256 dustEngine = 777_777_777; // wei, below one USDC atom (1e12)
        uint256 dustVenue = 123_456; // wei
        uint256 dustPm = 424_242;
        vm.deal(engine, engine.balance + dustEngine);
        vm.deal(address(venue), 1e12 + dustVenue); // one donated USDC atom plus dust (fork-only fixture)
        vm.deal(address(POOL_MANAGER), address(POOL_MANAGER).balance + dustPm);
        assertEq(IERC20(USDC).balanceOf(address(venue)), 1, "one donated USDC atom");
        assertEq(address(venue).balance % 1e12, dustVenue);
        assertEq(engine.balance % 1e12, dustEngine);

        uint256 engNative0 = engine.balance;
        uint256 venueNative0 = address(venue).balance;
        uint256 pmNative0 = address(POOL_MANAGER).balance;
        Snap memory b = _snap();

        uint256 qBuy = _quote(key, true, 200_000);
        vm.prank(engine);
        uint256 got = venue.buyCirBtc(200_000, qBuy, _deadline());
        assertEq(got, qBuy);
        Snap memory m = _snap();
        assertEq(b.engUsdc - m.engUsdc, 200_000, "ERC-20 USDC paid is exact");
        assertEq(m.engBtc - b.engBtc, got, "cirBTC received is exact");
        assertEq(m.pmUsdc - b.pmUsdc, 200_000);
        assertEq(m.venueUsdc, 1, "donated atom untouched after the buy");

        uint256 qSell = _quote(key, false, got);
        vm.prank(engine);
        uint256 back = venue.sellCirBtc(got, qSell, _deadline());
        assertEq(back, qSell);
        Snap memory a = _snap();
        assertEq(a.engBtc, b.engBtc, "all cirBTC sold");
        assertEq(a.engUsdc, b.engUsdc - 200_000 + back, "ERC-20 USDC delta is exact");
        assertEq(a.venueUsdc, 1, "donated atom untouched after the sell");
        assertEq(a.venueBtc, 0);

        // Native view: every wei moved is a whole number of USDC atoms, so the fractional parts are unchanged.
        assertEq(engine.balance, engNative0 - 200_000 * 1e12 + back * 1e12, "engine native, exact");
        assertEq(engine.balance % 1e12, dustEngine, "engine fractional dust persists");
        assertEq(address(venue).balance, venueNative0, "venue native persists (donation and dust)");
        assertEq(address(venue).balance % 1e12, dustVenue);
        assertEq(address(POOL_MANAGER).balance, pmNative0 + 200_000 * 1e12 - back * 1e12, "PoolManager native, exact");
        assertEq(address(POOL_MANAGER).balance % 1e12, pmNative0 % 1e12, "PoolManager fractional dust persists");
    }
}

/// @dev Unlocks the PoolManager and records who gets called back.
contract Prober {
    error CalledBack(address who);

    function probe(address manager) external {
        (bool ok, bytes memory ret) = manager.call(abi.encodeWithSignature("unlock(bytes)", hex"01"));
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    function unlockCallback(bytes calldata) external view returns (bytes memory) {
        revert CalledBack(address(this));
    }
}
