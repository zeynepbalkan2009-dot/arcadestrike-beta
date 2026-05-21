/**
 * Stats Routes
 *
 * Player statistics, leaderboards, and match history.
 *
 *   GET /api/stats/player/:playerId   — player profile + stats
 *   GET /api/stats/leaderboard        — top 100 by ELO
 *   GET /api/stats/match/:matchId     — match replay data
 *   GET /api/stats/economy            — platform-wide economy metrics
 */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { rateLimitApi } from "../middleware/rateLimit";
import { createLogger } from "../utils/logger";

const log = createLogger("routes/stats");

// ─── In-memory store (replace with PostgreSQL + Redis in production) ──────────

interface PlayerStats {
  playerId:    string;
  username:    string;
  elo:         number;
  wins:        number;
  losses:      number;
  winStreak:   number;
  bestStreak:  number;
  totalWagered: string;
  totalEarned:  string;
  createdAt:   number;
  lastActive:  number;
}

interface MatchRecord {
  matchId:       string;
  player1:       string;
  player2:       string;
  winnerId:      string;
  scores:        Record<string, number>;
  duration:      number; // ms
  wagerAmount:   string;
  currency:      "REAL" | "PROMO";
  timestamp:     number;
}

const playerStats  = new Map<string, PlayerStats>();
const matchHistory = new Map<string, MatchRecord>();

// ELO delta calculation (standard 32-K factor)
function calcElo(winnerElo: number, loserElo: number): [number, number] {
  const K = 32;
  const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedLoser  = 1 - expectedWinner;
  const deltaWinner    = Math.round(K * (1 - expectedWinner));
  const deltaLoser     = Math.round(K * (0 - expectedLoser));
  return [deltaWinner, deltaLoser];
}

export function getOrCreateStats(playerId: string): PlayerStats {
  if (!playerStats.has(playerId)) {
    playerStats.set(playerId, {
      playerId,
      username:     `Player_${playerId.slice(-6)}`,
      elo:          1200,
      wins:         0,
      losses:       0,
      winStreak:    0,
      bestStreak:   0,
      totalWagered: "0",
      totalEarned:  "0",
      createdAt:    Date.now(),
      lastActive:   Date.now(),
    });
  }
  return playerStats.get(playerId)!;
}

/** Called by EconomyService after match settlement */
export function recordMatchResult(
  matchId: string,
  winnerId: string,
  loserId: string,
  wagerAmount: string,
  currency: "REAL" | "PROMO",
  scores: Record<string, number>,
  durationMs: number
): void {
  const winner = getOrCreateStats(winnerId);
  const loser  = getOrCreateStats(loserId);

  // ELO update
  const [deltaW, deltaL] = calcElo(winner.elo, loser.elo);
  winner.elo      = Math.max(100, winner.elo + deltaW);
  loser.elo       = Math.max(100, loser.elo  + deltaL);

  // W/L record
  winner.wins++;
  winner.winStreak++;
  winner.bestStreak = Math.max(winner.bestStreak, winner.winStreak);
  loser.losses++;
  loser.winStreak = 0;

  // Economy totals
  winner.totalWagered = (BigInt(winner.totalWagered) + BigInt(wagerAmount)).toString();
  loser.totalWagered  = (BigInt(loser.totalWagered)  + BigInt(wagerAmount)).toString();

  const payout = BigInt(wagerAmount) * 2n * 95n / 100n; // 95% after fee
  winner.totalEarned = (BigInt(winner.totalEarned) + payout).toString();

  winner.lastActive = loser.lastActive = Date.now();

  // Match record
  matchHistory.set(matchId, {
    matchId,
    player1:    winnerId,
    player2:    loserId,
    winnerId,
    scores,
    duration:   durationMs,
    wagerAmount,
    currency,
    timestamp:  Date.now(),
  });

  log.info({ matchId, winnerId, eloChange: `+${deltaW}` }, "Match stats recorded");
}

export function createStatsRouter(): Router {
  const router = Router();

  /**
   * GET /api/stats/player/:playerId
   */
  router.get("/player/:playerId", rateLimitApi, (req, res) => {
    const stats = getOrCreateStats(req.params.playerId);
    const winRate = stats.wins + stats.losses > 0
      ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1)
      : "0.0";

    res.json({
      ...stats,
      winRate: `${winRate}%`,
      totalMatches: stats.wins + stats.losses,
    });
  });

  /**
   * GET /api/stats/leaderboard?limit=100&offset=0
   */
  router.get("/leaderboard", rateLimitApi, (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit  as string) || 100, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const sorted = Array.from(playerStats.values())
      .sort((a, b) => b.elo - a.elo)
      .slice(offset, offset + limit)
      .map((p, i) => ({
        rank:      offset + i + 1,
        playerId:  p.playerId,
        username:  p.username,
        elo:       p.elo,
        wins:      p.wins,
        losses:    p.losses,
        winStreak: p.winStreak,
      }));

    res.json({
      total:  playerStats.size,
      offset,
      limit,
      players: sorted,
    });
  });

  /**
   * GET /api/stats/match/:matchId
   */
  router.get("/match/:matchId", requireAuth, rateLimitApi, (req, res) => {
    const record = matchHistory.get(req.params.matchId);
    if (!record) {
      return res.status(404).json({ error: "Match not found" });
    }
    res.json(record);
  });

  /**
   * GET /api/stats/player/:playerId/history?limit=20&offset=0
   */
  router.get("/player/:playerId/history", rateLimitApi, (req, res) => {
    const { playerId } = req.params;
    const limit  = Math.min(parseInt(req.query.limit  as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const history = Array.from(matchHistory.values())
      .filter(m => m.player1 === playerId || m.player2 === playerId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(offset, offset + limit)
      .map(m => ({
        matchId:    m.matchId,
        opponent:   m.player1 === playerId ? m.player2 : m.player1,
        result:     m.winnerId === playerId ? "win" : "loss",
        scores:     m.scores,
        wagerAmount: m.wagerAmount,
        currency:   m.currency,
        duration:   m.duration,
        timestamp:  m.timestamp,
      }));

    res.json({ playerId, history, total: history.length });
  });

  /**
   * PATCH /api/stats/player/username
   * Set display name (authenticated).
   */
  router.patch("/player/username", requireAuth, rateLimitApi, (req, res) => {
    const { username } = req.body;

    if (!username || typeof username !== "string") {
      return res.status(400).json({ error: "Invalid username" });
    }
    const clean = username.trim().slice(0, 20);
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(clean)) {
      return res.status(400).json({
        error: "Username must be 3-20 characters, alphanumeric, _ or -",
      });
    }

    const stats = getOrCreateStats(req.auth!.playerId);
    stats.username = clean;
    res.json({ username: clean });
  });

  /**
   * GET /api/stats/economy
   * Platform-wide economy metrics (public).
   */
  router.get("/economy", rateLimitApi, (_req, res) => {
    let totalPlayers = playerStats.size;
    let totalMatches = matchHistory.size;
    let totalWagered = 0n;

    for (const m of matchHistory.values()) {
      totalWagered += BigInt(m.wagerAmount) * 2n;
    }

    res.json({
      totalPlayers,
      totalMatches,
      totalWageredWei: totalWagered.toString(),
      timestamp: Date.now(),
    });
  });

  return router;
}
