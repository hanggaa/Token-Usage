import { describe, expect, it } from "vitest";
import type { NormalizedTurn } from "../../src/domain/types.js";
import { buildDashboardSnapshot } from "../../src/services/dashboard.js";

function turn(
  id: string,
  timestamp: string,
  source: NormalizedTurn["source"],
  total: number | null,
  quality: "exact" | "estimated" | "partial" | "unavailable"
): NormalizedTurn {
  return {
    id,
    source,
    sourceSessionId: `${source}-session`,
    sourceTurnId: id,
    executionScope: "main",
    timestamp,
    model: "model",
    provider: "provider",
    project: "/project",
    prompt: `Prompt ${id}`,
    response: `Response ${id}`,
    toolEventCount: 0,
    fingerprint: id,
    metrics: [
      {
        kind: "total",
        value: total,
        quality,
        basis: "fixture"
      }
    ]
  };
}

function localTimestamp(
  year: number,
  monthIndex: number,
  day: number,
  hour = 12
): string {
  return new Date(year, monthIndex, day, hour).toISOString();
}

function pointStarting(
  snapshot: ReturnType<typeof buildDashboardSnapshot>,
  granularity: "daily" | "weekly" | "monthly",
  startDate: string
) {
  return snapshot.trends[granularity].find((point) => point.startDate === startDate);
}

