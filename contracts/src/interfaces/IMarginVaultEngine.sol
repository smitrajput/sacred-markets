// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IMarginVaultEngine
/// @notice The small surface the margin engine uses on MarginVault. Every function is callable only by the one bound
///         engine. USDC flows are pull-based: the engine approves the vault, and the vault measures what it receives.
/// @dev Origination, principal return, finalization and the two NAV primitives (`creditLpMarkup`,
///      `writeOffPrincipal`). Checkpoint 01c puts the 77/23 markup split and the loss waterfall in front of those two
///      primitives; their signatures here are what the vault records after that routing.
interface IMarginVaultEngine {
    /// @notice Reserve a financing commitment and send `2 * principal` of gross purchase cash to the engine, funded
    ///         entirely from existing recorded depositor idle cash. Trader equity is NOT received here.
    /// @dev Eligibility checks and the commitment are recorded before the transfer. Pending gross cash is tracked
    ///      separately from the principal commitment. Reverts unless recorded free depositor cash (idle minus pending
    ///      gross) is at least `2 * principal`; reserves, manager cash, claims and donations never count as lendable.
    function reserveOpen(uint256 id, address account, uint256 principal) external returns (uint256 grossCash);

    /// @notice The engine acquired the collateral and holds the trader's equity: the vault now pulls equity equal to
    ///         `principal`, and the position becomes outstanding. Net idle falls by `principal`. Allowed while paused.
    /// @dev The production engine performs reserve, acquisition, resale, equity receipt and confirm in ONE transaction,
    ///      so any failure (including a failed equity pull) reverts the whole open.
    function confirmOpen(uint256 id) external;

    /// @notice The open failed before confirmation: the engine returns the full `2 * principal` and the reservation
    ///         is released.
    function cancelOpen(uint256 id) external;

    /// @notice Principal returned to depositors. The position stays live at zero principal because markup may still be
    ///         owed. Allowed while funding is paused. Never subject to a price check.
    function repayPrincipal(uint256 id, uint256 amount) external;

    /// @notice LP share of collected markup, already split by the engine. Raises NAV for all current shares.
    function creditLpMarkup(uint256 amount) external;

    /// @notice Principal lost after protection buckets were exhausted. Lowers NAV. No cash moves. The position stays
    ///         live at zero principal until finalized.
    function writeOffPrincipal(uint256 id, uint256 amount) external;

    /// @notice Final closure, only with recorded principal of zero: the engine calls it after the full debt is paid or
    ///         unpaid markup is written off. Removes the position from the bounded live set exactly once.
    function finalizePosition(uint256 id) external;
}

/// @notice What the vault asks the engine for in its impairment scan.
interface IMarginEngineView {
    /// @param netCollateralValue Fresh, conservative collateral value net of execution friction, in USDC atoms.
    /// @param priceFresh False when the price is older than the allowed age.
    function positionValue(uint256 id) external view returns (uint256 netCollateralValue, bool priceFresh);
}
