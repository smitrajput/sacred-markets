// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MarginVault} from "../src/MarginVault.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {TestMarginEngine} from "./mocks/TestMarginEngine.sol";

/// @notice Shared setup for MarginVault unit tests. Demo sizing from the brief: ceiling 100 USDC, per-account cap 10.
/// Every expectation in the tests is computed by hand in the test from its own inputs, never read back from the vault.
abstract contract VaultBase is Test {
    uint256 internal constant USDC1 = 1e6;
    uint256 internal constant CEILING = 100e6;
    uint256 internal constant CAP = 10e6;

    TestERC20 internal usdc;
    MarginVault internal vault;
    TestMarginEngine internal engine;

    address internal deployer = makeAddr("deployer");
    address internal guardian = makeAddr("guardian");
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal trader1 = makeAddr("trader1");
    address internal trader2 = makeAddr("trader2");

    bytes32 internal mandate;

    function setUp() public virtual {
        usdc = new TestERC20("USD Coin", "USDC", 6);
        (vault, engine) = _deployVault(CEILING, CAP);
        mandate = vault.MANDATE_HASH();
    }

    function _deployVault(uint256 ceiling, uint256 cap) internal returns (MarginVault v, TestMarginEngine e) {
        e = new TestMarginEngine(usdc);
        v = new MarginVault(IERC20(address(usdc)), guardian, treasury, deployer, ceiling, cap);
        vm.prank(deployer);
        v.bindEngine(address(e));
        e.setVault(v);
    }

    function _seed(MarginVault v, uint256 primary, uint256 tail) internal {
        usdc.mint(treasury, primary + tail);
        vm.startPrank(treasury);
        usdc.approve(address(v), type(uint256).max);
        if (primary > 0) v.seedProtection(MarginVault.ProtectionKind.Primary, primary);
        if (tail > 0) v.seedProtection(MarginVault.ProtectionKind.Tail, tail);
        vm.stopPrank();
    }

    function _seedTargets() internal {
        _seed(vault, 400_000, 600_000); // 0.4% and 0.6% of the 100 USDC ceiling
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        return _depositTo(vault, who, amount);
    }

    function _depositTo(MarginVault v, address who, uint256 amount) internal returns (uint256 shares) {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(v), amount);
        shares = v.deposit(amount, 0, v.MANDATE_HASH());
        vm.stopPrank();
    }

    function _open(uint256 id, address account, uint256 principal) internal {
        engine.openFull(id, account, principal);
    }

    /// @dev Uses the full 1 USDC of protection seeded by `_seedTargets()` (0.4 primary + 0.6 tail) by opening and
    /// completely losing a 1 USDC position, so later final losses are uncovered. The position is finalized; net idle
    /// cash is unchanged because the covered principal returns to idle. Needs 2 USDC of free idle cash and an unused id.
    function _drainReserves(uint256 id) internal {
        engine.openFull(id, makeAddr("reserveDrain"), 1 * USDC1);
        engine.finalLoss(id, 0);
        engine.finalizePosition(id);
        assertEq(vault.primaryReserve() + vault.tailReserve(), 0, "reserves drained");
    }
}
