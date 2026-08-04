import { expect, it } from "vitest";
import type { MeasurementQuality, NormalizedTurn, Source } from "../../src/domain/types.js";
import { currentCalendarPeriod } from "../../src/services/calendar-periods.js";
import { buildUsageInsights } from "../../src/services/usage-insights.js";
import type { PeriodInsights } from "../../src/shared/dashboard.js";

function turn(
  id: string,
  timestamp: Date,
  source: Source,
  model: string | null,
  project: string | null,
  total: number,
  quality: MeasurementQuality,
  metricValue: number | null = quality === "unavailable" ? null : total
): NormalizedTurn {
  return {
    id,
    source,
    sourceSessionId: `session-${id}`,
    sourceTurnId: id,
    executionScope: "main",
    timestamp: timestamp.toISOString(),
    model,
    provider: null,
    project,
    prompt: `Prompt ${id}`,
    response: "",
    toolEventCount: 0,
    metrics: [{
      kind: "total",
      value: metricValue,
      quality,
      basis: "fixture"
    }],
    fingerprint: id
  };
}

it("ranks three contributors with unknown grouping, shares, and partial flags", () => {
  const insights = buildUsageInsights(
    [
      turn("a", new Date(2026, 6, 22, 9), "codex", "gpt-5", "/work/app", 600, "exact"),
      turn("b", new Date(2026, 6, 22, 10), "opencode", null, null, 300, "partial"),
      turn("c", new Date(2026, 6, 22, 11), "antigravity", "gemini", "/work/api", 100, "estimated")
    ],
    new Date(2026, 6, 22, 12)
  ).daily;

  expect(insights.total).toBe(1_000);
  expect(insights.partial).toBe(true);
  expect(insights.contributors.sources.map(({ label, tokens }) => ({ label, tokens }))).toEqual([
    { label: "Codex", tokens: 600 },
    { label: "OpenCode", tokens: 300 },
    { label: "Antigravity IDE", tokens: 100 }
  ]);
  expect(insights.contributors.models[0].share).toBeCloseTo(0.6);
  expect(insights.contributors.models.some((item) => item.label === "Unknown")).toBe(true);
  expect(insights.contributors.projects.find((item) => item.label === "app")?.fullLabel).toBe("/work/app");
});

it("labels Claude Code as a source contributor", () => {
  const insights = buildUsageInsights([
    turn(
      "claude",
      new Date(2026, 6, 22, 9),
      "claude",
      "claude-sonnet-4",
      "/work/app",
      100,
      "exact"
    )
  ], new Date(2026, 6, 22, 12)).daily;

  expect(insights.contributors.sources).toEqual([
    expect.objectContaining({ key: "claude", label: "Claude Code", tokens: 100 })
  ]);
});

it("labels Antigravity CLI separately from Antigravity IDE", () => {
  const insights = buildUsageInsights([
    turn("ide", new Date(2026, 6, 22, 9), "antigravity", "gemini", "/work/ide", 40, "exact"),
    turn("cli", new Date(2026, 6, 22, 10), "antigravity-cli", "gemini", "/work/cli", 90, "exact")
  ], new Date(2026, 6, 22, 12)).daily;

  expect(insights.contributors.sources.map(({ key, label }) => ({ key, label }))).toEqual([
    { key: "antigravity-cli", label: "Antigravity CLI" },
    { key: "antigravity", label: "Antigravity IDE" }
  ]);
});

it("excludes numeric unavailable totals from period totals and contributors", () => {
  const insights = buildUsageInsights([
    turn("exact", new Date(2026, 6, 22, 9), "codex", "gpt-5", "/work/app", 100, "exact"),
    turn("unavailable", new Date(2026, 6, 22, 10), "opencode", "claude", "/work/api", 900, "unavailable", 900)
  ], new Date(2026, 6, 22, 12)).daily;

  expect(insights.total).toBe(100);
  expect(insights.contributors.sources).toEqual([
    expect.objectContaining({ label: "Codex", tokens: 100 })
  ]);
});

