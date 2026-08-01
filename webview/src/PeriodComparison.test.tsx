// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PeriodComparison as PeriodComparisonData } from "../../src/shared/dashboard.js";
import { PeriodComparison } from "./PeriodComparison.js";

const comparison: PeriodComparisonData = {
  currentStartDate: "2026-07-20",
  currentThrough: "2026-07-24T07:00:00.000Z",
  previousStartDate: "2026-07-13",
  previousThrough: "2026-07-17T07:00:00.000Z",
  current: { tokens: 1_500, quality: "estimated" },
  previous: { tokens: 1_000, quality: "exact" },
  delta: 500,
  deltaPercent: 50,
  quality: "estimated",
  kind: "increase",
  movers: {
    sources: {
      increases: [{
        key: "codex",
        label: "Codex",
        current: { tokens: 1_200, quality: "estimated" },
        previous: { tokens: 700, quality: "exact" },
        delta: 500,
        deltaPercent: 71.428,
        quality: "estimated",
        kind: "increase"
      }],
      decreases: [{
        key: "opencode",
        label: "OpenCode",
        current: { tokens: 200, quality: "exact" },
        previous: { tokens: 300, quality: "exact" },
        delta: -100,
        deltaPercent: -33.333,
        quality: "exact",
        kind: "decrease"
      }],
      omittedCount: 1
    },
    projects: {
      increases: [{
        key: "/work/new-app",
        label: "new-app",
        fullLabel: "/work/new-app",
        current: { tokens: 400, quality: "exact" },
        previous: { tokens: 0, quality: "exact" },
        delta: 400,
        deltaPercent: null,
        quality: "exact",
        kind: "new"
      }],
      decreases: [],
      omittedCount: 0
    },
    models: { increases: [], decreases: [], omittedCount: 0 }
  }
};

afterEach(cleanup);

describe("PeriodComparison", () => {
  it("shows matched totals, approximate delta, and source movers", () => {
    render(<PeriodComparison comparison={comparison} granularity="weekly" />);

    const panel = screen.getByRole("heading", { name: "Period Comparison" }).closest("section")!;
    expect(within(panel).getByText(/Weekly usage through/u)).toBeInTheDocument();
    expect(within(panel).getByText(/≈1[.,]500/u)).toBeInTheDocument();
    expect(within(panel).getByText(/≈\+500 \(\+50\.0%\)/u)).toBeInTheDocument();
    expect(within(panel).getByText("Codex")).toBeInTheDocument();
    expect(within(panel).getByText("OpenCode")).toBeInTheDocument();
    expect(within(panel).getByText(/1 source omitted/u)).toBeInTheDocument();
  });

  it("switches one breakdown selector and labels new usage", () => {
    render(<PeriodComparison comparison={comparison} granularity="weekly" />);

    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    expect(screen.getByRole("button", { name: "Project" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("new-app").closest("li")).toHaveAttribute("title", "/work/new-app");
    expect(screen.getByText(/New · \+400/u)).toBeInTheDocument();
  });

  it("suppresses deltas for partial lower-bound periods", () => {
    render(
      <PeriodComparison
        granularity="monthly"
        comparison={{
          ...comparison,
          current: { tokens: 1_500, quality: "partial" },
          delta: null,
          deltaPercent: null,
          quality: "partial",
          kind: "unavailable"
        }}
      />
    );

    expect(screen.getByText(/≥1[.,]500/u)).toBeInTheDocument();
    expect(screen.getByText("Not comparable")).toBeInTheDocument();
    expect(screen.getByText(/Delta hidden because one period is a lower bound/u))
      .toBeInTheDocument();
  });
});
