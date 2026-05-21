import { describe, expect, it } from "@jest/globals";
type Presence = Map<string, { roomId: string; sessionId: string; updatedAt: number }>;

function restorePresence(
  presence: Presence,
  playerId: string,
  nextSessionId: string
): Presence {
  const current = presence.get(playerId);
  if (!current) return presence;

  presence.set(playerId, {
    ...current,
    sessionId: nextSessionId,
    updatedAt: current.updatedAt + 1,
  });
  return presence;
}

describe("websocket reconnect presence", () => {
  it("restores a player to the same authoritative room with a new session id", () => {
    const presence: Presence = new Map([
      ["p1", { roomId: "room-a", sessionId: "old-session", updatedAt: 100 }],
    ]);

    const restored = restorePresence(presence, "p1", "new-session");
    expect(restored.get("p1")).toEqual({
      roomId: "room-a",
      sessionId: "new-session",
      updatedAt: 101,
    });
  });
});