it("uses basenames for Windows projects and Unknown for missing projects", () => {
  const insights = buildUsageInsights([
    turn(
      "windows",
      new Date(2026, 6, 22, 9),
      "codex",
      "gpt-5",
      "C:\\Users\\demo\\work\\token-usage",
      100,
      "exact"
    ),
    turn("unknown", new Date(2026, 6, 22, 10), "codex", "gpt-5", null, 50, "exact")
  ], new Date(2026, 6, 22, 12)).daily;

  expect(insights.contributors.projects).toEqual([
    expect.objectContaining({
      label: "token-usage",
      fullLabel: "C:\\Users\\demo\\work\\token-usage"
    }),
    expect.objectContaining({ label: "Unknown", fullLabel: undefined })
  ]);
});

it("uses source-model median first and source fallback second", () => {
  const history = [100, 100, 100, 100, 100].map((total, index) =>
    turn(`model-${index}`, new Date(2026, 5, index + 22, 12), "codex", "gpt-5", "/work/app", total, "exact")
  );
  const fallbackHistory = [200, 200, 200, 200, 200].map((total, index) =>
    turn(`source-${index}`, new Date(2026, 5, index + 27, 12), "opencode", `model-${index}`, "/work/api", total, "exact")
  );
  const insights = buildUsageInsights(
    [
      ...history,
      ...fallbackHistory,
      turn("same-model", new Date(2026, 6, 22, 9), "codex", "gpt-5", "/work/app", 200, "exact"),
      turn("fallback", new Date(2026, 6, 22, 10), "opencode", "new-model", "/work/api", 400, "estimated")
    ],
    new Date(2026, 6, 22, 12)
  ).daily;

  expect(insights.heavyTurns.map(({ turnId, baselineMedian, multiplier, baselineScope }) => ({
    turnId, baselineMedian, multiplier, baselineScope
  }))).toEqual([
    { turnId: "fallback", baselineMedian: 200, multiplier: 2, baselineScope: "source" },
    { turnId: "same-model", baselineMedian: 100, multiplier: 2, baselineScope: "source-model" }
  ]);
});

it("uses an inclusive 1.5x threshold and requires five eligible samples", () => {
  const five = [0, 1, 2, 3, 4].map((index) =>
    turn(`history-${index}`, new Date(2026, 5, index + 22, 12), "codex", "gpt-5", "/app", 100, "exact")
  );
  const enough = buildUsageInsights([
    ...five,
    turn("below", new Date(2026, 6, 22, 9), "codex", "gpt-5", "/app", 149, "exact"),
    turn("at", new Date(2026, 6, 22, 10), "codex", "gpt-5", "/app", 150, "exact")
  ], new Date(2026, 6, 22, 12)).daily;
  expect(enough.heavyTurns.map((item) => item.turnId)).toEqual(["at"]);

  const insufficient = buildUsageInsights(five.slice(0, 4), new Date(2026, 6, 22, 12)).daily;
  expect(insufficient.hasComparableHistory).toBe(false);
  expect(insufficient.heavyTurns).toEqual([]);
});

it("excludes partial and unavailable comparison metrics", () => {
  const excluded = ["partial", "unavailable"] as const;
  const insights = buildUsageInsights(excluded.flatMap((quality) =>
    [0, 1, 2, 3, 4].map((index) =>
      turn(`${quality}-${index}`, new Date(2026, 5, index + 22, 12), "codex", "gpt-5", "/app", 100, quality)
    )
  ), new Date(2026, 6, 22, 12)).daily;
  expect(insights.hasComparableHistory).toBe(false);
});

it("does not count history that no current candidate can use", () => {
  const unrelatedHistory = Array.from({ length: 5 }, (_, index) =>
    turn(`codex-${index}`, new Date(2026, 5, index + 22, 12), "codex", "gpt-5", "/app", 100, "exact")
  );
  const insights = buildUsageInsights([
    ...unrelatedHistory,
    turn("current", new Date(2026, 6, 22, 9), "opencode", "claude", "/app", 200, "exact")
  ], new Date(2026, 6, 22, 12)).daily;

  expect(insights.hasComparableHistory).toBe(false);
  expect(insights.heavyTurns).toEqual([]);
});

