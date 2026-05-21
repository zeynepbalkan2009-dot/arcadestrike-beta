// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ArcadeStrikeEscrow
 * @notice Holds equal wagers from two players for a single match.
 *         Settlement is triggered by a signed oracle message from the
 *         ArcadeStrike game server. Fees are split: 2% treasury, 3% burn.
 *
 * @dev Security properties:
 *   - Server-signed EIP-712 typed message prevents match result forgery
 *   - nonce per match prevents signature replay across matches
 *   - usedNonces mapping prevents the same nonce being used twice
 *   - ReentrancyGuard on all value-transferring functions
 *   - Only the oracle (server wallet) can trigger settlement
 *   - Players can call emergencyWithdraw after TIMEOUT if not settled
 */
contract ArcadeStrikeEscrow is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --------------------------------------------------------
    // CONSTANTS
    // --------------------------------------------------------

    uint256 public constant FEE_BPS_TOTAL    = 500;  // 5%
    uint256 public constant FEE_BPS_TREASURY = 200;  // 2%
    uint256 public constant FEE_BPS_BURN     = 300;  // 3%
    uint256 public constant BPS_DENOMINATOR  = 10_000;
    uint256 public constant MATCH_TIMEOUT    = 10 minutes; // emergency withdraw window

    bytes32 private constant RESULT_TYPEHASH = keccak256(
        "MatchResult(bytes32 matchId,address winner,address player1,address player2,uint256 wagerWei,uint256 nonce,uint256 timestamp)"
    );

    // --------------------------------------------------------
    // STATE
    // --------------------------------------------------------

    struct Match {
        address player1;
        address player2;
        uint256 wagerWei;       // per-player stake (NOT total pot)
        uint256 lockedAt;       // block.timestamp when both players deposited
        bool    settled;
    }

    IERC20  public immutable gameToken;      // STRIKE token, burned for fees
    address public           treasury;
    address public           oracle;         // game-server signing key (EOA)

    mapping(bytes32 => Match)   public matches;      // matchId => Match
    mapping(bytes32 => bool)    public usedNonces;   // nonce => consumed

    // --------------------------------------------------------
    // EVENTS
    // --------------------------------------------------------

    event MatchCreated(bytes32 indexed matchId, address player1, address player2, uint256 wagerWei);
    event MatchSettled(bytes32 indexed matchId, address winner, uint256 payout, uint256 fee);
    event EmergencyWithdraw(bytes32 indexed matchId, address player, uint256 amount);
    event OracleUpdated(address oldOracle, address newOracle);

    // --------------------------------------------------------
    // ERRORS
    // --------------------------------------------------------

    error MatchAlreadyExists();
    error MatchNotFound();
    error MatchAlreadySettled();
    error InvalidDeposit();
    error NotAPlayer();
    error TooEarlyToWithdraw();
    error NonceAlreadyUsed();
    error InvalidSignature();
    error InvalidWinner();
    error StaleResult();

    // --------------------------------------------------------
    // CONSTRUCTOR
    // --------------------------------------------------------

    constructor(
        address _gameToken,
        address _treasury,
        address _oracle
    )
        EIP712("ArcadeStrikeOracle", "1")
        Ownable(msg.sender)
    {
        gameToken = IERC20(_gameToken);
        treasury  = _treasury;
        oracle    = _oracle;
    }

    // --------------------------------------------------------
    // MATCH CREATION  (called by server on match found)
    // --------------------------------------------------------

    /**
     * @notice Create escrow for a new match. Both players must approve
     *         this contract to spend `wagerWei` STRIKE before calling.
     *         The server calls this after both players confirm deposit.
     * @param matchId  Unique match identifier (bytes32 of UUID)
     * @param player1  Address of first player
     * @param player2  Address of second player
     * @param wagerWei Stake per player in token wei
     */
    function createMatch(
        bytes32 matchId,
        address player1,
        address player2,
        uint256 wagerWei
    ) external nonReentrant {
        if (matches[matchId].player1 != address(0)) revert MatchAlreadyExists();
        if (wagerWei == 0) revert InvalidDeposit();

        // Pull tokens from both players
        gameToken.safeTransferFrom(player1, address(this), wagerWei);
        gameToken.safeTransferFrom(player2, address(this), wagerWei);

        matches[matchId] = Match({
            player1:  player1,
            player2:  player2,
            wagerWei: wagerWei,
            lockedAt: block.timestamp,
            settled:  false
        });

        emit MatchCreated(matchId, player1, player2, wagerWei);
    }

    // --------------------------------------------------------
    // SETTLEMENT  (oracle-triggered)
    // --------------------------------------------------------

    /**
     * @notice Settle a match using a signed result from the game oracle.
     * @param matchId    Match to settle
     * @param winner     Address of winning player
     * @param nonce      Unique bytes32 nonce for this result (prevents replay)
     * @param timestamp  Unix timestamp of result signing (must be recent)
     * @param signature  EIP-712 signature from oracle EOA
     */
    function settleMatch(
        bytes32 matchId,
        address winner,
        bytes32 nonce,
        uint256 timestamp,
        bytes calldata signature
    ) external nonReentrant {
        Match storage m = matches[matchId];
        if (m.player1 == address(0))  revert MatchNotFound();
        if (m.settled)                revert MatchAlreadySettled();
        if (usedNonces[nonce])        revert NonceAlreadyUsed();
        // Timestamp must be within 5 minutes to prevent stale results
        if (block.timestamp > timestamp + 5 minutes) revert StaleResult();

        // Verify winner is one of the two players
        if (winner != m.player1 && winner != m.player2) revert InvalidWinner();

        // Reconstruct and verify EIP-712 signature
        bytes32 structHash = keccak256(abi.encode(
            RESULT_TYPEHASH,
            matchId,
            winner,
            m.player1,
            m.player2,
            m.wagerWei,
            nonce,
            timestamp
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        if (signer != oracle) revert InvalidSignature();

        // Mark settled and consume nonce
        m.settled      = true;
        usedNonces[nonce] = true;

        // Calculate pot and fees
        uint256 totalPot      = m.wagerWei * 2;
        uint256 feeTreasury   = (totalPot * FEE_BPS_TREASURY) / BPS_DENOMINATOR;
        uint256 feeBurn       = (totalPot * FEE_BPS_BURN)     / BPS_DENOMINATOR;
        uint256 totalFee      = feeTreasury + feeBurn;
        uint256 winnerPayout  = totalPot - totalFee;

        // Distribute
        gameToken.safeTransfer(winner,   winnerPayout);
        gameToken.safeTransfer(treasury, feeTreasury);
        // Burn: transfer to dead address (if token has burn(), call it instead)
        gameToken.safeTransfer(address(0xdead), feeBurn);

        emit MatchSettled(matchId, winner, winnerPayout, totalFee);
    }

    // --------------------------------------------------------
    // EMERGENCY WITHDRAW  (timeout safety hatch)
    // --------------------------------------------------------

    /**
     * @notice If a match is not settled within MATCH_TIMEOUT, either
     *         player can reclaim their original stake. This protects
     *         against server downtime or oracle key loss.
     */
    function emergencyWithdraw(bytes32 matchId) external nonReentrant {
        Match storage m = matches[matchId];
        if (m.player1 == address(0)) revert MatchNotFound();
        if (m.settled)               revert MatchAlreadySettled();
        if (msg.sender != m.player1 && msg.sender != m.player2) revert NotAPlayer();
        if (block.timestamp < m.lockedAt + MATCH_TIMEOUT) revert TooEarlyToWithdraw();

        uint256 refund = m.wagerWei;
        // Mark settled to prevent double-withdraw
        m.settled = true;

        // Refund both players (we handle both at once — simpler, no griefing)
        gameToken.safeTransfer(m.player1, refund);
        gameToken.safeTransfer(m.player2, refund);

        emit EmergencyWithdraw(matchId, msg.sender, refund * 2);
    }

    // --------------------------------------------------------
    // ADMIN
    // --------------------------------------------------------

    function setOracle(address _oracle) external onlyOwner {
        emit OracleUpdated(oracle, _oracle);
        oracle = _oracle;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    /// @notice EIP-712 domain separator (public for frontend verification)
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
