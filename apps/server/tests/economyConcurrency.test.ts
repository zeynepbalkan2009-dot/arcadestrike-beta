import { describe, expect, it } from "@jest/globals";

class LockedLedger {
  private balance: bigint;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(openingBalance: bigint) {
    this.balance = openingBalance;
  }

  mutate(amount: bigint): Promise<bigint> {
    const next = this.queue.then(() => {
      const after = this.balance + amount;
      if (after < 0n) throw new Error("INSUFFICIENT_BALANCE");
      this.balance = after;
      return after;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  getBalance(): bigint {
    return this.balance;
  }
}

describe("economy concurrency", () => {
  it("serializes concurrent debits so only funded mutations commit", async () => {
    const ledger = new LockedLedger(100n);

    const results = await Promise.allSettled([
      ledger.mutate(-70n),
      ledger.mutate(-70n),
      ledger.mutate(-30n),
    ]);

    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(2);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(ledger.getBalance()).toBe(0n);
  });
});
