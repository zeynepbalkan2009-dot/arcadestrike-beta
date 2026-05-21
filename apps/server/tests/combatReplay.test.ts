import { describe, expect, it } from "@jest/globals";
import { makeInput, runReplay } from "./helpers/combatHarness";

describe("deterministic combat replay", () => {
  it("replays identical inputs into identical fighter state and events", () => {
    const inputs = new Map([
      [0, new Map([["p1", makeInput(0, 0, { attack: true })]])],
      [18, new Map([["p1", makeInput(1, 18, { attack: true })]])],
      [45, new Map([["p2", makeInput(0, 45, { special: true })]])],
    ]);

    const first = runReplay(inputs);
    const second = runReplay(inputs);

    expect(second).toEqual(first);
    expect(first.events.some(event => event.type === "hit" || event.type === "combo")).toBe(true);
  });
});
