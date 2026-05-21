/**
 * EscrowWatcher
 *
 * Subscribes to ArcadeStrikeEscrow contract events via WebSocket
 * RPC provider. When both player deposits confirm, notifies the
 * MatchStateMachine to advance to ESCROW_LOCKED.
 *
 * In production: use Alchemy/Infura webhooks + confirmation depth ≥ 2.
 */
import { ethers } from "ethers";
import { EventEmitter } from "events";
import { createLogger } from "../utils/logger";

const log = createLogger("EscrowWatcher");

const ESCROW_ABI = [
  "event MatchCreated(bytes32 indexed matchId, address indexed player1, address indexed player2, uint256 wagerAmount, address tokenAddress)",
  "event MatchLocked(bytes32 indexed matchId)",
  "event MatchSettled(bytes32 indexed matchId, address indexed winner, uint256 payout, uint256 feeTotal)",
  "event MatchCancelled(bytes32 indexed matchId, string reason)",
];

export class EscrowWatcher extends EventEmitter {
  private provider: ethers.WebSocketProvider | ethers.JsonRpcProvider | null = null;
  private contract: ethers.Contract | null = null;
  private watchedMatches = new Set<string>();

  async initialize(): Promise<void> {
    const rpcUrl = process.env.RPC_URL_WS || process.env.RPC_URL;
    const escrowAddress = process.env.ESCROW_ADDRESS;

    if (!rpcUrl || !escrowAddress) {
      log.warn("EscrowWatcher: RPC_URL or ESCROW_ADDRESS not set — on-chain watching disabled");
      return;
    }

    try {
      this.provider = rpcUrl.startsWith("wss://")
        ? new ethers.WebSocketProvider(rpcUrl)
        : new ethers.JsonRpcProvider(rpcUrl);

      this.contract = new ethers.Contract(escrowAddress, ESCROW_ABI, this.provider);

      this.contract.on("MatchLocked", (matchId: string) => {
        log.info({ matchId }, "On-chain: MatchLocked event received");
        this.emit("match_locked", { matchId });
      });

      this.contract.on("MatchSettled", (matchId: string, winner: string, payout: bigint) => {
        log.info({ matchId, winner, payout: payout.toString() }, "On-chain: MatchSettled");
        this.emit("match_settled", { matchId, winner, payout: payout.toString() });
      });

      this.contract.on("MatchCancelled", (matchId: string, reason: string) => {
        log.warn({ matchId, reason }, "On-chain: MatchCancelled");
        this.emit("match_cancelled", { matchId, reason });
      });

      log.info({ escrowAddress }, "EscrowWatcher listening to contract events");
    } catch (err) {
      log.error({ err }, "EscrowWatcher failed to initialize");
    }
  }

  watchMatch(matchId: string): void {
    this.watchedMatches.add(matchId);
  }

  stopWatching(matchId: string): void {
    this.watchedMatches.delete(matchId);
  }

  async getMatchStatus(matchIdBytes32: string): Promise<string> {
    if (!this.contract) return "unknown";
    try {
      const match = await this.contract.getMatch(matchIdBytes32);
      const statusMap = ["NONE","PENDING","LOCKED","SETTLED","CANCELLED"];
      return statusMap[Number(match.status)] || "unknown";
    } catch {
      return "unknown";
    }
  }

  dispose(): void {
    if (this.contract) {
      this.contract.removeAllListeners();
      this.contract = null;
    }
    if (this.provider && "destroy" in this.provider) {
      (this.provider as ethers.WebSocketProvider).destroy();
    }
  }
}
