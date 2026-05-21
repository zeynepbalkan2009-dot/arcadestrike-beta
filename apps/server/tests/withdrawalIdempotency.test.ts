import { describe, expect, it } from "@jest/globals";
import { randomUUID } from "crypto";

function withdrawalKey(playerId: string, amountWei: string, toAddress: string, supplied?: string): string {
  return (supplied?.trim() || `withdraw:${playerId}:${amountWei}:${toAddress.toLowerCase()}`).slice(0, 191);
}

describe("withdrawal idempotency", () => {
  it("uses caller supplied idempotency keys unchanged when present", () => {
    const supplied = `wd:${randomUUID()}`;
    expect(withdrawalKey("p1", "100", "0xABC", supplied)).toBe(supplied);
  });

  it("derives a stable fallback key from player, amount, and normalized address", () => {
    const a = withdrawalKey("p1", "100", "0xABCDEF");
    const b = withdrawalKey("p1", "100", "0xabcdef");
    expect(a).toBe(b);
  });
});
