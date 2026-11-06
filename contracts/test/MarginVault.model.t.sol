// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarginVault} from "../src/MarginVault.sol";
import {VaultBase} from "./VaultBase.sol";

/// @notice Randomized sequences against an independent model kept in this test (plain integers, no vault reads used
/// to compute expectations). After every step the vault must agree with the model and remain fully backed.
contract MarginVaultModelTest is VaultBase {
    // ---- independent model
    uint256 internal mIdle;
    uint256 internal mOut;
    uint256 internal mShares;
    uint256 internal mDonated;
    uint256[] internal mIds;
    mapping(uint256 => uint256) internal mRemaining;
    mapping(uint256 => address) internal mAccount;
    mapping(address => uint256) internal mExposure;
    mapping(address => uint256) internal mUserShares;
    uint256 internal nextId = 1;

    address[3] internal users;
    address[3] internal traders;

    function setUp() public override {
        super.setUp();
        users = [alice, bob, carol];
        traders = [trader1, trader2, makeAddr("trader3")];
        _seedTargets();
        mShares = _deposit(alice, 40 * USDC1);
        mUserShares[alice] = mShares;
        mIdle = 40 * USDC1;
        assertEq(mShares, 40 * USDC1);
    }

    function _r(uint256 seed, uint256 i, uint256 salt) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, i, salt)));
    }

    function testFuzz_vaultMatchesIndependentModel(uint256 seed) public {
        for (uint256 i; i < 40; i++) {
            uint256 action = _r(seed, i, 0) % 7;
            if (action == 0) _stepDeposit(_r(seed, i, 1));
            else if (action == 1) _stepOpen(_r(seed, i, 1));
            else if (action == 2) _stepRepay(_r(seed, i, 1));
            else if (action == 3) _stepMarkup(_r(seed, i, 1));
            else if (action == 4) _stepWriteOff(_r(seed, i, 1));
            else if (action == 5) _stepFinalize(_r(seed, i, 1));
            else _stepDonate(_r(seed, i, 1));
            _assertAgrees();
        }
    }

    function _stepDeposit(uint256 r) internal {
        address u = users[r % 3];
        uint256 amount = 1 + (r >> 8) % (30 * USDC1);
        uint256 nav = mIdle + mOut;
        uint256 expected = (amount * mShares) / nav; // supply and NAV are always positive after setUp
        usdc.mint(u, amount);
        vm.startPrank(u);
        usdc.approve(address(vault), amount);
        (bool ok, bytes memory ret) =
            address(vault).call(abi.encodeCall(MarginVault.deposit, (amount, 0, vault.MANDATE_HASH())));
        vm.stopPrank();
        assertEq(ok, expected > 0, "deposit succeeds iff shares > 0");
        if (ok) {
            assertEq(abi.decode(ret, (uint256)), expected);
            mIdle += amount;
            mShares += expected;
            mUserShares[u] += expected;
        }
    }

    function _stepOpen(uint256 r) internal {
        address t = traders[r % 3];
        uint256 p = 1 + (r >> 8) % (12 * USDC1);
        uint256 nav = mIdle + mOut;
        bool allowed = mIds.length < 32 && mOut + p <= 100 * USDC1 && (mOut + p) * 10_000 <= nav * 9_500
            && mExposure[t] + p <= 10 * USDC1 && mIdle >= 2 * p && (mIdle - p) * 10_000 >= nav * 500;
        uint256 id = nextId++;
        try engine.openFull(id, t, p) {
            assertTrue(allowed, "vault allowed an opening the model forbids");
            mIdle -= p;
            mOut += p;
            mExposure[t] += p;
            mIds.push(id);
            mRemaining[id] = p;
            mAccount[id] = t;
        } catch {
            assertFalse(allowed, "vault refused an opening the model allows");
        }
    }

    /// @dev Positions that still owe principal; a position at zero principal stays live until finalized.
    function _pickWithPrincipal(uint256 r) internal view returns (bool, uint256 idx) {
        uint256 count;
        for (uint256 i; i < mIds.length; i++) if (mRemaining[mIds[i]] > 0) count++;
        if (count == 0) return (false, 0);
        uint256 target = r % count;
        for (uint256 i; i < mIds.length; i++) {
            if (mRemaining[mIds[i]] == 0) continue;
            if (target == 0) return (true, i);
            target--;
        }
        return (false, 0);
    }

    function _shrink(uint256 idx, uint256 amount) internal {
        uint256 id = mIds[idx];
        mRemaining[id] -= amount;
        mOut -= amount;
        mExposure[mAccount[id]] -= amount;
    }

    function _stepRepay(uint256 r) internal {
        (bool any, uint256 idx) = _pickWithPrincipal(r);
        if (!any) return;
        uint256 id = mIds[idx];
        uint256 amount = 1 + (r >> 8) % mRemaining[id];
        engine.repayPrincipal(id, amount);
        mIdle += amount;
        _shrink(idx, amount);
    }

    function _stepWriteOff(uint256 r) internal {
        (bool any, uint256 idx) = _pickWithPrincipal(r);
        if (!any) return;
        uint256 id = mIds[idx];
        uint256 amount = 1 + (r >> 8) % mRemaining[id];
        engine.writeOffPrincipal(id, amount);
        _shrink(idx, amount);
    }

    function _stepFinalize(uint256 r) internal {
        if (mIds.length == 0) return;
        uint256 idx = r % mIds.length;
        uint256 id = mIds[idx];
        if (mRemaining[id] != 0) {
            vm.expectRevert(abi.encodeWithSelector(MarginVault.PrincipalOutstanding.selector, id, mRemaining[id]));
            engine.finalizePosition(id);
            return;
        }
        engine.finalizePosition(id);
        mIds[idx] = mIds[mIds.length - 1];
        mIds.pop();
    }

    function _stepMarkup(uint256 r) internal {
        uint256 amount = 1 + r % (2 * USDC1);
        engine.creditLpMarkup(amount);
        mIdle += amount;
    }

    function _stepDonate(uint256 r) internal {
        uint256 amount = 1 + r % USDC1;
        usdc.mint(address(this), amount);
        usdc.transfer(address(vault), amount);
        mDonated += amount;
    }

    function _assertAgrees() internal view {
        assertEq(vault.depositorIdleCash(), mIdle, "idle");
        assertEq(vault.outstandingPrincipal(), mOut, "outstanding");
        assertEq(vault.nav(), mIdle + mOut, "nav");
        assertEq(vault.totalShares(), mShares, "shares");
        assertEq(vault.liveCount(), mIds.length, "live count");
        uint256 sum;
        for (uint256 i; i < 3; i++) {
            assertEq(vault.sharesOf(users[i]), mUserShares[users[i]], "user shares");
            sum += vault.sharesOf(users[i]);
        }
        assertEq(sum, vault.totalShares(), "share conservation");
        for (uint256 i; i < mIds.length; i++) {
            (, , , uint256 remaining,) = vault.positions(mIds[i]);
            assertEq(remaining, mRemaining[mIds[i]], "position remaining");
        }
        // Physical cash: recorded idle + the 1 USDC of reserves + unrecorded donations. Principal is out with the engine.
        assertEq(usdc.balanceOf(address(vault)), mIdle + 1_000_000 + mDonated, "cash");
        assertTrue(vault.isFullyBacked());
        assertEq(vault.commitments(), 0);
    }
}
