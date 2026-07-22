# Token Budget and Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local daily, weekly, and monthly token budgets with period contributor rankings and evidence-based unusually heavy turn detection.

**Architecture:** Extract the existing local-calendar logic into one reusable service, then build presentation-ready insights from normalized turns in the extension host. VS Code user configuration stores budgets; the provider validates save messages and republishes snapshots from the existing tracker store without importing. A focused React `UsageGuardrails` component renders the selected period and owns only editor presentation state.

**Tech Stack:** TypeScript, VS Code Extension API, React 19, Vitest, Testing Library, CSS, Playwright visual QA.

## Global Constraints

- All calculations and prompt data remain local; do not add network requests.
- Budgets measure tokens only. Do not add monetary cost conversion or provider pricing.
- Daily uses today, weekly uses Monday through Sunday, and monthly uses the local calendar month.
- Use local `Date` construction for calendar arithmetic; do not use fixed millisecond durations.
- Budget values are whole, non-negative safe integers; `0` disables the budget.
- Budget statuses are fixed: below 80% is `On track`, 80% through less than 100% is `Approaching limit`, and 100% or more is `Budget exceeded`.
- Budget totals and contributors include exact, estimated, and partial usable totals; partial values retain lower-bound presentation.
- Efficiency candidates and baselines include exact and estimated totals only; exclude partial and unavailable totals.
- A comparable baseline requires at least five samples; flag a turn at `1.5x` or more of its baseline median.
- Prefer same-source-and-model history, then fall back to same-source history.
- The baseline is the 30 completed local days immediately before the selected current period and never overlaps it.
- Show at most three contributors per group and five unusually heavy turns.
- Saving budgets updates VS Code global user configuration and republishes stored data without calling source adapters or the import coordinator.
- Do not add notifications, automatic blocking, custom thresholds, arbitrary date ranges, per-dimension budgets, or AI advice.
- Preserve the Today, Last 7 Days, All Time, Usage Over Time, Import Health, filters, turn table, and turn-details behavior.
- The current main worktree has uncommitted OpenCode import, version `0.3.0`, changelog, and scanner-test changes. Execution preflight must preserve them and must not create a feature worktree from a base that silently omits them. Because Task 3 modifies `package.json`, resolve that overlap explicitly before implementation; never use `git add .`.
- Do not modify or delete the untracked `graphify-out/` directory.

---

### Task 0: Preserve the approved OpenCode and 0.3.0 release work

**Files already modified before this feature:**
- `src/adapters/opencode-source.ts`
- `tests/adapters/scanners.test.ts`
- `.vscodeignore`
- `CHANGELOG.md`
- `package.json`
- `package-lock.json`

**Interfaces:**
- Consumes: the already-approved macOS/NVM OpenCode fix, WAL-safe snapshot import, aggregation release notes, and version `0.3.0` changes.
- Produces: two clean prerequisite commits so Task 3 can modify `package.json` without mixing unrelated changes.

- [ ] **Step 1: Reconfirm the prerequisite diff and exclusions**

```sh
git diff -- src/adapters/opencode-source.ts tests/adapters/scanners.test.ts .vscodeignore CHANGELOG.md package.json package-lock.json
git status --short
```

Expected: only the six listed files are tracked modifications; `.DS_Store`, this plan, and `graphify-out/` remain untracked. Do not stage `.DS_Store` or `graphify-out/`.

- [ ] **Step 2: Verify the already-approved work before preserving it**

```sh
npx vitest run tests/adapters/scanners.test.ts tests/services/dashboard.test.ts webview/src/App.test.tsx webview/src/Root.test.tsx
npm run typecheck
npm run package
```

Expected: OpenCode discovery/snapshot tests, aggregation tests, both TypeScript projects, and the production package build pass.

- [ ] **Step 3: Commit the OpenCode fix independently**

```sh
git add src/adapters/opencode-source.ts tests/adapters/scanners.test.ts
git commit -m "fix: improve OpenCode discovery on macOS"
```

- [ ] **Step 4: Commit the 0.3.0 release metadata independently**

```sh
git add .vscodeignore CHANGELOG.md package.json package-lock.json
git commit -m "chore: prepare version 0.3.0"
```

- [ ] **Step 5: Commit this approved implementation plan**

```sh
git add docs/superpowers/plans/2026-07-22-token-budget-insights.md
git commit -m "docs: plan token budget insights"
```

- [ ] **Step 6: Recheck the feature starting point**

```sh
git status --short
git log -2 --oneline
```

Expected: the prerequisite work and this plan are committed; only `.DS_Store` and `graphify-out/` remain untracked. Task 3 may now edit `package.json` without absorbing prior release changes.

---

### Task 1: Extract reusable local-calendar periods

**Files:**
- Create: `src/services/calendar-periods.ts`
- Create: `tests/services/calendar-periods.test.ts`
- Modify: `src/services/dashboard.ts:14-111,138-163`
- Test: `tests/services/dashboard.test.ts`

**Interfaces:**
- Consumes: `UsageGranularity` from `src/shared/dashboard.ts`.
- Produces: `CalendarPeriod`, `startOfLocalDay`, `addLocalDays`, `dateKey`, `currentCalendarPeriod`, and `calendarPeriods` for Tasks 2 and 3.

- [ ] **Step 1: Write failing calendar-period tests**

Create `tests/services/calendar-periods.test.ts` with deterministic local-time assertions:

```ts
import { afterEach, describe, expect, it } from "vitest";
import {
  addLocalDays,
  calendarPeriods,
  currentCalendarPeriod
} from "../../src/services/calendar-periods.js";

const originalTimezone = process.env.TZ;

afterEach(() => {
  if (originalTimezone == null) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

describe("calendar periods", () => {
  it("builds current daily, Monday-based weekly, and monthly periods", () => {
    const now = new Date(2026, 6, 22, 12);
    expect(currentCalendarPeriod("daily", now)).toMatchObject({
      startDate: "2026-07-22", endDate: "2026-07-22"
    });
    expect(currentCalendarPeriod("weekly", now)).toMatchObject({
      startDate: "2026-07-20", endDate: "2026-07-26"
    });
    expect(currentCalendarPeriod("monthly", now)).toMatchObject({
      startDate: "2026-07-01", endDate: "2026-07-31"
    });
  });

  it("returns ordered period collections including the current period", () => {
    const periods = calendarPeriods("weekly", 12, new Date(2026, 6, 22, 12));
    expect(periods).toHaveLength(12);
    expect(periods[0].start.valueOf()).toBeLessThan(periods[1].start.valueOf());
    expect(periods.at(-1)).toMatchObject({ startDate: "2026-07-20" });
  });

  it("reconstructs local day boundaries through midnight DST changes", () => {
    process.env.TZ = "America/Santiago";
    const transitionDay = new Date(2026, 8, 6);
    const nextDay = addLocalDays(transitionDay, 1);
    expect(nextDay.getFullYear()).toBe(2026);
    expect(nextDay.getMonth()).toBe(8);
    expect(nextDay.getDate()).toBe(7);
    expect(nextDay.getHours()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```sh
