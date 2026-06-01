/**
 * NetworkManager
 *
 * Singleton. Owns the Colyseus WebSocket connection lifecycle.
 *
 * Responsibilities:
 *  - Connect / reconnect with exponential backoff
 *  - Join / leave Colyseus rooms
 *  - Route incoming messages to registered handlers
 *  - Send inputs and queue messages during brief disconnects
 *  - Expose typed send methods so the rest of the client
 *    never touches the raw socket
 */
import { Client, Room } from "colyseus.js";
import type {
  C2SMessage,
  S2CMessage,
  PlayerInput,
  JoinQueueRequest,
} from "@arcadestrike/shared";

type MessageHandler<T = any> = (payload: T) => void;

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "ws://localhost:2567";
const MAX_RECONNECT_ATTEMPTS = 8;
const BASE_RECONNECT_DELAY_MS = 500;

export class NetworkManager {
  private static instance: NetworkManager | null = null;

  private client: Client;
  private room: Room | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private sendQueue: C2SMessage[] = [];
  private inputSentAt = new Map<number, number>();
  private latencyMs = 0;
  private playerId = "";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;

  private constructor() {
    this.client = new Client(SERVER_URL);
  }

  static getInstance(): NetworkManager {
    if (!NetworkManager.instance) {
      NetworkManager.instance = new NetworkManager();
    }
    return NetworkManager.instance;
  }

  // ─── Connection ─────────────────────────────────────────────

  isConnected(): boolean {
    return this.room !== null && this.room.connection.isOpen;
  }

  getPlayerId(): string {
    return this.playerId || this.room?.sessionId || "";
  }

  getLatencyMs(): number {
    return this.latencyMs;
  }

  /**
   * Connect to a game room. Called by QueueScene once a match is found.
   */
  async joinRoom(
    roomName: string,
    options: Record<string, any>,
    authToken: string
  ): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      this.room = await this.client.joinOrCreate(roomName, { ...options, token: authToken });
      this.playerId = this.room.sessionId;
      this.reconnectAttempts = 0;
      this.isConnecting = false;

