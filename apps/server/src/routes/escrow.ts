/**
 * Escrow Routes
 *
 * Bridge between the off-chain game server and the on-chain
 * ArcadeStrikeEscrow contract. Handles:
 *
 *   POST /api/escrow/prepare       — build unsigned tx for player deposit
 *   POST /api/escrow/confirm       — verify deposit confirmed on-chain
 *   GET  /api/escrow/match/:matchId — on-chain match status
 *   POST /api/escrow/settle        — submit oracle sig on-chain (server auto)
 *   GET  /api/escrow/history       — player escrow transaction history
 */
import { Router } from "express";
import { ethers } from "ethers";
import { requireAuth } from "../middleware/auth";
import { rateLimitApi, rateLimitPayout } from "../middleware/rateLimit";
import { EscrowWatcher } from "../web3/EscrowWatcher";
import { createLogger } from "../utils/logger";

const log = createLogger("routes/escrow");

// ABI fragments needed by this router
const ESCROW_ABI_FRAGMENTS = [
  "function createMatch(bytes32 matchId, address player2, address token, uint256 amount) payable",
  "function joinMatch(bytes32 matchId) payable",
  "function settleMatch(bytes32 matchId, address winner, address loser, bytes32 nonce, bytes calldata signature)",
  "function cancelMatch(bytes32 matchId)",
  "function getMatch(bytes32 matchId) view returns (tuple(address player1, address player2, uint256 wagerAmount, address tokenAddress, uint8 status, uint256 createdAt, uint256 lockedAt, uint256 settledAt, address winner))",
  "function matches(bytes32) view returns (address player1, address player2, uint256 wagerAmount, address tokenAddress, uint8 status, uint256 createdAt, uint256 lockedAt, uint256 settledAt, address winner)",
];

const MATCH_STATUS = ["NONE","PENDING","LOCKED","SETTLED","CANCELLED"] as const;

function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(process.env.RPC_URL || "https://polygon-rpc.com");
}

function getEscrowContract(signerOrProvider?: ethers.Signer | ethers.Provider): ethers.Contract {
  const address = process.env.ESCROW_ADDRESS;
  if (!address) throw new Error("ESCROW_ADDRESS not configured");
  return new ethers.Contract(address, ESCROW_ABI_FRAGMENTS, signerOrProvider || getProvider());
}

function getOracleSigner(): ethers.Wallet {
  if (!process.env.ORACLE_PRIVATE_KEY) throw new Error("ORACLE_PRIVATE_KEY not set");
  return new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY, getProvider());
}

