import { describe, expect, it } from "vitest";
import type {
  MeasurementQuality,
  NormalizedTurn,
  Source
} from "../../src/domain/types.js";
import {
  buildPeriodComparison,
  buildUsageComparisons
} from "../../src/services/usage-comparison.js";

function turn(
  id: string,
  timestamp: Date,
  tokens: number | null,
  quality: MeasurementQuality = "exact",
  source: Source = "codex",
  project = "/work/app",
  model = "gpt-5"
): NormalizedTurn {
  return {
    id,
    source,
    sourceSessionId: `${source}-session`,
    sourceTurnId: id,
    executionScope: "main",
    timestamp: timestamp.toISOString(),
    model,
    provider: null,
    project,
    prompt: id,
    response: "",
    toolEventCount: 0,
    fingerprint: id,
    metrics: [{
      kind: "total",
      value: tokens,
      quality,
      basis: "fixture"
    }]
  };
}

describe("buildPeriodComparison", () => {
  it("compares daily usage through the same local time and excludes future turns", () => {
    const now = new Date(2026, 6, 24, 14);
    const comparison = buildPeriodComparison([
      turn("previous-before", new Date(2026, 6, 23, 13), 100),
      turn("previous-after", new Date(2026, 6, 23, 15), 900),
      turn("current-before", new Date(2026, 6, 24, 12), 150),
      turn("current-future", new Date(2026, 6, 24, 15), 900)
    ], "daily", now);

    expect(comparison.current).toEqual({ tokens: 150, quality: "exact" });
    expect(comparison.previous).toEqual({ tokens: 100, quality: "exact" });
    expect(comparison.delta).toBe(50);
    expect(comparison.deltaPercent).toBe(50);
    expect(new Date(comparison.previousThrough).getHours()).toBe(14);
  });

  it("matches Monday-week progress by weekday and local time", () => {
    const now = new Date(2026, 6, 23, 10, 30);
    const comparison = buildPeriodComparison([
      turn("previous-in", new Date(2026, 6, 16, 10), 80),
      turn("previous-out", new Date(2026, 6, 16, 11), 90),
      turn("current", new Date(2026, 6, 23, 10), 120)
    ], "weekly", now);

    expect(comparison.previousStartDate).toBe("2026-07-13");
    expect(comparison.previous.tokens).toBe(80);
    expect(comparison.current.tokens).toBe(120);
  });

  it("caps an unequal previous month at its calendar end", () => {
    const now = new Date(2026, 4, 31, 12);
    const comparison = buildPeriodComparison([
      turn("april-end", new Date(2026, 3, 30, 23, 59, 59, 998), 50),
      turn("may", new Date(2026, 4, 31, 11), 75)
    ], "monthly", now);

    const previousThrough = new Date(comparison.previousThrough);
    expect(previousThrough.getMonth()).toBe(3);
    expect(previousThrough.getDate()).toBe(30);
    expect(comparison.previous.tokens).toBe(50);
  });

  it("suppresses unsafe deltas when either period is partial", () => {
    const comparison = buildPeriodComparison([
      turn("previous", new Date(2026, 6, 23, 10), 100),
      turn("current", new Date(2026, 6, 24, 10), 150, "partial")
    ], "daily", new Date(2026, 6, 24, 12));

    expect(comparison.current).toEqual({ tokens: 150, quality: "partial" });
    expect(comparison.delta).toBeNull();
    expect(comparison.deltaPercent).toBeNull();
    expect(comparison.kind).toBe("unavailable");
  });

  it("marks estimated deltas and new usage without inventing a percentage", () => {
    const comparison = buildPeriodComparison([
      turn("current", new Date(2026, 6, 24, 10), 150, "estimated")
    ], "daily", new Date(2026, 6, 24, 12));

    expect(comparison.quality).toBe("estimated");
    expect(comparison.kind).toBe("new");
    expect(comparison.delta).toBe(150);
    expect(comparison.deltaPercent).toBeNull();
  });

  it("ranks the top three increases and decreases and omits partial contributors", () => {
    const now = new Date(2026, 6, 24, 12);
    const turns = [
      turn("codex-prev", new Date(2026, 6, 23, 10), 100, "exact", "codex"),
      turn("codex-now", new Date(2026, 6, 24, 10), 250, "exact", "codex"),
      turn("open-prev", new Date(2026, 6, 23, 10), 300, "exact", "opencode"),
      turn("open-now", new Date(2026, 6, 24, 10), 100, "exact", "opencode"),
      turn("claude-prev", new Date(2026, 6, 23, 10), 50, "partial", "claude"),
      turn("claude-now", new Date(2026, 6, 24, 10), 70, "partial", "claude")
    ];
    const comparison = buildPeriodComparison(turns, "daily", now);

    expect(comparison.movers.sources.increases.map((item) => item.label)).toEqual(["Codex"]);
    expect(comparison.movers.sources.decreases.map((item) => item.label)).toEqual(["OpenCode"]);
    expect(comparison.movers.sources.omittedCount).toBe(1);
  });

  it("labels Antigravity CLI separately from Antigravity IDE movers", () => {
    const now = new Date(2026, 6, 24, 12);
    const comparison = buildPeriodComparison([
      turn("ide", new Date(2026, 6, 24, 10), 40, "exact", "antigravity"),
      turn("cli", new Date(2026, 6, 24, 10), 90, "exact", "antigravity-cli")
    ], "daily", now);

    expect(comparison.movers.sources.increases.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "antigravity-cli", label: "Antigravity CLI" },
      { key: "antigravity", label: "Antigravity IDE" }
    ]);
  });

  it("builds all selector granularities in one snapshot contract", () => {
    expect(Object.keys(buildUsageComparisons([], new Date(2026, 6, 24, 12)))).toEqual([
      "daily",
      "weekly",
      "monthly"
    ]);
  });
});
