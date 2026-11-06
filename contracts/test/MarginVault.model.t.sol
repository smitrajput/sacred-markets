// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarginVault} from "../src/MarginVault.sol";
import {VaultBase} from "./VaultBase.sol";

/// @notice Randomized sequences against an independent model kept in this test (plain integers, nothing read back from
/// the vault to compute expectations): LP cash, principal, protection buckets, manager cash, per-position collected
/// markup and the loss waterfall. After every step the vault must agree with the model and custody must be exact.
contract MarginVaultModelTest is VaultBase {
    uint256 internal mIdle;
    uint256 internal mOut;
    uint256 internal mShares;
    uint256 internal mDonated;
    uint256 internal mPrimary;
    uint256 internal mTail;
    uint256 internal mBackstop;
    uint256 internal mManager;
    uint256[] internal mIds;
    mapping(uint256 => uint256) internal mRemaining;
    mapping(uint256 => address) internal mAccount;
    mapping(uint256 => uint256) internal mCum;
    mapping(uint256 => uint256) internal mLp;
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
        mPrimary = 400_000;
        mTail = 600_000;
        usdc.mint(treasury, 2 * USDC1);
        vm.prank(treasury);
        vault.seedProtection(MarginVault.ProtectionKind.Backstop, 2 * USDC1);
        mBackstop = 2 * USDC1;
        mShares = _deposit(alice, 40 * USDC1);
        mUserShares[alice] = mShares;
        mIdle = 40 * USDC1;
    }

    function _r(uint256 seed, uint256 i, uint256 salt) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, i, salt)));
    }

    function testFuzz_vaultMatchesIndependentModel(uint256 seed) public {
        for (uint256 i; i < 40; i++) {
            uint256 action = _r(seed, i, 0) % 9;
            uint256 r = _r(seed, i, 1);
            if (action == 0) _stepDeposit(r);
            else if (action == 1) _stepOpen(r);
            else if (action == 2) _stepRepay(r);
            else if (action == 3) _stepMarkup(r);
            else if (action == 4) _stepFinalLoss(r);
            else if (action == 5) _stepFinalize(r);
            else if (action == 6) _stepDonate(r);
            else if (action == 7) _stepSeed(r);
            else _stepMarkup(r >> 3);
            _assertAgrees();
        }
    }

    function _stepDeposit(uint256 r) internal {
        address u = users[r % 3];
        uint256 amount = 1 + (r >> 8) % (30 * USDC1);
        uint256 expected = (amount * mShares) / (mIdle + mOut); // supply and NAV stay positive in this model
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
        bool allowed = mIds.length < 32 && mPrimary >= 400_000 && mTail >= 600_000 && mOut + p <= 100 * USDC1
            && (mOut + p) * 10_000 <= nav * 9_500 && mExposure[t] + p <= 10 * USDC1 && mIdle >= 2 * p
            && (mIdle - p) * 10_000 >= nav * 500;
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

    /// @dev Index of the n-th position (n = r % count) among those with remaining principal, if any.
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

    function _reduce(uint256 id, uint256 amount) internal {
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
        _reduce(id, amount);
    }

    /// @dev Collected markup on any live position, including one at zero principal.
    function _stepMarkup(uint256 r) internal {
        if (mIds.length == 0) return;
        uint256 id = mIds[r % mIds.length];
        uint256 payment = 1 + (r >> 8) % (3 * USDC1);
        uint256 cum = mCum[id] + payment;
        uint256 lpTotal = (cum * 7_700) / 10_000;
        uint256 lpInc = lpTotal - mLp[id];
        uint256 manager = payment - lpInc;
        mCum[id] = cum;
        mLp[id] = lpTotal;
        mIdle += lpInc;
        uint256 toP = manager < 400_000 - _min(mPrimary, 400_000) ? manager : 400_000 - _min(mPrimary, 400_000);
        mPrimary += toP;
        manager -= toP;
        uint256 toT = manager < 600_000 - _min(mTail, 600_000) ? manager : 600_000 - _min(mTail, 600_000);
        mTail += toT;
        manager -= toT;
        mManager += manager;
        engine.recordCollectedMarkup(id, payment);
    }

    function _stepFinalLoss(uint256 r) internal {
        (bool any, uint256 idx) = _pickWithPrincipal(r);
        if (!any) return;
        uint256 id = mIds[idx];
        uint256 proceeds = (r >> 8) % mRemaining[id]; // 0 .. remaining - 1: a shortfall always remains
        uint256 gross = mRemaining[id] - proceeds;
        uint256 fromP = _min(gross, mPrimary);
        uint256 fromT = _min(gross - fromP, mTail);
        uint256 fromB = _min(gross - fromP - fromT, mBackstop);
        mPrimary -= fromP;
        mTail -= fromT;
        mBackstop -= fromB;
        mIdle += proceeds + fromP + fromT + fromB;
        _reduce(id, mRemaining[id]);
        engine.finalLoss(id, proceeds);
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

    function _stepDonate(uint256 r) internal {
        uint256 amount = 1 + r % USDC1;
        usdc.mint(address(this), amount);
        usdc.transfer(address(vault), amount);
        mDonated += amount;
    }

    function _stepSeed(uint256 r) internal {
        uint256 amount = 1 + r % (2 * USDC1);
        uint256 kind = (r >> 8) % 3;
        usdc.mint(treasury, amount);
        vm.startPrank(treasury);
        usdc.approve(address(vault), amount);
        vault.seedProtection(MarginVault.ProtectionKind(kind), amount);
        vm.stopPrank();
        if (kind == 0) mPrimary += amount;
        else if (kind == 1) mTail += amount;
        else mBackstop += amount;
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _assertAgrees() internal view {
        assertEq(vault.depositorIdleCash(), mIdle, "idle");
        assertEq(vault.outstandingPrincipal(), mOut, "outstanding");
        assertEq(vault.nav(), mIdle + mOut, "nav");
        assertEq(vault.totalShares(), mShares, "shares");
        assertEq(vault.primaryReserve(), mPrimary, "primary");
        assertEq(vault.tailReserve(), mTail, "tail");
        assertEq(vault.pilotBackstop(), mBackstop, "backstop");
        assertEq(vault.managerCash(), mManager, "manager cash");
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
            assertEq(vault.markupCollected(mIds[i]), mCum[mIds[i]], "cumulative markup");
            assertEq(vault.lpMarkupAllocated(mIds[i]), mLp[mIds[i]], "cumulative LP share");
        }
        // Custody equality: every recorded bucket plus the explicit donations is exactly the token balance.
        assertEq(
            usdc.balanceOf(address(vault)), mIdle + mPrimary + mTail + mBackstop + mManager + mDonated, "custody"
        );
        assertTrue(vault.isFullyBacked());
        assertEq(vault.commitments(), 0);
    }
}