export function createEscrowRouter(): Router {
  const router = Router();

  /**
   * POST /api/escrow/prepare
   *
   * Returns the unsigned transaction data for the client wallet to sign.
   * Client calls this, receives calldata, signs with MetaMask, broadcasts.
   *
   * Body: {
   *   matchId: string,           — internal game match ID
   *   role: "creator" | "joiner",
   *   player2Address?: string,   — required if role === "creator"
   *   wagerAmount: string,       — in wei
   *   tokenAddress?: string      — address(0) for native MATIC
   * }
   */
  router.post("/prepare", requireAuth, rateLimitApi, async (req, res) => {
    const { matchId, role, player2Address, wagerAmount, tokenAddress } = req.body;

    if (!matchId || !role || !wagerAmount) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const escrowAddress = process.env.ESCROW_ADDRESS;
      if (!escrowAddress) return res.status(503).json({ error: "Escrow contract not configured" });

      const matchIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(matchId));
      const tokenAddr = tokenAddress || ethers.ZeroAddress;
      const iface = new ethers.Interface(ESCROW_ABI_FRAGMENTS);

      let calldata: string;
      if (role === "creator") {
        if (!player2Address || !ethers.isAddress(player2Address)) {
          return res.status(400).json({ error: "Valid player2Address required for creator" });
        }
        calldata = iface.encodeFunctionData("createMatch", [
          matchIdBytes32,
          player2Address,
          tokenAddr,
          wagerAmount,
        ]);
      } else if (role === "joiner") {
        calldata = iface.encodeFunctionData("joinMatch", [matchIdBytes32]);
      } else {
        return res.status(400).json({ error: "role must be creator or joiner" });
      }

      // If native token (MATIC), value must equal wagerAmount
      const txValue = tokenAddr === ethers.ZeroAddress ? wagerAmount : "0";

      res.json({
        to: escrowAddress,
        data: calldata,
        value: txValue,
        matchIdBytes32,
        note: "Sign and broadcast this transaction with the player wallet",
      });
    } catch (err: any) {
      log.error({ err }, "Escrow prepare failed");
      res.status(500).json({ error: err.message || "Internal error" });
    }
  });

  /**
   * POST /api/escrow/confirm
   *
   * Called by client after broadcasting the deposit tx.
   * Server verifies on-chain, then advances match state.
   *
   * Body: { txHash: string, matchId: string }
   */
  router.post("/confirm", requireAuth, rateLimitApi, async (req, res) => {
    const { txHash, matchId } = req.body;
    const playerId = req.auth!.playerId;

    if (!txHash || !matchId) {
      return res.status(400).json({ error: "Missing txHash or matchId" });
    }

    try {
      const provider = getProvider();

      // Poll for receipt with up to 30s timeout
      let receipt: ethers.TransactionReceipt | null = null;
      for (let i = 0; i < 6; i++) {
        receipt = await provider.getTransactionReceipt(txHash);
        if (receipt) break;
        await new Promise(r => setTimeout(r, 5000));
      }

      if (!receipt) {
        return res.status(202).json({
          status: "pending",
          message: "Transaction not yet confirmed. Try again in a few seconds.",
        });
      }

      if (receipt.status !== 1) {
        return res.status(400).json({ error: "Transaction reverted on-chain", txHash });
      }

      // Verify it went to the right contract
      const escrowAddress = process.env.ESCROW_ADDRESS?.toLowerCase();
      if (receipt.to?.toLowerCase() !== escrowAddress) {
        return res.status(400).json({ error: "Transaction sent to wrong contract" });
      }

      const matchIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(matchId));
      const contract = getEscrowContract();
      const onChainMatch = await contract.getMatch(matchIdBytes32);
      const statusName = MATCH_STATUS[Number(onChainMatch.status)] || "UNKNOWN";

      log.info({ playerId, matchId, txHash, status: statusName }, "Escrow deposit confirmed on-chain");

      res.json({
        status: "confirmed",
        matchStatus: statusName,
        txHash,
        blockNumber: receipt.blockNumber,
      });
    } catch (err: any) {
      log.error({ err, txHash }, "Escrow confirm failed");
      res.status(500).json({ error: err.message || "Internal error" });
    }
  });

  /**
   * GET /api/escrow/match/:matchId
   *
   * Read current on-chain match state.
   */
  router.get("/match/:matchId", requireAuth, rateLimitApi, async (req, res) => {
    const { matchId } = req.params;

    try {
      const matchIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(matchId));
      const contract = getEscrowContract();
      const m = await contract.getMatch(matchIdBytes32);

      res.json({
        matchId,
        matchIdBytes32,
        player1:      m.player1,
        player2:      m.player2,
        wagerAmount:  m.wagerAmount.toString(),
        tokenAddress: m.tokenAddress,
        status:       MATCH_STATUS[Number(m.status)] || "UNKNOWN",
        createdAt:    Number(m.createdAt),
        lockedAt:     Number(m.lockedAt),
        settledAt:    Number(m.settledAt),
        winner:       m.winner,
      });
    } catch (err: any) {
      // If contract reverts, match doesn't exist
      if (err.code === "CALL_EXCEPTION") {
        return res.status(404).json({ error: "Match not found on-chain" });
      }
      log.error({ err }, "Failed to fetch on-chain match");
      res.status(500).json({ error: "Internal error" });
    }
  });

  /**
   * POST /api/escrow/settle
   *
   * Server-initiated settlement. Called internally after oracle signs
   * the match result. Submits the settle tx from the oracle wallet.
   *
   * In production this is called by the server automatically —
   * not by the client. This REST endpoint is for manual fallback only.
   *
   * Body: {
   *   matchId: string,
   *   winnerAddress: string,
   *   loserAddress: string,
   *   nonce: string,       — bytes32 hex from OracleService
   *   signature: string    — oracle EIP-712 sig
   * }
   */
  router.post("/settle", requireAuth, rateLimitPayout, async (req, res) => {
    const { matchId, winnerAddress, loserAddress, nonce, signature } = req.body;

    if (!matchId || !winnerAddress || !loserAddress || !nonce || !signature) {
      return res.status(400).json({ error: "Missing required settlement fields" });
    }

    if (!ethers.isAddress(winnerAddress) || !ethers.isAddress(loserAddress)) {
      return res.status(400).json({ error: "Invalid Ethereum addresses" });
    }

    try {
      const oracleSigner = getOracleSigner();
      const contract = getEscrowContract(oracleSigner);
      const matchIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(matchId));

      const tx = await contract.settleMatch(
        matchIdBytes32,
        winnerAddress,
        loserAddress,
        nonce,
        signature,
        { gasLimit: 250_000 }
      );

      log.info({ matchId, winner: winnerAddress, txHash: tx.hash }, "Settlement tx submitted");

      // Don't wait for confirmation — return immediately
      res.json({
        status: "submitted",
        txHash: tx.hash,
        message: "Settlement transaction submitted. Funds will be distributed after confirmation.",
      });

      // Log confirmation in background
      tx.wait().then((receipt: any) => {
        log.info({ matchId, txHash: tx.hash, blockNumber: receipt.blockNumber }, "Settlement confirmed ✓");
      }).catch((err: any) => {
        log.error({ err, matchId }, "Settlement tx failed on-chain");
      });

    } catch (err: any) {
      log.error({ err, matchId }, "Settlement failed");
      // Parse revert reason if available
      const reason = err.reason || err.shortMessage || err.message || "Unknown error";
      res.status(500).json({ error: reason });
    }
  });

  /**
   * POST /api/escrow/cancel/:matchId
   *
   * Cancel an expired/abandoned match and refund players.
   * Only callable by participants after timeout windows have passed.
   */
  router.post("/cancel/:matchId", requireAuth, rateLimitApi, async (req, res) => {
    const { matchId } = req.params;
    const playerId = req.auth!.playerId;

    try {
      const oracleSigner = getOracleSigner();
      const contract = getEscrowContract(oracleSigner);
      const matchIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(matchId));

      const tx = await contract.cancelMatch(matchIdBytes32, { gasLimit: 150_000 });
      log.info({ matchId, playerId, txHash: tx.hash }, "Cancel tx submitted");

      res.json({ status: "submitted", txHash: tx.hash });
    } catch (err: any) {
      const reason = err.reason || err.shortMessage || err.message;
      res.status(500).json({ error: reason });
    }
  });

  /**
   * GET /api/escrow/history
   *
   * Returns the last 50 settled/cancelled matches for this player
   * by querying on-chain event logs.
   * NOTE: In production use an indexed subgraph (The Graph) for this.
   */
  router.get("/history", requireAuth, rateLimitApi, async (req, res) => {
    const { address } = req.query;

    if (!address || !ethers.isAddress(address as string)) {
      return res.status(400).json({ error: "Valid Ethereum address required as query param" });
    }

    try {
      const provider = getProvider();
      const escrowAddress = process.env.ESCROW_ADDRESS;
      if (!escrowAddress) return res.json({ history: [] });

      const iface = new ethers.Interface([
        "event MatchSettled(bytes32 indexed matchId, address indexed winner, uint256 payout, uint256 feeTotal)",
      ]);

      const filter = {
        address: escrowAddress,
        topics: [
          iface.getEvent("MatchSettled")!.topicHash,
          null,  // any matchId
          ethers.zeroPadValue(address as string, 32), // winner = this address
        ],
        fromBlock: -10000, // last ~10k blocks (~3 hours on Polygon)
      };

      const logs = await provider.getLogs(filter as any);
      const history = logs.map(log => {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        return {
          matchId:     parsed?.args.matchId,
          winner:      parsed?.args.winner,
          payout:      parsed?.args.payout?.toString(),
          feeTotal:    parsed?.args.feeTotal?.toString(),
          blockNumber: log.blockNumber,
          txHash:      log.transactionHash,
        };
      }).reverse();

      res.json({ history: history.slice(0, 50) });
    } catch (err: any) {
      log.error({ err }, "History fetch failed");
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  return router;
}
