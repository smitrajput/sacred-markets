// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {V4SpotVenue} from "../src/V4SpotVenue.sol";
import {VenueUnitBase} from "./VenueUnitBase.sol";

/// @notice Unit tests (mock PoolManager): construction, one-time binding, caller authentication,
/// callback authentication, input validation.
contract V4SpotVenueAccessTest is VenueUnitBase {
    // ---------------------------------------------------------------- construction

    function test_constructor_rejectsBadConfig() public {
        IPoolManager m = IPoolManager(address(pm));
        vm.expectRevert(V4SpotVenue.InvalidConfig.selector);
        new V4SpotVenue(m, address(btc), address(usdc), 3000, 60, deployer); // unsorted
        vm.expectRevert(V4SpotVenue.InvalidConfig.selector);
        new V4SpotVenue(m, address(usdc), address(usdc), 3000, 60, deployer); // same token
        vm.expectRevert(V4SpotVenue.InvalidConfig.selector);
        new V4SpotVenue(IPoolManager(address(0xBEEF)), address(usdc), address(btc), 3000, 60, deployer); // no code
        vm.expectRevert(V4SpotVenue.InvalidConfig.selector);
        new V4SpotVenue(m, address(usdc), address(btc), 1_000_000, 60, deployer); // fee >= 100%
        vm.expectRevert(V4SpotVenue.InvalidConfig.selector);
        new V4SpotVenue(m, address(usdc), address(btc), 0x800000, 60, deployer); // dynamic-fee flag
        vm.expectRevert(V4SpotVenue.InvalidConfig.selector);
        new V4SpotVenue(m, address(usdc), address(btc), 3000, 0, deployer);
        vm.expectRevert(V4SpotVenue.InvalidConfig.selector);
        new V4SpotVenue(m, address(usdc), address(btc), 3000, -60, deployer);
        vm.expectRevert(V4SpotVenue.InvalidConfig.selector);
        new V4SpotVenue(m, address(usdc), address(btc), 3000, 60, address(0));
    }

    function test_poolKey_isFixedAndHookless() public view {
        (address c0, address c1, uint24 f, int24 ts, address hooks) = _key();
        assertEq(c0, address(usdc));
        assertEq(c1, address(btc));
        assertEq(f, 3000);
        assertEq(ts, 60);
        assertEq(hooks, address(0));
    }

    function _key() internal view returns (address, address, uint24, int24, address) {
        (bool ok, bytes memory ret) = address(venue).staticcall(abi.encodeWithSignature("poolKey()"));
        assertTrue(ok);
        return abi.decode(ret, (address, address, uint24, int24, address));
    }

    // ---------------------------------------------------------------- binding

    function test_bind_onlyDeployer() public {
        V4SpotVenue fresh = _newVenue();
        address[3] memory callers = [attacker, engine, address(pm)];
        for (uint256 i; i < callers.length; i++) {
            vm.prank(callers[i]);
            vm.expectRevert(V4SpotVenue.NotDeployer.selector);
            fresh.bindEngine(engine);
        }
        assertEq(fresh.engine(), address(0));
    }

    function test_bind_exactlyOnce() public {
        V4SpotVenue fresh = _newVenue();
        vm.startPrank(deployer);
        vm.expectEmit(true, false, false, false, address(fresh));
        emit V4SpotVenue.EngineBound(engine);
        fresh.bindEngine(engine);
        vm.expectRevert(V4SpotVenue.EngineAlreadyBound.selector);
        fresh.bindEngine(attacker);
        vm.expectRevert(V4SpotVenue.EngineAlreadyBound.selector);
        fresh.bindEngine(engine);
        vm.stopPrank();
        assertEq(fresh.engine(), engine);
    }

    function test_bind_rejectsInvalidEngines() public {
        V4SpotVenue fresh = _newVenue();
        address[6] memory bad = [address(0), address(fresh), address(pm), deployer, address(usdc), address(btc)];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(deployer);
            vm.expectRevert(V4SpotVenue.InvalidEngine.selector);
            fresh.bindEngine(bad[i]);
        }
        assertEq(fresh.engine(), address(0));
    }

    function test_swapsRevertBeforeBind() public {
        V4SpotVenue fresh = _newVenue();
        Balances memory b = _balances();
        address[3] memory callers = [deployer, attacker, engine];
        for (uint256 i; i < callers.length; i++) {
            vm.startPrank(callers[i]);
            vm.expectRevert(V4SpotVenue.EngineNotBound.selector);
            fresh.buyCirBtc(1000, 1, _deadline());
            vm.expectRevert(V4SpotVenue.EngineNotBound.selector);
            fresh.sellCirBtc(1000, 1, _deadline());
            vm.stopPrank();
        }
        _assertUnchanged(b);
    }

    // ---------------------------------------------------------------- caller authentication

    function test_onlyEngineCanTrade_evenWhenEngineHasApproved() public {
        Balances memory b = _balances();
        address[4] memory callers = [attacker, deployer, address(pm), address(venue)];
        for (uint256 i; i < callers.length; i++) {
            vm.startPrank(callers[i]);
            vm.expectRevert(V4SpotVenue.NotEngine.selector);
            venue.buyCirBtc(1000, 1, _deadline());
            vm.expectRevert(V4SpotVenue.NotEngine.selector);
            venue.sellCirBtc(1000, 1, _deadline());
            vm.stopPrank();
        }
        _assertUnchanged(b); // engine funds untouched although it approved the venue
        assertEq(pm.unlockCount(), 0);
    }

    // ---------------------------------------------------------------- callback authentication

    function test_callback_rejectsEveryoneButPoolManager() public {
        bytes memory data = abi.encode(true, uint128(1000), uint128(1));
        address[4] memory callers = [attacker, engine, deployer, address(venue)];
        for (uint256 i; i < callers.length; i++) {
            vm.prank(callers[i]);
            vm.expectRevert(V4SpotVenue.NotPoolManager.selector);
            venue.unlockCallback(data);
        }
    }

    function test_callback_rejectsPoolManagerWithoutPendingOperation() public {
        vm.prank(address(pm));
        vm.expectRevert(V4SpotVenue.NoPendingOperation.selector);
        venue.unlockCallback(abi.encode(true, uint128(1000), uint128(1)));
    }

    function test_callback_secondCallInSameUnlockFails() public {
        pm.setCallbackTwice(true);
        vm.prank(engine);
        uint256 out = venue.buyCirBtc(1000, 1, _deadline());
        assertEq(out, 1500);
        assertTrue(pm.secondCallReverted(), "repeat callback must fail");
        assertEq(bytes4(pm.secondCallRevertData()), V4SpotVenue.NoPendingOperation.selector);
    }

    function test_callback_tamperedDataFails() public {
        // The pending hash is consumed by the first call, so even correct data fails; tampered data never matches.
        pm.setCallbackTwice(true);
        pm.setTamperSecondCall(true);
        vm.prank(engine);
        venue.sellCirBtc(900, 1, _deadline());
        assertTrue(pm.secondCallReverted());
        assertEq(bytes4(pm.secondCallRevertData()), V4SpotVenue.NoPendingOperation.selector);
    }

    // ---------------------------------------------------------------- input validation

    function test_zeroInputAndZeroMinOutRevert() public {
        Balances memory b = _balances();
        vm.startPrank(engine);
        vm.expectRevert(V4SpotVenue.ZeroAmount.selector);
        venue.buyCirBtc(0, 1, _deadline());
        vm.expectRevert(V4SpotVenue.ZeroAmount.selector);
        venue.sellCirBtc(0, 1, _deadline());
        vm.expectRevert(V4SpotVenue.ZeroMinOut.selector);
        venue.buyCirBtc(1000, 0, _deadline());
        vm.expectRevert(V4SpotVenue.ZeroMinOut.selector);
        venue.sellCirBtc(1000, 0, _deadline());
        vm.stopPrank();
        _assertUnchanged(b);
    }

    function test_amountAboveInt128Reverts() public {
        vm.startPrank(engine);
        vm.expectRevert(V4SpotVenue.AmountTooLarge.selector);
        venue.buyCirBtc(uint256(type(uint128).max), 1, _deadline());
        vm.expectRevert(V4SpotVenue.AmountTooLarge.selector);
        venue.sellCirBtc(1000, uint256(uint128(type(int128).max)) + 1, _deadline());
        vm.stopPrank();
    }

    function test_expiredDeadlineReverts_boundaryAccepted() public {
        vm.warp(1_000_000);
        Balances memory b = _balances();
        vm.startPrank(engine);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.Expired.selector, block.timestamp - 1, block.timestamp));
        venue.buyCirBtc(1000, 1, block.timestamp - 1);
        vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.Expired.selector, block.timestamp - 1, block.timestamp));
        venue.sellCirBtc(1000, 1, block.timestamp - 1);
        _assertUnchanged(b);
        // deadline == block.timestamp is still valid
        assertEq(venue.buyCirBtc(1000, 1, block.timestamp), 1500);
        vm.stopPrank();
    }

    function testFuzz_deadline(uint256 deadline) public {
        vm.warp(2_000_000);
        vm.prank(engine);
        if (deadline < block.timestamp) {
            vm.expectRevert(abi.encodeWithSelector(V4SpotVenue.Expired.selector, deadline, block.timestamp));
            venue.buyCirBtc(1000, 1, deadline);
        } else {
            assertEq(venue.buyCirBtc(1000, 1, deadline), 1500);
        }
    }
}
