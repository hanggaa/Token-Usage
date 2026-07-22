import type { NormalizedTurn, Source, TokenMetric } from "../domain/types.js";
import {
  type HeavyTurnInsight,
  type PeriodInsights,
  type RankedContributor,
  type UsageGranularity
} from "../shared/dashboard.js";
import { addLocalDays, currentCalendarPeriod } from "./calendar-periods.js";

const GRANULARITIES: UsageGranularity[] = ["daily", "weekly", "monthly"];
const SOURCE_LABELS: Record<Source, string> = {
  codex: "Codex", opencode: "OpenCode", antigravity: "Antigravity"
};

function totalMetric(turn: NormalizedTurn): TokenMetric | undefined {
  return turn.metrics.find((metric) => metric.kind === "total");
}

function timestampIn(turn: NormalizedTurn, start: Date, nextStart: Date): boolean {
  const value = new Date(turn.timestamp).valueOf();
  return value >= start.valueOf() && value < nextStart.valueOf();
}

function projectLabel(project: string | null): string {
  if (!project?.trim()) return "Unknown";
  return project.split(/[\\/]/u).filter(Boolean).at(-1) ?? project;
}

function median(values: number[]): number | null {
  if (values.length < 5) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const result = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return Number.isFinite(result) && result > 0 ? result : null;
}

interface ContributorIdentity {
  key: string;
  label: string;
  fullLabel?: string;
}

function rankContributors(
  turns: NormalizedTurn[],
  periodTotal: number,
  identityFor: (turn: NormalizedTurn) => ContributorIdentity
): RankedContributor[] {
  const groups = new Map<string, RankedContributor>();
  for (const turn of turns) {
    const metric = totalMetric(turn);
    if (metric?.value == null) continue;
    const identity = identityFor(turn);
    const existing = groups.get(identity.key) ?? {
      ...identity, tokens: 0, share: 0, partial: false
    };
    existing.tokens += metric.value;
    existing.partial ||= metric.quality === "partial";
    groups.set(identity.key, existing);
  }
  return [...groups.values()]
    .map((item) => ({ ...item, share: periodTotal > 0 ? item.tokens / periodTotal : 0 }))
    .toSorted((left, right) =>
      right.tokens - left.tokens
      || left.label.localeCompare(right.label)
      || left.key.localeCompare(right.key)
    )
    .slice(0, 3);
}

interface HeavyTurnResult {
  items: HeavyTurnInsight[];
  hasComparableHistory: boolean;
}

function comparisonValue(turn: NormalizedTurn): { value: number; quality: "exact" | "estimated" } | null {
  const metric = totalMetric(turn);
  if (metric?.value == null || metric.value <= 0) return null;
  if (metric.quality !== "exact" && metric.quality !== "estimated") return null;
  return { value: metric.value, quality: metric.quality };
}

function modelKey(turn: NormalizedTurn): string {
  return `${turn.source}\u0000${turn.model?.trim() || "Unknown"}`;
}

function buildHeavyTurns(current: NormalizedTurn[], baseline: NormalizedTurn[]): HeavyTurnResult {
  const byModel = new Map<string, number[]>();
  const bySource = new Map<Source, number[]>();
  for (const turn of baseline) {
    const metric = comparisonValue(turn);
    if (!metric) continue;
    byModel.set(modelKey(turn), [...(byModel.get(modelKey(turn)) ?? []), metric.value]);
    bySource.set(turn.source, [...(bySource.get(turn.source) ?? []), metric.value]);
  }

  let hasComparableHistory = false;
  const items: HeavyTurnInsight[] = [];
  for (const turn of current) {
    const metric = comparisonValue(turn);
    if (!metric) continue;
    const modelMedian = median(byModel.get(modelKey(turn)) ?? []);
    const sourceMedian = median(bySource.get(turn.source) ?? []);
    const baselineMedian = modelMedian ?? sourceMedian;
    if (baselineMedian == null) continue;
    hasComparableHistory = true;
    const multiplier = metric.value / baselineMedian;
    if (multiplier < 1.5) continue;
    items.push({
      turnId: turn.id,
      prompt: turn.prompt,
      source: turn.source,
      model: turn.model?.trim() || "Unknown",
      project: turn.project?.trim() || "Unknown",
      total: metric.value,
      quality: metric.quality,
      baselineMedian,
      multiplier,
      baselineScope: modelMedian == null ? "source" : "source-model"
    });
  }
  return {
    hasComparableHistory,
    items: items.toSorted((left, right) =>
      right.multiplier - left.multiplier || right.total - left.total || left.turnId.localeCompare(right.turnId)
    ).slice(0, 5)
  };
}

export function buildUsageInsights(
  turns: NormalizedTurn[],
  now = new Date()
): Record<UsageGranularity, PeriodInsights> {
  return Object.fromEntries(GRANULARITIES.map((granularity) => {
    const period = currentCalendarPeriod(granularity, now);
    const baselineStart = addLocalDays(period.start, -30);
    const currentTurns = turns.filter((turn) => timestampIn(turn, period.start, period.nextStart));
    const baselineTurns = turns.filter((turn) => timestampIn(turn, baselineStart, period.start));
    const usableMetrics = currentTurns
      .map((turn) => totalMetric(turn))
      .filter((metric): metric is TokenMetric => metric?.value != null);
    const total = usableMetrics.reduce((sum, metric) => sum + metric.value!, 0);
    const heavy = buildHeavyTurns(currentTurns, baselineTurns);

    return [granularity, {
      startDate: period.startDate,
      endDate: period.endDate,
      total,
      partial: usableMetrics.some((metric) => metric.quality === "partial"),
      contributors: {
        sources: rankContributors(currentTurns, total, (turn) => ({
          key: turn.source, label: SOURCE_LABELS[turn.source]
        })),
        projects: rankContributors(currentTurns, total, (turn) => ({
          key: turn.project?.trim() || "__unknown_project__",
          label: projectLabel(turn.project),
          fullLabel: turn.project?.trim() || undefined
        })),
        models: rankContributors(currentTurns, total, (turn) => ({
          key: turn.model?.trim() || "__unknown_model__",
          label: turn.model?.trim() || "Unknown"
        }))
      },
      heavyTurns: heavy.items,
      hasComparableHistory: heavy.hasComparableHistory
    } satisfies PeriodInsights];
  })) as Record<UsageGranularity, PeriodInsights>;
}
