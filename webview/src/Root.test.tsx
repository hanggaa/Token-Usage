// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardSnapshot, PeriodInsights } from "../../src/shared/dashboard.js";
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

const snapshot: DashboardSnapshot = {
  generatedAt: "2026-07-22T04:00:00.000Z",
  summaries: {
    today: { total: 1_000, exact: 1_000, estimated: 0, partial: 0 },
    sevenDays: { total: 5_000, exact: 5_000, estimated: 0, partial: 0 },
    allTime: { total: 10_000, exact: 10_000, estimated: 0, partial: 0 }
  },
  trends: {
    daily: [
      { startDate: "2026-07-22", endDate: "2026-07-22", inProgress: true, codex: 1_000, opencode: 0, antigravity: 0 }
    ],
    weekly: [
      { startDate: "2026-07-20", endDate: "2026-07-26", inProgress: true, codex: 1_000, opencode: 0, antigravity: 0 }
    ],
    monthly: [
      { startDate: "2026-07-01", endDate: "2026-07-31", inProgress: true, codex: 1_000, opencode: 0, antigravity: 0 }
    ]
  },
  budgets: { daily: 0, weekly: 0, monthly: 0 },
  insights: {
    daily: emptyInsights("2026-07-22", "2026-07-22"),
    weekly: emptyInsights("2026-07-20", "2026-07-26"),
    monthly: emptyInsights("2026-07-01", "2026-07-31")
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Root", () => {
  it("restores Monthly, persists Weekly, and does not refresh for a selector change", () => {
    const vscode = fakeVsCode({ usageGranularity: "monthly" });
    render(<Root vscode={vscode} />);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "snapshot", snapshot } }));
    });

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

    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "snapshot", snapshot } }));
    });

    expect(screen.getByRole("radio", { name: "Daily" })).toBeChecked();
  });
});
