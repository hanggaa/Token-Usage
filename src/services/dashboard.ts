import type {
  MeasurementQuality,
  NormalizedTurn,
  Source
} from "../domain/types.js";
import type { SourceHealth } from "../storage/tracker-store.js";
import {
  SOURCES,
  type DashboardSnapshot,
  type TrendPoint,
  type UsageSummary
} from "../shared/dashboard.js";
import {
  addLocalDays,
  calendarPeriods,
  startOfLocalDay,
  type CalendarPeriod
} from "./calendar-periods.js";

interface SourceAccumulator {
  value: number;
  seen: boolean;
  qualities: Set<MeasurementQuality>;
}

function emptySources(): Record<Source, SourceAccumulator> {
  return {
    codex: { value: 0, seen: false, qualities: new Set() },
    opencode: { value: 0, seen: false, qualities: new Set() },
    antigravity: { value: 0, seen: false, qualities: new Set() }
  };
}

function totalMetric(turn: NormalizedTurn) {
  return turn.metrics.find((metric) => metric.kind === "total");
}

function buildTrend(turns: NormalizedTurn[], periods: CalendarPeriod[]): TrendPoint[] {
  const values = periods.map(() => emptySources());

  for (const turn of turns) {
    const timestamp = new Date(turn.timestamp).valueOf();
    const bucketIndex = periods.findIndex(
      ({ start, nextStart }) => timestamp >= start.valueOf() && timestamp < nextStart.valueOf()
    );
    const metric = totalMetric(turn);
    if (bucketIndex < 0 || metric?.value == null) {
      continue;
    }

    const source = values[bucketIndex][turn.source];
    source.value += metric.value;
    source.seen = true;
    source.qualities.add(metric.quality);
  }

  return periods.map(({ startDate, endDate }, index) => {
    const sourceValues = values[index];
    return {
      startDate,
      endDate,
      inProgress: index === periods.length - 1,
      codex: sourceValues.codex.seen ? sourceValues.codex.value : null,
      opencode: sourceValues.opencode.seen ? sourceValues.opencode.value : null,
      antigravity: sourceValues.antigravity.seen ? sourceValues.antigravity.value : null,
      partialSources: SOURCES.filter((source) =>
        sourceValues[source].qualities.has("partial")
      )
    };
  });
}

function summarize(
  turns: NormalizedTurn[],
  minimumTimestamp: number
): UsageSummary {
  const summary: UsageSummary = { total: 0, exact: 0, estimated: 0, partial: 0 };
  for (const turn of turns) {
    if (new Date(turn.timestamp).valueOf() < minimumTimestamp) {
      continue;
    }
    const metric = totalMetric(turn);
    if (metric?.value == null) {
      continue;
    }
    summary.total += metric.value;
    if (metric.quality === "exact") {
      summary.exact += metric.value;
    } else if (metric.quality === "estimated") {
      summary.estimated += metric.value;
    } else if (metric.quality === "partial") {
      summary.partial += metric.value;
    }
  }
  return summary;
}

export function buildDashboardSnapshot(
  turns: NormalizedTurn[],
  health: SourceHealth[],
  now = new Date()
): DashboardSnapshot {
  const today = startOfLocalDay(now);
  const week = addLocalDays(today, -6);
  const trends = {
    daily: buildTrend(turns, calendarPeriods("daily", 14, now)),
    weekly: buildTrend(turns, calendarPeriods("weekly", 12, now)),
    monthly: buildTrend(turns, calendarPeriods("monthly", 12, now))
  };

  return {
    generatedAt: now.toISOString(),
    summaries: {
      today: summarize(turns, today.valueOf()),
      sevenDays: summarize(turns, week.valueOf()),
      allTime: summarize(turns, Number.NEGATIVE_INFINITY)
    },
    trends,
    turns,
    health
  };
}
