import { describe, expect, it } from "@jest/globals";
import type { PlayerInput } from "@arcadestrike/shared";
import { CombatEngine } from "../src/game/CombatEngine";
import { makeFighters, makeInput, snapshotFighter } from "./helpers/combatHarness";

function tickInputs(tick: number): Map<string, PlayerInput> {
  if (tick === 0) return new Map([["p1", makeInput(0, tick, { right: true })]]);
  if (tick === 4) return new Map([["p1", makeInput(1, tick, { attack: true })]]);
  if (tick === 22) return new Map([["p2", makeInput(0, tick, { attack: true })]]);
  return new Map();
}

describe("rollback replay consistency", () => {
  it("matches authoritative state after rollback and deterministic replay", () => {
    const authoritative = makeFighters();
    for (let tick = 0; tick < 50; tick++) {
      CombatEngine.tick(authoritative, tickInputs(tick));
    }

    const rollbackBase = makeFighters();
    for (let tick = 0; tick < 20; tick++) {
      CombatEngine.tick(rollbackBase, tickInputs(tick));
    }
    for (let tick = 20; tick < 50; tick++) {
      CombatEngine.tick(rollbackBase, tickInputs(tick));
    }

    expect(rollbackBase.map(snapshotFighter)).toEqual(authoritative.map(snapshotFighter));
  });
});
