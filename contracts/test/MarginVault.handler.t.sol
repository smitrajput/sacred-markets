// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {MarginVault} from "../src/MarginVault.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {TestMarginEngine} from "./mocks/TestMarginEngine.sol";
import {VaultBase} from "./VaultBase.sol";

/// @notice Bounded actions for the invariant run. Actors are pre-funded and pre-approved, every action checks its
/// own preconditions first so reverts stay rare, and the actions that carry money rules (markup split, loss waterfall,
/// share pricing, claims, seeding) check their effect against independently computed expectations and raise a flag the
/// invariants read. Only the configured USDC is involved.
contract VaultHandler is Test {
    MarginVault public vault;
    TestMarginEngine public engine;
    TestERC20 public usdc;
    address public treasury;
    address public guardian;
    address[4] public lps;
    address[3] public traders;

    uint256 public nextId = 1;
    uint256[] internal liveList; // ids the vault should consider live (including principal zero)
    mapping(uint256 => uint256) public cum; // independent per-position collected markup
    mapping(uint256 => uint256) public lpAlloc; // independent per-position LP allocation

    // ghost accounting
    uint256 public donated;
    uint256 public reservedTotal;
    uint256 public claimedTotal;
    // call statistics
    uint256 public attempts;
    uint256 public skips;
    uint256 public unexpectedReverts;
    mapping(bytes32 => uint256) public ok;
    mapping(bytes32 => uint256) public failed;
    string[] internal names;
    // flags raised when an independent expectation fails
    bool public wrongShares;
    bool public wrongMarkupSplit;
    bool public wrongLossWaterfall;
    bool public wrongClaim;
    bool public seedMovedNav;
    bool public wrongFill;

    constructor(MarginVault v, TestMarginEngine e, TestERC20 u, address treasury_, address guardian_, address[4] memory lps_, address[3] memory traders_) {
        vault = v;
        engine = e;
        usdc = u;
        treasury = treasury_;
        guardian = guardian_;
        lps = lps_;
        traders = traders_;
    }

    // ------------------------------------------------------------------ bookkeeping

    function _skip() internal {
        skips++;
    }

    function _done(string memory name, bool success) internal {
        attempts++;
        if (success) {
            bytes32 k = keccak256(bytes(name));
            if (ok[k]++ == 0) names.push(name);
        } else {
            unexpectedReverts++;
            bytes32 k = keccak256(bytes(name));
            if (failed[k]++ == 0 && ok[k] == 0) names.push(name);
        }
    }

    function count(string memory name) external view returns (uint256) {
        return ok[keccak256(bytes(name))];
    }

    function liveCountGhost() external view returns (uint256) {
        return liveList.length;
    }

    function liveIdAtGhost(uint256 i) external view returns (uint256) {
        return liveList[i];
    }

    function _nav() internal view returns (uint256) {
        return vault.depositorIdleCash() + vault.outstandingPrincipal();
    }

    function _pick(uint256 seed, bool needPrincipal) internal view returns (bool, uint256 id, uint256 idx) {
        uint256 n = liveList.length;
        for (uint256 k; k < n; k++) {
            uint256 i = (seed + k) % n;
            (, , , uint256 remaining,) = vault.positions(liveList[i]);
            if (!needPrincipal || remaining > 0) return (true, liveList[i], i);
        }
        return (false, 0, 0);
    }

    function _removeLive(uint256 idx) internal {
        liveList[idx] = liveList[liveList.length - 1];
        liveList.pop();
    }

    function _financingOpen() internal view returns (bool) {
        return !vault.fundingPaused() && vault.queueHead() == vault.queueTail() && vault.pendingOpens() == 0
            && vault.primaryReserve() >= vault.primaryTarget() && vault.tailReserve() >= vault.tailTarget();
    }

    function _openBound(uint256 traderSeed, uint256 principalSeed) internal view returns (bool, address, uint256) {
        if (!_financingOpen() || vault.liveCount() >= 32) return (false, address(0), 0);
        address t = traders[traderSeed % 3];
        uint256 room = vault.perAccountCap() - vault.accountExposure(t);
        uint256 max = vault.financingHeadroom();
        if (room < max) max = room;
        if (max == 0) return (false, address(0), 0);
        return (true, t, bound(principalSeed, 1, max));
    }

    // ------------------------------------------------------------------ depositor actions

    function deposit(uint256 actorSeed, uint256 amountSeed) external {
        address who = lps[actorSeed % 4];
        uint256 amount = bound(amountSeed, 10_000, 20 * 1e6);
        uint256 supply = vault.totalShares();
        uint256 nav = _nav();
        uint256 expected;
        if (vault.fundingPaused() || vault.queueHead() != vault.queueTail() || vault.pendingOpens() != 0) return _skip();
        if (supply == 0) {
            if (nav != 0 || vault.liveCount() != 0) return _skip();
            expected = amount;
        } else {
            if (nav == 0) return _skip();
            expected = Math.mulDiv(amount, supply, nav);
            if (expected == 0) return _skip();
        }
        bytes32 mandate = vault.MANDATE_HASH(); // read before the prank, which applies to the next call only
        vm.prank(who);
        try vault.deposit(amount, 0, mandate) returns (uint256 shares) {
            if (shares != expected) wrongShares = true;
            _done("deposit", true);
        } catch {
            _done("deposit", false);
        }
    }

    function requestWithdraw(uint256 actorSeed, uint256 sharesSeed) external {
        address who = lps[actorSeed % 4];
        uint256 available = vault.sharesOf(who) - vault.lockedShares(who);
        if (available == 0 || vault.activeRequests() >= 64) return _skip();
        vm.prank(who);
        try vault.requestWithdraw(bound(sharesSeed, 1, available)) {
            _done("requestWithdraw", true);
        } catch {
            _done("requestWithdraw", false);
        }
    }

    function process(uint256 nSeed) external {
        if (vault.queueHead() == vault.queueTail() || vault.pendingOpens() != 0) return _skip();
        uint256 idle0 = vault.depositorIdleCash();
        uint256 claim0 = vault.claimableWithdrawals();
        try vault.processWithdrawals(bound(nSeed, 1, 20)) {
            uint256 reserved = vault.claimableWithdrawals() - claim0;
            if (idle0 - vault.depositorIdleCash() != reserved) wrongFill = true; // cash leaves idle exactly into claims
            reservedTotal += reserved;
            _done("process", true);
        } catch {
            _done("process", false);
        }
    }

    function claim(uint256 actorSeed) external {
        address who = lps[actorSeed % 4];
        uint256 owed = vault.claimable(who);
        if (owed == 0) return _skip();
        uint256 nav0 = _nav();
        uint256 bal0 = usdc.balanceOf(who);
        vm.prank(who);
        try vault.claim() returns (uint256 amount) {
            if (amount != owed || usdc.balanceOf(who) - bal0 != owed || _nav() != nav0) wrongClaim = true;
            claimedTotal += amount;
            _done("claim", true);
        } catch {
            _done("claim", false);
        }
    }

    function burnWorthless(uint256 actorSeed) external {
        address who = lps[actorSeed % 4];
        uint256 available = vault.sharesOf(who) - vault.lockedShares(who);
        if (_nav() != 0 || available == 0 || vault.pendingOpens() != 0) return _skip();
        vm.prank(who);
        try vault.burnWorthlessShares(available) {
            _done("burnWorthless", true);
        } catch {
            // refused only by the last-share guard while a position is live; that is the intended behaviour
            _skip();
        }
    }

    // ------------------------------------------------------------------ engine actions

    function open(uint256 traderSeed, uint256 principalSeed) external {
        (bool can, address t, uint256 p) = _openBound(traderSeed, principalSeed);
        if (!can) return _skip();
        uint256 id = nextId++;
        try engine.openFull(id, t, p) {
            liveList.push(id);
            _done("open", true);
        } catch {
            _done("open", false);
        }
    }

    function reserveThenCancel(uint256 traderSeed, uint256 principalSeed) external {
        (bool can, address t, uint256 p) = _openBound(traderSeed, principalSeed);
        if (!can) return _skip();
        uint256 id = nextId++;
        uint256 bal0 = usdc.balanceOf(address(vault));
        uint256 idle0 = vault.depositorIdleCash();
        try engine.reserveOpen(id, t, p) {
            engine.cancelOpen(id); // atomic: nothing stays pending between actions
            if (usdc.balanceOf(address(vault)) != bal0 || vault.depositorIdleCash() != idle0) wrongFill = true;
            _done("reserveThenCancel", true);
        } catch {
            _done("reserveThenCancel", false);
        }
    }

    function repay(uint256 idSeed, uint256 amountSeed) external {
        (bool any, uint256 id,) = _pick(idSeed, true);
        if (!any) return _skip();
        (, , , uint256 remaining,) = vault.positions(id);
        try engine.repayPrincipal(id, bound(amountSeed, 1, remaining)) {
            _done("repay", true);
        } catch {
            _done("repay", false);
        }
    }

    function collectMarkup(uint256 idSeed, uint256 paymentSeed) external {
        (bool any, uint256 id,) = _pick(idSeed, false);
        if (!any) return _skip();
        uint256 payment = bound(paymentSeed, 1, 5 * 1e6);
        // independent expectation
        uint256 c = cum[id] + payment;
        uint256 lpTotal = (c * 7_700) / 10_000;
        uint256 lpInc = lpTotal - lpAlloc[id];
        uint256 mgr = payment - lpInc;
        uint256 pDef = vault.primaryTarget() > vault.primaryReserve() ? vault.primaryTarget() - vault.primaryReserve() : 0;
        uint256 toP = mgr < pDef ? mgr : pDef;
        uint256 tDef = vault.tailTarget() > vault.tailReserve() ? vault.tailTarget() - vault.tailReserve() : 0;
        uint256 toT = (mgr - toP) < tDef ? (mgr - toP) : tDef;
        uint256 toM = mgr - toP - toT;
        uint256[5] memory pre = [vault.depositorIdleCash(), vault.primaryReserve(), vault.tailReserve(), vault.managerCash(), usdc.balanceOf(address(vault))];
        try engine.recordCollectedMarkup(id, payment) {
            cum[id] = c;
            lpAlloc[id] = lpTotal;
            if (
                vault.depositorIdleCash() - pre[0] != lpInc || vault.primaryReserve() - pre[1] != toP
                    || vault.tailReserve() - pre[2] != toT || vault.managerCash() - pre[3] != toM
                    || usdc.balanceOf(address(vault)) - pre[4] != payment
            ) wrongMarkupSplit = true;
            _done("collectMarkup", true);
        } catch {
            _done("collectMarkup", false);
        }
    }

    function finalLoss(uint256 idSeed, uint256 proceedsSeed) external {
        (bool any, uint256 id,) = _pick(idSeed, true);
        if (!any) return _skip();
        (, , , uint256 remaining,) = vault.positions(id);
        uint256 proceeds = remaining == 1 ? 0 : bound(proceedsSeed, 0, remaining - 1);
        uint256 gross = remaining - proceeds;
        uint256 fromP = gross < vault.primaryReserve() ? gross : vault.primaryReserve();
        uint256 fromT = (gross - fromP) < vault.tailReserve() ? (gross - fromP) : vault.tailReserve();
        uint256 fromB = (gross - fromP - fromT) < vault.pilotBackstop() ? (gross - fromP - fromT) : vault.pilotBackstop();
        uint256 uncovered = gross - fromP - fromT - fromB;
        uint256 navBefore = _nav();
        uint256 bal0 = usdc.balanceOf(address(vault));
        uint256 prim0 = vault.primaryReserve();
        uint256 tail0 = vault.tailReserve();
        uint256 back0 = vault.pilotBackstop();
        uint256 mgr0 = vault.managerCash();
        try engine.finalLoss(id, proceeds) {
            if (
                prim0 - vault.primaryReserve() != fromP || tail0 - vault.tailReserve() != fromT
                    || back0 - vault.pilotBackstop() != fromB || vault.managerCash() != mgr0
                    || usdc.balanceOf(address(vault)) - bal0 != proceeds || navBefore - _nav() != uncovered
            ) wrongLossWaterfall = true;
            _done("finalLoss", true);
        } catch {
            _done("finalLoss", false);
        }
    }

    function finalize(uint256 idSeed) external {
        uint256 n = liveList.length;
        for (uint256 k; k < n; k++) {
            uint256 i = (idSeed + k) % n;
            (, , , uint256 remaining,) = vault.positions(liveList[i]);
            if (remaining != 0) continue;
            try engine.finalizePosition(liveList[i]) {
                _removeLive(i);
                _done("finalize", true);
            } catch {
                _done("finalize", false);
            }
            return;
        }
        _skip();
    }

    // ------------------------------------------------------------------ third parties and operators

    function donate(uint256 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 1e6);
        usdc.mint(address(this), amount);
        usdc.transfer(address(vault), amount);
        donated += amount;
        _done("donate", true);
    }

    /// @dev Paused one time in eight, so financing stays open for most of a run.
    function setPaused(uint256 seed) external {
        vm.prank(guardian);
        vault.setFundingPaused(seed % 8 == 0);
        _done("setPaused", true);
    }

    function seedProtection(uint256 kindSeed, uint256 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 3 * 1e6);
        usdc.mint(treasury, amount);
        uint256 nav0 = _nav();
        uint256 shares0 = vault.totalShares();
        vm.prank(treasury);
        try vault.seedProtection(MarginVault.ProtectionKind(kindSeed % 3), amount) {
            if (_nav() != nav0 || vault.totalShares() != shares0) seedMovedNav = true;
            _done("seedProtection", true);
        } catch {
            _done("seedProtection", false);
        }
    }

    function summary() external view returns (string memory out) {
        for (uint256 i; i < names.length; i++) {
            bytes32 k = keccak256(bytes(names[i]));
            out = string.concat(out, names[i], "=", vm.toString(ok[k]), "/", vm.toString(failed[k]), " ");
        }
    }
}

