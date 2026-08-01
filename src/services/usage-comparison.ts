import type { NormalizedTurn, Source, TokenMetric } from "../domain/types.js";
import type {
  ComparisonDimension,
  ComparisonMover,
  ComparisonMovers,
  ComparisonQuality,
  ComparisonUsage,
  PeriodComparison,
  UsageGranularity
} from "../shared/dashboard.js";
import {
  addLocalDays,
  currentCalendarPeriod,
  previousCalendarPeriod
} from "./calendar-periods.js";

const GRANULARITIES: UsageGranularity[] = ["daily", "weekly", "monthly"];
const SOURCE_LABELS: Record<Source, string> = {
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
  antigravity: "Antigravity"
};

interface ContributorIdentity {
  key: string;
  label: string;
  fullLabel?: string;
}

function totalMetric(turn: NormalizedTurn): TokenMetric | undefined {
  return turn.metrics.find((metric) => metric.kind === "total");
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function timestampIn(turn: NormalizedTurn, start: Date, through: Date): boolean {
  const timestamp = new Date(turn.timestamp).valueOf();
  return timestamp >= start.valueOf() && timestamp <= through.valueOf();
}

function usageFor(turns: NormalizedTurn[]): ComparisonUsage {
  let tokens = 0;
  let usable = false;
  let hasEstimated = false;
  let hasIncomplete = false;

  for (const turn of turns) {
    const metric = totalMetric(turn);
    if (
      metric?.value == null
      || metric.quality === "partial"
      || metric.quality === "unavailable"
    ) {
      hasIncomplete = true;
      if (metric?.value != null) {
        tokens += metric.value;
        usable = true;
      }
      continue;
    }
    tokens += metric.value;
    usable = true;
    hasEstimated ||= metric.quality === "estimated";
  }

  if (!usable && turns.length > 0) {
    return { tokens: null, quality: "unavailable" };
  }
  return {
    tokens,
    quality: hasIncomplete
      ? "partial"
      : hasEstimated
        ? "estimated"
        : "exact"
  };
}

function comparisonQuality(
  current: ComparisonUsage,
  previous: ComparisonUsage
): ComparisonQuality {
  if (current.quality === "unavailable" || previous.quality === "unavailable") {
    return "unavailable";
  }
  if (current.quality === "partial" || previous.quality === "partial") {
    return "partial";
  }
  return current.quality === "estimated" || previous.quality === "estimated"
    ? "estimated"
    : "exact";
}

function matchedPreviousThrough(
  granularity: UsageGranularity,
  now: Date,
  previousStart: Date,
  previousNextStart: Date
): Date {
  let matched: Date;
  if (granularity === "daily") {
    matched = new Date(previousStart);
    matched.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  } else if (granularity === "weekly") {
    const dayOffset = (now.getDay() + 6) % 7;
    matched = addLocalDays(previousStart, dayOffset);
    matched.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  } else {
    const lastPreviousDay = new Date(
      previousNextStart.getFullYear(),
      previousNextStart.getMonth(),
      0
    ).getDate();
    if (now.getDate() > lastPreviousDay) {
      return new Date(previousNextStart.valueOf() - 1);
    }
    matched = new Date(
      previousStart.getFullYear(),
      previousStart.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getMilliseconds()
    );
  }
  return new Date(Math.min(matched.valueOf(), previousNextStart.valueOf() - 1));
}

function projectLabel(project: string | null): string {
  if (!project?.trim()) return "Unknown";
  return project.split(/[\\/]/u).filter(Boolean).at(-1) ?? project;
}

function identityFor(
  dimension: ComparisonDimension,
  turn: NormalizedTurn
): ContributorIdentity {
  if (dimension === "sources") {
    return { key: turn.source, label: SOURCE_LABELS[turn.source] };
  }
  if (dimension === "projects") {
    const fullLabel = turn.project?.trim() || undefined;
    return {
      key: fullLabel ?? "__unknown_project__",
      label: projectLabel(turn.project),
      fullLabel
    };
  }
  return {
    key: turn.model?.trim() || "__unknown_model__",
    label: turn.model?.trim() || "Unknown"
  };
}

function groupTurns(
  turns: NormalizedTurn[],
  dimension: ComparisonDimension
): Map<string, { identity: ContributorIdentity; turns: NormalizedTurn[] }> {
  const groups = new Map<string, { identity: ContributorIdentity; turns: NormalizedTurn[] }>();
  for (const turn of turns) {
    const identity = identityFor(dimension, turn);
    const group = groups.get(identity.key) ?? { identity, turns: [] };
    group.turns.push(turn);
    groups.set(identity.key, group);
  }
  return groups;
}

function buildMovers(
  currentTurns: NormalizedTurn[],
  previousTurns: NormalizedTurn[],
  dimension: ComparisonDimension
): ComparisonMovers {
  const currentGroups = groupTurns(currentTurns, dimension);
  const previousGroups = groupTurns(previousTurns, dimension);
  const keys = new Set([...currentGroups.keys(), ...previousGroups.keys()]);
  const increases: ComparisonMover[] = [];
  const decreases: ComparisonMover[] = [];
  let omittedCount = 0;

  for (const key of keys) {
    const currentGroup = currentGroups.get(key);
    const previousGroup = previousGroups.get(key);
    const identity = currentGroup?.identity ?? previousGroup!.identity;
    const current = usageFor(currentGroup?.turns ?? []);
    const previous = usageFor(previousGroup?.turns ?? []);
    const quality = comparisonQuality(current, previous);
    if (
      quality === "partial"
      || quality === "unavailable"
      || current.tokens == null
      || previous.tokens == null
    ) {
      omittedCount += 1;
      continue;
    }
    const delta = current.tokens - previous.tokens;
    if (delta === 0) continue;
    const mover: ComparisonMover = {
      ...identity,
      current,
      previous,
      delta,
      deltaPercent: previous.tokens > 0 ? (delta / previous.tokens) * 100 : null,
      quality,
      kind:
        previous.tokens === 0
          ? "new"
          : current.tokens === 0
            ? "stopped"
            : delta > 0
              ? "increase"
              : "decrease"
    };
    (delta > 0 ? increases : decreases).push(mover);
  }

  return {
    increases: increases.toSorted((left, right) =>
      right.delta - left.delta
      || compareCodePoints(left.label, right.label)
      || compareCodePoints(left.key, right.key)
    ).slice(0, 3),
    decreases: decreases.toSorted((left, right) =>
      left.delta - right.delta
      || compareCodePoints(left.label, right.label)
      || compareCodePoints(left.key, right.key)
    ).slice(0, 3),
    omittedCount
  };
}

export function buildPeriodComparison(
  turns: NormalizedTurn[],
  granularity: UsageGranularity,
  now = new Date()
): PeriodComparison {
  const currentPeriod = currentCalendarPeriod(granularity, now);
  const previousPeriod = previousCalendarPeriod(granularity, now);
  const previousThrough = matchedPreviousThrough(
    granularity,
    now,
    previousPeriod.start,
    previousPeriod.nextStart
  );
  const currentTurns = turns.filter((turn) => timestampIn(turn, currentPeriod.start, now));
  const previousTurns = turns.filter((turn) =>
    timestampIn(turn, previousPeriod.start, previousThrough)
  );
  const current = usageFor(currentTurns);
  const previous = usageFor(previousTurns);
  const quality = comparisonQuality(current, previous);
  const comparable =
    quality !== "partial"
    && quality !== "unavailable"
    && current.tokens != null
    && previous.tokens != null;
  const delta = comparable ? current.tokens! - previous.tokens! : null;
  const deltaPercent =
    delta != null && previous.tokens != null && previous.tokens > 0
      ? (delta / previous.tokens) * 100
      : null;
  const kind =
    delta == null
      ? "unavailable"
      : previous.tokens === 0 && current.tokens! > 0
        ? "new"
        : delta > 0
          ? "increase"
          : delta < 0
            ? "decrease"
            : "unchanged";

  return {
    currentStartDate: currentPeriod.startDate,
    currentThrough: now.toISOString(),
    previousStartDate: previousPeriod.startDate,
    previousThrough: previousThrough.toISOString(),
    current,
    previous,
    delta,
    deltaPercent,
    quality,
    kind,
    movers: {
      sources: buildMovers(currentTurns, previousTurns, "sources"),
      projects: buildMovers(currentTurns, previousTurns, "projects"),
      models: buildMovers(currentTurns, previousTurns, "models")
    }
  };
}

export function buildUsageComparisons(
  turns: NormalizedTurn[],
  now = new Date()
): Record<UsageGranularity, PeriodComparison> {
  return Object.fromEntries(
    GRANULARITIES.map((granularity) => [
      granularity,
      buildPeriodComparison(turns, granularity, now)
    ])
  ) as Record<UsageGranularity, PeriodComparison>;
}
