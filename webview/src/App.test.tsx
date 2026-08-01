// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedTurn } from "../../src/domain/types.js";
import type {
  DashboardSnapshot,
  PeriodComparison,
  PeriodInsights,
  UsageGranularity
} from "../../src/shared/dashboard.js";
import { App } from "./App.js";

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

function comparison(
  current: number,
  previous: number,
  currentStartDate: string,
  previousStartDate: string
): PeriodComparison {
  const delta = current - previous;
  return {
    currentStartDate,
    currentThrough: "2026-07-09T04:00:00.000Z",
    previousStartDate,
    previousThrough: "2026-07-08T04:00:00.000Z",
    current: { tokens: current, quality: "exact" },
    previous: { tokens: previous, quality: "exact" },
    delta,
    deltaPercent: previous > 0 ? (delta / previous) * 100 : null,
    quality: "exact",
    kind: previous === 0 && current > 0
      ? "new"
      : delta > 0
        ? "increase"
        : delta < 0
          ? "decrease"
          : "unchanged",
    movers: {
      sources: {
        increases: [{
          key: "codex",
          label: "Codex",
          current: { tokens: current, quality: "exact" },
          previous: { tokens: previous, quality: "exact" },
          delta,
          deltaPercent: previous > 0 ? (delta / previous) * 100 : null,
          quality: "exact",
          kind: previous === 0 ? "new" : "increase"
        }],
        decreases: [],
        omittedCount: 0
      },
      projects: { increases: [], decreases: [], omittedCount: 0 },
      models: { increases: [], decreases: [], omittedCount: 0 }
    }
  };
}

function fixtureTurn(
  id: string,
  source: NormalizedTurn["source"],
  prompt: string,
  total: number
): NormalizedTurn {
  return {
    id,
    source,
    sourceSessionId: `${source}-session`,
    sourceTurnId: id,
    executionScope: source === "claude" && id.includes("subagent") ? "subagent" : "main",
    timestamp: "2026-07-09T03:00:00.000Z",
    model: source === "claude" ? "claude-sonnet-4" : source === "antigravity" ? "gemini-3-pro" : "gpt-5",
    provider: source === "claude" ? "anthropic" : source === "antigravity" ? "google" : "openai",
    project: source === "claude" || source === "opencode" ? "/project/api" : "/project/web",
    prompt,
    response: `Response for ${prompt}`,
    toolEventCount: 2,
    fingerprint: id,
    metrics: [
      { kind: "typed_input", value: 12, quality: "estimated", basis: "fixture" },
      { kind: "request_input", value: total - 20, quality: "exact", basis: "fixture" },
      { kind: "output", value: 20, quality: "exact", basis: "fixture" },
      { kind: "total", value: total, quality: "exact", basis: "fixture" }
    ]
  };
}