it("limits and deterministically orders contributors and heavy turns", () => {
  const insights = buildLargeRankingFixture();
  expect(insights.contributors.models).toHaveLength(3);
  expect(insights.contributors.models.map((item) => item.label)).toEqual(["Alpha", "Beta", "Gamma"]);
  expect(insights.heavyTurns).toHaveLength(5);
  expect(insights.heavyTurns.map((item) => item.turnId)).toEqual([
    "ratio-3-total-500", "ratio-3-total-400", "ratio-2-a", "ratio-2-b", "ratio-15"
  ]);
});

it("uses code-point ordering for non-ASCII contributor ties", () => {
  const insights = buildUsageInsights([
    turn("zulu", new Date(2026, 6, 22, 9), "codex", "Zulu", "/work/app", 100, "exact"),
    turn("accented", new Date(2026, 6, 22, 10), "codex", "Ångström", "/work/app", 100, "exact")
  ], new Date(2026, 6, 22, 12)).daily;

  expect(insights.contributors.models.map((item) => item.label)).toEqual(["Zulu", "Ångström"]);
});

it("uses code-point turn IDs for exact heavy-turn ties before applying the top-five limit", () => {
  const history = Array.from({ length: 5 }, (_, index) =>
    turn(`history-${index}`, new Date(2026, 5, index + 22, 12), "codex", "gpt-5", "/app", 100, "exact")
  );
  const current = ["Zulu", "Ångström", "Alpha", "Beta", "Gamma", "Omega"].map((id, index) =>
    turn(id, new Date(2026, 6, 22, 9 + index), "codex", "gpt-5", "/app", 200, "exact")
  );

  const insights = buildUsageInsights([...history, ...current], new Date(2026, 6, 22, 20)).daily;

  expect(insights.heavyTurns.map((item) => item.turnId)).toEqual([
    "Alpha", "Beta", "Gamma", "Omega", "Zulu"
  ]);
});

function buildLargeRankingFixture(): PeriodInsights {
  const cohorts = [
    { model: "Alpha", id: "ratio-3-total-500", baseline: 166, current: 500, target: 700 },
    { model: "Beta", id: "ratio-3-total-400", baseline: 133, current: 400, target: 650 },
    { model: "Gamma", id: "ratio-2-a", baseline: 150, current: 300, target: 600 },
    { model: "Delta", id: "ratio-2-b", baseline: 150, current: 300, target: 550 },
    { model: "Epsilon", id: "ratio-15", baseline: 200, current: 300, target: 500 }
  ];
  const history = cohorts.flatMap(({ model, baseline }, cohortIndex) =>
    Array.from({ length: 5 }, (_, sampleIndex) =>
      turn(
        `history-${cohortIndex}-${sampleIndex}`,
        new Date(2026, 5, cohortIndex * 5 + sampleIndex + 22, 12),
        "codex",
        model,
        "/work/app",
        baseline,
        "exact"
      )
    )
  );
  const current = cohorts.flatMap(({ model, id, current: total, target }, index) => [
    turn(id, new Date(2026, 6, 22, 8 + index), "codex", model, "/work/app", total, "exact"),
    turn(
      `partial-fill-${index}`,
      new Date(2026, 6, 22, 14 + index),
      "codex",
      model,
      "/work/app",
      target - total,
      "partial"
    )
  ]);
  return buildUsageInsights([...history, ...current], new Date(2026, 6, 22, 20)).daily;
}

it.each(["daily", "weekly", "monthly"] as const)(
  "keeps the %s baseline strictly before the current period",
  (granularity) => {
    const now = new Date(2026, 6, 22, 12);
    const start = currentCalendarPeriod(granularity, now).start;
    const before = new Date(start.valueOf() - 60_000);
    const turns = [
      ...Array.from({ length: 5 }, (_, index) =>
        turn(`before-${index}`, before, "codex", "gpt-5", "/app", 100, "exact")
      ),
      turn("at-start", start, "codex", "gpt-5", "/app", 200, "exact")
    ];
    const insights = buildUsageInsights(turns, now)[granularity];

    expect(insights.total).toBe(200);
    expect(insights.hasComparableHistory).toBe(true);
    expect(insights.heavyTurns.map((item) => item.turnId)).toEqual(["at-start"]);
  }
);
