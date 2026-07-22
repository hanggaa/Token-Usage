// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { NormalizedTurn } from "../../src/domain/types.js";
import type { DashboardSnapshot, UsageGranularity } from "../../src/shared/dashboard.js";
import { App } from "./App.js";

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
    timestamp: "2026-07-09T03:00:00.000Z",
    model: source === "opencode" ? "claude-sonnet-4" : "gpt-5",
    provider: source === "opencode" ? "anthropic" : "openai",
    project: source === "opencode" ? "/project/api" : "/project/web",
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
      { startDate: "2026-07-08", endDate: "2026-07-08", inProgress: false, codex: 200, opencode: 100, antigravity: null },
      { startDate: "2026-07-09", endDate: "2026-07-09", inProgress: true, codex: 600, opencode: 200, antigravity: 50, partialSources: ["antigravity"] }
    ],
    weekly: [
      { startDate: "2026-07-06", endDate: "2026-07-12", inProgress: false, codex: 200, opencode: 100, antigravity: 50, partialSources: ["antigravity"] },
      { startDate: "2026-07-13", endDate: "2026-07-19", inProgress: true, codex: 600, opencode: 200, antigravity: 50 }
    ],
    monthly: [
      { startDate: "2026-07-01", endDate: "2026-07-31", inProgress: false, codex: 200, opencode: 100, antigravity: 50, partialSources: ["antigravity"] },
      { startDate: "2026-08-01", endDate: "2026-08-31", inProgress: true, codex: 600, opencode: 200, antigravity: 50 }
    ]
  },
  turns: [
    fixtureTurn("codex-turn", "codex", "Refactor the authentication parser", 600),
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
      source: "opencode",
      complete: true,
      completedAt: "2026-07-09T04:00:00.000Z",
      sessionCount: 1,
      turnCount: 1,
      issues: []
    }
  ]
};

afterEach(cleanup);

function renderApp(initialGranularity: UsageGranularity = "daily") {
  function Harness() {
    const [usageGranularity, setUsageGranularity] = useState(initialGranularity);
    return (
      <App
        snapshot={snapshot}
        loading={false}
        onRefresh={() => undefined}
        usageGranularity={usageGranularity}
        onUsageGranularityChange={setUsageGranularity}
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
    expect(screen.getByRole("table", { name: "Token usage by turn" })).toBeInTheDocument();
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

  it("closes the detail panel and reopens it when another row is selected", () => {
    renderApp();

    fireEvent.click(screen.getByRole("button", { name: "Close turn details" }));
    expect(screen.queryByRole("complementary", { name: "Turn details" })).not.toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Token usage by turn" });
    fireEvent.click(within(table).getByText("Write the database migration"));
    expect(screen.getByRole("complementary", { name: "Turn details" })).toBeInTheDocument();
  });

  it("defaults to Daily and switches to the precomputed weekly and monthly series", () => {
    renderApp();

    expect(screen.getByRole("radio", { name: "Daily" })).toBeChecked();
    expect(screen.getByRole("img", { name: "Daily token usage by source" })).toBeInTheDocument();
    expect(screen.getByText("Jul 9")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));
    expect(screen.getByRole("radio", { name: "Weekly" })).toBeChecked();
    expect(screen.getByRole("img", { name: "Weekly token usage by source" })).toBeInTheDocument();
    expect(screen.getByText("Jul 6–12")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Monthly" }));
    expect(screen.getByRole("img", { name: "Monthly token usage by source" })).toBeInTheDocument();
    expect(screen.getByText("Jul 2026")).toBeInTheDocument();
  });

  it("marks the current bucket in progress and retains partial-source styling", () => {
    const { container } = renderApp("weekly");

    expect(screen.getByTitle(/In progress/u)).toBeInTheDocument();
    expect(container.querySelector(".chart-column.in-progress .bar-track")).not.toBeNull();
    expect(container.querySelector(".bar-partial.source-antigravity")).not.toBeNull();
  });
});
