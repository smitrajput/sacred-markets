// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarginVault} from "../src/MarginVault.sol";
import {VaultBase} from "./VaultBase.sol";

/// @notice Randomized sequences over the whole vault surface including the FIFO queue. After every step the
/// structural invariants must hold, whatever mix of reverts and successes the sequence produced. Calls that may
/// legitimately revert are made with low-level calls; the invariants are what is asserted.
contract MarginVaultInvariantsTest is VaultBase {
    address[4] internal users;
    address[3] internal traders;
    uint256 internal nextId = 1;
    uint256[] internal ids;
    uint256 internal opened;

    function setUp() public override {
        super.setUp();
        users = [alice, bob, carol, makeAddr("dave")];
        traders = [trader1, trader2, makeAddr("trader3")];
        _seedTargets();
        _deposit(alice, 30 * USDC1);
        _deposit(bob, 20 * USDC1);
    }

    function _r(uint256 seed, uint256 i, uint256 salt) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, i, salt)));
    }

    function testFuzz_structuralInvariantsHoldAcrossRandomSequences(uint256 seed) public {
        for (uint256 i; i < 40; i++) {
            uint256 r = _r(seed, i, 1);
            uint256 action = _r(seed, i, 0) % 9;
            address u = users[r % 4];
            if (action == 0) _try(u, abi.encodeCall(MarginVault.deposit, ((r >> 8) % (15 * USDC1) + 1, 0, vault.MANDATE_HASH())), true);
            else if (action == 1) _try(u, abi.encodeCall(MarginVault.requestWithdraw, ((r >> 8) % (20 * USDC1) + 1)), false);
            else if (action == 2) _try(address(0xbeef), abi.encodeCall(MarginVault.processWithdrawals, ((r >> 8) % 20)), false);
            else if (action == 3) _try(u, abi.encodeCall(MarginVault.claim, ()), false);
            else if (action == 4) _open_(r);
            else if (action == 5) _repayOrWriteOff(r);
            else if (action == 6) _try(address(engine), abi.encodeCall(engine.creditLpMarkup, ((r >> 8) % USDC1 + 1)), false);
            else if (action == 7) _finalize(r);
            else _try(u, abi.encodeCall(MarginVault.burnWorthlessShares, ((r >> 8) % USDC1 + 1)), false);
            _assertInvariants();
        }
    }

    function _try(address from, bytes memory data, bool needsFunds) internal {
        address target = from == address(engine) ? address(engine) : address(vault);
        if (needsFunds) {
            (uint256 amount) = abi.decode(_slice(data, 4, 32), (uint256));
            usdc.mint(from, amount);
            vm.prank(from);
            usdc.approve(address(vault), amount);
        }
        vm.prank(from);
        (bool ok,) = target.call(data);
        ok;
    }

    function _slice(bytes memory b, uint256 start, uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i; i < len; i++) out[i] = b[start + i];
    }

    function _open_(uint256 r) internal {
        uint256 id = nextId++;
        try engine.openFull(id, traders[r % 3], (r >> 8) % (6 * USDC1) + 1) {
            ids.push(id);
            opened++;
        } catch {}
    }

    function _repayOrWriteOff(uint256 r) internal {
        if (ids.length == 0) return;
        uint256 id = ids[r % ids.length];
        (, , , uint256 remaining,) = vault.positions(id);
        if (remaining == 0) return;
        uint256 amount = (r >> 8) % remaining + 1;
        if ((r >> 40) % 2 == 0) engine.repayPrincipal(id, amount);
        else engine.writeOffPrincipal(id, amount);
    }

    function _finalize(uint256 r) internal {
        if (ids.length == 0) return;
        uint256 id = ids[r % ids.length];
        (MarginVault.PositionStatus st,,, uint256 remaining,) = vault.positions(id);
        if (st == MarginVault.PositionStatus.Live && remaining == 0) engine.finalizePosition(id);
    }

    function _assertInvariants() internal view {
        assertTrue(vault.isFullyBacked(), "custody");
        assertEq(vault.nav(), vault.depositorIdleCash() + vault.outstandingPrincipal(), "nav");

        uint256 sumShares;
        uint256 sumLocked;
        uint256 sumClaimable;
        for (uint256 i; i < 4; i++) {
            uint256 sh = vault.sharesOf(users[i]);
            uint256 lk = vault.lockedShares(users[i]);
            assertLe(lk, sh, "locked <= owned");
            sumShares += sh;
            sumLocked += lk;
            sumClaimable += vault.claimable(users[i]);
        }
        assertEq(sumShares, vault.totalShares(), "share conservation");
        assertEq(sumClaimable, vault.claimableWithdrawals(), "claimable conservation");

        // locked shares equal the unfilled shares sitting in the queue; active count matches
        uint256 queued;
        uint256 active;
        for (uint256 id = vault.queueHead(); id < vault.queueTail(); id++) {
            (, uint256 left) = vault.withdrawalRequests(id);
            queued += left;
            active += 1;
        }
        assertEq(queued, sumLocked, "queue vs locked");
        assertEq(active, vault.activeRequests(), "active requests");
        assertLe(active, 64);

        // the last-share guard: a live position always has at least one share behind it
        if (vault.liveCount() > 0) assertGe(vault.totalShares(), 1, "orphaned positions");
        // principal bookkeeping
        uint256 sumRemaining;
        for (uint256 i; i < ids.length; i++) {
            (, , , uint256 remaining,) = vault.positions(ids[i]);
            sumRemaining += remaining;
        }
        assertEq(sumRemaining, vault.outstandingPrincipal(), "outstanding");
        assertEq(vault.pendingOpens(), 0);
        assertEq(vault.commitments(), 0);
    }
}
