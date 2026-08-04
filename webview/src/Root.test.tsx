// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DashboardSnapshot,
  PeriodComparison,
  PeriodInsights
} from "../../src/shared/dashboard.js";
import { Root, type VsCodeApi } from "./Root.js";

function emptyInsights(startDate: string, endDate: string): PeriodInsights {
  return {
    startDate,
    endDate,
    total: 0,
    partial: false,
    contributors: { sources: [], projects: [], models: [] },
    heavyTurns: [],
    hasComparableHistory: false
  };
}

function emptyComparison(
  currentStartDate: string,
  previousStartDate: string
): PeriodComparison {
  return {
    currentStartDate,
    currentThrough: "2026-07-22T04:00:00.000Z",
    previousStartDate,
    previousThrough: "2026-07-21T04:00:00.000Z",
    current: { tokens: 0, quality: "exact" },
    previous: { tokens: 0, quality: "exact" },
    delta: 0,
    deltaPercent: null,
    quality: "exact",
    kind: "unchanged",
    movers: {
      sources: { increases: [], decreases: [], omittedCount: 0 },
      projects: { increases: [], decreases: [], omittedCount: 0 },
      models: { increases: [], decreases: [], omittedCount: 0 }
    }
  };
}

const snapshot: DashboardSnapshot = {
  generatedAt: "2026-07-22T04:00:00.000Z",
  summaries: {
    today: { total: 1_000, exact: 1_000, estimated: 0, partial: 0 },
    sevenDays: { total: 5_000, exact: 5_000, estimated: 0, partial: 0 },
    allTime: { total: 10_000, exact: 10_000, estimated: 0, partial: 0 }
  },
  trends: {
    daily: [
      { startDate: "2026-07-22", endDate: "2026-07-22", inProgress: true, codex: 1_000, claude: 0, opencode: 0, antigravity: 100, "antigravity-cli": 250, partialSources: ["antigravity"] }
    ],
    weekly: [
      { startDate: "2026-07-20", endDate: "2026-07-26", inProgress: true, codex: 1_000, claude: 0, opencode: 0, antigravity: 700, "antigravity-cli": 1_750, partialSources: ["antigravity"] }
    ],
    monthly: [
      { startDate: "2026-07-01", endDate: "2026-07-31", inProgress: true, codex: 1_000, claude: 0, opencode: 0, antigravity: 3_000, "antigravity-cli": 7_500, partialSources: ["antigravity"] }
    ]
  },
  budgets: { daily: 0, weekly: 0, monthly: 0 },
  forecasts: {
    daily: {
      projectedTotal: 1_200,
      projectedBudgetPercent: null,
      remainingBudget: null,
      recommendedAllowance: null,
      allowanceUnit: "hour",
      confidence: "medium",
      quality: "exact",
      status: "no_budget",
      elapsedRatio: 0.5
    },
    weekly: {
      projectedTotal: 3_000,
      projectedBudgetPercent: null,
      remainingBudget: null,
      recommendedAllowance: null,
      allowanceUnit: "day",
      confidence: "low",
      quality: "exact",
      status: "no_budget",
      elapsedRatio: 0.2
    },
    monthly: {
      projectedTotal: 8_000,
      projectedBudgetPercent: null,
      remainingBudget: null,
      recommendedAllowance: null,
      allowanceUnit: "day",
      confidence: "high",
      quality: "exact",
      status: "no_budget",
      elapsedRatio: 0.7
    }
  },
  insights: {
    daily: emptyInsights("2026-07-22", "2026-07-22"),
    weekly: emptyInsights("2026-07-20", "2026-07-26"),
    monthly: emptyInsights("2026-07-01", "2026-07-31")
  },
  comparisons: {
    daily: emptyComparison("2026-07-22", "2026-07-21"),
    weekly: emptyComparison("2026-07-20", "2026-07-13"),
    monthly: emptyComparison("2026-07-01", "2026-06-01")
  },
  turns: [],
  health: []
};

function fakeVsCode(state: unknown): VsCodeApi {
  return {
    postMessage: vi.fn(),
    getState: vi.fn(() => state),
    setState: vi.fn()
  };
}

function deliver(data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });
}

