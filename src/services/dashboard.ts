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

function totalMetric(turn: NormalizedTurn) {
  return turn.metrics.find((metric) => metric.kind === "total");
}

function summarize(
  turns: NormalizedTurn[],
  minimumTimestamp: number
): UsageSummary {
  const summary: UsageSummary = { total: 0, exact: 0, estimated: 0 };
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
  const trendStart = addDays(today, -13);
  const trendMap = new Map<
    string,
    Record<Source, { value: number; seen: boolean; qualities: Set<MeasurementQuality> }>
  >();

  for (let offset = 0; offset < 14; offset += 1) {
    const key = dateKey(addDays(trendStart, offset));
    trendMap.set(key, {
      codex: { value: 0, seen: false, qualities: new Set() },
      opencode: { value: 0, seen: false, qualities: new Set() },
      antigravity: { value: 0, seen: false, qualities: new Set() }
    });
  }

  for (const turn of turns) {
    const key = dateKey(new Date(turn.timestamp));
    const point = trendMap.get(key);
    const metric = totalMetric(turn);
    if (!point || metric?.value == null) {
      continue;
    }
    point[turn.source].value += metric.value;
    point[turn.source].seen = true;
    point[turn.source].qualities.add(metric.quality);
  }

  const trend: TrendPoint[] = [...trendMap].map(([date, values]) => ({
    date,
    ...Object.fromEntries(
      SOURCES.map((source) => [
        source,
        values[source].seen ? values[source].value : null
      ])
    )
  })) as TrendPoint[];

  return {
    generatedAt: now.toISOString(),
    summaries: {
      today: summarize(turns, today.valueOf()),
      sevenDays: summarize(turns, week.valueOf()),
      allTime: summarize(turns, Number.NEGATIVE_INFINITY)
    },
    trend,
    turns,
    health
  };
}

