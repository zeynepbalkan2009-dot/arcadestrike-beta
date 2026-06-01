/**
 * NetworkManager — Colyseus client wrapper.
 * Manages room lifecycle, reconnection, and state sync.
 */
import { Client, Room } from 'colyseus.js';
import type { ArcadeRoomState } from '../types/GameState';
import {
  MSG_INPUT, MSG_READY, MSG_PING, MSG_PONG,
  MSG_COUNTDOWN, MSG_ROUND_START, MSG_ROUND_END,
  MSG_MATCH_END, MSG_PLAYER_HIT, MSG_GAME_ERROR,
} from '../../../../packages/shared/src/types';
import type { PlayerInputPayload } from '../../../../packages/shared/src/types';

type NetworkEvent =
  | 'connected'
  | 'disconnected'
  | 'countdown'
  | 'roundStart'
  | 'roundEnd'
  | 'matchEnd'
  | 'playerHit'
  | 'error';

type EventCallback = (data?: any) => void;

class NetworkManager {
  private _client: Client | null     = null;
  private _room:   Room  | null      = null;
  private _handlers = new Map<NetworkEvent, EventCallback[]>();
  private _pingInterval: ReturnType<typeof setInterval> | null = null;
  public  latency = 0;

  init(serverUrl: string): void {
    this._client = new Client(serverUrl);
  }

  async joinMatchmaking(playerId: string, displayName: string, mmr = 1000): Promise<void> {
    if (!this._client) throw new Error('NetworkManager not initialized');

    this._room = await this._client.joinOrCreate<any>('arcade', {
      playerId,
      displayName,
      mmr,
    });

    this._bindRoomEvents();
    this._startPing();
    this._emit('connected');
  }

  sendInput(input: PlayerInputPayload): void {
    this._room?.send(MSG_INPUT, input);
  }

  sendReady(): void {
    this._room?.send(MSG_READY);
  }

  on(event: NetworkEvent, cb: EventCallback): void {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event)!.push(cb);
  }

  off(event: NetworkEvent, cb: EventCallback): void {
    const arr = this._handlers.get(event);
    if (arr) this._handlers.set(event, arr.filter((fn) => fn !== cb));
  }

  get state(): any {
    return this._room?.state;
  }

  get roomId(): string | null {
    return this._room?.id ?? null;
  }

  async disconnect(): Promise<void> {
    this._clearPing();
    await this._room?.leave();
    this._room = null;
  }

  private _bindRoomEvents(): void {
    if (!this._room) return;

    this._room.onMessage(MSG_COUNTDOWN,  (d) => this._emit('countdown', d));
    this._room.onMessage(MSG_ROUND_START, (d) => this._emit('roundStart', d));
    this._room.onMessage(MSG_ROUND_END,   (d) => this._emit('roundEnd', d));
    this._room.onMessage(MSG_MATCH_END,   (d) => this._emit('matchEnd', d));
    this._room.onMessage(MSG_PLAYER_HIT,  (d) => this._emit('playerHit', d));
    this._room.onMessage(MSG_GAME_ERROR,  (d) => this._emit('error', d));
    this._room.onMessage(MSG_PONG,        (d) => {
      this.latency = Date.now() - (d?.ts ?? Date.now());
    });

    this._room.onLeave(() => {
      this._clearPing();
      this._emit('disconnected');
    });
  }

  private _startPing(): void {
    this._pingInterval = setInterval(() => {
      this._room?.send(MSG_PING, { ts: Date.now() });
    }, 2000);
  }

  private _clearPing(): void {
    if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
  }

  private _emit(event: NetworkEvent, data?: any): void {
    this._handlers.get(event)?.forEach((fn) => fn(data));
  }
}

// Singleton
export const networkManager = new NetworkManager();
