import { describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../../src/webview/messages.js";

describe("parseWebviewMessage", () => {
  it.each(["refresh", "ready", "deleteAll", "rebuild"] as const)(
    "accepts %s",
    (type) => expect(parseWebviewMessage({ type })).toEqual({ type })
  );

  it("accepts valid budgets", () => {
    expect(parseWebviewMessage({
      type: "setBudgets",
      budgets: { daily: 10, weekly: 20, monthly: 30 }
    })).toEqual({ type: "setBudgets", budgets: { daily: 10, weekly: 20, monthly: 30 } });
  });

  it.each([
    null,
    {},
    { type: "unknown" },
    { type: "setBudgets" },
    { type: "setBudgets", budgets: { daily: -1, weekly: 20, monthly: 30 } }
  ])("rejects untrusted payload %#", (value) => {
    expect(parseWebviewMessage(value)).toBeNull();
  });
});
