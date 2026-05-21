// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ArcadeStrikeEscrow
 * @notice Holds wagers for 1v1 ArcadeStrike matches.
 *         The off-chain oracle signs match results via EIP-712.
 *         Winners claim via oracle signature — no admin intervention.
 *
 * Fee structure:
 *  - 5% total  (500 bps)
 *  - 2% → treasury
 *  - 3% → token buyback & burn address
 *
 * Replay protection: each matchId + nonce can only be settled once.
 */
contract ArcadeStrikeEscrow is ReentrancyGuard, Ownable, EIP712 {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // ─── Types ────────────────────────────────────────────────

    enum MatchStatus { NONE, PENDING, LOCKED, SETTLED, CANCELLED }

    struct Match {
        address player1;
        address player2;
        uint256 wagerAmount;   // per player (equal stakes)
        address tokenAddress;  // address(0) for native ETH/MATIC
        MatchStatus status;
        uint256 createdAt;
        uint256 lockedAt;
        uint256 settledAt;
        address winner;
    }

    // ─── EIP-712 ──────────────────────────────────────────────

    bytes32 private constant RESULT_TYPEHASH = keccak256(
        "MatchResult(bytes32 matchId,address winner,address loser,uint256 wagerAmount,bytes32 nonce)"
    );

    // ─── Storage ──────────────────────────────────────────────

    mapping(bytes32 => Match) public matches;
    mapping(bytes32 => bool) public usedNonces;

    address public oracle;
    address public treasury;
    address public burnAddress;

    uint256 public constant FEE_BPS = 500;         // 5%
    uint256 public constant TREASURY_BPS = 200;    // 2%
    uint256 public constant BURN_BPS = 300;        // 3%
    uint256 public constant BPS_DENOMINATOR = 10000;

    uint256 public constant MATCH_TIMEOUT = 10 minutes;  // cancel if not locked
    uint256 public constant SETTLE_TIMEOUT = 5 minutes;  // oracle must settle

    // ─── Events ───────────────────────────────────────────────

    event MatchCreated(
        bytes32 indexed matchId,
        address indexed player1,
        address indexed player2,
        uint256 wagerAmount,
        address tokenAddress
    );
    event MatchLocked(bytes32 indexed matchId);
    event MatchSettled(
        bytes32 indexed matchId,
        address indexed winner,
        uint256 payout,
        uint256 feeTotal
    );
    event MatchCancelled(bytes32 indexed matchId, string reason);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);

    // ─── Errors ───────────────────────────────────────────────

    error MatchAlreadyExists();
    error MatchNotFound();
    error InvalidMatchStatus(MatchStatus expected, MatchStatus actual);
    error NotPlayer();
    error InvalidWager();
    error InvalidOracle();
    error InvalidSignature();
    error NonceAlreadyUsed();
    error WinnerNotInMatch();
    error TransferFailed();
    error MatchExpired();
    error ZeroAddress();

    // ─── Constructor ──────────────────────────────────────────

    constructor(
        address _oracle,
        address _treasury,
        address _burnAddress
    ) Ownable(msg.sender) EIP712("ArcadeStrikeEscrow", "1") {
        if (_oracle == address(0) || _treasury == address(0) || _burnAddress == address(0))
            revert ZeroAddress();
        oracle = _oracle;
        treasury = _treasury;
        burnAddress = _burnAddress;
    }

    // ─── Match Lifecycle ──────────────────────────────────────

    /**
     * @notice Player 1 creates the match and deposits wager.
     *         Called server-side after matchmaking confirms both players.
     * @param matchId  Unique match identifier (keccak256 of internal match UUID)
     * @param player2  Address of second player
     * @param token    ERC-20 token address (address(0) for native)
     * @param amount   Wager per player
     */
    function createMatch(
        bytes32 matchId,
        address player2,
        address token,
        uint256 amount
    ) external payable nonReentrant {
        if (matches[matchId].status != MatchStatus.NONE) revert MatchAlreadyExists();
        if (player2 == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidWager();

        _receiveDeposit(msg.sender, token, amount);

        matches[matchId] = Match({
            player1: msg.sender,
            player2: player2,
            wagerAmount: amount,
            tokenAddress: token,
            status: MatchStatus.PENDING,
            createdAt: block.timestamp,
            lockedAt: 0,
            settledAt: 0,
            winner: address(0)
        });

        emit MatchCreated(matchId, msg.sender, player2, amount, token);
    }

    /**
     * @notice Player 2 joins and deposits wager, locking the escrow.
     */
    function joinMatch(bytes32 matchId) external payable nonReentrant {
        Match storage m = matches[matchId];
        if (m.status == MatchStatus.NONE) revert MatchNotFound();
        if (m.status != MatchStatus.PENDING)
            revert InvalidMatchStatus(MatchStatus.PENDING, m.status);
        if (msg.sender != m.player2) revert NotPlayer();
        if (block.timestamp > m.createdAt + MATCH_TIMEOUT) revert MatchExpired();

        _receiveDeposit(msg.sender, m.tokenAddress, m.wagerAmount);

        m.status = MatchStatus.LOCKED;
        m.lockedAt = block.timestamp;

        emit MatchLocked(matchId);
    }

    /**
     * @notice Oracle settles the match after verifying the game result.
     *         Uses EIP-712 signature to prevent tampering.
     * @param matchId   The match identifier
     * @param winner    Winner's address
     * @param loser     Loser's address
     * @param nonce     Unique nonce to prevent replay
     * @param signature EIP-712 signature from the oracle key
     */
    function settleMatch(
        bytes32 matchId,
        address winner,
        address loser,
        bytes32 nonce,
        bytes calldata signature
    ) external nonReentrant {
        Match storage m = matches[matchId];
        if (m.status == MatchStatus.NONE) revert MatchNotFound();
        if (m.status != MatchStatus.LOCKED)
            revert InvalidMatchStatus(MatchStatus.LOCKED, m.status);
        if (usedNonces[nonce]) revert NonceAlreadyUsed();
        if (winner != m.player1 && winner != m.player2) revert WinnerNotInMatch();

        // ── Verify oracle EIP-712 signature ──
        bytes32 structHash = keccak256(abi.encode(
            RESULT_TYPEHASH,
            matchId,
            winner,
            loser,
            m.wagerAmount,
            nonce
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(signature);
        if (signer != oracle) revert InvalidSignature();

        // ── Mark nonce used ──
        usedNonces[nonce] = true;

        // ── Calculate fees & payout ──
        uint256 totalPot = m.wagerAmount * 2;
        uint256 totalFee = (totalPot * FEE_BPS) / BPS_DENOMINATOR;
        uint256 treasuryFee = (totalPot * TREASURY_BPS) / BPS_DENOMINATOR;
        uint256 burnFee = totalFee - treasuryFee;
        uint256 winnerPayout = totalPot - totalFee;

        m.status = MatchStatus.SETTLED;
        m.settledAt = block.timestamp;
        m.winner = winner;

        // ── Distribute funds ──
        _sendFunds(winner, m.tokenAddress, winnerPayout);
        _sendFunds(treasury, m.tokenAddress, treasuryFee);
        _sendFunds(burnAddress, m.tokenAddress, burnFee);

        emit MatchSettled(matchId, winner, winnerPayout, totalFee);
    }

    /**
     * @notice Cancel a PENDING match (player1 cancels if player2 never joins).
     *         Both players can cancel a LOCKED match if timeout exceeded.
     */
    function cancelMatch(bytes32 matchId) external nonReentrant {
        Match storage m = matches[matchId];
        if (m.status == MatchStatus.NONE) revert MatchNotFound();

        string memory reason;

        if (m.status == MatchStatus.PENDING) {
            // Player 1 can cancel their own pending match anytime
            // Or anyone can cancel after timeout
            bool isPlayer1 = msg.sender == m.player1;
            bool isExpired = block.timestamp > m.createdAt + MATCH_TIMEOUT;
            if (!isPlayer1 && !isExpired) revert NotPlayer();

            m.status = MatchStatus.CANCELLED;
            reason = isExpired ? "timeout" : "player_cancelled";
            _sendFunds(m.player1, m.tokenAddress, m.wagerAmount);

        } else if (m.status == MatchStatus.LOCKED) {
            // Only cancel if oracle failed to settle in time
            bool isParticipant = msg.sender == m.player1 || msg.sender == m.player2;
            bool isOracleTimeout = block.timestamp > m.lockedAt + SETTLE_TIMEOUT;
            if (!isParticipant || !isOracleTimeout) revert InvalidMatchStatus(MatchStatus.PENDING, m.status);

            m.status = MatchStatus.CANCELLED;
            reason = "oracle_timeout";
            // Refund both players
            _sendFunds(m.player1, m.tokenAddress, m.wagerAmount);
            _sendFunds(m.player2, m.tokenAddress, m.wagerAmount);

        } else {
            revert InvalidMatchStatus(MatchStatus.PENDING, m.status);
        }

        emit MatchCancelled(matchId, reason);
    }

    // ─── View ─────────────────────────────────────────────────

    function getMatch(bytes32 matchId) external view returns (Match memory) {
        return matches[matchId];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ─── Admin ────────────────────────────────────────────────

    function updateOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        emit OracleUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    function updateTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
    }

    function updateBurnAddress(address newBurnAddress) external onlyOwner {
        if (newBurnAddress == address(0)) revert ZeroAddress();
        burnAddress = newBurnAddress;
    }

    // ─── Internal Helpers ─────────────────────────────────────

    function _receiveDeposit(address from, address token, uint256 amount) internal {
        if (token == address(0)) {
            if (msg.value != amount) revert InvalidWager();
        } else {
            if (msg.value != 0) revert InvalidWager();
            IERC20(token).safeTransferFrom(from, address(this), amount);
        }
    }

    function _sendFunds(address to, address token, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    receive() external payable {}
}