function guardrails() {
  return within(screen.getByRole("heading", { name: "Usage Guardrails" }).closest("section")!);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Root", () => {
  it("renders a non-zero Antigravity CLI segment from a delivered snapshot", () => {
    const vscode = fakeVsCode(null);
    const { container } = render(<Root vscode={vscode} />);

    deliver({ type: "snapshot", snapshot });

    const trend = within(screen.getByRole("heading", { name: "Usage Over Time" }).closest("section")!);
    expect(trend.getByText("Antigravity IDE")).toBeInTheDocument();
    expect(trend.getByText("Antigravity CLI")).toBeInTheDocument();
    const segment = container.querySelector<HTMLElement>(
      ".chart-column.in-progress .bar-segment.source-antigravity-cli"
    )!;
    expect(Number.parseFloat(segment.style.height)).toBeGreaterThan(0);
  });

  it("restores Monthly, persists Weekly, and does not refresh for a selector change", () => {
    const vscode = fakeVsCode({ usageGranularity: "monthly" });
    render(<Root vscode={vscode} />);

    deliver({ type: "snapshot", snapshot });

    expect(screen.getByRole("radio", { name: "Monthly" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));

    expect(vscode.setState).toHaveBeenCalledTimes(1);
    expect(vscode.setState).toHaveBeenLastCalledWith({ usageGranularity: "weekly" });
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: "ready" });
    expect(vscode.postMessage).not.toHaveBeenCalledWith({ type: "refresh" });
  });

  it("selects Daily when the saved state is malformed", () => {
    const vscode = fakeVsCode({ usageGranularity: "yearly" });
    render(<Root vscode={vscode} />);

    deliver({ type: "snapshot", snapshot });

    expect(screen.getByRole("radio", { name: "Daily" })).toBeChecked();
  });

  it("posts one setBudgets message without refreshing", () => {
    const vscode = fakeVsCode(null);
    render(<Root vscode={vscode} />);
    deliver({ type: "snapshot", snapshot });

    fireEvent.click(screen.getByRole("button", { name: "Set token budget" }));
    fireEvent.change(guardrails().getByLabelText("Daily"), { target: { value: "77" } });
    fireEvent.change(guardrails().getByLabelText("Weekly"), { target: { value: "500" } });
    fireEvent.change(guardrails().getByLabelText("Monthly"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const messages = vi.mocked(vscode.postMessage).mock.calls.map(([message]) => message);
    expect(messages.filter((message) => message.type === "setBudgets")).toEqual([
      expect.objectContaining({
        type: "setBudgets",
        requestId: expect.any(String),
        budgets: { daily: 77, weekly: 500, monthly: 2_000 }
      })
    ]);
    expect(messages).not.toContainEqual({ type: "refresh" });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("keeps the dashboard and entered values visible after budgetError", () => {
    const vscode = fakeVsCode(null);
    render(<Root vscode={vscode} />);
    deliver({ type: "snapshot", snapshot });

    fireEvent.click(screen.getByRole("button", { name: "Set token budget" }));
    fireEvent.change(guardrails().getByLabelText("Daily"), { target: { value: "77" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const request = vi.mocked(vscode.postMessage).mock.calls
      .map(([message]) => message)
      .find((message) => message.type === "setBudgets");
    if (!request || request.type !== "setBudgets") throw new Error("Expected budget request");
    deliver({
      type: "snapshot",
      snapshot: { ...snapshot, budgets: { daily: 0, weekly: 222, monthly: 0 } }
    });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    deliver({
      type: "budgetError",
      requestId: request.requestId,
      message: "Token budgets changed in Settings during save. Review the active values and try again."
    });

    expect(screen.getByRole("heading", { name: "Token Usage" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Token budgets changed in Settings");
    expect(guardrails().getByLabelText("Daily")).toHaveValue("77");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Saving…" })).not.toBeInTheDocument();
  });

  it("closes the editor when budgetsSaved follows the updated snapshot", () => {
    const vscode = fakeVsCode(null);
    render(<Root vscode={vscode} />);
    deliver({ type: "snapshot", snapshot });

    fireEvent.click(screen.getByRole("button", { name: "Set token budget" }));
    fireEvent.change(guardrails().getByLabelText("Daily"), { target: { value: "77" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const request = vi.mocked(vscode.postMessage).mock.calls
      .map(([message]) => message)
      .find((message) => message.type === "setBudgets");
    if (!request || request.type !== "setBudgets") throw new Error("Expected budget request");
    deliver({
      type: "snapshot",
      snapshot: { ...snapshot, budgets: { ...snapshot.budgets, daily: 77 } }
    });
    expect(guardrails().getByLabelText("Daily")).toHaveValue("77");

    deliver({ type: "budgetsSaved", requestId: request.requestId });

    expect(guardrails().queryByLabelText("Daily")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit budgets" })).toBeInTheDocument();
  });

  it("waits for the submitted-budget snapshot when acknowledgement arrives first", () => {
    const vscode = fakeVsCode(null);
    render(<Root vscode={vscode} />);
    deliver({ type: "snapshot", snapshot });
    fireEvent.click(screen.getByRole("button", { name: "Set token budget" }));
    fireEvent.change(guardrails().getByLabelText("Daily"), { target: { value: "77" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const request = vi.mocked(vscode.postMessage).mock.calls
      .map(([message]) => message)
      .find((message) => message.type === "setBudgets");
    if (!request || request.type !== "setBudgets") throw new Error("Expected budget request");

    deliver({ type: "budgetsSaved", requestId: request.requestId });
    expect(guardrails().getByLabelText("Daily")).toHaveValue("77");
    deliver({
      type: "snapshot",
      snapshot: { ...snapshot, budgets: { daily: 77, weekly: 0, monthly: 0 } }
    });

    expect(guardrails().queryByLabelText("Daily")).not.toBeInTheDocument();
  });

  it("ignores stale and unrelated budget response IDs", () => {
    const vscode = fakeVsCode(null);
    render(<Root vscode={vscode} />);
    deliver({ type: "snapshot", snapshot });
    fireEvent.click(screen.getByRole("button", { name: "Set token budget" }));
    fireEvent.change(guardrails().getByLabelText("Daily"), { target: { value: "77" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    deliver({ type: "budgetError", requestId: "another-webview-save", message: "Not ours" });
    deliver({ type: "budgetsSaved", requestId: "stale-save" });

    expect(screen.queryByText("Not ours")).not.toBeInTheDocument();
    expect(guardrails().getByLabelText("Daily")).toHaveValue("77");
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("keeps fatal errors in the full-page error state", () => {
    const vscode = fakeVsCode(null);
    render(<Root vscode={vscode} />);
    deliver({ type: "snapshot", snapshot });
    deliver({ type: "error", message: "Dashboard unavailable" });

    expect(screen.getByRole("heading", { name: "Token Usage" })).toBeInTheDocument();
    expect(screen.getByText("Dashboard unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Usage Guardrails" })).not.toBeInTheDocument();
  });
});
