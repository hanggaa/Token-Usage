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
    const values = new Map([
      ["budgets.daily", 1], ["budgets.weekly", 2], ["budgets.monthly", 3]
    ]);
    const read = () => ({
      daily: values.get("budgets.daily")!,
      weekly: values.get("budgets.weekly")!,
      monthly: values.get("budgets.monthly")!
    });
    const update = vi.fn(async (key: string, value: number) => {
      values.set(key, value);
    });
    await saveUsageBudgets(
      { daily: 10, weekly: 20, monthly: 30 },
      { daily: 1, weekly: 2, monthly: 3 },
      read,
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
    const read = () => ({
      daily: values.get("budgets.daily")!,
      weekly: values.get("budgets.weekly")!,
      monthly: values.get("budgets.monthly")!
    });
    const update = async (key: string, value: number) => {
      updates.push([key, value]);
      if (key === "budgets.monthly" && value === 30) throw new Error("monthly rejected");
      values.set(key, value);
    };

    await expect(saveUsageBudgets(
      { daily: 10, weekly: 20, monthly: 30 },
      { daily: 1, weekly: 2, monthly: 3 },
      read,
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
    const values = new Map([
      ["budgets.daily", 1], ["budgets.weekly", 2], ["budgets.monthly", 3]
    ]);
    const read = () => ({
      daily: values.get("budgets.daily")!,
      weekly: values.get("budgets.weekly")!,
      monthly: values.get("budgets.monthly")!
    });
    const update = async (key: string, value: number) => {
      if (key === "budgets.monthly" && value === 30) throw new Error("monthly rejected");
      if (value === 2) throw new Error("weekly rollback rejected");
      if (value === 1) throw new Error("daily rollback rejected");
      values.set(key, value);
    };

    await expect(saveUsageBudgets(
      { daily: 10, weekly: 20, monthly: 30 },
      { daily: 1, weekly: 2, monthly: 3 },
      read,
      update
    )).rejects.toThrow(
      "monthly rejected Rollback failed for budgets.weekly: weekly rollback rejected; budgets.daily: daily rollback rejected"
    );
  });

  it("does not overwrite a not-yet-written key that diverged from the baseline", async () => {
    const values = new Map([
      ["budgets.daily", 1], ["budgets.weekly", 2], ["budgets.monthly", 3]
    ]);
    const updates: Array<[string, number]> = [];
    const read = () => ({
      daily: values.get("budgets.daily")!,
      weekly: values.get("budgets.weekly")!,
      monthly: values.get("budgets.monthly")!
    });
    const update = async (key: string, value: number) => {
      updates.push([key, value]);
      values.set(key, value);
      if (key === "budgets.daily" && value === 10) {
        values.set("budgets.monthly", 300);
      }
    };

    await expect(saveUsageBudgets(
      { daily: 10, weekly: 20, monthly: 30 },
      { daily: 1, weekly: 2, monthly: 3 },
      read,
      update
    )).rejects.toThrow("Token budgets changed in Settings during save");

    expect(updates).toEqual([
      ["budgets.daily", 10],
      ["budgets.daily", 1]
    ]);
    expect(read()).toEqual({ daily: 1, weekly: 2, monthly: 300 });
  });

  it("does not roll back a completed key changed externally", async () => {
    const values = new Map([
      ["budgets.daily", 1], ["budgets.weekly", 2], ["budgets.monthly", 3]
    ]);
    const updates: Array<[string, number]> = [];
    const read = () => ({
      daily: values.get("budgets.daily")!,
      weekly: values.get("budgets.weekly")!,
      monthly: values.get("budgets.monthly")!
    });
    const update = async (key: string, value: number) => {
      updates.push([key, value]);
      values.set(key, value);
      if (key === "budgets.daily" && value === 10) {
        values.set("budgets.daily", 99);
      }
    };

    await expect(saveUsageBudgets(
      { daily: 10, weekly: 20, monthly: 30 },
      { daily: 1, weekly: 2, monthly: 3 },
      read,
      update
    )).rejects.toThrow("Token budgets changed in Settings during save");

    expect(updates).toEqual([["budgets.daily", 10]]);
    expect(read()).toEqual({ daily: 99, weekly: 2, monthly: 3 });
  });
});
