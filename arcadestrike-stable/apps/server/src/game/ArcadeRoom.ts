import { Room, Client } from '@colyseus/core';
import { ArcadeRoomState, PlayerState } from './GameState';
import { simulateTick, resetCombatMeta } from './CombatEngine';
import { checkInput, resetAntiCheat } from './AntiCheat';
import { logger } from '../utils/logger';
import { metrics } from '../infra/metrics';
import { generateCorrelationId } from '../infra/correlation';
import {
  TICK_RATE, TICK_MS, MAX_HP, ROUNDS_TO_WIN,
  ROUND_DURATION_S, STAGE_WIDTH, GROUND_Y,
} from '../../../packages/shared/src/combat';
import {
  MSG_INPUT, MSG_READY, MSG_PING,
  MSG_PONG, MSG_COUNTDOWN, MSG_ROUND_START,
  MSG_ROUND_END, MSG_MATCH_END, MSG_PLAYER_HIT, MSG_GAME_ERROR,
} from '../../../packages/shared/src/types';
import type { PlayerInputPayload, HitResult } from '../../../packages/shared/src/types';

const COUNTDOWN_SECONDS = 3;
const PLAYER_SPAWN_X    = [150, STAGE_WIDTH - 150];

export class ArcadeRoom extends Room<ArcadeRoomState> {
  maxClients   = 2;
  private _tickInterval: ReturnType<typeof setInterval> | null = null;
  private _countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingInputs  = new Map<string, PlayerInputPayload>();
  private _playerMeta     = new Map<string, { sessionId: string; displayName: string; mmr: number }>();
  private _readyPlayers   = new Set<string>();
  private _roundStartTick = 0;

  onCreate(options: Record<string, unknown>) {
    this.setState(new ArcadeRoomState());
    this.state.matchId = generateCorrelationId();

    logger.info({ roomId: this.roomId, matchId: this.state.matchId }, '[Room] created');
    metrics.increment('rooms.created');

    this.onMessage(MSG_INPUT, (client, data: PlayerInputPayload) => this._handleInput(client, data));
    this.onMessage(MSG_READY, (client) => this._handleReady(client));
    this.onMessage(MSG_PING,  (client, data) => client.send(MSG_PONG, { ts: data?.ts ?? Date.now() }));

    // Auto-start after join if both players present
    this.clock.setTimeout(() => {
      if (this.clients.length < 2) {
        logger.warn({ roomId: this.roomId }, '[Room] not enough players — disposing');
        this.disconnect();
      }
    }, 30_000);
  }

  onJoin(client: Client, options: Record<string, unknown>) {
    const playerId    = String(options.playerId    ?? client.sessionId);
    const displayName = String(options.displayName ?? 'Player');
    const mmr         = Number(options.mmr         ?? 1000);
    const spawnIdx    = this.state.players.size;

    const p = new PlayerState();
    p.playerId    = playerId;
    p.displayName = displayName;
    p.x           = PLAYER_SPAWN_X[spawnIdx] ?? 400;
    p.y           = GROUND_Y;
    p.hp          = MAX_HP;
    p.connected   = true;
    p.facingRight = spawnIdx === 0;

    this.state.players.set(client.sessionId, p);
    this._playerMeta.set(client.sessionId, { sessionId: client.sessionId, displayName, mmr });

    logger.info({ roomId: this.roomId, playerId, displayName }, '[Room] player joined');
    metrics.increment('rooms.player_joined');

    // Both players present → start countdown
    if (this.state.players.size === 2) {
      this._startCountdown();
    }
  }

  onLeave(client: Client, consented: boolean) {
    const p = this.state.players.get(client.sessionId);
    if (p) {
      p.connected = false;
      logger.info({ roomId: this.roomId, playerId: p.playerId, consented }, '[Room] player left');
    }

    // If match was in progress, other player wins
    if (this.state.phase === 'fighting' || this.state.phase === 'countdown') {
      const remaining = [...this.state.players.values()].find((pl) => pl.connected);
      if (remaining) {
        this._endMatch(remaining.playerId, 'disconnect');
      }
    }
  }

  onDispose() {
    this._clearTimers();
    resetCombatMeta([...this._playerMeta.keys()]);
    resetAntiCheat([...this._playerMeta.keys()]);
    logger.info({ roomId: this.roomId }, '[Room] disposed');
    metrics.increment('rooms.disposed');
  }

  // ─── Private ─────────────────────────────────────────────────

  private _handleInput(client: Client, data: PlayerInputPayload) {
    if (this.state.phase !== 'fighting') return;

    const verdict = checkInput(client.sessionId, data, this.state.matchId);
    if (verdict === 'kick') {
      logger.warn({ sessionId: client.sessionId, matchId: this.state.matchId }, '[AntiCheat] kicking player');
      client.send(MSG_GAME_ERROR, { code: 'ANTICHEAT_KICK', message: 'Anti-cheat violation' });
      client.leave(4000);
      return;
    }

    this._pendingInputs.set(client.sessionId, data);
  }

  private _handleReady(client: Client) {
    this._readyPlayers.add(client.sessionId);
    logger.debug({ sessionId: client.sessionId }, '[Room] player ready');
  }