npx vitest run tests/services/calendar-periods.test.ts
```

Expected: FAIL because `src/services/calendar-periods.ts` does not exist.

- [ ] **Step 3: Implement the calendar service**

Create `src/services/calendar-periods.ts`:

```ts
import type { UsageGranularity } from "../shared/dashboard.js";

export interface CalendarPeriod {
  start: Date;
  nextStart: Date;
  startDate: string;
  endDate: string;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addLocalDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfPeriod(granularity: UsageGranularity, date: Date): Date {
  const day = startOfLocalDay(date);
  if (granularity === "daily") return day;
  if (granularity === "weekly") return addLocalDays(day, -((day.getDay() + 6) % 7));
  return new Date(day.getFullYear(), day.getMonth(), 1);
}

function shiftPeriod(granularity: UsageGranularity, start: Date, amount: number): Date {
  if (granularity === "daily") return addLocalDays(start, amount);
  if (granularity === "weekly") return addLocalDays(start, amount * 7);
  return new Date(start.getFullYear(), start.getMonth() + amount, 1);
}

function toCalendarPeriod(granularity: UsageGranularity, start: Date): CalendarPeriod {
  const nextStart = shiftPeriod(granularity, start, 1);
  return {
    start,
    nextStart,
    startDate: dateKey(start),
    endDate: dateKey(addLocalDays(nextStart, -1))
  };
}

export function currentCalendarPeriod(
  granularity: UsageGranularity,
  now = new Date()
): CalendarPeriod {
  return toCalendarPeriod(granularity, startOfPeriod(granularity, now));
}

export function calendarPeriods(
  granularity: UsageGranularity,
  count: number,
  now = new Date()
): CalendarPeriod[] {
  const currentStart = startOfPeriod(granularity, now);
  return Array.from({ length: count }, (_, index) =>
    toCalendarPeriod(granularity, shiftPeriod(granularity, currentStart, index - count + 1))
  );
}
```

- [ ] **Step 4: Refactor dashboard aggregation to consume the shared periods**

In `src/services/dashboard.ts`, remove its private `startOfDay`, `addDays`, `dateKey`, `CalendarBucket`, `startOfWeek`, `startOfMonth`, `addMonths`, and `makeBuckets`. Import:

```ts
import {
  addLocalDays,
  calendarPeriods,
  startOfLocalDay,
  type CalendarPeriod
} from "./calendar-periods.js";
```

Change `buildTrend` to accept `CalendarPeriod[]`, use `period.startDate` and `period.endDate`, and build trends exactly as follows:

```ts
const trends = {
  daily: buildTrend(turns, calendarPeriods("daily", 14, now)),
  weekly: buildTrend(turns, calendarPeriods("weekly", 12, now)),
  monthly: buildTrend(turns, calendarPeriods("monthly", 12, now))
};
```

Use `startOfLocalDay(now)` for today and `addLocalDays(today, -6)` for the seven-day summary boundary. Preserve inclusive-start/exclusive-next-start assignment and all current null/partial behavior.

- [ ] **Step 5: Run focused and regression tests**

Run:

```sh
npx vitest run tests/services/calendar-periods.test.ts tests/services/dashboard.test.ts
npm run typecheck
```

Expected: both files pass, including existing Santiago DST tests, and both TypeScript projects report no errors.

- [ ] **Step 6: Commit the calendar foundation**

```sh
git add src/services/calendar-periods.ts tests/services/calendar-periods.test.ts src/services/dashboard.ts tests/services/dashboard.test.ts
git commit -m "refactor: share local calendar periods"
```

---

### Task 2: Calculate contributor and efficiency insights

**Files:**
- Modify: `src/shared/dashboard.ts:11-33`
- Create: `src/services/usage-insights.ts`
- Create: `tests/services/usage-insights.test.ts`

**Interfaces:**
- Consumes: `currentCalendarPeriod` and `addLocalDays` from Task 1; normalized turns and total metrics.
- Produces: `buildUsageInsights(turns, now): Record<UsageGranularity, PeriodInsights>` and the shared insight types used by Tasks 3-5.

- [ ] **Step 1: Add shared presentation-ready insight contracts**

Add these contracts to `src/shared/dashboard.ts` without changing `DashboardSnapshot` yet:

```ts
export interface UsageBudgets {
  daily: number;
  weekly: number;
  monthly: number;
}

export const ZERO_USAGE_BUDGETS: UsageBudgets = { daily: 0, weekly: 0, monthly: 0 };

export interface RankedContributor {
  key: string;
  label: string;
  fullLabel?: string;
  tokens: number;
  share: number;
  partial: boolean;
}

export interface HeavyTurnInsight {
  turnId: string;
  prompt: string;
  source: Source;
  model: string;
  project: string;
  total: number;
  quality: "exact" | "estimated";
  baselineMedian: number;
  multiplier: number;
  baselineScope: "source-model" | "source";
}

export interface PeriodInsights {
  startDate: string;
  endDate: string;
  total: number;
  partial: boolean;
  contributors: {
    sources: RankedContributor[];
    projects: RankedContributor[];
    models: RankedContributor[];
  };
  heavyTurns: HeavyTurnInsight[];
  hasComparableHistory: boolean;
}
```

`share` is a fraction from `0` through `1`; the webview multiplies it by 100 for display.

- [ ] **Step 2: Write failing insight tests**

Create `tests/services/usage-insights.test.ts` with these imports and fixture:

```ts
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
  quality: MeasurementQuality
): NormalizedTurn {
  return {
    id,
    source,
    sourceSessionId: `session-${id}`,
    sourceTurnId: id,
    timestamp: timestamp.toISOString(),
    model,
    provider: null,
    project,
    prompt: `Prompt ${id}`,
    response: "",
    toolEventCount: 0,
    metrics: [{
      kind: "total",
      value: quality === "unavailable" ? null : total,
      quality,
      basis: "fixture"
    }],
    fingerprint: id
  };
}
```

Add these explicit cases:

```ts
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
    { label: "Antigravity", tokens: 100 }
  ]);
  expect(insights.contributors.models[0].share).toBeCloseTo(0.6);
  expect(insights.contributors.models.some((item) => item.label === "Unknown")).toBe(true);
  expect(insights.contributors.projects.find((item) => item.label === "app")?.fullLabel).toBe("/work/app");
});
```

```ts
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
```

Add these concrete boundary assertions using the same `turn` fixture:

```ts
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
```

Add this deterministic fixture and non-overlap test in the same test file:

```ts
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
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

```sh
npx vitest run tests/services/usage-insights.test.ts
```

Expected: FAIL because `buildUsageInsights` does not exist.

- [ ] **Step 4: Implement the insight engine**

Create `src/services/usage-insights.ts` with these exported and internal boundaries:

```ts
import type { MeasurementQuality, NormalizedTurn, Source, TokenMetric } from "../domain/types.js";
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
```

Add the contributor helper exactly as follows:

```ts
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
```

Add the heavy-turn helper with explicit cohort and sorting rules:

