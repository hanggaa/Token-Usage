import { describe, expect, it } from "vitest";
import type {
  MeasurementQuality,
  NormalizedTurn
} from "../../src/domain/types.js";
import {
  buildUsageForecast,
  buildUsageForecasts
} from "../../src/services/usage-forecast.js";

function turn(
  id: string,
  timestamp: Date,
  total: number | null,
  quality: MeasurementQuality
): NormalizedTurn {
  return {
    id,
    source: "codex",
    sourceSessionId: "session",
    sourceTurnId: id,
    executionScope: "main",
    timestamp: timestamp.toISOString(),
    model: "model",
    provider: "provider",
    project: "/project",
    prompt: `Prompt ${id}`,
    response: `Response ${id}`,
    toolEventCount: 0,
    metrics: [{ kind: "total", value: total, quality, basis: "fixture" }],
    fingerprint: id
  };
}

describe("buildUsageForecast", () => {
  it("waits until one percent of the active period has elapsed", () => {
    const now = new Date(2026, 6, 22, 0, 10);
    const forecast = buildUsageForecast(
      [turn("early", new Date(2026, 6, 22, 0, 5), 100, "exact")],
      "daily",
      1_000,
      now
    );

    expect(forecast).toMatchObject({
      projectedTotal: null,
      projectedBudgetPercent: null,
      remainingBudget: 900,
      recommendedAllowance: null,
      allowanceUnit: "hour",
      confidence: null,
      quality: "exact",
      status: "not_enough_elapsed_time"
    });
    expect(forecast.elapsedRatio).toBeLessThan(0.01);
  });

  it("projects current usage linearly and rounds to the nearest token", () => {
    const now = new Date(2026, 6, 22, 8);
    const forecast = buildUsageForecast(
      [turn("morning", new Date(2026, 6, 22, 7), 101, "exact")],
      "daily",
      1_000,
      now
    );

    expect(forecast.projectedTotal).toBe(303);
    expect(forecast.projectedBudgetPercent).toBeCloseTo(30.3);
    expect(forecast.status).toBe("on_pace");
  });

  it("returns a projection without budget-specific values when no budget is configured", () => {
    const forecast = buildUsageForecast(
      [turn("morning", new Date(2026, 6, 22, 6), 100, "exact")],
      "daily",
      0,
      new Date(2026, 6, 22, 12)
    );

    expect(forecast).toMatchObject({
      projectedTotal: 200,
      projectedBudgetPercent: null,
      remainingBudget: null,
      recommendedAllowance: null,
      status: "no_budget"
    });
  });

  it("projects zero after the grace period when the period has no usage", () => {
    const forecast = buildUsageForecast(
      [],
      "daily",
      1_000,
      new Date(2026, 6, 22, 12)
    );

    expect(forecast).toMatchObject({
      projectedTotal: 0,
      projectedBudgetPercent: 0,
      remainingBudget: 1_000,
      recommendedAllowance: 83,
      confidence: "medium",
      quality: "exact",
      status: "on_pace"
    });
  });

  it.each([
    { total: 399, status: "on_pace" },
    { total: 400, status: "at_risk" },
    { total: 500, status: "likely_to_exceed" },
    { total: 1_000, status: "budget_exceeded" }
  ] as const)("classifies $status at the approved budget threshold", ({ total, status }) => {
    const forecast = buildUsageForecast(
      [turn(status, new Date(2026, 6, 22, 10), total, "exact")],
      "daily",
      1_000,
      new Date(2026, 6, 22, 12)
    );

    expect(forecast.status).toBe(status);
  });

  it("treats an unavailable current-period total as partial and avoids an on-pace claim", () => {
    const forecast = buildUsageForecast(
      [
        turn("known", new Date(2026, 6, 22, 10), 100, "exact"),
        turn("unknown", new Date(2026, 6, 22, 11), null, "unavailable")
      ],
      "daily",
      1_000,
      new Date(2026, 6, 22, 12)
    );

    expect(forecast).toMatchObject({
      projectedTotal: 200,
      quality: "partial",
      status: "incomplete_data"
    });
  });

  it("keeps actionable risk states for partial lower bounds", () => {
    const atRisk = buildUsageForecast(
      [turn("partial-risk", new Date(2026, 6, 22, 10), 400, "partial")],
      "daily",
      1_000,
      new Date(2026, 6, 22, 12)
    );
    const overBudget = buildUsageForecast(
      [turn("partial-over", new Date(2026, 6, 22, 10), 1_000, "partial")],
      "daily",
      1_000,
      new Date(2026, 6, 22, 12)
    );

    expect(atRisk.status).toBe("at_risk");
    expect(overBudget.status).toBe("budget_exceeded");
  });

  it("uses the strongest included quality signal", () => {
    const estimated = buildUsageForecast(
      [
        turn("exact", new Date(2026, 6, 22, 10), 100, "exact"),
        turn("estimated", new Date(2026, 6, 22, 11), 100, "estimated")
      ],
      "daily",
      1_000,
      new Date(2026, 6, 22, 12)
    );
    const partial = buildUsageForecast(
      [
        turn("estimated", new Date(2026, 6, 22, 10), 100, "estimated"),
        turn("partial", new Date(2026, 6, 22, 11), 100, "partial")
      ],
      "daily",
      1_000,
      new Date(2026, 6, 22, 12)
    );

    expect(estimated.quality).toBe("estimated");
    expect(partial.quality).toBe("partial");
  });

  it("uses low, medium, and high confidence at the elapsed-period boundaries", () => {
    const input = [turn("usage", new Date(2026, 6, 22, 1), 100, "exact")];

    expect(buildUsageForecast(input, "daily", 1_000, new Date(2026, 6, 22, 5, 59))
      .confidence).toBe("low");
    expect(buildUsageForecast(input, "daily", 1_000, new Date(2026, 6, 22, 6))
      .confidence).toBe("medium");
    expect(buildUsageForecast(input, "daily", 1_000, new Date(2026, 6, 22, 14, 24))
      .confidence).toBe("high");
  });

  it("caps partial-data confidence at medium", () => {
    const forecast = buildUsageForecast(
      [turn("partial", new Date(2026, 6, 22, 10), 100, "partial")],
      "daily",
      1_000,
      new Date(2026, 6, 22, 18)
    );

    expect(forecast.confidence).toBe("medium");
  });

  it("recommends budget allowance per remaining hour for daily periods", () => {
    const forecast = buildUsageForecast(
      [turn("used", new Date(2026, 6, 22, 10), 400, "exact")],
      "daily",
      1_000,
      new Date(2026, 6, 22, 12)
    );

    expect(forecast).toMatchObject({
      remainingBudget: 600,
      recommendedAllowance: 50,
      allowanceUnit: "hour"
    });
  });

  it("recommends budget allowance per remaining 24-hour day for longer periods", () => {
    const weekly = buildUsageForecast(
      [turn("weekly", new Date(2026, 6, 20, 10), 100, "exact")],
      "weekly",
      750,
      new Date(2026, 6, 20, 12)
    );
    const monthly = buildUsageForecast(
      [],
      "monthly",
      1_550,
      new Date(2026, 6, 16, 12)
    );

    expect(weekly).toMatchObject({
      remainingBudget: 650,
      recommendedAllowance: 100,
      allowanceUnit: "day"
    });
    expect(monthly).toMatchObject({
      remainingBudget: 1_550,
      recommendedAllowance: 100,
      allowanceUnit: "day"
    });
  });

  it("excludes turns outside the active local calendar period", () => {
    const forecast = buildUsageForecast(
      [
        turn("yesterday", new Date(2026, 6, 21, 23, 59), 900, "exact"),
        turn("today", new Date(2026, 6, 22, 1), 100, "exact")
      ],
      "daily",
      1_000,
      new Date(2026, 6, 22, 12)
    );

    expect(forecast.projectedTotal).toBe(200);
  });

  it("excludes future-dated turns from the current projection", () => {
    const forecast = buildUsageForecast(
      [
        turn("known", new Date(2026, 6, 22, 10), 100, "exact"),
        turn("future", new Date(2026, 6, 22, 18), 900, "exact")
      ],
      "daily",
      1_000,
      new Date(2026, 6, 22, 12)
    );

    expect(forecast.projectedTotal).toBe(200);
  });
});

describe("buildUsageForecasts", () => {
  it("builds daily, weekly, and monthly forecasts with their matching budgets", () => {
    const forecasts = buildUsageForecasts(
      [turn("today", new Date(2026, 6, 22, 9), 100, "exact")],
      { daily: 1_000, weekly: 2_000, monthly: 3_000 },
      new Date(2026, 6, 22, 12)
    );

    expect(Object.keys(forecasts)).toEqual(["daily", "weekly", "monthly"]);
    expect(forecasts.daily.allowanceUnit).toBe("hour");
    expect(forecasts.weekly.allowanceUnit).toBe("day");
    expect(forecasts.monthly.allowanceUnit).toBe("day");
  });
});