/// @notice Handler-driven invariants over the whole vault surface. Default 256 runs; depth trimmed so the run stays quick.
/// forge-config: default.invariant.depth = 120
contract MarginVaultHandlerInvariantTest is VaultBase {
    VaultHandler internal h;
    address[4] internal lps;
    address[3] internal traders;

    function setUp() public override {
        super.setUp();
        lps = [alice, bob, carol, makeAddr("dave")];
        traders = [trader1, trader2, makeAddr("trader3")];
        _seedTargets();
        usdc.mint(treasury, 2 * USDC1);
        vm.prank(treasury);
        vault.seedProtection(MarginVault.ProtectionKind.Backstop, 2 * USDC1);

        _deposit(alice, 40 * USDC1); // the helper sets an exact allowance, so approvals below come after it
        h = new VaultHandler(vault, engine, usdc, treasury, guardian, lps, traders);
        for (uint256 i; i < 4; i++) {
            usdc.mint(lps[i], 1_000_000 * USDC1); // funded actors
            vm.prank(lps[i]);
            usdc.approve(address(vault), type(uint256).max); // approved actors
        }
        vm.prank(treasury);
        usdc.approve(address(vault), type(uint256).max);

        targetContract(address(h));
        bytes4[14] memory sels = [
            VaultHandler.deposit.selector, VaultHandler.requestWithdraw.selector, VaultHandler.process.selector,
            VaultHandler.claim.selector, VaultHandler.burnWorthless.selector, VaultHandler.open.selector,
            VaultHandler.reserveThenCancel.selector, VaultHandler.repay.selector, VaultHandler.collectMarkup.selector,
            VaultHandler.finalLoss.selector, VaultHandler.finalize.selector, VaultHandler.donate.selector,
            VaultHandler.setPaused.selector, VaultHandler.seedProtection.selector
        ];
        bytes4[] memory list = new bytes4[](14);
        for (uint256 i; i < 14; i++) list[i] = sels[i];
        targetSelector(FuzzSelector({addr: address(h), selectors: list}));
    }

    // ---------------------------------------------------------------- invariants

    function invariant_sharesAreConserved_andQueueMatchesLockedShares() public view {
        uint256 sum;
        uint256 locked;
        uint256 claimable;
        for (uint256 i; i < 4; i++) {
            uint256 s = vault.sharesOf(lps[i]);
            uint256 l = vault.lockedShares(lps[i]);
            assertLe(l, s, "locked <= owned");
            sum += s;
            locked += l;
            claimable += vault.claimable(lps[i]);
        }
        assertEq(sum, vault.totalShares(), "share conservation");
        uint256 queued;
        uint256 active;
        for (uint256 id = vault.queueHead(); id < vault.queueTail(); id++) {
            (, uint256 left) = vault.withdrawalRequests(id);
            queued += left;
            active++;
        }
        assertEq(queued, locked, "queued shares equal locked shares");
        assertEq(active, vault.activeRequests(), "active requests");
        assertLe(active, 64, "request cap");
        assertEq(claimable, vault.claimableWithdrawals(), "claimable sums to the reserved total");
    }

    function invariant_recordedBucketsPlusDonationsEqualTokenCustody() public view {
        assertEq(
            usdc.balanceOf(address(vault)),
            vault.depositorIdleCash() + vault.primaryReserve() + vault.tailReserve() + vault.pilotBackstop()
                + vault.managerCash() + vault.claimableWithdrawals() + h.donated(),
            "custody"
        );
        assertTrue(vault.isFullyBacked());
        assertEq(vault.pendingGrossCash(), 0);
        assertEq(vault.commitments(), 0);
    }

    function invariant_principalMatchesLivePositions_includingZeroPrincipalWithMarkupOwed() public view {
        uint256 sum;
        uint256 exposure;
        uint256 n = h.liveCountGhost();
        for (uint256 i; i < n; i++) {
            (MarginVault.PositionStatus st,,, uint256 remaining,) = vault.positions(h.liveIdAtGhost(i));
            assertEq(uint8(st), uint8(MarginVault.PositionStatus.Live), "tracked position is live");
            sum += remaining;
        }
        assertEq(vault.liveCount(), n, "live set matches");
        assertEq(vault.outstandingPrincipal(), sum, "outstanding equals the sum of live remaining principal");
        for (uint256 i; i < 3; i++) exposure += vault.accountExposure(traders[i]);
        assertEq(exposure, vault.outstandingPrincipal(), "account exposure equals outstanding");
        if (n > 0) assertGe(vault.totalShares(), 1, "a live position always has a share behind it");
    }

    function invariant_noClaimIsDebitedTwice_andNoReserveIsCountedAsNav() public view {
        assertEq(h.reservedTotal() - h.claimedTotal(), vault.claimableWithdrawals(), "reserved minus claimed is what remains");
        assertEq(vault.nav(), vault.depositorIdleCash() + vault.outstandingPrincipal(), "NAV formula");
        // everything outside NAV is accounted for separately; adding it back to NAV (less lent principal) is the custody
        assertEq(
            vault.nav() + vault.primaryReserve() + vault.tailReserve() + vault.pilotBackstop() + vault.managerCash()
                + vault.claimableWithdrawals() + h.donated(),
            usdc.balanceOf(address(vault)) + vault.outstandingPrincipal(),
            "reserves, manager cash, claims and donations are not NAV"
        );
    }

    function invariant_independentExpectationsHeld() public view {
        assertFalse(h.wrongShares(), "share pricing");
        assertFalse(h.wrongMarkupSplit(), "77/23 split and replenishment order");
        assertFalse(h.wrongLossWaterfall(), "loss waterfall");
        assertFalse(h.wrongClaim(), "claim");
        assertFalse(h.seedMovedNav(), "seeding must not touch NAV or shares");
        assertFalse(h.wrongFill(), "withdrawal cash flow");
    }

    /// @dev Ceiling on handler-call reverts for every invariant run.
    function afterInvariant() public view {
        uint256 attempts = h.attempts();
        if (attempts >= 50) {
            assertLe(h.unexpectedReverts() * 20, attempts, string.concat("revert rate above 5%: ", h.summary()));
        }
    }

    /// @dev Call statistics. A long deterministic drive of the same handler proves the actions are exercised (not mostly
    /// skipped) and reports the figures recorded in the checkpoint file. Run with -vv to print them.
    function test_handlerCampaign_exercisesEveryActionWithFewReverts() public {
        uint256 total = 4_000;
        for (uint256 i; i < total; i++) {
            uint256 pick = uint256(keccak256(abi.encode("pick", i))) % 18;
            uint256 a = uint256(keccak256(abi.encode("a", i)));
            uint256 b = uint256(keccak256(abi.encode("b", i)));
            if (pick < 3) h.deposit(a, b);
            else if (pick < 5) h.requestWithdraw(a, b);
            else if (pick < 7) h.process(a);
            else if (pick == 7) h.claim(a);
            else if (pick == 8) h.burnWorthless(a);
            else if (pick < 12) h.open(a, b);
            else if (pick == 12) h.reserveThenCancel(a, b);
            else if (pick == 13) h.repay(a, b);
            else if (pick == 14) h.collectMarkup(a, b);
            else if (pick == 15) h.finalLoss(a, b);
            else if (pick == 16) h.finalize(a);
            else if (i % 3 == 0) h.donate(a);
            else if (i % 3 == 1) h.setPaused(a);
            else h.seedProtection(a, b);
            if (i % 250 == 0) _assertCampaignInvariants();
        }
        _assertCampaignInvariants();
        console2.log("handler calls:", total);
        console2.log("attempts (preconditions met):", h.attempts());
        console2.log("skipped (preconditions not met):", h.skips());
        console2.log("reverts:", h.unexpectedReverts());
        console2.log(h.summary());
        assertLe(h.unexpectedReverts() * 20, h.attempts(), "revert rate above 5%");
        assertGe(h.attempts() * 2, total, "at least half of all calls must reach the vault");
        assertGe(h.count("open"), 30);
        assertGe(h.count("collectMarkup"), 30);
        assertGe(h.count("finalLoss"), 5);
        assertGe(h.count("repay"), 10);
        assertGe(h.count("finalize"), 5);
        assertGe(h.count("deposit"), 20);
        assertGe(h.count("requestWithdraw"), 20);
        assertGe(h.count("process"), 20);
        assertGe(h.count("claim"), 10);
        assertGe(h.count("reserveThenCancel"), 5);
        assertGe(h.count("seedProtection"), 5);
    }

    function _assertCampaignInvariants() internal view {
        invariant_sharesAreConserved_andQueueMatchesLockedShares();
        invariant_recordedBucketsPlusDonationsEqualTokenCustody();
        invariant_principalMatchesLivePositions_includingZeroPrincipalWithMarkupOwed();
        invariant_noClaimIsDebitedTwice_andNoReserveIsCountedAsNav();
        invariant_independentExpectationsHeld();
    }
}