```ts
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
```

Complete the public function with non-overlapping current and baseline windows:

```ts
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
```

- [ ] **Step 5: Run focused tests and typecheck**

```sh
npx vitest run tests/services/usage-insights.test.ts
npm run typecheck
```

Expected: all insight tests pass and both TypeScript projects report no errors.

- [ ] **Step 6: Commit the insight engine**

```sh
git add src/shared/dashboard.ts src/services/usage-insights.ts tests/services/usage-insights.test.ts
git commit -m "feat: calculate usage guardrail insights"
```

---

### Task 3: Integrate budget settings, snapshots, and trusted messages

**Files:**
- Create: `src/services/usage-budgets.ts`
- Create: `tests/services/usage-budgets.test.ts`
- Create: `src/webview/messages.ts`
- Create: `tests/webview/messages.test.ts`
- Modify: `src/shared/dashboard.ts:23-43`
- Modify: `src/services/dashboard.ts:138-163`
- Modify: `tests/services/dashboard.test.ts`
- Modify: `src/webview/provider.ts:3-113`
- Modify: `src/extension.ts:41-221`
- Modify: `tests/extension-config.test.ts`
- Modify: `package.json:94-154`
- Modify: `webview/src/App.test.tsx:38-81`
- Modify: `webview/src/Root.test.tsx:8-28`

**Interfaces:**
- Consumes: `UsageBudgets`, `buildUsageInsights`, and existing tracker-store reads.
- Produces: snapshots containing `budgets` and `insights`; validated `setBudgets` commands; `budgetsSaved` and `budgetError` extension messages consumed by Task 4.

- [ ] **Step 1: Write failing budget validation and message parser tests**

Create `tests/services/usage-budgets.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  readUsageBudgets,
  saveUsageBudgets,
  validateUsageBudgets
} from "../../src/services/usage-budgets.js";

it("validates whole non-negative safe integers", () => {
  expect(validateUsageBudgets({ daily: 10, weekly: 20, monthly: 0 })).toEqual({
    daily: 10, weekly: 20, monthly: 0
  });
  for (const daily of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "10", null]) {
    expect(() => validateUsageBudgets({ daily, weekly: 20, monthly: 30 })).toThrow(
      "Budgets must be whole, non-negative safe integers."
    );
  }
});

it("reads malformed configuration values as disabled", () => {
  const values = new Map<string, unknown>([
    ["budgets.daily", -1], ["budgets.weekly", 25], ["budgets.monthly", 1.5]
  ]);
  expect(readUsageBudgets({ get: (key, fallback) => values.get(key) ?? fallback })).toEqual({
    daily: 0, weekly: 25, monthly: 0
  });
});

it("writes all three budget settings", async () => {
  const update = vi.fn(async () => undefined);
  await saveUsageBudgets({ daily: 10, weekly: 20, monthly: 30 }, update);
  expect(update.mock.calls).toEqual([
    ["budgets.daily", 10], ["budgets.weekly", 20], ["budgets.monthly", 30]
  ]);
});
```

Create `tests/webview/messages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../../src/webview/messages.js";

describe("parseWebviewMessage", () => {
  it.each(["refresh", "ready", "deleteAll", "rebuild"] as const)(
    "accepts %s",
    (type) => expect(parseWebviewMessage({ type })).toEqual({ type })
  );

  it("accepts valid budgets", () => {
    expect(parseWebviewMessage({
      type: "setBudgets",
      budgets: { daily: 10, weekly: 20, monthly: 30 }
    })).toEqual({ type: "setBudgets", budgets: { daily: 10, weekly: 20, monthly: 30 } });
  });

  it.each([
    null,
    {},
    { type: "unknown" },
    { type: "setBudgets" },
    { type: "setBudgets", budgets: { daily: -1, weekly: 20, monthly: 30 } }
  ])("rejects untrusted payload %#", (value) => {
    expect(parseWebviewMessage(value)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

```sh
npx vitest run tests/services/usage-budgets.test.ts tests/webview/messages.test.ts
```

Expected: FAIL because both production modules are missing.

- [ ] **Step 3: Implement pure budget and message boundaries**

Create `src/services/usage-budgets.ts`:

```ts
import type { UsageBudgets } from "../shared/dashboard.js";

const MESSAGE = "Budgets must be whole, non-negative safe integers.";
const entries: Array<[keyof UsageBudgets, string]> = [
  ["daily", "budgets.daily"],
  ["weekly", "budgets.weekly"],
  ["monthly", "budgets.monthly"]
];

function valid(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validateUsageBudgets(value: unknown): UsageBudgets {
  if (!value || typeof value !== "object") throw new Error(MESSAGE);
  const candidate = value as Record<string, unknown>;
  if (!valid(candidate.daily) || !valid(candidate.weekly) || !valid(candidate.monthly)) {
    throw new Error(MESSAGE);
  }
  return { daily: candidate.daily, weekly: candidate.weekly, monthly: candidate.monthly };
}

export function readUsageBudgets(configuration: {
  get<T>(key: string, fallback: T): T;
}): UsageBudgets {
  return Object.fromEntries(entries.map(([name, key]) => {
    const value = configuration.get<unknown>(key, 0);
    return [name, valid(value) ? value : 0];
  })) as unknown as UsageBudgets;
}

export async function saveUsageBudgets(
  budgets: UsageBudgets,
  update: (key: string, value: number) => Promise<void>
): Promise<void> {
  const validBudgets = validateUsageBudgets(budgets);
  for (const [name, key] of entries) await update(key, validBudgets[name]);
}
```

Change `WebviewMessage` to a discriminated union and `ExtensionMessage` to explicit variants in `src/shared/dashboard.ts`:

```ts
export type WebviewMessage =
  | { type: "refresh" | "ready" | "deleteAll" | "rebuild" }
  | { type: "setBudgets"; budgets: UsageBudgets };

export type ExtensionMessage =
  | { type: "snapshot"; snapshot: DashboardSnapshot }
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "budgetsSaved" }
  | { type: "budgetError"; message: string };
```

Create `src/webview/messages.ts`:

```ts
import type { WebviewMessage } from "../shared/dashboard.js";
import { validateUsageBudgets } from "../services/usage-budgets.js";

const ACTIONS = new Set(["refresh", "ready", "deleteAll", "rebuild"]);