function inTimezone<T>(timezone: string, callback: () => T): T {
  const originalTimezone = process.env.TZ;
  process.env.TZ = timezone;
  try {
    return callback();
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
}

describe("buildDashboardSnapshot", () => {
  it("includes validated budgets and current-period insights", () => {
    const snapshot = buildDashboardSnapshot(
      [turn("today", localTimestamp(2026, 6, 22, 9), "codex", 250, "exact")],
      [],
      new Date(2026, 6, 22, 12),
      { daily: 1_000, weekly: 5_000, monthly: 20_000 }
    );

    expect(snapshot.budgets).toEqual({ daily: 1_000, weekly: 5_000, monthly: 20_000 });
    expect(snapshot.forecasts.daily).toMatchObject({
      projectedTotal: 500,
      projectedBudgetPercent: 50,
      remainingBudget: 750,
      recommendedAllowance: 62,
      allowanceUnit: "hour",
      confidence: "medium",
      quality: "exact",
      status: "on_pace",
      elapsedRatio: 0.5
    });
    expect(snapshot.insights.daily).toMatchObject({
      startDate: "2026-07-22",
      endDate: "2026-07-22",
      total: 250,
      partial: false
    });
    expect(snapshot.comparisons.daily).toMatchObject({
      currentStartDate: "2026-07-22",
      previousStartDate: "2026-07-21",
      current: { tokens: 250, quality: "exact" },
      previous: { tokens: 0, quality: "exact" },
      delta: 250,
      deltaPercent: null,
      kind: "new"
    });
  });

  it("builds today, seven-day, and all-time exact/estimated summaries", () => {
    const snapshot = buildDashboardSnapshot(
      [
        turn("today-exact", "2026-07-09T02:00:00.000Z", "codex", 100, "exact"),
        turn("today-estimated", "2026-07-09T03:00:00.000Z", "antigravity", 40, "estimated"),
        turn("today-partial", "2026-07-09T03:30:00.000Z", "antigravity", 30, "partial"),
        turn("week", "2026-07-05T03:00:00.000Z", "opencode", 60, "exact"),
        turn("old", "2026-06-01T03:00:00.000Z", "codex", 20, "exact"),
        turn("unknown", "2026-07-09T04:00:00.000Z", "antigravity", null, "unavailable")
      ],
      [],
      new Date("2026-07-09T12:00:00.000Z")
    );

    expect(snapshot.summaries.today).toEqual({
      total: 170,
      exact: 100,
      estimated: 40,
      partial: 30
    });
    expect(snapshot.summaries.sevenDays.total).toBe(230);
    expect(snapshot.summaries.allTime.total).toBe(250);
  });

  it("creates daily source series without treating unavailable metrics as zero usage", () => {
    const snapshot = buildDashboardSnapshot(
      [
        turn("codex", localTimestamp(2026, 6, 9, 9), "codex", 100, "exact"),
        turn("claude", localTimestamp(2026, 6, 9, 9), "claude", 75, "exact"),
        turn("open", localTimestamp(2026, 6, 9, 10), "opencode", 50, "exact"),
        turn("partial", localTimestamp(2026, 6, 9, 10), "antigravity", 25, "partial"),
        turn("ag", localTimestamp(2026, 6, 9, 11), "antigravity", null, "unavailable")
      ],
      [],
      new Date(2026, 6, 9, 12)
    );

    for (const granularity of ["daily", "weekly", "monthly"] as const) {
      expect(snapshot.trends[granularity].at(-1)).toMatchObject({
      codex: 100,
      claude: 75,
      opencode: 50,
      antigravity: 25,
      partialSources: ["antigravity"]
      });
    }
  });

  it("builds 14 daily, 12 Monday-based weekly, and 12 monthly buckets", () => {
    const snapshot = buildDashboardSnapshot([], [], new Date(2026, 6, 22, 12));

    expect(snapshot.trends.daily).toHaveLength(14);
    expect(snapshot.trends.weekly).toHaveLength(12);
    expect(snapshot.trends.monthly).toHaveLength(12);
    expect(snapshot.trends.daily.at(-1)).toMatchObject({
      startDate: "2026-07-22",
      endDate: "2026-07-22",
      inProgress: true
    });
    expect(snapshot.trends.weekly.at(-1)).toMatchObject({
      startDate: "2026-07-20",
      endDate: "2026-07-26",
      inProgress: true
    });
    expect(snapshot.trends.monthly.at(-1)).toMatchObject({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      inProgress: true
    });
    expect(snapshot.trends.daily.at(-2)?.inProgress).toBe(false);
    expect(snapshot.trends.weekly.at(-2)?.inProgress).toBe(false);
    expect(snapshot.trends.monthly.at(-2)?.inProgress).toBe(false);
  });

  it("keeps Monday through Sunday together and starts a new bucket on Monday", () => {
    const snapshot = buildDashboardSnapshot(
      [
        turn("monday", localTimestamp(2026, 6, 6), "codex", 10, "exact"),
        turn("sunday", localTimestamp(2026, 6, 12), "codex", 20, "exact"),
        turn("next-monday", localTimestamp(2026, 6, 13), "codex", 40, "exact")
      ],
      [],
      new Date(2026, 6, 15, 12)
    );

    expect(pointStarting(snapshot, "weekly", "2026-07-06")?.codex).toBe(30);
    expect(pointStarting(snapshot, "weekly", "2026-07-13")?.codex).toBe(40);
  });

  it("keeps daily buckets disjoint when DST advances at local midnight", () => {
    inTimezone("America/Santiago", () => {
      const snapshot = buildDashboardSnapshot(
        [
          turn("september-6", new Date(2026, 8, 6, 1, 30).toISOString(), "codex", 10, "exact"),
          turn("september-7", new Date(2026, 8, 7, 0, 30).toISOString(), "codex", 20, "exact")
        ],
        [],
        new Date(2026, 8, 7, 12)
      );

      expect(pointStarting(snapshot, "daily", "2026-09-06")?.codex).toBe(10);
      expect(pointStarting(snapshot, "daily", "2026-09-07")?.codex).toBe(20);
    });
  });

  it("keeps daily buckets continuous when DST moves backward", () => {
    inTimezone("America/Santiago", () => {
      const snapshot = buildDashboardSnapshot(
        [
          turn("april-4", new Date(2026, 3, 4, 23, 30).toISOString(), "codex", 10, "exact"),
          turn("april-5", new Date(2026, 3, 5, 0, 30).toISOString(), "codex", 20, "exact")
        ],
        [],
        new Date(2026, 3, 5, 12)
      );

      expect(pointStarting(snapshot, "daily", "2026-04-04")?.codex).toBe(10);
      expect(pointStarting(snapshot, "daily", "2026-04-05")?.codex).toBe(20);
    });
  });

  it("groups months across a year boundary", () => {
    const snapshot = buildDashboardSnapshot(
      [
        turn("december", localTimestamp(2026, 11, 31), "opencode", 25, "exact"),
        turn("january", localTimestamp(2027, 0, 1), "opencode", 50, "exact")
      ],
      [],
      new Date(2027, 0, 15, 12)
    );

    expect(pointStarting(snapshot, "monthly", "2026-12-01")?.opencode).toBe(25);
    expect(pointStarting(snapshot, "monthly", "2027-01-01")?.opencode).toBe(50);
  });
});
