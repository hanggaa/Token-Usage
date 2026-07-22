import type { UsageBudgets } from "../shared/dashboard.js";

const MESSAGE = "Budgets must be whole, non-negative safe integers.";
const entries: Array<[keyof UsageBudgets, string]> = [
  ["daily", "budgets.daily"],
  ["weekly", "budgets.weekly"],
  ["monthly", "budgets.monthly"]
];

function valid(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validateUsageBudgets(value: unknown): UsageBudgets {
  if (!value || typeof value !== "object") throw new Error(MESSAGE);
  const candidate = value as Record<string, unknown>;
  if (!valid(candidate.daily) || !valid(candidate.weekly) || !valid(candidate.monthly)) {
    throw new Error(MESSAGE);
  }
  return { daily: candidate.daily, weekly: candidate.weekly, monthly: candidate.monthly };
}

export function readUsageBudgets(configuration: {
  get<T>(key: string, fallback: T): T;
}): UsageBudgets {
  return Object.fromEntries(entries.map(([name, key]) => {
    const value = configuration.get<unknown>(key, 0);
    return [name, valid(value) ? value : 0];
  })) as unknown as UsageBudgets;
}

export async function saveUsageBudgets(
  budgets: UsageBudgets,
  previousBudgets: UsageBudgets,
  update: (key: string, value: number) => Promise<void>
): Promise<void> {
  const validBudgets = validateUsageBudgets(budgets);
  const validPreviousBudgets = validateUsageBudgets(previousBudgets);
  const completed: Array<[keyof UsageBudgets, string]> = [];
  try {
    for (const [name, key] of entries) {
      await update(key, validBudgets[name]);
      completed.push([name, key]);
    }
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const [name, key] of completed.toReversed()) {
      try {
        await update(key, validPreviousBudgets[name]);
      } catch (rollbackError) {
        const message = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        rollbackFailures.push(`${key}: ${message}`);
      }
    }
    if (rollbackFailures.length > 0) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} Rollback failed for ${rollbackFailures.join("; ")}`, {
        cause: error
      });
    }
    throw error;
  }
}