export function parseWebviewMessage(value: unknown): WebviewMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== "string") return null;
  if (ACTIONS.has(candidate.type)) {
    return { type: candidate.type as "refresh" | "ready" | "deleteAll" | "rebuild" };
  }
  if (candidate.type !== "setBudgets") return null;
  try {
    return { type: "setBudgets", budgets: validateUsageBudgets(candidate.budgets) };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Add budget settings to the extension manifest**

Add these three entries under `contributes.configuration.properties` in `package.json`:

```json
"tokenUsage.budgets.daily": {
  "type": "number",
  "default": 0,
  "minimum": 0,
  "description": "Daily token budget. Set to 0 to disable."
},
"tokenUsage.budgets.weekly": {
  "type": "number",
  "default": 0,
  "minimum": 0,
  "description": "Monday-Sunday token budget. Set to 0 to disable."
},
"tokenUsage.budgets.monthly": {
  "type": "number",
  "default": 0,
  "minimum": 0,
  "description": "Calendar-month token budget. Set to 0 to disable."
}
```

Add this case to `tests/extension-config.test.ts` (extend the local property type with `type?: string`):

```ts
it("contributes disabled-by-default token budget settings", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    contributes: { configuration: { properties: Record<string, unknown> } };
  };
  const properties = manifest.contributes.configuration.properties;

  for (const key of ["daily", "weekly", "monthly"]) {
    expect(properties[`tokenUsage.budgets.${key}`]).toMatchObject({
      type: "number",
      default: 0,
      minimum: 0
    });
  }
});
```

- [ ] **Step 5: Extend snapshots without breaking the existing date argument**

Add required `budgets` and `insights` fields to `DashboardSnapshot`. Preserve the current third `now` argument and add budgets fourth:

```ts
export function buildDashboardSnapshot(
  turns: NormalizedTurn[],
  health: SourceHealth[],
  now = new Date(),
  budgets: UsageBudgets = ZERO_USAGE_BUDGETS
): DashboardSnapshot
```

Return `budgets` and `insights: buildUsageInsights(turns, now)`. Add this dashboard service case:

```ts
it("includes validated budgets and current-period insights", () => {
  const snapshot = buildDashboardSnapshot(
    [turn("today", localTimestamp(2026, 6, 22, 9), "codex", 250, "exact")],
    [],
    new Date(2026, 6, 22, 12),
    { daily: 1_000, weekly: 5_000, monthly: 20_000 }
  );

  expect(snapshot.budgets).toEqual({ daily: 1_000, weekly: 5_000, monthly: 20_000 });
  expect(snapshot.insights.daily).toMatchObject({
    startDate: "2026-07-22",
    endDate: "2026-07-22",
    total: 250,
    partial: false
  });
});
```

Add the following required fields to both typed dashboard fixtures in `webview/src/App.test.tsx` and `webview/src/Root.test.tsx`, changing the dates to match each fixture's trend periods:

```ts
budgets: { daily: 0, weekly: 0, monthly: 0 },
insights: {
  daily: emptyInsights("2026-07-22", "2026-07-22"),
  weekly: emptyInsights("2026-07-20", "2026-07-26"),
  monthly: emptyInsights("2026-07-01", "2026-07-31")
},
```

Define this test helper above each fixture:

```ts
function emptyInsights(startDate: string, endDate: string): PeriodInsights {
  return {
    startDate,
    endDate,
    total: 0,
    partial: false,
    contributors: { sources: [], projects: [], models: [] },
    heavyTurns: [],
    hasComparableHistory: false
  };
}
```

Import `PeriodInsights` from the shared dashboard module in each test.

- [ ] **Step 6: Route only validated provider messages**

In `src/webview/provider.ts`, replace the string `WebviewAction` callback with `(message: WebviewMessage) => void | Promise<void>`, parse the raw payload with `parseWebviewMessage`, and ignore `null` results. Add public methods:

```ts
webview.onDidReceiveMessage((value: unknown) => {
  const message = parseWebviewMessage(value);
  if (message) void this.onAction(message);
});

budgetsSaved(): void {
  this.broadcast({ type: "budgetsSaved" });
}

setBudgetError(message: string): void {
  this.broadcast({ type: "budgetError", message });
}
```

Do not reuse `setError` for budget failures because it replaces the entire dashboard in `Root`.

- [ ] **Step 7: Read, save, and republish budgets without importing**

In `src/extension.ts`, import `WebviewMessage`, `readUsageBudgets`, and `saveUsageBudgets`; remove the `WebviewAction` import. Read budgets inside every `publishSnapshot` call and preserve the existing date default:

```ts
const snapshot = buildDashboardSnapshot(
  await store.getTurns(),
  await store.getHealth(),
  new Date(),
  readUsageBudgets(configuration)
);
```

Replace `handleWebviewAction` with this discriminated handler:

```ts
const handleWebviewAction = async (message: WebviewMessage): Promise<void> => {
  if (message.type === "ready") {
    await publishSnapshot();
  } else if (message.type === "refresh") {
    await refresh();
  } else if (message.type === "rebuild") {
    await store.clear();
    await refresh();
  } else if (message.type === "deleteAll") {
    await store.clear();
    await publishSnapshot();
  } else if (message.type === "setBudgets") {
    try {
      await saveUsageBudgets(message.budgets, async (key, value) => {
        await configuration.update(key, value, vscode.ConfigurationTarget.Global);
      });
      await publishSnapshot();
      provider.budgetsSaved();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      output.appendLine(`[${new Date().toISOString()}] Budget save failed: ${errorMessage}`);
      provider.setBudgetError(errorMessage);
    }
  }
};
```

Add this disposable to the main `context.subscriptions.push(...)` call:

```ts
vscode.workspace.onDidChangeConfiguration((event) => {
  const budgetChanged = [
    "tokenUsage.budgets.daily",
    "tokenUsage.budgets.weekly",
    "tokenUsage.budgets.monthly"
  ].some((key) => event.affectsConfiguration(key));
  if (budgetChanged) void publishSnapshot();
}),
```

The save catch calls only `setBudgetError`, while the configuration listener calls only `publishSnapshot`; neither path calls `refresh()` or `coordinator.refresh()`.

Add this source-structure case to `tests/extension-config.test.ts`:

```ts
it("republishes budget changes without importing source history", async () => {
  const source = await readFile("src/extension.ts", "utf8");
  const branchStart = source.indexOf('message.type === "setBudgets"');
  const branchEnd = source.indexOf("provider = new DashboardWebviewProvider", branchStart);
  const budgetBranch = source.slice(branchStart, branchEnd);
  const listenerStart = source.indexOf("onDidChangeConfiguration");
  const listenerEnd = source.indexOf("),", listenerStart) + 2;
  const listener = source.slice(listenerStart, listenerEnd);

  expect(branchStart).toBeGreaterThan(-1);
  expect(budgetBranch).toContain("saveUsageBudgets");
  expect(budgetBranch).toContain("provider.budgetsSaved()");
  expect(budgetBranch).toContain("provider.setBudgetError(errorMessage)");
  expect(budgetBranch).not.toContain("coordinator.refresh");
  expect(listener).toContain("publishSnapshot()");
  expect(listener).not.toContain("refresh()");
});
```

- [ ] **Step 8: Run backend integration verification**

```sh
npx vitest run tests/services/usage-budgets.test.ts tests/webview/messages.test.ts tests/services/dashboard.test.ts tests/extension-config.test.ts
npm run typecheck
npm test
```

Expected: all focused tests and the full suite pass; both TypeScript projects report no errors.

- [ ] **Step 9: Commit the backend integration with exact staging**

```sh
git add package.json src/shared/dashboard.ts src/services/usage-budgets.ts src/services/dashboard.ts src/webview/messages.ts src/webview/provider.ts src/extension.ts tests/services/usage-budgets.test.ts tests/services/dashboard.test.ts tests/webview/messages.test.ts tests/extension-config.test.ts webview/src/App.test.tsx webview/src/Root.test.tsx
git commit -m "feat: persist token budgets"
```

---

### Task 4: Build the Usage Guardrails panel and save lifecycle

**Files:**
- Create: `webview/src/UsageGuardrails.tsx`
- Create: `webview/src/UsageGuardrails.test.tsx`
- Modify: `webview/src/App.tsx:21-36,490-515`
- Modify: `webview/src/App.test.tsx`
- Modify: `webview/src/Root.tsx:17-80`
- Modify: `webview/src/Root.test.tsx`
- Modify: `webview/src/styles.css:104-420,759-800`

**Interfaces:**
- Consumes: `snapshot.budgets`, `snapshot.insights[usageGranularity]`, `budgetsSaved`, and `budgetError`.
- Produces: one `setBudgets` message with validated values and a responsive, accessible Usage Guardrails panel.

- [ ] **Step 1: Write failing panel tests for budget states and insights**

Create `webview/src/UsageGuardrails.test.tsx` with this harness:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PeriodInsights } from "../../src/shared/dashboard.js";
import { UsageGuardrails, type UsageGuardrailsProps } from "./UsageGuardrails.js";

