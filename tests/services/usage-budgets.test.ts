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
    await saveUsageBudgets(
      { daily: 10, weekly: 20, monthly: 30 },
      { daily: 1, weekly: 2, monthly: 3 },
      update
    );
    expect(update.mock.calls).toEqual([
      ["budgets.daily", 10], ["budgets.weekly", 20], ["budgets.monthly", 30]
    ]);
  });

  it("rolls back every completed write after a mid-save failure", async () => {
    const values = new Map([
      ["budgets.daily", 1], ["budgets.weekly", 2], ["budgets.monthly", 3]
    ]);
    const updates: Array<[string, number]> = [];
    const update = async (key: string, value: number) => {
      updates.push([key, value]);
      if (key === "budgets.monthly" && value === 30) throw new Error("monthly rejected");
      values.set(key, value);
    };

    await expect(saveUsageBudgets(
      { daily: 10, weekly: 20, monthly: 30 },
      { daily: 1, weekly: 2, monthly: 3 },
      update
    )).rejects.toThrow("monthly rejected");

    expect(updates).toEqual([
      ["budgets.daily", 10],
      ["budgets.weekly", 20],
      ["budgets.monthly", 30],
      ["budgets.weekly", 2],
      ["budgets.daily", 1]
    ]);
    expect(Object.fromEntries(values)).toEqual({
      "budgets.daily": 1,
      "budgets.weekly": 2,
      "budgets.monthly": 3
    });
  });

  it("reports the original save error and every rollback failure", async () => {
    const update = async (key: string, value: number) => {
      if (key === "budgets.monthly") throw new Error("monthly rejected");
      if (value === 2) throw new Error("weekly rollback rejected");
      if (value === 1) throw new Error("daily rollback rejected");
    };

    await expect(saveUsageBudgets(
      { daily: 10, weekly: 20, monthly: 30 },
      { daily: 1, weekly: 2, monthly: 3 },
      update
    )).rejects.toThrow(
      "monthly rejected Rollback failed for budgets.weekly: weekly rollback rejected; budgets.daily: daily rollback rejected"
    );
  });
});
