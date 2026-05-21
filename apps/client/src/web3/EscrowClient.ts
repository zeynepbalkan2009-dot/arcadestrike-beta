/**
 * EscrowClient
 *
 * Client-side Web3 wrapper for the ArcadeStrikeEscrow contract.
 *
 * Orchestrates the full escrow deposit → lock → settle flow
 * from the browser, coordinating with:
 *   - WalletManager (signing + broadcasting txs)
 *   - NetworkManager (confirming deposit with server)
 *   - REST API (getting prepared tx calldata)
 *
 * Emits events so FightScene / QueueScene can react to
 * each state change without polling.
 */
import { ethers } from "ethers";
import { WalletManager } from "./WalletManager";
import { NetworkManager } from "../network/NetworkManager";

const API_BASE     = import.meta.env.VITE_API_URL     || "http://localhost:2567";
const ESCROW_ADDR  = import.meta.env.VITE_ESCROW_ADDRESS || "";
const TOKEN_ADDR   = import.meta.env.VITE_TOKEN_ADDRESS  || "";

export type EscrowStatus =
  | "idle"
  | "approving"
  | "depositing"
  | "confirming"
  | "locked"
  | "settling"
  | "settled"
  | "cancelled"
  | "error";

export type EscrowEventType =
  | "status_change"
  | "deposit_sent"
  | "deposit_confirmed"
  | "locked"
  | "settled"
  | "error";

type EscrowListener = (event: { type: EscrowEventType; data?: any }) => void;

export class EscrowClient {
  private wallet  = WalletManager.getInstance();
  private network = NetworkManager.getInstance();
  private status: EscrowStatus = "idle";
  private listeners: EscrowListener[] = [];

  // ─── Escrow flow ────────────────────────────────────────────

  /**
   * Full flow for PLAYER 1 (match creator):
   *  1. Approve ERC-20 if needed
   *  2. Fetch prepared createMatch calldata from server
   *  3. Sign + broadcast tx
   *  4. Notify server of txHash
   */
  async depositAsCreator(params: {
    matchId:       string;
    player2Address:string;
    wagerAmount:   string;
    useToken:      boolean;  // true = ERC-20, false = native MATIC
  }): Promise<string> {
    this.setStatus("depositing");

    try {
      // Approve ERC-20 first if using token
      if (params.useToken && TOKEN_ADDR) {
        this.setStatus("approving");
        await this.wallet.approveERC20ForEscrow(params.wagerAmount);
        this.emit("status_change", { status: "approved" });
      }

      this.setStatus("depositing");

      // Get prepared tx from server
      const txData = await this.prepareTx({
        matchId:        params.matchId,
        role:           "creator",
        player2Address: params.player2Address,
        wagerAmount:    params.wagerAmount,
        tokenAddress:   params.useToken ? TOKEN_ADDR : ethers.ZeroAddress,
      });

      // Sign + broadcast
      const txHash = await this.wallet.sendPreparedTx(txData);
      this.emit("deposit_sent", { txHash });

      this.setStatus("confirming");

      // Confirm with server
      await this.confirmWithServer(params.matchId, txHash, params.wagerAmount);
      this.network.sendEscrowConfirmed(txHash);

      this.setStatus("locked");
      this.emit("locked", { txHash });

      return txHash;
    } catch (err: any) {
      this.setStatus("error");
      this.emit("error", { message: err.message });
      throw err;
    }
  }

  /**
   * Full flow for PLAYER 2 (match joiner):
   *  1. Approve ERC-20 if needed
   *  2. Fetch prepared joinMatch calldata
   *  3. Sign + broadcast
   *  4. Notify server
   */
  async depositAsJoiner(params: {
    matchId:     string;
    wagerAmount: string;
    useToken:    boolean;
  }): Promise<string> {
    this.setStatus("depositing");

    try {
      if (params.useToken && TOKEN_ADDR) {
        this.setStatus("approving");
        await this.wallet.approveERC20ForEscrow(params.wagerAmount);
      }

      this.setStatus("depositing");

      const txData = await this.prepareTx({
        matchId:     params.matchId,
        role:        "joiner",
        wagerAmount: params.wagerAmount,
        tokenAddress: params.useToken ? TOKEN_ADDR : ethers.ZeroAddress,
      });

      const txHash = await this.wallet.sendPreparedTx(txData);
      this.emit("deposit_sent", { txHash });

      this.setStatus("confirming");
      await this.confirmWithServer(params.matchId, txHash, params.wagerAmount);
      this.network.sendEscrowConfirmed(txHash);

      this.setStatus("locked");
      this.emit("locked", { txHash });

      return txHash;
    } catch (err: any) {
      this.setStatus("error");
      this.emit("error", { message: err.message });
      throw err;
    }
  }

  /**
   * Claim settlement on-chain.
   * Called by client after receiving ORACLE_RESULT via WebSocket.
   * In practice, the server auto-settles — this is the client fallback.
   */
  async settleOnChain(params: {
    matchId:       string;
    winnerAddress: string;
    loserAddress:  string;
    nonce:         string;
    signature:     string;
  }): Promise<string> {
    this.setStatus("settling");

    try {
      const res = await this.authedFetch("/api/escrow/settle", "POST", params);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Settlement failed");
      }
      const { txHash } = await res.json();
      this.setStatus("settled");
      this.emit("settled", { txHash });
      return txHash;
    } catch (err: any) {
      this.setStatus("error");
      this.emit("error", { message: err.message });
      throw err;
    }
  }

  /**
   * Cancel a match and get a refund.
   * Only succeeds after the timeout window on-chain.
   */
  async cancelMatch(matchId: string): Promise<string> {
    const res = await this.authedFetch(`/api/escrow/cancel/${matchId}`, "POST", {});
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Cancel failed");
    }
    const { txHash } = await res.json();
    this.setStatus("cancelled");
    return txHash;
  }

  /**
   * Poll on-chain match status (useful for recovery after reconnect).
   */
  async getOnChainStatus(matchId: string): Promise<string> {
    const res = await this.authedFetch(`/api/escrow/match/${matchId}`, "GET");
    if (!res.ok) return "unknown";
    const data = await res.json();
    return data.status;
  }

  getStatus(): EscrowStatus { return this.status; }

  // ─── Event system ────────────────────────────────────────────

  on(listener: EscrowListener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private emit(type: EscrowEventType, data?: any): void {
    this.listeners.forEach(l => l({ type, data }));
  }

  private setStatus(s: EscrowStatus): void {
    this.status = s;
    this.emit("status_change", { status: s });
  }

  // ─── Helpers ────────────────────────────────────────────────

  private async prepareTx(body: Record<string, any>): Promise<{
    to: string; data: string; value: string;
  }> {
    const res = await this.authedFetch("/api/escrow/prepare", "POST", body);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to prepare tx");
    }
    return res.json();
  }

  private async confirmWithServer(
    matchId: string,
    txHash: string,
    amountWei: string
  ): Promise<void> {
    const res = await this.authedFetch("/api/escrow/confirm", "POST", {
      matchId,
      txHash,
      amountWei,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Deposit confirmation failed");
    }
  }

  private authedFetch(path: string, method = "GET", body?: any): Promise<Response> {
    const token = this.wallet.getToken();
    return fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
}
