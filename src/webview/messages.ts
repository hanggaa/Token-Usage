import type { BudgetResponse, WebviewMessage } from "../shared/dashboard.js";
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
  if (typeof candidate.requestId !== "string" || candidate.requestId.length === 0) return null;
  try {
    return {
      type: "setBudgets",
      requestId: candidate.requestId,
      budgets: validateUsageBudgets(candidate.budgets)
    };
  } catch {
    return null;
  }
}

export type BudgetResponder = (message: BudgetResponse) => Promise<void>;

export function createWebviewMessageReceiver(
  onAction: (message: WebviewMessage, respond: BudgetResponder) => void | Promise<void>,
  respond: BudgetResponder
): (value: unknown) => Promise<void> {
  return async (value: unknown) => {
    const message = parseWebviewMessage(value);
    if (message) {
      await onAction(message, respond);
      return;
    }
    if (!value || typeof value !== "object") return;
    const candidate = value as Record<string, unknown>;
    if (candidate.type !== "setBudgets") return;
    const requestId = typeof candidate.requestId === "string" ? candidate.requestId : "";
    let errorMessage = "Budgets must be whole, non-negative safe integers.";
    try {
      validateUsageBudgets(candidate.budgets);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    await respond({ type: "budgetError", requestId, message: errorMessage });
  };
}
