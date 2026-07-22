import type { WebviewMessage } from "../shared/dashboard.js";
import { validateUsageBudgets } from "../services/usage-budgets.js";

const ACTIONS = new Set(["refresh", "ready", "deleteAll", "rebuild"]);

export function parseWebviewMessage(value: unknown): WebviewMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== "string") return null;
  if (ACTIONS.has(candidate.type)) {
    return { type: candidate.type as "refresh" | "ready" | "deleteAll" | "rebuild" };
  }
  if (candidate.type !== "setBudgets") return null;
  try {
    return { type: "setBudgets", budgets: validateUsageBudgets(candidate.budgets) };
  } catch {
    return null;
  }
}