const snapshot: DashboardSnapshot = {
  generatedAt: "2026-07-09T04:00:00.000Z",
  summaries: {
    today: { total: 1_050, exact: 800, estimated: 200, partial: 50 },
    sevenDays: { total: 5_250, exact: 4_000, estimated: 1_000, partial: 250 },
    allTime: { total: 21_000, exact: 16_000, estimated: 4_000, partial: 1_000 }
  },
  trends: {
    daily: [
      { startDate: "2026-07-08", endDate: "2026-07-08", inProgress: false, codex: 200, claude: null, opencode: 100, antigravity: null },
      { startDate: "2026-07-09", endDate: "2026-07-09", inProgress: true, codex: 600, claude: null, opencode: 200, antigravity: 50, partialSources: ["antigravity"] }
    ],
    weekly: [
      { startDate: "2026-07-06", endDate: "2026-07-12", inProgress: false, codex: 200, claude: null, opencode: 100, antigravity: 50, partialSources: ["antigravity"] },
      { startDate: "2026-07-13", endDate: "2026-07-19", inProgress: true, codex: 600, claude: null, opencode: 200, antigravity: 50 }
    ],
    monthly: [
      { startDate: "2026-07-01", endDate: "2026-07-31", inProgress: false, codex: 200, claude: null, opencode: 100, antigravity: 50, partialSources: ["antigravity"] },
      { startDate: "2026-08-01", endDate: "2026-08-31", inProgress: true, codex: 600, claude: null, opencode: 200, antigravity: 50 }
    ]
  },
  budgets: { daily: 100, weekly: 250, monthly: 2_000 },
  forecasts: {
    daily: {
      projectedTotal: 20,
      projectedBudgetPercent: 20,
      remainingBudget: 90,
      recommendedAllowance: 4,
      allowanceUnit: "hour",
      confidence: "low",
      quality: "exact",
      status: "on_pace",
      elapsedRatio: 0.5
    },
    weekly: {
      projectedTotal: 300,
      projectedBudgetPercent: 120,
      remainingBudget: 50,
      recommendedAllowance: 25,
      allowanceUnit: "day",
      confidence: "medium",
      quality: "estimated",
      status: "likely_to_exceed",
      elapsedRatio: 0.5
    },
    monthly: {
      projectedTotal: 3_500,
      projectedBudgetPercent: 175,
      remainingBudget: 0,
      recommendedAllowance: 0,
      allowanceUnit: "day",
      confidence: "medium",
      quality: "partial",
      status: "budget_exceeded",
      elapsedRatio: 0.75
    }
  },
  insights: {
    daily: { ...emptyInsights("2026-07-09", "2026-07-09"), total: 10 },
    weekly: { ...emptyInsights("2026-07-13", "2026-07-19"), total: 200 },
    monthly: { ...emptyInsights("2026-08-01", "2026-08-31"), total: 3_000 }
  },
  comparisons: {
    daily: comparison(1_050, 700, "2026-07-09", "2026-07-08"),
    weekly: comparison(5_250, 4_200, "2026-07-06", "2026-06-29"),
    monthly: comparison(21_000, 18_000, "2026-07-01", "2026-06-01")
  },
  turns: [
    fixtureTurn("codex-turn", "codex", "Refactor the authentication parser", 600),
    fixtureTurn("claude-subagent-turn", "claude", "Inspect the parser tests", 200),
    fixtureTurn("open-turn", "opencode", "Write the database migration", 400)
  ],
  health: [
    {
      source: "codex",
      complete: true,
      completedAt: "2026-07-09T04:00:00.000Z",
      sessionCount: 1,
      turnCount: 1,
      issues: []
    },
    {
      source: "claude",
      complete: true,
      completedAt: "2026-07-09T04:00:00.000Z",
      sessionCount: 1,
      turnCount: 1,
      issues: []
    },
    {
      source: "opencode",
      complete: true,
      completedAt: "2026-07-09T04:00:00.000Z",
      sessionCount: 1,
      turnCount: 1,
      issues: []
    }
  ]
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderApp(
  initialGranularity: UsageGranularity = "daily",
  currentSnapshot: DashboardSnapshot = snapshot
) {
  function Harness() {
    const [usageGranularity, setUsageGranularity] = useState(initialGranularity);
    return (
      <App
        snapshot={currentSnapshot}
        loading={false}
        onRefresh={() => undefined}
        usageGranularity={usageGranularity}
        onUsageGranularityChange={setUsageGranularity}
        budgetSaveState="idle"
        budgetSaveError={null}
        onSaveBudgets={() => undefined}
        onBudgetSaveSettled={() => undefined}
      />
    );
  }

  return render(<Harness />);
}

describe("App", () => {
  it("renders the accepted overview, trend, health, and turn-table structure", () => {
    renderApp();

    expect(screen.getByRole("heading", { name: "Token Usage" })).toBeInTheDocument();
    const todayCard = screen.getByText("Today").closest("section");
    expect(within(todayCard!).getByText(/≥1[.,]050/u)).toBeInTheDocument();
    expect(within(todayCard!).getByText(/Lower bound:/u)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Usage Over Time" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Import Health" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Period Comparison" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Token usage by turn" })).toBeInTheDocument();
  });

  it("shows successful Claude imports as healthy with expandable warnings", () => {
    renderApp("daily", {
      ...snapshot,
      health: snapshot.health.map((health) =>
        health.source === "claude"
          ? {
              ...health,
              complete: false,
              turnCount: 520,
              issues: [{
                sourcePath: "C:\\Users\\dev\\.claude\\projects\\session.jsonl",
                severity: "warning",
                message: "1 malformed Claude Code JSONL line was ignored"
              }]
            }
          : health
      )
    });

    const summary = screen.getByText("Healthy · 1 warning").closest("summary")!;
    expect(summary).toBeInTheDocument();
    expect(summary.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
    expect(screen.getByText(/1 malformed Claude Code JSONL line was ignored/u))
      .toBeInTheDocument();
    expect(screen.getByText(/C:\\Users\\dev/u)).toBeInTheDocument();
  });

  it("filters rows by prompt search and source", () => {
    renderApp();

    fireEvent.change(screen.getByPlaceholderText("Search prompts"), {
      target: { value: "migration" }
    });
    const table = screen.getByRole("table", { name: "Token usage by turn" });
    expect(within(table).getByText("Write the database migration")).toBeInTheDocument();
    expect(within(table).queryByText("Refactor the authentication parser")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Source"), {
      target: { value: "codex" }
    });
    expect(screen.getByText("No turns match the current filters.")).toBeInTheDocument();
  });

  it("opens full prompt and visible response details for the selected row", () => {
    renderApp();

    const table = screen.getByRole("table", { name: "Token usage by turn" });
    fireEvent.click(within(table).getByText("Write the database migration"));

    const details = screen.getByRole("complementary", { name: "Turn details" });
    expect(within(details).getByText("Write the database migration")).toBeInTheDocument();
    expect(within(details).getByText("Response for Write the database migration")).toBeInTheDocument();
    expect(within(details).getByText("Request input")).toBeInTheDocument();
  });

  it("shows Claude Code subagent usage with badges in the table and details", () => {
    renderApp();

    const table = screen.getByRole("table", { name: "Token usage by turn" });
    fireEvent.click(within(table).getByText("Inspect the parser tests"));

    expect(within(table).getByText("Claude Code")).toBeInTheDocument();
    expect(within(table).getByText("Subagent")).toBeInTheDocument();
    const details = screen.getByRole("complementary", { name: "Turn details" });
    expect(within(details).getAllByText("Claude Code")).toHaveLength(2);
    expect(within(details).getAllByText("Subagent")).toHaveLength(2);
  });

  it("closes the detail panel and reopens it when another row is selected", () => {
    renderApp();

    fireEvent.click(screen.getByRole("button", { name: "Close turn details" }));
    expect(screen.queryByRole("complementary", { name: "Turn details" })).not.toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Token usage by turn" });
    fireEvent.click(within(table).getByText("Write the database migration"));
    expect(screen.getByRole("complementary", { name: "Turn details" })).toBeInTheDocument();
  });

  it("switches chart series and guardrail values across Daily, Weekly, and Monthly", () => {
    renderApp();

    expect(screen.getByRole("radio", { name: "Daily" })).toBeChecked();
    expect(screen.getByRole("img", { name: "Daily token usage by source" })).toBeInTheDocument();
    expect(screen.getByText("Jul 9")).toBeInTheDocument();
    const guardrails = screen.getByRole("heading", { name: "Usage Guardrails" }).closest("section")!;
    expect(within(guardrails).getByText("Daily period ending 2026-07-09")).toBeInTheDocument();
    expect(within(within(guardrails).getByText("Used").parentElement!).getByText("10")).toBeInTheDocument();
    expect(within(within(guardrails).getByText("Limit").parentElement!).getByText("100")).toBeInTheDocument();
    expect(within(guardrails).getByText("On track")).toBeInTheDocument();
    expect(within(guardrails).getByText("On pace")).toBeInTheDocument();
    expect(within(within(guardrails).getByText("Projected total").parentElement!).getByText("20")).toBeInTheDocument();
    expect(within(guardrails).getByText("Recommended per remaining hour")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));
    expect(screen.getByRole("radio", { name: "Weekly" })).toBeChecked();
    expect(screen.getByRole("img", { name: "Weekly token usage by source" })).toBeInTheDocument();
    expect(screen.getByText("Jul 6–12")).toBeInTheDocument();
    expect(within(guardrails).getByText("Weekly period ending 2026-07-19")).toBeInTheDocument();
    expect(within(within(guardrails).getByText("Used").parentElement!).getByText("200")).toBeInTheDocument();
    expect(within(within(guardrails).getByText("Limit").parentElement!).getByText("250")).toBeInTheDocument();
    expect(within(guardrails).getByText("Approaching limit")).toBeInTheDocument();
    expect(within(guardrails).getByText("Likely to exceed")).toBeInTheDocument();
    expect(within(within(guardrails).getByText("Projected total").parentElement!).getByText("≈300")).toBeInTheDocument();
    expect(within(guardrails).getByText("Recommended per remaining day")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Monthly" }));
    expect(screen.getByRole("img", { name: "Monthly token usage by source" })).toBeInTheDocument();
    expect(screen.getByText("Jul 2026")).toBeInTheDocument();
    expect(within(guardrails).getByText("Monthly period ending 2026-08-31")).toBeInTheDocument();
    expect(within(within(guardrails).getByText("Used").parentElement!).getByText(/3[.,]000/u)).toBeInTheDocument();
    expect(within(within(guardrails).getByText("Limit").parentElement!).getByText(/2[.,]000/u)).toBeInTheDocument();
    expect(within(guardrails).getAllByText("Budget exceeded")).toHaveLength(2);
    expect(within(within(guardrails).getByText("Projected total").parentElement!).getByText(/≥3[.,]500/u)).toBeInTheDocument();
  });

  it("marks the current bucket in progress and retains partial-source styling", () => {
    const { container } = renderApp("weekly");

    expect(screen.getByTitle(/In progress/u)).toBeInTheDocument();
    expect(container.querySelector(".chart-column.in-progress .bar-track")).not.toBeNull();
    expect(container.querySelector(".bar-partial.source-antigravity")).not.toBeNull();
  });

  it("uses English axis labels when the device default locale is non-English", async () => {
    const nativeDateTimeFormat = Intl.DateTimeFormat;
    vi.resetModules();
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locales, options) {
      return new nativeDateTimeFormat(locales ?? "id-ID", options);
    } as typeof Intl.DateTimeFormat);

    const { App: LocaleApp } = await import("./App.js");
    for (const [usageGranularity, label] of [
      ["daily", "Jul 9"],
      ["weekly", "Jul 6–12"],
      ["monthly", "Jul 2026"]
    ] as const) {
      render(
        <LocaleApp
          snapshot={snapshot}
          loading={false}
          onRefresh={() => undefined}
          usageGranularity={usageGranularity}
          onUsageGranularityChange={() => undefined}
          budgetSaveState="idle"
          budgetSaveError={null}
          onSaveBudgets={() => undefined}
          onBudgetSaveSettled={() => undefined}
        />
      );

      expect(screen.getByText(label)).toBeInTheDocument();
      cleanup();
    }
  });

  it("renders deterministic English weekly labels and tooltips across month and year boundaries", async () => {
    const nativeDateTimeFormat = Intl.DateTimeFormat;
    vi.resetModules();
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locales, options) {
      return new nativeDateTimeFormat(locales ?? "id-ID", options);
    } as typeof Intl.DateTimeFormat);

    const { App: LocaleApp } = await import("./App.js");
    const boundarySnapshot: DashboardSnapshot = {
      ...snapshot,
      trends: {
        ...snapshot.trends,
        weekly: [
          {
            startDate: "2026-07-27",
            endDate: "2026-08-02",
            inProgress: false,
            codex: 200,
            claude: null,
            opencode: 100,
            antigravity: 50
          },
          {
            startDate: "2026-12-28",
            endDate: "2027-01-03",
            inProgress: false,
            codex: 600,
            claude: null,
            opencode: 200,
            antigravity: 50
          }
        ]
      }
    };

    render(
      <LocaleApp
        snapshot={boundarySnapshot}
        loading={false}
        onRefresh={() => undefined}
        usageGranularity="weekly"
        onUsageGranularityChange={() => undefined}
        budgetSaveState="idle"
        budgetSaveError={null}
        onSaveBudgets={() => undefined}
        onBudgetSaveSettled={() => undefined}
      />
    );

    expect(screen.getByText("Jul 27–Aug 2").closest(".chart-column")).toHaveAttribute(
      "title",
      "July 27, 2026–August 2, 2026\nTotal: 350\nCodex: 200\nClaude Code: Unavailable\nOpenCode: 100\nAntigravity: 50"
    );
    expect(screen.getByText("Dec 28–Jan 3").closest(".chart-column")).toHaveAttribute(
      "title",
      "December 28, 2026–January 3, 2027\nTotal: 850\nCodex: 600\nClaude Code: Unavailable\nOpenCode: 200\nAntigravity: 50"
    );
  });
});
