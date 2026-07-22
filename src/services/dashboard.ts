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

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, amount: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface CalendarBucket {
  start: Date;
  nextStart: Date;
}

interface SourceAccumulator {
  value: number;
  seen: boolean;
  qualities: Set<MeasurementQuality>;
}

function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  const daysSinceMonday = (day.getDay() + 6) % 7;
  return addDays(day, -daysSinceMonday);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function makeBuckets(
  currentStart: Date,
  count: number,
  advance: (date: Date, amount: number) => Date
): CalendarBucket[] {
  return Array.from({ length: count }, (_, index) => {
    const offset = index - (count - 1);
    const start = advance(currentStart, offset);
    return { start, nextStart: advance(start, 1) };
  });
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

function buildTrend(turns: NormalizedTurn[], buckets: CalendarBucket[]): TrendPoint[] {
  const values = buckets.map(() => emptySources());

  for (const turn of turns) {
    const timestamp = new Date(turn.timestamp).valueOf();
    const bucketIndex = buckets.findIndex(
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

  return buckets.map(({ start, nextStart }, index) => {
    const sourceValues = values[index];
    return {
      startDate: dateKey(start),
      endDate: dateKey(addDays(nextStart, -1)),
      inProgress: index === buckets.length - 1,
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
  const today = startOfDay(now);
  const week = addDays(today, -6);
  const trends = {
    daily: buildTrend(turns, makeBuckets(today, 14, addDays)),
    weekly: buildTrend(turns, makeBuckets(startOfWeek(today), 12, (date, amount) =>
      addDays(date, amount * 7)
    )),
    monthly: buildTrend(turns, makeBuckets(startOfMonth(today), 12, addMonths))
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
