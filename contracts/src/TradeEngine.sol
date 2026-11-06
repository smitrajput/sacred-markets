// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {MarginVault} from "./MarginVault.sol";
import {IMarginEngineView} from "./interfaces/IMarginVaultEngine.sol";
import {ISpotVenue} from "./interfaces/ISpotVenue.sol";
import {IDemoPriceGuard} from "./interfaces/IDemoPriceGuard.sol";
import {EngineMath} from "./libraries/EngineMath.sol";

/// @title TradeEngine
/// @notice Fixed-policy 2x spot financing of cirBTC against the MarginVault. The vault funds the full gross purchase
/// before any trader equity is collected; the engine acts as the disclosed purchasing agent and then the pledge
/// custodian. Policy is immutable: E = P, C = 2P, 14-day term, 10% annualized markup fixed at open (77/23 is split by
/// the vault on collected markup only), rebalance at 160% back to 190%, no interest growth, rollover, late fees or
/// trader-profit share. Debt and ownership are not transferable. There is no upgrade, rescue or admin withdrawal.
///
/// Reference prices come from the testnet operator fixture (DemoPriceGuard), never from pool spot. One reference is
/// read per price-dependent operation. Open, sales and the vault's fresh scan fail closed on a stale price; repayment,
/// release and claims do not read the oracle at all.
contract TradeEngine is IMarginEngineView, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Active,
        Closed
    }

    enum CloseKind {
        Owner,
        Matured,
        Coverage,
        CoverageDustFallback
    }

    struct Position {
        address trader;
        Status status;
        uint64 openedAt;
        uint64 maturesAt;
        uint256 grossCost; // USDC spent on the gross purchase (2P)
        uint256 principal0;
        uint256 principal; // remaining P
        uint256 markup0;
        uint256 markup; // remaining M
        uint256 collateral; // pledged cirBTC atoms
        uint256 collected; // cumulative collected markup
        uint256 lpAllocation; // floor(collected * 7700 / 10000), mirrors what the vault allocates (no second split)
        bytes32 termsHash;
    }

    uint256 public constant MAX_LIVE = 32;

    MarginVault public immutable vault;
    ISpotVenue public immutable venue;
    IDemoPriceGuard public immutable guard;
    IERC20 public immutable usdc;
    IERC20 public immutable cirBtc;
    uint256 public immutable frictionBps; // execution friction budget, demo 300, hard cap 460
    uint256 public immutable dust; // minimum principal left by a partial rebalance (and minimum opening principal)
    bytes32 public immutable termsHash;

    uint256 public nextId;
    mapping(uint256 => Position) internal _positions;
    uint256[] internal _active;
    mapping(uint256 => uint256) internal _activeSlot; // id => index + 1

    event AssetAcquired(uint256 indexed id, address indexed trader, uint256 cost, uint256 atoms, uint256 referencePrice);
    event DisclosedSaleAgreed(
        uint256 indexed id,
        address indexed trader,
        uint256 equity,
        uint256 principal,
        uint256 markup,
        uint256 atoms,
        bytes32 termsHash
    );
    event Pledged(uint256 indexed id, address indexed trader, uint256 atoms, bytes32 termsHash);
    event Opened(uint256 indexed id, address indexed trader, uint256 maturesAt);
    event Repaid(uint256 indexed id, address indexed payer, uint256 principalPaid, uint256 markupPaid);
    event Released(uint256 indexed id, address indexed trader, uint256 atomsReturned);
    event Rebalanced(
        uint256 indexed id,
        uint256 atomsSold,
        uint256 proceeds,
        uint256 principalAfter,
        uint256 markupAfter,
        uint256 collateralAfter,
        bool dustFallback,
        bool toleranceUsed
    );
    event Closed(
        uint256 indexed id,
        CloseKind kind,
        uint256 atomsSold,
        uint256 proceeds,
        uint256 surplusToTrader,
        uint256 grossPrincipalLoss,
        uint256 writtenOffMarkup
    );

    error TermsMismatch(bytes32 expected, bytes32 given);
    error Expired(uint256 deadline);
    error BelowDust(uint256 amount, uint256 dust);
    error NotWired();
    error TooManyPositions();
    error StalePrice();
    error ZeroMinOut();
    error GrossMismatch(uint256 expected, uint256 actual);
    error AcquisitionMismatch(uint256 reported, uint256 received, uint256 minimum);
    error SaleMismatch(uint256 reported, uint256 received, uint256 minimum);
    error InitialCoverage(uint256 valueBps);
    error TransferShort(uint256 expected, uint256 actual);
    error NotActive(uint256 id);
    error NotTrader();
    error NotMatured(uint256 maturesAt);
    error ZeroAmount();
    error AmountExceedsDebt(uint256 amount, uint256 debt);
    error DebtChanged(uint256 expected, uint256 actual);
    error PositionHealthy(uint256 id, uint256 coverageBps);
    error PostCoverage(uint256 valueBps);
    error InvalidConfig();

    constructor(MarginVault vault_, ISpotVenue venue_, IDemoPriceGuard guard_, uint256 frictionBps_, uint256 dust_) {
        if (
            address(vault_) == address(0) || address(venue_) == address(0) || address(guard_) == address(0)
                || frictionBps_ == 0 || frictionBps_ > EngineMath.MAX_FRICTION_BPS || dust_ == 0
                || venue_.usdc() != address(vault_.usdc())
        ) revert InvalidConfig();
        vault = vault_;
        venue = venue_;
        guard = guard_;
        usdc = IERC20(address(vault_.usdc()));
        cirBtc = IERC20(venue_.cirBtc());
        frictionBps = frictionBps_;
        dust = dust_;
        bytes32 policy = keccak256(
            abi.encode(
                EngineMath.TERM,
                EngineMath.ANNUAL_MARKUP_BPS,
                EngineMath.LP_MARKUP_BPS,
                EngineMath.TRIGGER_BPS,
                EngineMath.RESTORE_BPS,
                EngineMath.INITIAL_COVERAGE_BPS,
                frictionBps_,
                dust_,
                MAX_LIVE
            )
        );
        termsHash = keccak256(
            abi.encode(
                "Sacred.TradeEngine.terms.v1", block.chainid, address(this), address(vault_), address(venue_),
                address(guard_), policy
            )
        );
    }

    // ================================================================ open

    struct OpenCtx {
        uint256 price;
        uint256 principal;
        uint256 gross;
        uint256 markup;
        uint256 minBtc;
        uint256 btc;
    }

    /// @notice Open a 2x position. The caller is the trader. Sequence, all in one transaction: validate; the vault sends
    /// the FULL gross 2P from recorded depositor cash; the engine buys the BTC; AssetAcquired, DisclosedSaleAgreed and
    /// Pledged are recorded; only then is the trader's equity E collected and the vault confirms. Any failure reverts
    /// every step.
    function open(uint256 equity, uint256 userMinBtc, uint256 deadline, bytes32 acceptedTermsHash)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (acceptedTermsHash != termsHash) revert TermsMismatch(termsHash, acceptedTermsHash);
        if (block.timestamp > deadline) revert Expired(deadline);
        if (equity < dust) revert BelowDust(equity, dust);
        if (_active.length >= MAX_LIVE) revert TooManyPositions();
        if (vault.engine() != address(this) || venue.engine() != address(this)) revert NotWired();

        OpenCtx memory c;
        {
            (uint256 price,, bool fresh) = guard.read();
            if (!fresh) revert StalePrice();
            c.price = price;
        }
        c.principal = equity;
        c.gross = 2 * equity;
        c.markup = EngineMath.markupFor(equity);
        uint256 oracleMin = EngineMath.afterFriction(EngineMath.atomsForUsdc(c.gross, c.price), frictionBps);
        c.minBtc = userMinBtc > oracleMin ? userMinBtc : oracleMin;
        if (c.minBtc == 0) revert ZeroMinOut();

        id = ++nextId;
        c.btc = _acquire(id, c, deadline);

        uint256 debt = c.principal + c.markup;
        uint256 valueBps = EngineMath.coverageBps(EngineMath.valueOf(c.btc, c.price), debt);
        if (valueBps < EngineMath.INITIAL_COVERAGE_BPS) revert InitialCoverage(valueBps);

        Position storage p = _positions[id];
        p.trader = msg.sender;
        p.status = Status.Active;
        p.openedAt = uint64(block.timestamp);
        p.maturesAt = uint64(block.timestamp + EngineMath.TERM);
        p.grossCost = c.gross;
        p.principal0 = c.principal;
        p.principal = c.principal;
        p.markup0 = c.markup;
        p.markup = c.markup;
        p.collateral = c.btc;
        p.termsHash = termsHash;
        _active.push(id);
        _activeSlot[id] = _active.length;

        emit AssetAcquired(id, msg.sender, c.gross, c.btc, c.price);
        emit DisclosedSaleAgreed(id, msg.sender, equity, c.principal, c.markup, c.btc, termsHash);
        emit Pledged(id, msg.sender, c.btc, termsHash);

        // Trader equity is collected only now, after acquisition, disclosure and pledge.
        uint256 before = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), equity);
        uint256 got = usdc.balanceOf(address(this)) - before;
        if (got != equity) revert TransferShort(equity, got);
        usdc.forceApprove(address(vault), equity);
        vault.confirmOpen(id);
        emit Opened(id, msg.sender, p.maturesAt);
    }

    function _acquire(uint256 id, OpenCtx memory c, uint256 deadline) internal returns (uint256 btc) {
        uint256 usdcBefore = usdc.balanceOf(address(this));
        uint256 sent = vault.reserveOpen(id, msg.sender, c.principal);
        if (sent != c.gross || usdc.balanceOf(address(this)) - usdcBefore != c.gross) {
            revert GrossMismatch(c.gross, usdc.balanceOf(address(this)) - usdcBefore);
        }
        usdc.forceApprove(address(venue), c.gross);
        uint256 btcBefore = cirBtc.balanceOf(address(this));
        uint256 reported = venue.buyCirBtc(c.gross, c.minBtc, deadline);
        btc = cirBtc.balanceOf(address(this)) - btcBefore;
        if (btc != reported || btc < c.minBtc || usdc.balanceOf(address(this)) != usdcBefore) {
            revert AcquisitionMismatch(reported, btc, c.minBtc);
        }
    }

    // ================================================================ repay / release (never reads the oracle)

    /// @notice Anyone may repay; the USDC always comes from msg.sender, nobody else's allowance is used. Principal is
    /// applied first, then markup. Overpayment is rejected. When the debt reaches zero the position is finalized in the
    /// vault exactly once and all remaining pledged BTC returns to the original trader.
    function repay(uint256 id, uint256 amount) external nonReentrant {
        _repay(id, amount);
    }

    /// @notice Pay the exact full remaining debt and release the collateral in one call.
    function repayAndRelease(uint256 id, uint256 expectedDebt) external nonReentrant {
        Position storage p = _live(id);
        uint256 debt = p.principal + p.markup;
        if (debt != expectedDebt) revert DebtChanged(expectedDebt, debt);
        _repay(id, debt);
    }

    function _repay(uint256 id, uint256 amount) internal {
        Position storage p = _live(id);
        if (amount == 0) revert ZeroAmount();
        uint256 debt = p.principal + p.markup;
        if (amount > debt) revert AmountExceedsDebt(amount, debt);
        uint256 before = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 got = usdc.balanceOf(address(this)) - before;
        if (got != amount) revert TransferShort(amount, got);
        (uint256 pPay, uint256 mPay,) = _applyToDebt(id, p, amount);
        emit Repaid(id, msg.sender, pPay, mPay);
        if (p.principal + p.markup == 0) _release(id, p);
    }

    /// @dev Principal first, markup second, surplus last. The vault does the 77/23 split on the markup it receives.
    function _applyToDebt(uint256 id, Position storage p, uint256 amount)
        internal
        returns (uint256 pPay, uint256 mPay, uint256 surplus)
    {
        pPay = amount < p.principal ? amount : p.principal;
        uint256 rest = amount - pPay;
        mPay = rest < p.markup ? rest : p.markup;
        surplus = rest - mPay;
        if (pPay > 0) {
            p.principal -= pPay;
            usdc.forceApprove(address(vault), pPay);
            vault.repayPrincipal(id, pPay);
        }
        if (mPay > 0) {
            p.markup -= mPay;
            p.collected += mPay;
            p.lpAllocation = EngineMath.lpAllocation(p.collected);
            usdc.forceApprove(address(vault), mPay);
            vault.recordCollectedMarkup(id, mPay);
        }
    }

    function _release(uint256 id, Position storage p) internal {
        address trader = p.trader;
        uint256 atoms = p.collateral;
        p.status = Status.Closed;
        p.collateral = 0;
        _removeActive(id);
        vault.finalizePosition(id);
        if (atoms > 0) cirBtc.safeTransfer(trader, atoms);
        emit Released(id, trader, atoms);
    }

    // ================================================================ close and maturity (oracle-guarded sales)

    /// @notice The recorded trader sells all remaining collateral. Proceeds repay principal, then markup; any surplus goes
    /// to the trader. A principal shortfall is booked in the vault as a final loss after the recovered amount is repaid.
    function ownerClose(uint256 id, uint256 minUsdc, uint256 deadline) external nonReentrant {
        Position storage p = _live(id);
        if (msg.sender != p.trader) revert NotTrader();
        uint256 price = _referencePrice(deadline);
        _sellAllAndSettle(id, p, price, minUsdc, deadline, CloseKind.Owner, 0);
    }

    /// @notice Permissionless once the term has ended. The same sale and settlement as ownerClose.
    function settleMatured(uint256 id, uint256 minUsdc, uint256 deadline) external nonReentrant {
        Position storage p = _live(id);
        if (block.timestamp < p.maturesAt) revert NotMatured(p.maturesAt);
        uint256 price = _referencePrice(deadline);
        _sellAllAndSettle(id, p, price, minUsdc, deadline, CloseKind.Matured, 0);
    }

    function _referencePrice(uint256 deadline) internal view returns (uint256 price) {
        if (block.timestamp > deadline) revert Expired(deadline);
        bool fresh;
        (price,, fresh) = guard.read();
        if (!fresh) revert StalePrice();
    }

    function _sellAllAndSettle(
        uint256 id,
        Position storage p,
        uint256 price,
        uint256 callerMin,
        uint256 deadline,
        CloseKind kind,
        uint256 priorSurplus
    ) internal {
        uint256 atoms = p.collateral;
        uint256 oracleFloor = EngineMath.saleFloor(atoms, price, frictionBps);
        uint256 minOut = callerMin > oracleFloor ? callerMin : oracleFloor;
        if (minOut == 0) revert ZeroMinOut();
        uint256 proceeds = _sell(atoms, minOut, deadline);
        p.collateral = 0;
        (,, uint256 surplus) = _applyToDebt(id, p, proceeds);
        _finishSold(id, p, kind, atoms, proceeds, surplus + priorSurplus);
    }

    /// @dev All collateral is sold. Remaining principal is a final loss (booked after the recovered part was repaid),
    /// remaining markup is written off, the vault position is finalized exactly once.
    function _finishSold(
        uint256 id,
        Position storage p,
        CloseKind kind,
        uint256 atomsSold,
        uint256 proceeds,
        uint256 surplus
    ) internal {
        uint256 lossPrincipal = p.principal;
        uint256 writtenOffMarkup = p.markup;
        address trader = p.trader;
        p.principal = 0;
        p.markup = 0;
        p.status = Status.Closed;
        _removeActive(id);
        if (lossPrincipal > 0) vault.settleFinalLoss(id);
        vault.finalizePosition(id);
        if (surplus > 0) usdc.safeTransfer(trader, surplus);
        emit Closed(id, kind, atomsSold, proceeds, surplus, lossPrincipal, writtenOffMarkup);
    }

    function _sell(uint256 atoms, uint256 minUsdc, uint256 deadline) internal returns (uint256 proceeds) {
        uint256 btcBefore = cirBtc.balanceOf(address(this));
        uint256 usdcBefore = usdc.balanceOf(address(this));
        cirBtc.forceApprove(address(venue), atoms);
        uint256 reported = venue.sellCirBtc(atoms, minUsdc, deadline);
        proceeds = usdc.balanceOf(address(this)) - usdcBefore;
        if (proceeds != reported || proceeds < minUsdc || btcBefore - cirBtc.balanceOf(address(this)) != atoms) {
            revert SaleMismatch(reported, proceeds, minUsdc);
        }
    }

    // ================================================================ coverage rebalance

    struct Plan {
        bool eligible; // coverage at or below 160%
        bool isPartial; // false means a full close
        uint256 value; // gross reference value of the collateral
        uint256 debt;
        uint256 gross; // g, the reference value to sell
        uint256 sellAtoms;
        uint256 minUsdc; // stricter of the caller floor and the independent floor
    }

    /// @notice Permissionless. The ENGINE chooses the quantity: eligible only at or below 160% coverage, it sells just
    /// enough to restore 190% (partial) or closes the position. The caller can only add a stricter floor and a deadline.
    /// Exception, documented: if a better-than-minimum execution would leave the remaining principal below `dust`
    /// (including P = 0 with markup owed), the engine sells the remaining collateral in the same transaction under the
    /// same captured reference and completes the full close; if that second leg fails everything reverts.
    function rebalance(uint256 id, uint256 callerMinUsdc, uint256 deadline) external nonReentrant {
        Position storage p = _live(id);
        uint256 price = _referencePrice(deadline);
        Plan memory pl = _plan(p, price, callerMinUsdc);
        if (!pl.eligible) revert PositionHealthy(id, EngineMath.coverageBps(pl.value, pl.debt));
        if (!pl.isPartial) {
            _sellAllAndSettle(id, p, price, callerMinUsdc, deadline, CloseKind.Coverage, 0);
            return;
        }

        uint256 proceeds = _sell(pl.sellAtoms, pl.minUsdc, deadline);
        p.collateral -= pl.sellAtoms;
        (uint256 pPay, uint256 mPay, uint256 surplus) = _applyToDebt(id, p, proceeds);
        emit Repaid(id, address(this), pPay, mPay);

        if (p.principal + p.markup == 0) {
            emit Rebalanced(id, pl.sellAtoms, proceeds, 0, 0, p.collateral, false, false);
            address trader = p.trader;
            _release(id, p); // remaining BTC is returned, not sold
            if (surplus > 0) usdc.safeTransfer(trader, surplus);
            return;
        }
        if (p.principal < dust) {
            emit Rebalanced(id, pl.sellAtoms, proceeds, p.principal, p.markup, p.collateral, true, false);
            _sellAllAndSettle(id, p, price, 0, deadline, CloseKind.CoverageDustFallback, surplus);
            return;
        }
        // Strict >= 190% is expected. Rounding can cost at most one BTC atom of reference value plus one USDC atom;
        // that is the only tolerance, and it is reported in the event.
        uint256 value1 = EngineMath.valueOf(p.collateral, price);
        uint256 debt1 = p.principal + p.markup;
        bool tolerance;
        if (value1 * EngineMath.BPS < debt1 * EngineMath.RESTORE_BPS) {
            uint256 slack = Math.ceilDiv(price, EngineMath.ATOMS_PER_BTC) + 1;
            if ((value1 + slack) * EngineMath.BPS < debt1 * EngineMath.RESTORE_BPS) {
                revert PostCoverage(EngineMath.coverageBps(value1, debt1));
            }
            tolerance = true;
        }
        emit Rebalanced(id, pl.sellAtoms, proceeds, p.principal, p.markup, p.collateral, false, tolerance);
    }

    function _plan(Position storage p, uint256 price, uint256 callerMin) internal view returns (Plan memory pl) {
        pl.value = EngineMath.valueOf(p.collateral, price);
        pl.debt = p.principal + p.markup;
        pl.eligible = pl.debt > 0 && pl.value * EngineMath.BPS <= pl.debt * EngineMath.TRIGGER_BPS;
        if (!pl.eligible) return pl;
        pl.gross = EngineMath.rebalanceGross(pl.debt, pl.value, frictionBps);
        // Mode and quantity depend ONLY on the position, the captured reference and the independent oracle floor.
        // The caller's floor is applied afterwards and can only make the chosen execution revert, never change it.
        if (pl.gross < pl.value) {
            uint256 sell = EngineMath.atomsToSell(pl.gross, price);
            if (sell < p.collateral) {
                uint256 oracleFloor = EngineMath.saleFloor(sell, price, frictionBps);
                if (oracleFloor > 0) {
                    uint256 worstPaid = oracleFloor < p.principal ? oracleFloor : p.principal;
                    if (p.principal - worstPaid >= dust) {
                        pl.isPartial = true;
                        pl.sellAtoms = sell;
                        pl.minUsdc = callerMin > oracleFloor ? callerMin : oracleFloor;
                        return pl;
                    }
                }
            }
        }
        uint256 full = EngineMath.saleFloor(p.collateral, price, frictionBps);
        pl.sellAtoms = p.collateral;
        pl.minUsdc = callerMin > full ? callerMin : full;
    }

    // ================================================================ views (UI and keeper)

    /// @inheritdoc IMarginEngineView
    /// @dev Conservative net collateral value: floor(grossValue * (B - f) / B). Never reverts on a stale or missing price;
    /// it reports fresh = false so the vault's scan fails closed.
    function positionValue(uint256 id) external view returns (uint256 netCollateralValue, bool priceFresh) {
        (uint256 price,, bool ok) = guard.read();
        Position storage p = _positions[id];
        if (p.status != Status.Active || price == 0) return (0, false);
        return (EngineMath.afterFriction(EngineMath.valueOf(p.collateral, price), frictionBps), ok);
    }

    function policyTermsHash() external view returns (bytes32) {
        return termsHash;
    }

    function isWired() external view returns (bool) {
        return vault.engine() == address(this) && venue.engine() == address(this);
    }

    function getPosition(uint256 id) external view returns (Position memory) {
        return _positions[id];
    }

    function activeCount() external view returns (uint256) {
        return _active.length;
    }

    /// @notice The live position ids (at most MAX_LIVE).
    function activeIds() external view returns (uint256[] memory) {
        return _active;
    }

    function debtOf(uint256 id) external view returns (uint256 principal, uint256 markup, uint256 total) {
        Position storage p = _positions[id];
        return (p.principal, p.markup, p.principal + p.markup);
    }

    struct OpenQuote {
        uint256 principal;
        uint256 gross;
        uint256 markup;
        uint256 debt;
        uint256 price;
        bool priceFresh;
        uint256 expectedAtoms;
        uint256 minAtoms;
        bytes32 termsHash;
        uint256 termSeconds;
    }

    function quoteOpen(uint256 equity) external view returns (OpenQuote memory q) {
        q.principal = equity;
        q.gross = 2 * equity;
        q.markup = EngineMath.markupFor(equity);
        q.debt = equity + q.markup;
        (q.price,, q.priceFresh) = guard.read();
        if (q.price != 0) {
            q.expectedAtoms = EngineMath.atomsForUsdc(q.gross, q.price);
            q.minAtoms = EngineMath.afterFriction(q.expectedAtoms, frictionBps);
        }
        q.termsHash = termsHash;
        q.termSeconds = EngineMath.TERM;
    }

    function quoteRebalance(uint256 id, uint256 callerMinUsdc) external view returns (Plan memory pl, bool priceFresh) {
        Position storage p = _positions[id];
        (uint256 price,, bool ok) = guard.read();
        priceFresh = ok;
        if (p.status == Status.Active && price != 0) pl = _plan(p, price, callerMinUsdc);
    }

    function coverageBps(uint256 id) external view returns (uint256) {
        Position storage p = _positions[id];
        (uint256 price,,) = guard.read();
        return EngineMath.coverageBps(EngineMath.valueOf(p.collateral, price), p.principal + p.markup);
    }

    // ================================================================ internals

    function _live(uint256 id) internal view returns (Position storage p) {
        p = _positions[id];
        if (p.status != Status.Active) revert NotActive(id);
    }

    function _removeActive(uint256 id) internal {
        uint256 slot = _activeSlot[id];
        uint256 last = _active.length;
        if (slot != last) {
            uint256 moved = _active[last - 1];
            _active[slot - 1] = moved;
            _activeSlot[moved] = slot;
        }
        _active.pop();
        delete _activeSlot[id];
    }
}