      this.attachRoomHandlers();
      this.flushSendQueue();
    } catch (err) {
      this.isConnecting = false;
      throw err;
    }
  }

  async joinMatchedRoom(roomId: string, authToken: string): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      this.room = await this.client.joinById(roomId, { token: authToken });
      this.playerId = this.room.sessionId;
      this.reconnectAttempts = 0;
      this.isConnecting = false;
      this.attachRoomHandlers();
      this.flushSendQueue();
    } catch (err) {
      this.isConnecting = false;
      throw err;
    }
  }

  async reconnect(reconnectionToken: string, sessionId: string, authToken: string): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;
    try {
      this.room = await this.client.reconnect(reconnectionToken);
      this.playerId = sessionId;
      this.reconnectAttempts = 0;
      this.isConnecting = false;
      this.attachRoomHandlers();
      this.flushSendQueue();
    } catch {
      this.isConnecting = false;
      this.scheduleReconnect(reconnectionToken, sessionId, authToken);
    }
  }

  async leaveRoom(): Promise<void> {
    if (this.room) {
      await this.room.leave();
      this.room = null;
    }
  }

  // ─── Message Routing ────────────────────────────────────────

  on<T = any>(type: string, handler: MessageHandler<T>): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    // Returns unsubscribe function
    return () => this.handlers.get(type)?.delete(handler);
  }

  off(type: string, handler: MessageHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  private emit(type: string, payload: any): void {
    const set = this.handlers.get(type);
    if (set) for (const h of set) h(payload);
  }

  // ─── Typed Send Methods ─────────────────────────────────────

  sendInput(input: PlayerInput): void {
    this.inputSentAt.set(input.seq, performance.now());
    if (this.inputSentAt.size > 64) {
      const oldest = Math.min(...this.inputSentAt.keys());
      this.inputSentAt.delete(oldest);
    }
    this.send({ type: "INPUT", payload: input });
  }

  async joinQueue(request: JoinQueueRequest): Promise<void> {
    // For queue join: use the REST API (not WS) since we're not in a room yet
    const token = localStorage.getItem("arcadestrike_token") || "";
    const res = await fetch(
      (import.meta.env.VITE_API_URL || "http://localhost:2567") + "/api/matchmaking/queue",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(request),
      }
    );
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Queue join failed");
    }
  }

  async leaveQueue(): Promise<void> {
    const token = localStorage.getItem("arcadestrike_token") || "";
    await fetch(
      (import.meta.env.VITE_API_URL || "http://localhost:2567") + "/api/matchmaking/queue",
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
  }

  async getQueueStatus(): Promise<any> {
    const token = localStorage.getItem("arcadestrike_token") || "";
    const res = await fetch(
      (import.meta.env.VITE_API_URL || "http://localhost:2567") + "/api/matchmaking/status",
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!res.ok) throw new Error("Queue status failed");
    return res.json();
  }

  sendRematchVote(vote: boolean): void {
    this.send({ type: "REMATCH_VOTE", payload: { vote } });
  }

  sendEscrowConfirmed(txHash: string): void {
    this.send({ type: "ESCROW_CONFIRMED", payload: { txHash } });
  }

  // ─── Internal ───────────────────────────────────────────────

  private send(msg: C2SMessage): void {
    if (this.isConnected()) {
      this.room!.send(msg.type, (msg as any).payload);
    } else {
      // Buffer messages during brief disconnects (inputs only, limited)
      if (msg.type === "INPUT" && this.sendQueue.length < 20) {
        this.sendQueue.push(msg);
      }
    }
  }

  private flushSendQueue(): void {
    while (this.sendQueue.length > 0 && this.isConnected()) {
      const msg = this.sendQueue.shift()!;
      this.room!.send(msg.type, (msg as any).payload);
    }
  }

  private attachRoomHandlers(): void {
    if (!this.room) return;

    // State sync (Colyseus delta serialization)
    this.room.onStateChange((state: any) => {
      this.emit("STATE_SNAPSHOT", {
        tick:         state.tick,
        state:        state,
        yourPlayerId: this.playerId,
      });
    });

    // Named messages from server
    const messageTypes: S2CMessage["type"][] = [
      "STATE_DELTA",
      "MATCH_FOUND",
      "MATCH_START",
      "ROUND_END",
      "MATCH_END",
      "QUEUE_UPDATE",
      "INPUT_ACK",
      "ORACLE_RESULT",
      "ERROR",
      "REMATCH_START",
      "REMATCH_DECLINED",
    ];

    for (const type of messageTypes) {
      this.room.onMessage(type, (payload: any) => {
        if (type === "INPUT_ACK" && typeof payload?.seq === "number") {
          const sentAt = this.inputSentAt.get(payload.seq);
          if (sentAt !== undefined) {
            const sample = performance.now() - sentAt;
            this.latencyMs = this.latencyMs === 0 ? sample : this.latencyMs * 0.82 + sample * 0.18;
            this.inputSentAt.delete(payload.seq);
            this.emit("LATENCY", { latencyMs: this.latencyMs });
          }
        }
        this.emit(type, payload);
      });
    }

    this.room.onError((code, message) => {
      console.error(`[NetworkManager] Room error ${code}: ${message}`);
      this.emit("ROOM_ERROR", { code, message });
    });

    this.room.onLeave((code) => {
      const reconnectionToken = this.room!.reconnectionToken;
      const sessionId  = this.room!.sessionId;
      const token      = localStorage.getItem("arcadestrike_token") || "";
      this.room = null;

      this.emit("DISCONNECTED", { code });

      // Attempt reconnect for abnormal closures (1001-1015)
      if (code > 1000 && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        this.scheduleReconnect(reconnectionToken, sessionId, token);
      }
    });
  }

  private scheduleReconnect(reconnectionToken: string, sessionId: string, token: string): void {
    const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    this.emit("RECONNECTING", { attempt: this.reconnectAttempts, delayMs: delay });

    this.reconnectTimer = setTimeout(() => {
      this.reconnect(reconnectionToken, sessionId, token);
    }, delay);
  }

  dispose(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.room?.leave();
    this.room = null;
    this.handlers.clear();
    NetworkManager.instance = null;
  }
}
