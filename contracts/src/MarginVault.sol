// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IMarginVaultEngine, IMarginEngineView} from "./interfaces/IMarginVaultEngine.sol";

/// @title MarginVault
/// @notice USDC vault with internal, non-transferable shares priced against recorded NAV, plus the funding and cap
///         accounting for fixed 2x margin financing. 01a: deposits, share/NAV math, origination limits, protection
///         seeding, pause and the engine accounting surface. 01b: one global FIFO withdrawal queue, permissionless
///         processing, pull claims, worthless-share burns and the last-share guard. 01c: collected-markup accounting
///         (77/23, manager part replenishes protection) and the final-loss waterfall.
/// @dev NAV = depositorIdleCash + outstandingPrincipal. It is built only from recorded buckets, so direct token
///      donations never change NAV or mint shares. Reserves, claimable cash, manager cash and trader equity are
///      separate buckets and are never lendable.
contract MarginVault is IMarginVaultEngine, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum ProtectionKind {
        Primary,
        Tail,
        Backstop
    }

    enum PositionStatus {
        None,
        Reserved,
        Live,
        Closed,
        Cancelled
    }

    struct Position {
        PositionStatus status;
        address account;
        uint256 principal; // original financed principal
        uint256 remaining; // principal still outstanding
        uint256 liveIndex; // index in liveIds while Live
    }

    struct WithdrawalRequest {
        address owner;
        uint256 shares; // unfilled shares; they stay in totalShares until filled
    }

    struct VaultState {
        uint256 depositorIdleCash;
        uint256 outstandingPrincipal;
        uint256 commitments;
        uint256 pendingGrossCash;
        uint256 nav;
        uint256 totalShares;
        uint256 managerCash;
        uint256 primaryReserve;
        uint256 tailReserve;
        uint256 pilotBackstop;
        uint256 claimableWithdrawals;
        uint256 primaryTarget;
        uint256 tailTarget;
        uint256 queueHead;
        uint256 queueTail;
        uint256 livePositions;
        uint256 pendingOpens;
        uint256 activeRequests;
        uint256 financingCeiling;
        uint256 perAccountCap;
        bool fundingPaused;
        address engine;
    }

    // ---------------------------------------------------------------- constants

    uint256 public constant MAX_LIVE_POSITIONS = 32;
    uint256 public constant MAX_ACTIVE_REQUESTS = 64;
    uint256 public constant MAX_PROCESS_REQUESTS = 16;
    uint256 public constant MIN_NET_IDLE_BPS = 500; // net idle after opening >= 5% of NAV
    uint256 public constant MAX_UTILISATION_BPS = 9500; // principal + commitments <= 95% of NAV
    uint256 public constant PRIMARY_TARGET_BPS = 40; // 0.4% of the immutable financing ceiling
    uint256 public constant TAIL_TARGET_BPS = 60; // 0.6% of the immutable financing ceiling
    uint256 public constant LP_MARKUP_BPS = 7_700; // LP share of COLLECTED markup; the rest is the manager's
    uint256 private constant BPS = 10_000;

    /// @notice Hash every depositor accepts: 2x exposure, 14-day term, 10% annualized markup fixed at open,
    ///         77/23 LP/manager split of collected markup only, no late growth, no trader-profit share.
    bytes32 public constant MANDATE_HASH = keccak256(
        "sacred.mandate.v1|exposure=2x|term=1209600s|annualMarkupBps=1000|lpMarkupBps=7700|managerMarkupBps=2300|split=collected-markup-only|lateGrowth=none|traderProfitShare=none"
    );

    // ---------------------------------------------------------------- immutable configuration

    IERC20 public immutable usdc;
    address public immutable guardian;
    address public immutable treasury;
    address public immutable deployer;
    uint256 public immutable financingCeiling;
    uint256 public immutable perAccountCap;
    uint256 public immutable primaryTarget;
    uint256 public immutable tailTarget;

    // ---------------------------------------------------------------- recorded accounting (USDC atoms)

    address public engine;
    bool public fundingPaused;

    uint256 public depositorIdleCash;
    uint256 public outstandingPrincipal;
    uint256 public commitments; // principal of reserved, unconfirmed opens (counts toward caps)
    uint256 public pendingGrossCash; // 2x principal already sent to the engine for unconfirmed opens; still inside depositorIdleCash
    uint256 public managerCash;
    uint256 public primaryReserve;
    uint256 public tailReserve;
    uint256 public pilotBackstop;
    uint256 public claimableWithdrawals;

    uint256 public totalShares;
    mapping(address => uint256) public sharesOf; // includes locked shares
    mapping(address => uint256) public lockedShares;

    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;
    uint256 public queueHead; // oldest possibly unfilled request
    uint256 public queueTail; // next request id
    uint256 public activeRequests; // unfilled requests, at most MAX_ACTIVE_REQUESTS
    mapping(address => uint256) public claimable; // reserved withdrawal cash per owner
    mapping(uint256 => uint256) public markupCollected; // cumulative collected markup per position
    mapping(uint256 => uint256) public lpMarkupAllocated; // cumulative LP share already credited, per position

    mapping(uint256 => Position) public positions;
    uint256[] private _liveIds;
    uint256 public pendingOpens;
    mapping(address => uint256) public accountExposure; // principal + commitments per trader account

    // ---------------------------------------------------------------- events

    event EngineBound(address indexed engine);
    event FundingPausedSet(bool paused);
    event Deposited(address indexed account, uint256 amount, uint256 shares, uint256 navBefore);
    event WithdrawalRequested(uint256 indexed requestId, address indexed owner, uint256 shares);
    event ProtectionSeeded(ProtectionKind indexed kind, uint256 amount, uint256 bucketAfter);
    event OpenReserved(uint256 indexed id, address indexed account, uint256 principal);
    event OpenConfirmed(uint256 indexed id);
    event OpenCancelled(uint256 indexed id);
    event PrincipalRepaid(uint256 indexed id, uint256 amount, uint256 remaining);
    /// @dev Emitted for every collected-markup payment: the LP increment and where the manager part went.
    event MarkupCollected(
        uint256 indexed id,
        uint256 payment,
        uint256 lpIncrement,
        uint256 toPrimary,
        uint256 toTail,
        uint256 toManagerCash
    );
    /// @dev Emitted for every final loss, even when protection covers all of it (uncoveredLpLoss is then zero).
    event FinalLossSettled(
        uint256 indexed id,
        uint256 grossLoss,
        uint256 fromPrimary,
        uint256 fromTail,
        uint256 fromBackstop,
        uint256 uncoveredLpLoss
    );
    event PositionFinalized(uint256 indexed id);
    event WithdrawalFilled(uint256 indexed requestId, address indexed owner, uint256 sharesBurned, uint256 payout);
    event WithdrawalDustWrittenOff(uint256 indexed requestId, address indexed owner, uint256 sharesBurned);
    event Claimed(address indexed owner, uint256 amount);
    event WorthlessSharesBurned(address indexed owner, uint256 shares);

    // ---------------------------------------------------------------- errors

    error InvalidConfig();
    error NotDeployer();
    error NotGuardian();
    error NotTreasury();
    error NotEngine();
    error EngineAlreadyBound();
    error InvalidEngine();
    error ZeroAmount();
    error ZeroAddress();
    error MandateMismatch(bytes32 expected, bytes32 provided);
    error FundingIsPaused();
    error WithdrawalQueueNotEmpty();
    error InvalidInitialState();
    error ZeroNav();
    error ZeroShares();
    error SlippageExceeded(uint256 shares, uint256 minShares);
    error TransferShort(uint256 expected, uint256 received);
    error AccountingNeedsSettlement(uint256 id);
    error StalePrice(uint256 id);
    error InsufficientShares(uint256 available, uint256 requested);
    error PositionExists(uint256 id);
    error UnknownPosition(uint256 id);
    error WrongPositionStatus(uint256 id, PositionStatus status);
    error TooManyPositions();
    error ReservesUnderfunded(uint256 primary, uint256 tail);
    error CeilingExceeded(uint256 exposureAfter, uint256 ceiling);
    error UtilisationExceeded(uint256 exposureAfter, uint256 nav);
    error AccountCapExceeded(address account, uint256 exposureAfter);
    error IdleBufferTooLow(uint256 netIdleAfter, uint256 nav);
    error GrossCashUnavailable(uint256 free, uint256 needed);
    error PendingOpensBlockAccounting();
    error PrincipalOutstanding(uint256 id, uint256 remaining);
    error NothingToClaim();
    error TooManyRequests();
    error NavNotZero(uint256 nav);
    error LastShareGuard();
    error NoShortfall(uint256 id);
    error AmountExceedsRemaining(uint256 id, uint256 amount, uint256 remaining);

    modifier onlyEngine() {
        if (msg.sender != engine) revert NotEngine();
        _;
    }

    constructor(
        IERC20 usdc_,
        address guardian_,
        address treasury_,
        address deployer_,
        uint256 financingCeiling_,
        uint256 perAccountCap_
    ) {
        uint256 pTarget = (financingCeiling_ * PRIMARY_TARGET_BPS) / BPS;
        uint256 tTarget = (financingCeiling_ * TAIL_TARGET_BPS) / BPS;
        if (
            address(usdc_).code.length == 0 || guardian_ == address(0) || treasury_ == address(0)
                || deployer_ == address(0) || financingCeiling_ == 0 || perAccountCap_ == 0
                || perAccountCap_ > financingCeiling_ || pTarget == 0 || tTarget == 0
        ) revert InvalidConfig();
        usdc = usdc_;
        guardian = guardian_;
        treasury = treasury_;
        deployer = deployer_;
        financingCeiling = financingCeiling_;
        perAccountCap = perAccountCap_;
        primaryTarget = pTarget;
        tailTarget = tTarget;
    }

    // ================================================================ administration

    /// @notice Bind the single engine. Deployer only, exactly once.
    function bindEngine(address engine_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (engine != address(0)) revert EngineAlreadyBound();
        if (engine_ == address(0) || engine_ == address(this) || engine_ == address(usdc)) revert InvalidEngine();
        engine = engine_;
        emit EngineBound(engine_);
    }

    /// @notice Guardian pauses or resumes NEW deposits and originations only. Repayment, release, confirm/cancel of
    ///         existing reservations and (from 01b) claims stay available.
    function setFundingPaused(bool paused) external {
        if (msg.sender != guardian) revert NotGuardian();
        fundingPaused = paused;
        emit FundingPausedSet(paused);
    }

    /// @notice Treasury seeds a protection bucket with real USDC. Never mints shares, never changes NAV.
    function seedProtection(ProtectionKind kind, uint256 amount) external nonReentrant {
        if (msg.sender != treasury) revert NotTreasury();
        if (amount == 0) revert ZeroAmount();
        _pull(msg.sender, amount);
        uint256 bucketAfter;
        if (kind == ProtectionKind.Primary) bucketAfter = primaryReserve += amount;
        else if (kind == ProtectionKind.Tail) bucketAfter = tailReserve += amount;
        else bucketAfter = pilotBackstop += amount;
        emit ProtectionSeeded(kind, amount, bucketAfter);
    }

    // ================================================================ depositors

    /// @notice Deposit USDC for shares priced at pre-deposit recorded NAV.
    function deposit(uint256 amount, uint256 minShares, bytes32 mandateHash) external nonReentrant returns (uint256 shares) {
        if (mandateHash != MANDATE_HASH) revert MandateMismatch(MANDATE_HASH, mandateHash);
        if (fundingPaused) revert FundingIsPaused();
        if (queueHead != queueTail) revert WithdrawalQueueNotEmpty();
        if (pendingOpens != 0) revert PendingOpensBlockAccounting();
        if (amount == 0) revert ZeroAmount();
        _requireNoImpairment();

        uint256 navBefore = depositorIdleCash + outstandingPrincipal;
        if (totalShares == 0) {
            // Initial funding: nothing recorded for depositors, nothing live, nothing reserved.
            if (navBefore != 0 || _liveIds.length != 0 || pendingOpens != 0) revert InvalidInitialState();
            shares = amount; // 1:1 in micro-USDC units
        } else {
            if (navBefore == 0) revert ZeroNav(); // no recapitalization into zero NAV with shares outstanding
            shares = Math.mulDiv(amount, totalShares, navBefore);
        }
        if (shares == 0) revert ZeroShares();
        if (shares < minShares) revert SlippageExceeded(shares, minShares);

        _pull(msg.sender, amount);
        depositorIdleCash += amount;
        totalShares += shares;
        sharesOf[msg.sender] += shares;
        emit Deposited(msg.sender, amount, shares, navBefore);
    }

    /// @notice Lock shares in the single FIFO queue. Locked shares stay in `totalShares` until filled. There is no
    ///         cancel and no reinsert. By requesting, the owner consents to write-off of an entire residual worth less
    ///         than one micro-USDC. At most 64 requests can be unfilled at once.
    function requestWithdraw(uint256 shares) external nonReentrant returns (uint256 requestId) {
        if (shares == 0) revert ZeroAmount();
        if (activeRequests >= MAX_ACTIVE_REQUESTS) revert TooManyRequests();
        uint256 available = sharesOf[msg.sender] - lockedShares[msg.sender];
        if (shares > available) revert InsufficientShares(available, shares);
        lockedShares[msg.sender] += shares;
        requestId = queueTail++;
        activeRequests += 1;
        withdrawalRequests[requestId] = WithdrawalRequest({owner: msg.sender, shares: shares});
        emit WithdrawalRequested(requestId, msg.sender, shares);
    }

    /// @notice Permissionless. Serve the oldest unfilled requests in strict FIFO order, at most 16 attempts per call.
    ///         Partial fills keep the head; incoming repayment funds the current head without losing its priority.
    ///         Reverts while an open is pending, and while any live position is impaired or has a stale price
    ///         (checked before cash is reserved, including for zero-value burns).
    /// @return completed Requests fully served or fully written off in this call.
    function processWithdrawals(uint256 maxRequests) external nonReentrant returns (uint256 completed) {
        if (maxRequests == 0) revert ZeroAmount();
        if (queueHead == queueTail) return 0;
        if (pendingOpens != 0) revert PendingOpensBlockAccounting();
        _requireNoImpairment();
        uint256 attempts = maxRequests > MAX_PROCESS_REQUESTS ? MAX_PROCESS_REQUESTS : maxRequests;
        for (uint256 i; i < attempts && queueHead != queueTail; i++) {
            (bool headDone, bool stop) = _processHead();
            if (headDone) completed += 1;
            if (stop) break;
        }
    }

    /// @notice Pay out cash already reserved for `msg.sender`. Pull transfer; works while paused and at any price
    ///         freshness; never touches NAV (the cash left NAV when it was reserved).
    function claim() external nonReentrant returns (uint256 amount) {
        amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        claimableWithdrawals -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /// @notice A holder burns their own unlocked, worthless shares once NAV is zero. While any position is still live
    ///         at least one share must remain, so late markup collections are never orphaned.
    function burnWorthlessShares(uint256 shares) external nonReentrant {
        if (shares == 0) revert ZeroAmount();
        if (pendingOpens != 0) revert PendingOpensBlockAccounting();
        uint256 n = nav();
        if (n != 0) revert NavNotZero(n);
        uint256 available = sharesOf[msg.sender] - lockedShares[msg.sender];
        if (shares > available) revert InsufficientShares(available, shares);
        if (_liveIds.length != 0 && totalShares - shares < 1) revert LastShareGuard();
        sharesOf[msg.sender] -= shares;
        totalShares -= shares;
        emit WorthlessSharesBurned(msg.sender, shares);
    }

    // ================================================================ engine: origination

    /// @inheritdoc IMarginVaultEngine
    function reserveOpen(uint256 id, address account, uint256 principal)
        external
        onlyEngine
        nonReentrant
        returns (uint256 grossCash)
    {
        if (account == address(0)) revert ZeroAddress();
        if (principal == 0) revert ZeroAmount();
        if (positions[id].status != PositionStatus.None) revert PositionExists(id);
        _checkOrigination(account, principal);

        // Effects first. Principal commitments and pending gross cash are separate counters; recorded idle is
        // untouched, so NAV and cap accounting are preserved through the pending open.
        grossCash = principal * 2;
        commitments += principal;
        pendingGrossCash += grossCash;
        accountExposure[account] += principal;
        pendingOpens += 1;
        positions[id] = Position({
            status: PositionStatus.Reserved, account: account, principal: principal, remaining: principal, liveIndex: 0
        });
        emit OpenReserved(id, account, principal);

        // The vault funds the whole purchase from existing recorded depositor cash BEFORE any equity is received.
        uint256 balance = usdc.balanceOf(address(this));
        uint256 requiredAfter = _requiredBalance();
        if (balance < requiredAfter + grossCash) revert GrossCashUnavailable(balance - _min(balance, requiredAfter), grossCash);
        usdc.safeTransfer(msg.sender, grossCash);
    }

    /// @inheritdoc IMarginVaultEngine
    function confirmOpen(uint256 id) external onlyEngine nonReentrant {
        Position storage p = _position(id);
        if (p.status != PositionStatus.Reserved) revert WrongPositionStatus(id, p.status);
        uint256 principal = p.principal;
        commitments -= principal;
        pendingGrossCash -= principal * 2;
        pendingOpens -= 1;
        depositorIdleCash -= principal; // gross 2P left at reserve, equity P arrives now: net P
        outstandingPrincipal += principal;
        p.status = PositionStatus.Live;
        p.liveIndex = _liveIds.length;
        _liveIds.push(id);
        _pull(msg.sender, principal); // trader equity, only after the engine's acquisition; a failed pull reverts all
        emit OpenConfirmed(id);
    }

    /// @inheritdoc IMarginVaultEngine
    function cancelOpen(uint256 id) external onlyEngine nonReentrant {
        Position storage p = _position(id);
        if (p.status != PositionStatus.Reserved) revert WrongPositionStatus(id, p.status);
        uint256 principal = p.principal;
        commitments -= principal;
        pendingGrossCash -= principal * 2;
        accountExposure[p.account] -= principal;
        pendingOpens -= 1;
        p.status = PositionStatus.Cancelled;
        p.remaining = 0;
        _pull(msg.sender, principal * 2); // the full gross cash comes back
        emit OpenCancelled(id);
    }

    // ================================================================ engine: accounting primitives

    /// @inheritdoc IMarginVaultEngine
    function repayPrincipal(uint256 id, uint256 amount) external onlyEngine nonReentrant {
        Position storage p = _livePosition(id);
        if (amount == 0) revert ZeroAmount();
        if (amount > p.remaining) revert AmountExceedsRemaining(id, amount, p.remaining);
        _pull(msg.sender, amount);
        depositorIdleCash += amount;
        _reduce(p, amount);
        emit PrincipalRepaid(id, amount, p.remaining);
    }

    /// @inheritdoc IMarginVaultEngine
    function finalizePosition(uint256 id) external onlyEngine nonReentrant {
        Position storage p = _position(id);
        if (p.status != PositionStatus.Live) revert WrongPositionStatus(id, p.status);
        if (p.remaining != 0) revert PrincipalOutstanding(id, p.remaining);
        p.status = PositionStatus.Closed;
        uint256 idx = p.liveIndex;
        uint256 last = _liveIds[_liveIds.length - 1];
        _liveIds[idx] = last;
        positions[last].liveIndex = idx;
        _liveIds.pop();
        emit PositionFinalized(id);
    }

    /// @inheritdoc IMarginVaultEngine
    function recordCollectedMarkup(uint256 id, uint256 payment) external onlyEngine nonReentrant {
        _livePosition(id); // the position must be live; its principal may already be zero
        if (payment == 0) revert ZeroAmount();

        // 77/23 applies to COLLECTED markup only, cumulatively per position, so rounding never drifts across payments.
        uint256 cumulative = markupCollected[id] + payment;
        uint256 lpTotal = Math.mulDiv(cumulative, LP_MARKUP_BPS, BPS);
        uint256 lpIncrement = lpTotal - lpMarkupAllocated[id];
        uint256 managerPart = payment - lpIncrement;
        markupCollected[id] = cumulative;
        lpMarkupAllocated[id] = lpTotal;
        depositorIdleCash += lpIncrement; // raises NAV for every current share

        // Manager part: refill primary to its target, then tail to its target, then lock the excess as manager cash.
        uint256 toPrimary = _min(managerPart, primaryTarget > primaryReserve ? primaryTarget - primaryReserve : 0);
        primaryReserve += toPrimary;
        managerPart -= toPrimary;
        uint256 toTail = _min(managerPart, tailTarget > tailReserve ? tailTarget - tailReserve : 0);
        tailReserve += toTail;
        managerPart -= toTail;
        managerCash += managerPart; // locked: nothing in this vault can pay it out in the pilot

        _pull(msg.sender, payment); // exactly the allocated LP plus manager amounts must arrive
        emit MarkupCollected(id, payment, lpIncrement, toPrimary, toTail, managerPart);
    }

    /// @inheritdoc IMarginVaultEngine
    function settleFinalLoss(uint256 id) external onlyEngine nonReentrant {
        Position storage p = _livePosition(id);
        uint256 gross = p.remaining;
        if (gross == 0) revert NoShortfall(id);

        // primary, then tail, then the optional pilot backstop, then LP NAV. Manager cash is never touched.
        uint256 fromPrimary = _min(gross, primaryReserve);
        uint256 fromTail = _min(gross - fromPrimary, tailReserve);
        uint256 fromBackstop = _min(gross - fromPrimary - fromTail, pilotBackstop);
        uint256 covered = fromPrimary + fromTail + fromBackstop;
        uint256 uncovered = gross - covered;

        primaryReserve -= fromPrimary;
        tailReserve -= fromTail;
        pilotBackstop -= fromBackstop;
        depositorIdleCash += covered; // covered principal moves from reserve cash into depositor idle cash
        _reduce(p, gross); // outstanding falls by the whole loss; uncovered principal credits nothing
        emit FinalLossSettled(id, gross, fromPrimary, fromTail, fromBackstop, uncovered);
    }

    // ================================================================ views

    /// @notice Recorded LP NAV: depositor idle cash plus outstanding principal. Excludes reserves, claims, manager
    ///         cash, uncollected markup, trader equity and unrecorded donations.
    function nav() public view returns (uint256) {
        return depositorIdleCash + outstandingPrincipal;
    }

    /// @notice True when the vault holds at least the USDC its recorded buckets require.
    function isFullyBacked() external view returns (bool) {
        return usdc.balanceOf(address(this)) >= _requiredBalance();
    }

    function liveCount() external view returns (uint256) {
        return _liveIds.length;
    }

    function liveIdAt(uint256 index) external view returns (uint256) {
        return _liveIds[index];
    }

    /// @notice Largest single principal that would currently pass the aggregate origination limits, including the
    ///         requirement that free depositor cash covers 2x (not per-account, not the reserve or queue checks).
    function financingHeadroom() external view returns (uint256) {
        uint256 n = nav();
        uint256 exposure = outstandingPrincipal + commitments;
        uint256 byCeiling = financingCeiling > exposure ? financingCeiling - exposure : 0;
        uint256 byUtilisation = (n * MAX_UTILISATION_BPS) / BPS;
        byUtilisation = byUtilisation > exposure ? byUtilisation - exposure : 0;
        uint256 lendable = depositorIdleCash - commitments;
        uint256 minIdle = (n * MIN_NET_IDLE_BPS + BPS - 1) / BPS;
        uint256 byIdle = lendable > minIdle ? lendable - minIdle : 0;
        uint256 byCash = (depositorIdleCash - pendingGrossCash) / 2; // the vault funds the whole 2P purchase
        return _min(_min(byCeiling, byCash), _min(byUtilisation, byIdle));
    }

    function vaultState() external view returns (VaultState memory s) {
        s.depositorIdleCash = depositorIdleCash;
        s.outstandingPrincipal = outstandingPrincipal;
        s.commitments = commitments;
        s.pendingGrossCash = pendingGrossCash;
        s.nav = nav();
        s.totalShares = totalShares;
        s.managerCash = managerCash;
        s.primaryReserve = primaryReserve;
        s.tailReserve = tailReserve;
        s.pilotBackstop = pilotBackstop;
        s.claimableWithdrawals = claimableWithdrawals;
        s.primaryTarget = primaryTarget;
        s.tailTarget = tailTarget;
        s.queueHead = queueHead;
        s.queueTail = queueTail;
        s.livePositions = _liveIds.length;
        s.pendingOpens = pendingOpens;
        s.activeRequests = activeRequests;
        s.financingCeiling = financingCeiling;
        s.perAccountCap = perAccountCap;
        s.fundingPaused = fundingPaused;
        s.engine = engine;
    }

    // ================================================================ internals

    /// @dev One attempt on the head request. Returns (requestCompleted, stopLoop).
    function _processHead() internal returns (bool completedHead, bool stop) {
        uint256 id = queueHead;
        WithdrawalRequest storage r = withdrawalRequests[id];
        uint256 n = nav();
        uint256 supply = totalShares;
        // While any position is live the last share must survive every burn.
        uint256 burnCap = _liveIds.length != 0 ? supply - 1 : supply;

        // A residual worth less than one micro-USDC (or any residual at zero NAV) is written off by consent.
        // This runs before the idle-cash check, so it also works when idle is zero.
        if (n == 0 || Math.mulDiv(r.shares, n, supply) == 0) {
            uint256 burn = r.shares < burnCap ? r.shares : burnCap;
            if (burn == 0) return (false, true); // last-share guard: wait for settlement
            _burn(r.owner, burn);
            r.shares -= burn;
            emit WithdrawalDustWrittenOff(id, r.owner, burn);
            if (r.shares != 0) return (false, true);
            _advance();
            return (true, false);
        }

        uint256 idle = depositorIdleCash;
        if (idle == 0) return (false, true); // legitimate waiting for liquidity
        uint256 burnShares = Math.mulDiv(idle, supply, n);
        if (burnShares > r.shares) burnShares = r.shares;
        if (burnShares > burnCap) burnShares = burnCap;
        if (burnShares == 0) return (false, true);
        uint256 payout = Math.mulDiv(burnShares, n, supply);
        if (payout == 0) return (false, true); // a partial fill must pay something; never destroy redeemable shares

        depositorIdleCash -= payout;
        claimable[r.owner] += payout;
        claimableWithdrawals += payout;
        _burn(r.owner, burnShares);
        r.shares -= burnShares;
        emit WithdrawalFilled(id, r.owner, burnShares, payout);
        if (r.shares != 0) return (false, false);
        _advance();
        return (true, false);
    }

    function _burn(address owner, uint256 shares) internal {
        sharesOf[owner] -= shares;
        lockedShares[owner] -= shares;
        totalShares -= shares;
    }

    function _advance() internal {
        queueHead += 1;
        activeRequests -= 1;
    }

    function _checkOrigination(address account, uint256 principal) internal view {
        if (fundingPaused) revert FundingIsPaused();
        if (queueHead != queueTail) revert WithdrawalQueueNotEmpty();
        if (_liveIds.length + pendingOpens >= MAX_LIVE_POSITIONS) revert TooManyPositions();
        if (primaryReserve < primaryTarget || tailReserve < tailTarget) {
            revert ReservesUnderfunded(primaryReserve, tailReserve);
        }
        uint256 n = nav();
        uint256 exposureAfter = outstandingPrincipal + commitments + principal;
        if (exposureAfter > financingCeiling) revert CeilingExceeded(exposureAfter, financingCeiling);
        if (exposureAfter * BPS > n * MAX_UTILISATION_BPS) revert UtilisationExceeded(exposureAfter, n);
        if (accountExposure[account] + principal > perAccountCap) {
            revert AccountCapExceeded(account, accountExposure[account] + principal);
        }
        // Recorded free depositor cash (idle minus gross already advanced) must cover the whole 2P purchase.
        uint256 free = depositorIdleCash - pendingGrossCash;
        if (free < principal * 2) revert GrossCashUnavailable(free, principal * 2);
        uint256 netIdleAfter = depositorIdleCash - commitments - principal;
        if (netIdleAfter * BPS < n * MIN_NET_IDLE_BPS) revert IdleBufferTooLow(netIdleAfter, n);
    }

    /// @dev Scan the bounded live positions with fresh conservative values. A stale price or a value below remaining
    ///      principal blocks the caller until the position is settled. Never applied to repayment or release.
    function _requireNoImpairment() internal view {
        uint256 n = _liveIds.length;
        if (n == 0) return;
        IMarginEngineView e = IMarginEngineView(engine);
        for (uint256 i; i < n; i++) {
            uint256 id = _liveIds[i];
            // Every live position is scanned, including principal zero with markup still owed.
            (uint256 value, bool fresh) = e.positionValue(id);
            if (!fresh) revert StalePrice(id);
            if (value < positions[id].remaining) revert AccountingNeedsSettlement(id);
        }
    }

    /// @dev USDC the vault must physically hold: recorded depositor cash that has not left for a pending open,
    ///      plus every segregated bucket. Pending gross cash is already with the engine. Direct donations are the
    ///      only way the balance exceeds this.
    function _requiredBalance() internal view returns (uint256) {
        return depositorIdleCash - pendingGrossCash + managerCash + primaryReserve + tailReserve + pilotBackstop
            + claimableWithdrawals;
    }

    function _pull(address from, uint256 amount) internal {
        uint256 before = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(from, address(this), amount);
        uint256 received = usdc.balanceOf(address(this)) - before;
        if (received != amount) revert TransferShort(amount, received);
    }

    /// @dev Lowers remaining principal. A position stays live at zero: markup may still be owed.
    function _reduce(Position storage p, uint256 amount) internal {
        p.remaining -= amount;
        outstandingPrincipal -= amount;
        accountExposure[p.account] -= amount;
    }

    function _position(uint256 id) internal view returns (Position storage p) {
        p = positions[id];
        if (p.status == PositionStatus.None) revert UnknownPosition(id);
    }

    function _livePosition(uint256 id) internal view returns (Position storage p) {
        p = _position(id);
        if (p.status != PositionStatus.Live) revert WrongPositionStatus(id, p.status);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