  private _startCountdown() {
    this.state.phase     = 'countdown';
    this.state.countdown = COUNTDOWN_SECONDS;

    this.broadcast(MSG_COUNTDOWN, { seconds: COUNTDOWN_SECONDS });

    let remaining = COUNTDOWN_SECONDS;
    const tick = () => {
      remaining--;
      this.state.countdown = remaining;
      this.broadcast(MSG_COUNTDOWN, { seconds: remaining });

      if (remaining <= 0) {
        this._startRound();
      } else {
        this._countdownTimer = setTimeout(tick, 1000);
      }
    };
    this._countdownTimer = setTimeout(tick, 1000);
  }

  private _startRound() {
    // Reset player positions
    let idx = 0;
    for (const p of this.state.players.values()) {
      p.x        = PLAYER_SPAWN_X[idx] ?? 400;
      p.y        = GROUND_Y;
      p.hp       = MAX_HP;
      p.velX     = 0;
      p.velY     = 0;
      p.grounded = true;
      p.attacking = false;
      p.blocking  = false;
      p.facingRight = idx === 0;
      idx++;
    }

    this.state.phase      = 'fighting';
    this.state.roundTimer = ROUND_DURATION_S;
    this._roundStartTick  = this.state.tick;

    this.broadcast(MSG_ROUND_START, {
      round:    this.state.currentRound,
      duration: ROUND_DURATION_S,
    });

    logger.info({ roomId: this.roomId, round: this.state.currentRound }, '[Room] round started');
    this._startGameLoop();
  }

  private _startGameLoop() {
    if (this._tickInterval) clearInterval(this._tickInterval);

    this._tickInterval = setInterval(() => {
      this._tick();
    }, TICK_MS);
  }

  private _tick() {
    if (this.state.phase !== 'fighting') return;

    this.state.tick++;

    // Build player state map
    const playerMap = new Map<string, PlayerState>();
    for (const [sid, p] of this.state.players) {
      if (p.connected) playerMap.set(sid, p);
    }

    // Run simulation
    const hits = simulateTick(playerMap, this._pendingInputs, Date.now());
    this._pendingInputs.clear();

    // Broadcast hits
    for (const hit of hits) {
      this.broadcast(MSG_PLAYER_HIT, { ...hit, tick: this.state.tick });
    }

    // Update round timer
    const ticksPerSecond = TICK_RATE;
    const elapsedTicks = this.state.tick - this._roundStartTick;
    this.state.roundTimer = Math.max(0, ROUND_DURATION_S - Math.floor(elapsedTicks / ticksPerSecond));

    // Check win conditions
    this._checkRoundEnd();
  }

  private _checkRoundEnd() {
    const players = [...this.state.players.values()].filter((p) => p.connected);

    // KO check
    const dead = players.find((p) => p.hp <= 0);
    if (dead) {
      const winner = players.find((p) => p.playerId !== dead.playerId);
      this._endRound(winner?.playerId ?? null, 'hp');
      return;
    }

    // Timeout
    if (this.state.roundTimer <= 0) {
      // Higher HP wins
      const sorted = [...players].sort((a, b) => b.hp - a.hp);
      const winner = sorted[0]?.hp !== sorted[1]?.hp ? sorted[0] : null;
      this._endRound(winner?.playerId ?? null, 'timeout');
    }
  }

  private _endRound(winnerId: string | null, reason: 'hp' | 'timeout' | 'disconnect') {
    if (this.state.phase !== 'fighting') return;

    this._clearTimers();
    this.state.phase = 'round_end';

    if (winnerId) {
      const wp = [...this.state.players.values()].find((p) => p.playerId === winnerId);
      if (wp) wp.roundsWon++;
    }

    this.broadcast(MSG_ROUND_END, {
      round:    this.state.currentRound,
      winnerId: winnerId ?? null,
      reason,
    });

    logger.info({ roomId: this.roomId, round: this.state.currentRound, winnerId, reason }, '[Room] round ended');

    // Check match winner
    const matchWinner = [...this.state.players.values()].find((p) => p.roundsWon >= ROUNDS_TO_WIN);
    if (matchWinner) {
      this.clock.setTimeout(() => this._endMatch(matchWinner.playerId, 'rounds'), 2000);
      return;
    }

    // Next round
    this.state.currentRound++;
    this.clock.setTimeout(() => this._startCountdown(), 3000);
  }

  private _endMatch(winnerId: string, reason: string) {
    if (this.state.phase === 'match_end') return;

    this._clearTimers();
    this.state.phase    = 'match_end';
    this.state.winnerId = winnerId;

    const loser = [...this.state.players.values()].find((p) => p.playerId !== winnerId);

    this.broadcast(MSG_MATCH_END, {
      matchId:  this.state.matchId,
      winnerId,
      loserId:  loser?.playerId ?? '',
      reason,
    });

    logger.info({ roomId: this.roomId, matchId: this.state.matchId, winnerId, reason }, '[Room] match ended');
    metrics.increment('rooms.match_ended');

    // Dispose after brief delay to let clients receive final state
    this.clock.setTimeout(() => this.disconnect(), 5000);
  }

  private _clearTimers() {
    if (this._tickInterval)    { clearInterval(this._tickInterval);   this._tickInterval = null; }
    if (this._countdownTimer)  { clearTimeout(this._countdownTimer);  this._countdownTimer = null; }
  }
}
