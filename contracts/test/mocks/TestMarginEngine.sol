// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MarginVault} from "../../src/MarginVault.sol";
import {IMarginEngineView} from "../../src/interfaces/IMarginVaultEngine.sol";
import {TestERC20} from "./TestERC20.sol";

/// @notice UNIT-TEST ONLY minimal engine stub until the real engine is wired. It forwards calls to the vault from the
/// bound engine address, holds the gross purchase cash a real engine would swap, and reports configurable position
/// values and price freshness to the vault's impairment scan. It has no access control by design.
contract TestMarginEngine is IMarginEngineView {
    MarginVault public vault;
    TestERC20 public usdc;

    mapping(uint256 => uint256) private _value;
    mapping(uint256 => bool) private _hasValue;
    mapping(uint256 => bool) public stale;

    constructor(TestERC20 usdc_) {
        usdc = usdc_;
    }

    function setVault(MarginVault vault_) external {
        vault = vault_;
        usdc.approve(address(vault_), type(uint256).max);
    }

    // ---- scan inputs: a position without an explicit value is comfortably healthy
    function setValue(uint256 id, uint256 value) external {
        _value[id] = value;
        _hasValue[id] = true;
    }

    function clearValue(uint256 id) external {
        _hasValue[id] = false;
    }

    function setStale(uint256 id, bool isStale) external {
        stale[id] = isStale;
    }

    function positionValue(uint256 id) external view returns (uint256, bool) {
        return (_hasValue[id] ? _value[id] : type(uint128).max, !stale[id]);
    }

    // ---- origination, in the order the production engine must follow:
    //      reserve (vault sends gross 2P) -> acquire (engine spends gross) -> equity arrives -> confirm (vault pulls P).
    //      A real engine does all of it in one transaction; the stub exposes the steps so tests can interleave them.
    address public constant SINK = address(0xdead); // stands in for the swap venue that receives the gross cash
    mapping(uint256 => uint256) public principalOf;

    /// @dev Funds the stub as the trader or engine treasury would (for repayments and the like).
    function fund(uint256 amount) external {
        usdc.mint(address(this), amount);
    }

    function reserveOpen(uint256 id, address account, uint256 principal) external returns (uint256) {
        principalOf[id] = principal;
        return vault.reserveOpen(id, account, principal);
    }

    /// @dev The engine spends the whole gross cash on the collateral.
    function acquire(uint256 id) public {
        usdc.transfer(SINK, principalOf[id] * 2);
    }

    /// @dev The trader's equity arrives only after the acquisition.
    function receiveEquity(uint256 id) public {
        usdc.mint(address(this), principalOf[id]);
    }

    function confirmOpen(uint256 id) external {
        vault.confirmOpen(id);
    }

    function cancelOpen(uint256 id) external {
        vault.cancelOpen(id);
    }

    /// @dev acquire + equity + confirm for an already reserved open.
    function completeOpen(uint256 id) public {
        acquire(id);
        receiveEquity(id);
        vault.confirmOpen(id);
    }

    function openFull(uint256 id, address account, uint256 principal) external {
        principalOf[id] = principal;
        vault.reserveOpen(id, account, principal);
        completeOpen(id);
    }

    /// @dev An atomic open whose equity never arrives: the confirm must fail and revert the reserve too.
    function openAtomicWithoutEquity(uint256 id, address account, uint256 principal) external {
        principalOf[id] = principal;
        vault.reserveOpen(id, account, principal);
        acquire(id);
        vault.confirmOpen(id);
    }

    // ---- accounting passthroughs. Cash that would come from the trader's wallet is minted to the stub first.
    function repayPrincipal(uint256 id, uint256 amount) external {
        usdc.mint(address(this), amount);
        vault.repayPrincipal(id, amount);
    }

    function creditLpMarkup(uint256 amount) external {
        usdc.mint(address(this), amount);
        vault.creditLpMarkup(amount);
    }

    function writeOffPrincipal(uint256 id, uint256 amount) external {
        vault.writeOffPrincipal(id, amount);
    }

    function finalizePosition(uint256 id) external {
        vault.finalizePosition(id);
    }
}
