import type { UsageBudgets } from "../shared/dashboard.js";

const MESSAGE = "Budgets must be whole, non-negative safe integers.";
export const USAGE_BUDGET_CONFLICT_MESSAGE =
  "Token budgets changed in Settings during save. Review the active values and try again.";
const entries: Array<[keyof UsageBudgets, string]> = [
  ["daily", "budgets.daily"],
  ["weekly", "budgets.weekly"],
  ["monthly", "budgets.monthly"]
];

function valid(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export class UsageBudgetConflictError extends Error {
  constructor() {
    super(USAGE_BUDGET_CONFLICT_MESSAGE);
    this.name = "UsageBudgetConflictError";
  }
}

export function usageBudgetsEqual(left: UsageBudgets, right: UsageBudgets): boolean {
  return left.daily === right.daily
    && left.weekly === right.weekly
    && left.monthly === right.monthly;
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
  readCurrentBudgets: () => UsageBudgets,
  update: (key: string, value: number) => Promise<void>
): Promise<void> {
  const validBudgets = validateUsageBudgets(budgets);
  const validPreviousBudgets = validateUsageBudgets(previousBudgets);
  const completed: Array<[keyof UsageBudgets, string]> = [];
  const completedNames = new Set<keyof UsageBudgets>();

  const assertExpectedState = () => {
    const current = validateUsageBudgets(readCurrentBudgets());
    for (const [name] of entries) {
      const expected = completedNames.has(name)
        ? validBudgets[name]
        : validPreviousBudgets[name];
      if (current[name] !== expected) throw new UsageBudgetConflictError();
    }
  };

  try {
    for (const [name, key] of entries) {
      assertExpectedState();
      await update(key, validBudgets[name]);
      completed.push([name, key]);
      completedNames.add(name);
    }
    assertExpectedState();
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const [name, key] of completed.toReversed()) {
      const current = validateUsageBudgets(readCurrentBudgets());
      if (current[name] !== validBudgets[name]) continue;
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