const baseInsights: PeriodInsights = {
  startDate: "2026-07-22",
  endDate: "2026-07-22",
  total: 800,
  partial: false,
  contributors: {
    sources: [{ key: "codex", label: "Codex", tokens: 800, share: 1, partial: false }],
    projects: [{ key: "/work/app", label: "app", fullLabel: "/work/app", tokens: 800, share: 1, partial: false }],
    models: [{ key: "gpt-5", label: "gpt-5", tokens: 800, share: 1, partial: false }]
  },
  heavyTurns: [{
    turnId: "heavy",
    prompt: "Investigate import health",
    source: "codex",
    model: "gpt-5",
    project: "/work/app",
    total: 230,
    quality: "exact",
    baselineMedian: 100,
    multiplier: 2.3,
    baselineScope: "source-model"
  }],
  hasComparableHistory: true
};

afterEach(cleanup);

function renderGuardrails(options: {
  budget?: number;
  used?: number;
  partial?: boolean;
  insights?: Partial<PeriodInsights>;
  props?: Partial<UsageGuardrailsProps>;
} = {}) {
  const onSave = vi.fn();
  const onSaveSettled = vi.fn();
  const props: UsageGuardrailsProps = {
    granularity: "daily",
    budgets: { daily: options.budget ?? 1_000, weekly: 5_000, monthly: 20_000 },
    insights: {
      ...baseInsights,
      total: options.used ?? baseInsights.total,
      partial: options.partial ?? baseInsights.partial,
      ...options.insights
    },
    saveState: "idle",
    saveError: null,
    onSave,
    onSaveSettled,
    ...options.props
  };
  return { ...render(<UsageGuardrails {...props} />), props, onSave, onSaveSettled };
}
```

Add these assertions:

```tsx
it.each([
  [79, "On track"],
  [80, "Approaching limit"],
  [99, "Approaching limit"],
  [100, "Budget exceeded"]
])("maps %s percent to %s", (used, status) => {
  renderGuardrails({ budget: 100, used });
  expect(screen.getByText(status)).toBeInTheDocument();
});

