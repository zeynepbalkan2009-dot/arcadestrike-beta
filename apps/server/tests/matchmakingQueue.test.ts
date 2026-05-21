import { describe, expect, it } from "@jest/globals";
import type { QueueEntry } from "@arcadestrike/shared";

function canMatch(p1: QueueEntry, p2: QueueEntry, now: number): boolean {
  if (p1.queueMode !== p2.queueMode) return false;
  if (p1.currency !== p2.currency) return false;
  if (p1.wagerAmount !== p2.wagerAmount) return false;
  if (p1.queueMode === "quick") return true;

  const waitSeconds = Math.max(now - p1.joinedAt, now - p2.joinedAt) / 1000;
  const eloRange = Math.min(100 + 50 * waitSeconds, 500);
  return Math.abs(p1.elo - p2.elo) <= eloRange;
}

const base: QueueEntry = {
  playerId: "p1",
  wagerAmount: "1000",
  currency: "PROMO",
  queueMode: "quick",
  joinedAt: 0,
  elo: 1200,
};

describe("matchmaking queue pairing rules", () => {
  it("pairs quick queue players with equal wager and currency", () => {
    expect(canMatch(base, { ...base, playerId: "p2", elo: 2200 }, 0)).toBe(true);
  });

  it("rejects mismatched wager or currency", () => {
    expect(canMatch(base, { ...base, playerId: "p2", wagerAmount: "2000" }, 0)).toBe(false);
    expect(canMatch(base, { ...base, playerId: "p2", currency: "REAL" }, 0)).toBe(false);
  });

  it("expands ranked ELO range with wait time", () => {
    const ranked = { ...base, queueMode: "ranked" as const };
    expect(canMatch(ranked, { ...ranked, playerId: "p2", elo: 1550 }, 0)).toBe(false);
    expect(canMatch(ranked, { ...ranked, playerId: "p2", elo: 1550 }, 6000)).toBe(true);
  });
});
