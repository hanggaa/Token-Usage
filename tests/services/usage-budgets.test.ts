import { describe, expect, it, vi } from "vitest";
import {
  readUsageBudgets,
  saveUsageBudgets,
  validateUsageBudgets
} from "../../src/services/usage-budgets.js";

describe("usage budgets", () => {
  it("validates whole non-negative safe integers", () => {
    expect(validateUsageBudgets({ daily: 10, weekly: 20, monthly: 0 })).toEqual({
      daily: 10, weekly: 20, monthly: 0
    });
    for (const daily of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "10", null]) {
      expect(() => validateUsageBudgets({ daily, weekly: 20, monthly: 30 })).toThrow(
        "Budgets must be whole, non-negative safe integers."
      );
    }
  });

  it("reads malformed configuration values as disabled", () => {
    const values = new Map<string, unknown>([
      ["budgets.daily", -1], ["budgets.weekly", 25], ["budgets.monthly", 1.5]
    ]);
    expect(readUsageBudgets({
      get: <T>(key: string, fallback: T) => (values.get(key) ?? fallback) as T
    })).toEqual({
      daily: 0, weekly: 25, monthly: 0
    });
  });

  it("writes all three budget settings", async () => {
    const update = vi.fn(async () => undefined);
    await saveUsageBudgets({ daily: 10, weekly: 20, monthly: 30 }, update);
    expect(update.mock.calls).toEqual([
      ["budgets.daily", 10], ["budgets.weekly", 20], ["budgets.monthly", 30]
    ]);
  });
});
