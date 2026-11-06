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
