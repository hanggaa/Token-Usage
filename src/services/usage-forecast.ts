import type { NormalizedTurn, TokenMetric } from "../domain/types.js";
import type {
  ForecastConfidence,
  ForecastQuality,
  ForecastStatus,
  UsageBudgets,
  UsageForecast,
  UsageGranularity
} from "../shared/dashboard.js";
import { currentCalendarPeriod } from "./calendar-periods.js";

const GRANULARITIES: UsageGranularity[] = ["daily", "weekly", "monthly"];
const MILLISECONDS_PER_HOUR = 60 * 60 * 1_000;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;
const FORECAST_GRACE_RATIO = 0.01;

function totalMetric(turn: NormalizedTurn): TokenMetric | undefined {
  return turn.metrics.find((metric) => metric.kind === "total");
}

function timestampInPeriod(turn: NormalizedTurn, start: Date, end: Date): boolean {
  const timestamp = new Date(turn.timestamp).valueOf();
  return timestamp >= start.valueOf() && timestamp <= end.valueOf();
}

function qualityFor(turns: NormalizedTurn[]): ForecastQuality {
  let hasEstimated = false;
  for (const turn of turns) {
    const metric = totalMetric(turn);
    if (metric?.value == null || metric.quality === "partial" || metric.quality === "unavailable") {
      return "partial";
    }
    hasEstimated ||= metric.quality === "estimated";
  }
  return hasEstimated ? "estimated" : "exact";
}

function knownTotal(turns: NormalizedTurn[]): number {
  return turns.reduce((sum, turn) => {
    const value = totalMetric(turn)?.value;
    return sum + (value == null ? 0 : value);
  }, 0);
}

function confidenceFor(elapsedRatio: number, quality: ForecastQuality): ForecastConfidence {
  const confidence = elapsedRatio < 0.25
    ? "low"
    : elapsedRatio < 0.6
      ? "medium"
      : "high";
  return quality === "partial" && confidence === "high" ? "medium" : confidence;
}

function statusFor(
  actualTotal: number,
  projectedBudgetPercent: number,
  budget: number,
  quality: ForecastQuality
): ForecastStatus {
  if (actualTotal >= budget) return "budget_exceeded";
  if (projectedBudgetPercent >= 100) return "likely_to_exceed";
  if (projectedBudgetPercent >= 80) return "at_risk";
  if (quality === "partial") return "incomplete_data";
  return "on_pace";
}

export function buildUsageForecast(
  turns: NormalizedTurn[],
  granularity: UsageGranularity,
  budget: number,
  now = new Date()
): UsageForecast {
  const period = currentCalendarPeriod(granularity, now);
  const periodDuration = period.nextStart.valueOf() - period.start.valueOf();
  const elapsedDuration = now.valueOf() - period.start.valueOf();
  const elapsedRatio = Math.min(1, Math.max(0, elapsedDuration / periodDuration));
  const currentTurns = turns.filter((turn) =>
    timestampInPeriod(turn, period.start, now)
  );
  const quality = qualityFor(currentTurns);
  const allowanceUnit = granularity === "daily" ? "hour" : "day";

  if (elapsedRatio < FORECAST_GRACE_RATIO) {
    return {
      projectedTotal: null,
      projectedBudgetPercent: null,
      remainingBudget: budget > 0 ? Math.max(0, budget - knownTotal(currentTurns)) : null,
      recommendedAllowance: null,
      allowanceUnit,
      confidence: null,
      quality,
      status: "not_enough_elapsed_time",
      elapsedRatio
    };
  }

  const actualTotal = knownTotal(currentTurns);
  const projectedTotal = Math.round(actualTotal / elapsedRatio);
  const confidence = confidenceFor(elapsedRatio, quality);

  if (budget <= 0) {
    return {
      projectedTotal,
      projectedBudgetPercent: null,
      remainingBudget: null,
      recommendedAllowance: null,
      allowanceUnit,
      confidence,
      quality,
      status: "no_budget",
      elapsedRatio
    };
  }

  const projectedBudgetPercent = (projectedTotal / budget) * 100;
  const remainingBudget = Math.max(0, budget - actualTotal);
  const remainingDuration = Math.max(0, period.nextStart.valueOf() - now.valueOf());
  const unitDuration = granularity === "daily"
    ? MILLISECONDS_PER_HOUR
    : MILLISECONDS_PER_DAY;
  const remainingUnits = remainingDuration / unitDuration;
  const recommendedAllowance = remainingUnits > 0
    ? Math.floor(remainingBudget / remainingUnits)
    : 0;

  return {
    projectedTotal,
    projectedBudgetPercent,
    remainingBudget,
    recommendedAllowance,
    allowanceUnit,
    confidence,
    quality,
    status: statusFor(actualTotal, projectedBudgetPercent, budget, quality),
    elapsedRatio
  };
}

export function buildUsageForecasts(
  turns: NormalizedTurn[],
  budgets: UsageBudgets,
  now = new Date()
): Record<UsageGranularity, UsageForecast> {
  return Object.fromEntries(GRANULARITIES.map((granularity) => [
    granularity,
    buildUsageForecast(turns, granularity, budgets[granularity], now)
  ])) as Record<UsageGranularity, UsageForecast>;
}
