import { describe, expect, it } from "vitest";
import type { BudgetResponse, WebviewMessage } from "../../src/shared/dashboard.js";
import {
  createWebviewMessageReceiver,
  parseWebviewMessage
} from "../../src/webview/messages.js";

describe("parseWebviewMessage", () => {
  it.each(["refresh", "ready", "deleteAll", "rebuild"] as const)(
    "accepts %s",
    (type) => expect(parseWebviewMessage({ type })).toEqual({ type })
  );

  it("accepts valid budgets", () => {
    expect(parseWebviewMessage({
      type: "setBudgets",
      requestId: "save-1",
      budgets: { daily: 10, weekly: 20, monthly: 30 }
    })).toEqual({
      type: "setBudgets",
      requestId: "save-1",
      budgets: { daily: 10, weekly: 20, monthly: 30 }
    });
  });

  it("routes budget responses only through the originating receiver", async () => {
    const firstResponses: unknown[] = [];
    const secondResponses: unknown[] = [];
    const actions: Array<{
      requestId: string;
      respond: (message: BudgetResponse) => Promise<void>;
    }> = [];
    const onAction = async (
      message: WebviewMessage,
      respond: (message: BudgetResponse) => Promise<void>
    ) => {
      if (message.type === "setBudgets") actions.push({ requestId: message.requestId, respond });
    };
    const first = createWebviewMessageReceiver(onAction, async (message) => {
      firstResponses.push(message);
    });
    const second = createWebviewMessageReceiver(onAction, async (message) => {
      secondResponses.push(message);
    });

    await first({
      type: "setBudgets",
      requestId: "first-save",
      budgets: { daily: 10, weekly: 20, monthly: 30 }
    });
    await second({
      type: "setBudgets",
      requestId: "second-save",
      budgets: { daily: 40, weekly: 50, monthly: 60 }
    });
    await actions[0].respond({ type: "budgetsSaved", requestId: actions[0].requestId });

    expect(firstResponses).toEqual([{ type: "budgetsSaved", requestId: "first-save" }]);
    expect(secondResponses).toEqual([]);
  });

  it("returns a targeted budget error for a malformed save", async () => {
    const responses: unknown[] = [];
    const receiver = createWebviewMessageReceiver(async () => undefined, async (message) => {
      responses.push(message);
    });

    await receiver({
      type: "setBudgets",
      requestId: "bad-save",
      budgets: { daily: -1, weekly: 20, monthly: 30 }
    });

    expect(responses).toEqual([{
      type: "budgetError",
      requestId: "bad-save",
      message: "Budgets must be whole, non-negative safe integers."
    }]);
  });

  it.each([
    null,
    {},
    { type: "unknown" },
    { type: "setBudgets" },
    { type: "setBudgets", requestId: "bad-save", budgets: { daily: -1, weekly: 20, monthly: 30 } }
  ])("rejects untrusted payload %#", (value) => {
    expect(parseWebviewMessage(value)).toBeNull();
  });
});
