/**
 * In-memory matchmaking queue.
 * Falls back gracefully if Redis is unavailable.
 * Matches players by proximity to average MMR.
 */
import { matchMaker } from '@colyseus/core';
import { logger } from '../utils/logger';
import { metrics } from '../infra/metrics';
import type { QueueEntry } from '../../../packages/shared/src/types';

const MMR_WINDOW_START  = 100;  // initial MMR range
const MMR_WINDOW_EXPAND = 50;   // expand by this every 5 seconds
const POLL_INTERVAL_MS  = 2000;

const _queue   = new Map<string, QueueEntry & { addedAt: number }>();
let   _running = false;
let   _timer: ReturnType<typeof setInterval> | null = null;

export const matchmakingQueue = {
  enqueue(entry: QueueEntry): void {
    if (_queue.has(entry.playerId)) return;
    _queue.set(entry.playerId, { ...entry, addedAt: Date.now() });
    logger.info({ playerId: entry.playerId, mmr: entry.mmr, queueSize: _queue.size }, '[Queue] player enqueued');
    metrics.gauge('matchmaking.queue_size', _queue.size);
  },

  dequeue(playerId: string): void {
    if (_queue.delete(playerId)) {
      logger.info({ playerId }, '[Queue] player dequeued');
      metrics.gauge('matchmaking.queue_size', _queue.size);
    }
  },

  isQueued(playerId: string): boolean {
    return _queue.has(playerId);
  },

  size(): number {
    return _queue.size;
  },

  start(): void {
    if (_running) return;
    _running = true;
    _timer   = setInterval(() => _tryMatch(), POLL_INTERVAL_MS);
    logger.info('[Queue] matchmaking loop started');
  },

  stop(): void {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _running = false;
    logger.info('[Queue] matchmaking loop stopped');
  },
};

async function _tryMatch(): Promise<void> {
  if (_queue.size < 2) return;

  const players = [..._queue.values()].sort((a, b) => a.addedAt - b.addedAt);

  for (let i = 0; i < players.length; i++) {
    const p1  = players[i];
    const age = (Date.now() - p1.addedAt) / 1000; // seconds in queue
    const mmrWindow = MMR_WINDOW_START + Math.floor(age / 5) * MMR_WINDOW_EXPAND;

    for (let j = i + 1; j < players.length; j++) {
      const p2 = players[j];
      if (Math.abs(p1.mmr - p2.mmr) <= mmrWindow) {
        await _createMatch(p1, p2);
        return;
      }
    }
  }
}

async function _createMatch(
  p1: QueueEntry & { addedAt: number },
  p2: QueueEntry & { addedAt: number },
): Promise<void> {
  // Remove from queue first to prevent double-matching
  _queue.delete(p1.playerId);
  _queue.delete(p2.playerId);
  metrics.gauge('matchmaking.queue_size', _queue.size);

  try {
    const room = await matchMaker.createRoom('arcade', {});

    await matchMaker.joinById(room.roomId, {
      playerId:    p1.playerId,
      displayName: p1.displayName,
      mmr:         p1.mmr,
    });
    await matchMaker.joinById(room.roomId, {
      playerId:    p2.playerId,
      displayName: p2.displayName,
      mmr:         p2.mmr,
    });

    metrics.increment('matchmaking.matches_created');
    logger.info(
      { roomId: room.roomId, p1: p1.playerId, p2: p2.playerId },
      '[Queue] match created',
    );
  } catch (err) {
    // Re-queue both players on failure
    logger.error({ err, p1: p1.playerId, p2: p2.playerId }, '[Queue] match creation failed — re-queuing');
    _queue.set(p1.playerId, p1);
    _queue.set(p2.playerId, p2);
    metrics.gauge('matchmaking.queue_size', _queue.size);
  }
}