it("shows lower-bound budget usage, contributor paths, and heavy turn evidence", () => {
  renderGuardrails({ partial: true });
  expect(screen.getByText(/≥800/u)).toBeInTheDocument();
  expect(screen.getByText("Partial data")).toBeInTheDocument();
  expect(screen.getByText("app")).toHaveAttribute("title", "/work/app");
  expect(screen.getByText("2.3× your recent median")).toBeInTheDocument();
  expect(screen.getByText("Same source and model")).toBeInTheDocument();
});
```

Add tests for disabled budget, zero remaining after exceeding, empty contributors, `Not enough history yet`, and `No unusually heavy turns in this period`.

```tsx
it("keeps contributors visible when the budget is disabled", () => {
  renderGuardrails({ budget: 0 });
  expect(screen.getByText("No budget set")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Set token budget" })).toBeInTheDocument();
  expect(screen.getByText("Codex")).toBeInTheDocument();
});

it("floors remaining tokens at zero after exceeding", () => {
  renderGuardrails({ budget: 100, used: 125 });
  const remaining = screen.getByText("Remaining").parentElement!;
  expect(within(remaining).getByText("0")).toBeInTheDocument();
});

it("renders contributor and heavy-turn empty states", () => {
  const { rerender, props } = renderGuardrails({
    insights: {
      contributors: { sources: [], projects: [], models: [] },
      heavyTurns: [],
      hasComparableHistory: false
    }
  });
  expect(screen.getAllByText("No usage in this period")).toHaveLength(3);
  expect(screen.getByText("Not enough history yet")).toBeInTheDocument();

  rerender(<UsageGuardrails {...props} insights={{
    ...props.insights,
    contributors: { sources: [], projects: [], models: [] },
    heavyTurns: [],
    hasComparableHistory: true
  }} />);
  expect(screen.getByText("No unusually heavy turns in this period")).toBeInTheDocument();
});
```

- [ ] **Step 2: Write failing editor tests**

Add the complete editor lifecycle cases:

```tsx
it("opens initialized inputs, normalizes blank, and saves all budgets once", () => {
  const { onSave } = renderGuardrails();
  fireEvent.click(screen.getByRole("button", { name: "Edit budgets" }));
  expect(screen.getByLabelText("Daily")).toHaveValue("1000");
  expect(screen.getByLabelText("Weekly")).toHaveValue("5000");
  expect(screen.getByLabelText("Monthly")).toHaveValue("20000");
  fireEvent.change(screen.getByLabelText("Daily"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Weekly"), { target: { value: "2500" } });
  fireEvent.change(screen.getByLabelText("Monthly"), { target: { value: "9000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSave).toHaveBeenCalledOnce();
  expect(onSave).toHaveBeenCalledWith({ daily: 0, weekly: 2_500, monthly: 9_000 });
});

it.each(["-1", "1.5", "abc", String(Number.MAX_SAFE_INTEGER + 1)])(
  "rejects invalid editor value %s",
  (value) => {
    const { onSave } = renderGuardrails();
    fireEvent.click(screen.getByRole("button", { name: "Edit budgets" }));
    fireEvent.change(screen.getByLabelText("Daily"), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter a whole, non-negative number.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  }
);

it("cancels edits and restores saved values on reopen", () => {
  renderGuardrails();
  fireEvent.click(screen.getByRole("button", { name: "Edit budgets" }));
  fireEvent.change(screen.getByLabelText("Daily"), { target: { value: "77" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByLabelText("Daily")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit budgets" }));
  expect(screen.getByLabelText("Daily")).toHaveValue("1000");
});

it("disables Save while saving and preserves edits after an error", () => {
  const view = renderGuardrails();
  fireEvent.click(screen.getByRole("button", { name: "Edit budgets" }));
  fireEvent.change(screen.getByLabelText("Daily"), { target: { value: "77" } });
  view.rerender(<UsageGuardrails {...view.props} saveState="saving" />);
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  view.rerender(<UsageGuardrails {...view.props} saveState="error" saveError="Could not save budgets" />);
  expect(screen.getByRole("alert")).toHaveTextContent("Could not save budgets");
  expect(screen.getByLabelText("Daily")).toHaveValue("77");
});

it("closes and settles only after the saved acknowledgement", () => {
  const view = renderGuardrails();
  fireEvent.click(screen.getByRole("button", { name: "Edit budgets" }));
  view.rerender(<UsageGuardrails {...view.props} saveState="saved" />);
  expect(screen.queryByLabelText("Daily")).not.toBeInTheDocument();
  expect(view.onSaveSettled).toHaveBeenCalledOnce();
});
```

- [ ] **Step 3: Run the focused test and confirm RED**

```sh
npx vitest run webview/src/UsageGuardrails.test.tsx
```

Expected: FAIL because `UsageGuardrails.tsx` does not exist.

- [ ] **Step 4: Implement the focused panel component**

Create `webview/src/UsageGuardrails.tsx` with:

```ts
export type BudgetSaveState = "idle" | "saving" | "saved" | "error";

export interface UsageGuardrailsProps {
  granularity: UsageGranularity;
  budgets: UsageBudgets;
  insights: PeriodInsights;
  saveState: BudgetSaveState;
  saveError: string | null;
  onSave: (budgets: UsageBudgets) => void;
  onSaveSettled: () => void;
}
```

Implement these exact pure rules in the component module:

```ts
function budgetStatus(used: number, budget: number) {
  if (budget === 0) return { label: "No budget set", className: "disabled" };
  const percent = (used / budget) * 100;
  if (percent >= 100) return { label: "Budget exceeded", className: "exceeded" };
  if (percent >= 80) return { label: "Approaching limit", className: "approaching" };
  return { label: "On track", className: "on-track" };
}

function parseBudget(value: string): number | null {
  if (value.trim() === "") return 0;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
```

Use this component structure so the approved content and save lifecycle are explicit:

```tsx
import { useCallback, useEffect, useState } from "react";
import type {
  PeriodInsights,
  RankedContributor,
  UsageBudgets,
  UsageGranularity
} from "../../src/shared/dashboard.js";

const periodLabels: Record<UsageGranularity, string> = {
  daily: "Daily", weekly: "Weekly", monthly: "Monthly"
};
const sourceLabels = { codex: "Codex", opencode: "OpenCode", antigravity: "Antigravity" };
const budgetKeys: Array<keyof UsageBudgets> = ["daily", "weekly", "monthly"];
const numberFormatter = new Intl.NumberFormat();

function ContributorGroup({ title, items }: { title: string; items: RankedContributor[] }) {
  return (
    <div className="contributor-group">
      <h3>{title}</h3>
      {items.length === 0 ? <p className="empty-copy">No usage in this period</p> : (
        <ol>{items.map((item) => (
          <li key={item.key}>
            <span
              title={item.fullLabel}
              aria-label={item.fullLabel ? `${item.label}: ${item.fullLabel}` : undefined}
            >{item.label}</span>
            <span>
              {item.partial ? "≥" : ""}{numberFormatter.format(item.tokens)}
              {" · "}{(item.share * 100).toFixed(1)}%
            </span>
          </li>
        ))}</ol>
      )}
    </div>
  );
}

export function UsageGuardrails({
  granularity, budgets, insights, saveState, saveError, onSave, onSaveSettled
}: UsageGuardrailsProps) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<keyof UsageBudgets, string>>({
    daily: String(budgets.daily),
    weekly: String(budgets.weekly),
    monthly: String(budgets.monthly)
  });
  const [errors, setErrors] = useState<Partial<Record<keyof UsageBudgets, string>>>({});
  const budget = budgets[granularity];
  const status = budgetStatus(insights.total, budget);
  const percent = budget === 0 ? 0 : (insights.total / budget) * 100;
  const remaining = Math.max(0, budget - insights.total);

  const resetEditor = useCallback(() => {
    setValues({
      daily: String(budgets.daily),
      weekly: String(budgets.weekly),
      monthly: String(budgets.monthly)
    });
    setErrors({});
  }, [budgets.daily, budgets.weekly, budgets.monthly]);

  useEffect(() => {
    if (saveState !== "saved") return;
    resetEditor();
    setEditing(false);
    onSaveSettled();
  }, [saveState, resetEditor, onSaveSettled]);

  const submit = () => {
    const parsed = Object.fromEntries(
      budgetKeys.map((key) => [key, parseBudget(values[key])])
    ) as Record<keyof UsageBudgets, number | null>;
    const nextErrors = Object.fromEntries(
      budgetKeys
        .filter((key) => parsed[key] == null)
        .map((key) => [key, "Enter a whole, non-negative number."])
    ) as Partial<Record<keyof UsageBudgets, string>>;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSave(parsed as UsageBudgets);
  };

  return (
    <section className="guardrails-panel" aria-labelledby="usage-guardrails-heading">
      <div className="guardrails-heading">
        <div>
          <h2 id="usage-guardrails-heading">Usage Guardrails</h2>
          <p>{periodLabels[granularity]} period ending {insights.endDate}</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => {
          resetEditor();
          setEditing(true);
        }}>
          {budget === 0 ? "Set token budget" : "Edit budgets"}
        </button>
      </div>

      <div className="guardrail-budget">
        <div><span>Used</span><strong>{insights.partial ? "≥" : ""}{numberFormatter.format(insights.total)}</strong></div>
        <div><span>Limit</span><strong>{budget === 0 ? "Disabled" : numberFormatter.format(budget)}</strong></div>
        <div><span>Remaining</span><strong>{budget === 0 ? "—" : numberFormatter.format(remaining)}</strong></div>
        <div><span>Usage</span><strong>{budget === 0 ? "—" : `${percent.toFixed(1)}%`}</strong></div>
        <p className={`budget-status ${status.className}`}>{status.label}</p>
        {insights.partial && <span className="partial-badge">Partial data</span>}
        <progress className="budget-progress" max="100" value={Math.min(percent, 100)}>
          {Math.min(percent, 100)}%
        </progress>
      </div>

      {editing && (
        <div className="budget-editor">
          {budgetKeys.map((key) => (
            <label key={key}>
              <span>{periodLabels[key]}</span>
              <input
                inputMode="numeric"
                value={values[key]}
                aria-invalid={Boolean(errors[key])}
                onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
              />
              {errors[key] && <small role="alert">{errors[key]}</small>}
            </label>
          ))}
          {saveError && <p className="budget-save-error" role="alert">{saveError}</p>}
          <div className="budget-editor-actions">
            <button className="secondary-button budget-save" type="button" disabled={saveState === "saving"} onClick={submit}>
              {saveState === "saving" ? "Saving…" : "Save"}
            </button>
            <button className="secondary-button" type="button" onClick={() => {
              resetEditor();
              setEditing(false);
            }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="contributors-grid">
        <ContributorGroup title="Sources" items={insights.contributors.sources} />
        <ContributorGroup title="Projects" items={insights.contributors.projects} />
        <ContributorGroup title="Models" items={insights.contributors.models} />
      </div>

      <div className="heavy-turns">
        <h3>Unusually Heavy Turns</h3>
        {insights.heavyTurns.length === 0 ? (
          <p className="empty-copy">
            {insights.hasComparableHistory
              ? "No unusually heavy turns in this period"
              : "Not enough history yet"}
          </p>
        ) : (
          <ol className="heavy-turn-list">{insights.heavyTurns.map((turn) => (
            <li key={turn.turnId}>
              <strong>{turn.prompt.trim() || "Prompt unavailable"}</strong>
              <span>{sourceLabels[turn.source]} · {turn.model} · {turn.project}</span>
              <span className={turn.quality === "estimated" ? "estimated" : undefined}>
                {numberFormatter.format(turn.total)} tokens
                {turn.quality === "estimated" ? " (estimated)" : ""}
                {" · "}{turn.multiplier.toFixed(1)}× your recent median
              </span>
              <small>{turn.baselineScope === "source-model" ? "Same source and model" : "Same source"}</small>
            </li>
          ))}</ol>
        )}
      </div>
    </section>
  );
}
```

The only effect-triggered reset is the `saveState === "saved"` acknowledgement; `budgetError` keeps the entered strings intact.

- [ ] **Step 5: Wire the save acknowledgement in Root**

Add Root state:

```ts
const [budgetSaveState, setBudgetSaveState] = useState<BudgetSaveState>("idle");
const [budgetSaveError, setBudgetSaveError] = useState<string | null>(null);
```

In the message listener, preserve the existing snapshot/loading/fatal-error branches and add:

```ts
} else if (event.data.type === "budgetsSaved") {
  setBudgetSaveState("saved");
  setBudgetSaveError(null);
} else if (event.data.type === "budgetError") {
  setBudgetSaveState("error");
  setBudgetSaveError(event.data.message);
}
```

Add the send and settlement callbacks:

```ts
const saveBudgets = (budgets: UsageBudgets) => {
  setBudgetSaveState("saving");
  setBudgetSaveError(null);
  vscode?.postMessage({ type: "setBudgets", budgets });
};

const settleBudgetSave = () => setBudgetSaveState("idle");
```

Pass `budgetSaveState`, `budgetSaveError`, `saveBudgets`, and `settleBudgetSave` to `App`. Extend `Root.test.tsx` to deliver both response messages and prove:

- Save posts exactly one `setBudgets` message and no refresh.
- `budgetError` leaves the dashboard and editor visible with entered values.
- `budgetsSaved` closes the editor after the updated snapshot arrives.
- Existing fatal `error` still uses the full-page error state.

- [ ] **Step 6: Render Guardrails from App without altering table filters**

Extend `AppProps` with the save props and render:

```tsx
<UsageGuardrails
  granularity={usageGranularity}
  budgets={snapshot.budgets}
  insights={snapshot.insights[usageGranularity]}
  saveState={budgetSaveState}
  saveError={budgetSaveError}
  onSave={onSaveBudgets}
  onSaveSettled={onBudgetSaveSettled}
/>
```

Place it after `.analytics-grid` and before `.workspace`. Do not connect contributor rows to existing filter state. Update the App harness and fixtures for the new required props and assert Daily/Weekly/Monthly switch both the chart and guardrail values.

- [ ] **Step 7: Add responsive, status-safe styling**

Add this block before the existing media queries in `webview/src/styles.css`:

```css
.guardrails-panel {
  margin-bottom: 9px;
  padding: 16px;
  overflow: hidden;
  border: 1px solid var(--vscode-panel-border, #35383a);
  border-radius: 4px;
  background: var(--vscode-sideBar-background, #1c1e1f);
}

.guardrails-heading,
.guardrail-budget,
.budget-editor-actions,
.contributor-group li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.guardrails-heading h2,
.heavy-turns h3,
.contributor-group h3 { margin: 0; font-size: 12px; }
.guardrails-heading p,
.empty-copy { margin: 4px 0 0; color: var(--vscode-descriptionForeground, #999); font-size: 10px; }

.guardrail-budget {
  flex-wrap: wrap;
  margin-top: 14px;
  padding: 12px;
  background: var(--vscode-editor-background, #181a1b);
}

.guardrail-budget > div { display: grid; gap: 4px; min-width: 100px; }
.guardrail-budget > div span { color: var(--vscode-descriptionForeground, #999); font-size: 10px; }
.guardrail-budget strong { font: 600 13px/1.2 var(--vscode-editor-font-family, monospace); }
.budget-status { margin: 0; font-size: 11px; font-weight: 650; }
.budget-status.on-track { color: #77ce4b; }
.budget-status.approaching { color: #e4a72b; }
.budget-status.exceeded { color: var(--vscode-errorForeground, #f48771); }
.budget-status.disabled { color: var(--vscode-descriptionForeground, #999); }

.partial-badge {
  padding: 2px 6px;
  border: 1px solid #e0a22c;
  border-radius: 999px;
  color: #e0a22c;
  font-size: 9px;
}

.budget-progress { width: 100%; height: 7px; accent-color: var(--vscode-progressBar-background, #0e70c0); }
.budget-progress::-webkit-progress-bar { background: var(--vscode-editorWidget-background, #252526); }
.budget-progress::-webkit-progress-value { background: var(--vscode-progressBar-background, #0e70c0); }

.budget-editor,
.contributors-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.budget-editor {
  padding: 12px;
  border: 1px solid var(--vscode-panel-border, #35383a);
}

.budget-editor label { display: grid; min-width: 0; gap: 5px; color: var(--vscode-descriptionForeground, #aaa); font-size: 10px; }
.budget-editor input { width: 100%; min-width: 0; padding: 6px 8px; color: var(--vscode-input-foreground, #ddd); border: 1px solid var(--vscode-input-border, #555); background: var(--vscode-input-background, #242424); }
.budget-editor small,
.budget-save-error { color: var(--vscode-errorForeground, #f48771); }
.budget-save-error,
.budget-editor-actions { grid-column: 1 / -1; margin: 0; }
.budget-editor-actions { justify-content: flex-end; }
.budget-save { color: var(--vscode-button-foreground, #fff); background: var(--vscode-button-background, #0e639c); }

.contributor-group { min-width: 0; padding: 12px; border: 1px solid var(--vscode-panel-border, #35383a); }
.contributor-group ol,
.heavy-turn-list { display: grid; gap: 8px; margin: 10px 0 0; padding: 0; list-style: none; }
.contributor-group li span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }

.heavy-turns { margin-top: 14px; }
.heavy-turn-list li { display: grid; min-width: 0; gap: 4px; padding: 10px 0; border-top: 1px solid var(--vscode-panel-border, #35383a); }
.heavy-turn-list strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.heavy-turn-list span,
.heavy-turn-list small { overflow-wrap: anywhere; color: var(--vscode-descriptionForeground, #999); font-size: 10px; }

@media (max-width: 720px) {
  .budget-editor,
  .contributors-grid { grid-template-columns: minmax(0, 1fr); }
  .guardrails-heading { align-items: flex-start; }
  .guardrail-budget > div { min-width: calc(50% - 12px); }
}
```

Keep the status labels in the JSX so color is supplementary, retain the existing global focus outlines, and verify no horizontal overflow at 390px.

- [ ] **Step 8: Run focused and full webview verification**

```sh
npx vitest run webview/src/UsageGuardrails.test.tsx webview/src/App.test.tsx webview/src/Root.test.tsx
npm run typecheck
npm test
```

Expected: all new editor/panel/integration cases pass, existing chart/table tests pass, and both TypeScript projects report no errors.

- [ ] **Step 9: Commit the complete webview behavior**

```sh
git add webview/src/UsageGuardrails.tsx webview/src/UsageGuardrails.test.tsx webview/src/App.tsx webview/src/App.test.tsx webview/src/Root.tsx webview/src/Root.test.tsx webview/src/styles.css
git commit -m "feat: add usage guardrails panel"
```

---

### Task 5: Update visual QA and perform final verification

**Files:**
- Modify: `scripts/visual-qa.mjs:93-193`
- Regenerate: `docs/design/token-usage-dashboard-implementation.png`
- Regenerate: `docs/design/token-usage-dashboard-mobile.png`

**Interfaces:**
- Consumes: final snapshot, settings, messages, and Guardrails UI.
- Produces: reviewed visual baselines and full release evidence.

- [ ] **Step 1: Extend the browser fixture**

Add to the visual snapshot:

```js
budgets: { daily: 2_000_000, weekly: 10_000_000, monthly: 40_000_000 },
insights: {
  daily: makeInsights("2026-07-09", "2026-07-09", 1_842_357),
  weekly: makeInsights("2026-07-06", "2026-07-12", 8_650_000),
  monthly: makeInsights("2026-07-01", "2026-07-31", 31_800_000)
}
```

Define the fixture helper before the snapshot:

```js
function makeInsights(startDate, endDate, total) {
  const tokens = [Math.round(total * 0.55), Math.round(total * 0.3)];
  tokens.push(total - tokens[0] - tokens[1]);
  const ranked = (labels, paths = []) => labels.map((label, index) => ({
    key: label.toLowerCase(),
    label,
    ...(paths[index] ? { fullLabel: paths[index] } : {}),
    tokens: tokens[index],
    share: tokens[index] / total,
    partial: index === 1
  }));
  return {
    startDate,
    endDate,
    total,
    partial: true,
    contributors: {
      sources: ranked(["Codex", "OpenCode", "Antigravity"]),
      projects: ranked(
        ["token-usage", "notes", "Unknown"],
        ["/Users/demo/work/token-usage", "/Users/demo/work/notes", undefined]
      ),
      models: ranked(["gpt-5", "claude-sonnet", "gemini-pro"])
    },
    heavyTurns: [
      {
        turnId: "heavy-1",
        prompt: "Refactor import health detection",
        source: "opencode",
        model: "claude-sonnet",
        project: "/Users/demo/work/token-usage",
        total: 230_000,
        quality: "exact",
        baselineMedian: 100_000,
        multiplier: 2.3,
        baselineScope: "source-model"
      },
      {
        turnId: "heavy-2",
        prompt: "Generate release verification",
        source: "codex",
        model: "gpt-5",
        project: "/Users/demo/work/token-usage",
        total: 180_000,
        quality: "estimated",
        baselineMedian: 100_000,
        multiplier: 1.8,
        baselineScope: "source"
      }
    ],
    hasComparableHistory: true
  };
}
```

With the weekly total and budget above, the fixture renders **Approaching limit**, the full project path only in the tooltip, a `2.3×` comparison, and the **Same source** fallback label.

- [ ] **Step 2: Exercise selector and budget editor in visual QA**

Keep the existing Weekly selection, wait for the **Usage Guardrails** heading and **Approaching limit**, then open **Edit budgets**, verify the three labeled inputs, cancel, and capture desktop/mobile screenshots with the editor closed.

- [ ] **Step 3: Run full automated verification**

```sh
npm run verify
```

Expected: every Vitest file passes, both TypeScript projects pass, and the extension/webview production build succeeds.

- [ ] **Step 4: Run visual QA and inspect both PNGs**

```sh
node scripts/visual-qa.mjs
```

Inspect both images with the local image viewer and confirm:

- Usage Guardrails follows the Weekly selection.
- Approaching limit includes visible text and progress treatment.
- Top Contributors and Unusually Heavy Turns are readable.
- Project/tooltips do not expose full paths as primary labels.
- The desktop layout remains balanced.
- At 390px, editor controls, contributors, and heavy-turn metadata do not overflow.
- Existing summary cards, chart, Import Health, filters, table, and details remain intact.

- [ ] **Step 5: Audit stale contracts and scope**

```sh
rg -n 'snapshot\.insights|snapshot\.budgets|setBudgets|budgetsSaved|budgetError' src tests webview scripts
rg -n 'cost|pricing|notification|blocking' src webview
git diff --check
git status --short
```

Expected: every new contract has production and test consumers; no cost/pricing/notification/blocking feature was introduced; no whitespace errors; only Task 5 files plus explicitly preserved pre-existing changes remain.

- [ ] **Step 6: Commit visual fixtures and baselines**

```sh
git add scripts/visual-qa.mjs docs/design/token-usage-dashboard-implementation.png docs/design/token-usage-dashboard-mobile.png
git commit -m "test: cover usage guardrails visual states"
```

- [ ] **Step 7: Run final verification on the committed head**

```sh
npm run verify
git status --short
```

Expected: all checks stay green; only the intentionally untracked `.DS_Store` and `graphify-out/` remain outside the committed feature.

---

## Completion Checklist

- [ ] Daily, weekly, and monthly budgets are optional global user settings; zero disables each one.
- [ ] The selected aggregation controls budget progress, contributors, and heavy turns without importing.
- [ ] Status thresholds are exact at 80% and 100%, with visible text independent of color.
- [ ] Partial budget and contributor totals retain lower-bound semantics.
- [ ] Contributors rank deterministically, show top three, and preserve Unknown/path rules.
- [ ] Efficiency uses non-overlapping 30-day local baselines, five samples, model-first fallback, `1.5x`, and top five.
- [ ] Invalid values are rejected in both the webview and extension boundary.
- [ ] Save failures preserve editor values; successful saves acknowledge and close.
- [ ] External settings changes republish stored data without invoking source adapters.
- [ ] Existing dashboard and import behavior remain unchanged.
- [ ] Full tests, typecheck, build, visual QA, image inspection, scope audit, and whitespace audit pass.
