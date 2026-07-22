# Usage Aggregation Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted `Daily | Weekly | Monthly` selector to the Usage Over Time chart, backed by precomputed local-calendar buckets and an explicit in-progress treatment for the current period.

**Architecture:** The extension service computes all 38 calendar buckets once per dashboard snapshot and retains source-level null and partial-quality semantics. The React webview is a controlled presentation layer: it selects one precomputed series, formats its labels and tooltip, and stores only the selected granularity through VS Code webview state.

**Tech Stack:** TypeScript, React 19, VS Code Webview API, Vitest, Testing Library, CSS, Playwright visual QA.

## Global Constraints

- Follow the approved design in `docs/superpowers/specs/2026-07-22-usage-aggregation-selector-design.md`.
- Keep the Today, Last 7 Days, and All Time summary cards unchanged.
- Do not trigger refresh, reimport, or an extension-host message when the aggregation changes.
- Use device-local calendar arithmetic. Do not derive days, weeks, or months with fixed millisecond durations.
- Preserve `null` when a source has no usable total metric in a bucket, and preserve per-source partial styling.
- Keep the selector state presentation-only; do not put it in SQLite or VS Code settings.
- The worktree already contains unrelated OpenCode import/version changes. In every commit, stage only the files named by that task; do not use `git add .`.
- Do not modify or delete the untracked `graphify-out/` directory.

---

## Task 1: Build the calendar trend series and aggregation selector atomically

This execution task combines the original service and chart tasks so the shared snapshot contract and every consumer change in one green commit. Do not commit or run the repository-wide typecheck between Part A and Part B.

### Part A: Extension aggregation service

**Files:**

- Modify: `src/shared/dashboard.ts:11-27`
- Modify: `tests/services/dashboard.test.ts:1-81`
- Modify: `src/services/dashboard.ts:14-118`

### Step 1: Replace the shared single-series contract

- [ ] In `src/shared/dashboard.ts`, introduce the granularity union and replace `date` with explicit period boundaries:

```ts
export type UsageGranularity = "daily" | "weekly" | "monthly";

export interface TrendPoint {
  startDate: string;
  endDate: string;
  inProgress: boolean;
  codex: number | null;
  opencode: number | null;
  antigravity: number | null;
  partialSources?: Source[];
}

export interface DashboardSnapshot {
  generatedAt: string;
  summaries: {
    today: UsageSummary;
    sevenDays: UsageSummary;
    allTime: UsageSummary;
  };
  trends: Record<UsageGranularity, TrendPoint[]>;
  turns: NormalizedTurn[];
  health: SourceHealth[];
}
```

### Step 2: Write failing service tests for the complete contract

- [ ] Add local-time helpers to `tests/services/dashboard.test.ts` so calendar assertions do not depend on the machine's UTC offset:

```ts
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
```

- [ ] Replace the old `snapshot.trend` assertion and add focused tests that verify:

```ts
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
```

```ts
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
```

```ts
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
```

- [ ] Retain the existing unavailable/partial test, but assert against the final daily, weekly, and monthly points. Each should have `antigravity: 25`, not treat the unavailable metric as zero, and include `partialSources: ["antigravity"]`.

### Step 3: Run the focused test and confirm the contract fails

- [ ] Run:

```sh
npx vitest run tests/services/dashboard.test.ts
```

Expected: TypeScript/runtime assertions fail because `DashboardSnapshot.trends` and calendar aggregation do not exist yet.

### Step 4: Implement reusable local-calendar bucket construction

- [ ] In `src/services/dashboard.ts`, add the following internal model and helpers beside `dateKey`:

```ts
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
```

### Step 5: Implement the focused aggregation helper

- [ ] Add a `buildTrend` helper that creates every empty bucket first, assigns timestamps with inclusive start/exclusive next-start boundaries, and converts only seen metrics to numbers:

```ts
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
```

- [ ] Replace the existing 14-day `trendMap` block in `buildDashboardSnapshot` with explicit current-period boundaries and all three series:

```ts
const trends = {
  daily: buildTrend(turns, makeBuckets(today, 14, addDays)),
  weekly: buildTrend(turns, makeBuckets(startOfWeek(today), 12, (date, amount) =>
    addDays(date, amount * 7)
  )),
  monthly: buildTrend(turns, makeBuckets(startOfMonth(today), 12, addMonths))
};
```

- [ ] Return `trends` instead of `trend`. Leave summary calculation, turns, and health untouched.

### Step 6: Run focused service tests

- [ ] Run:

```sh
npx vitest run tests/services/dashboard.test.ts
```

Expected: service tests pass. Continue directly into Part B before committing because the webview still consumes the old shared contract.

### Step 7: Do not commit the intermediate shared-contract state

- [ ] Confirm only the Task 1 service files have changed so far, then continue directly to Part B. Do not commit and do not run the repository-wide typecheck while consumers still reference `snapshot.trend`.

### Part B: Accessible aggregation selector and selected-series rendering

**Files:**

- Modify: `webview/src/App.test.tsx:37-125`
- Modify: `webview/src/App.tsx:1-176,327-394`
- Modify: `webview/src/styles.css:187-310,727-763`

### Step 1: Expand the webview fixture and write failing interaction tests

- [ ] Change the `DashboardSnapshot` fixture in `webview/src/App.test.tsx` from `trend` to `trends`, with at least two daily points and representative weekly and monthly points. Make the final point in each series `inProgress: true`; make one source partial so regression coverage remains visible.

- [ ] Add a small controlled harness so tests exercise the same props as production:

```tsx
function renderApp(initialGranularity: UsageGranularity = "daily") {
  function Harness() {
    const [usageGranularity, setUsageGranularity] = useState(initialGranularity);
    return (
      <App
        snapshot={snapshot}
        loading={false}
        onRefresh={() => undefined}
        usageGranularity={usageGranularity}
        onUsageGranularityChange={setUsageGranularity}
      />
    );
  }

  return render(<Harness />);
}
```

- [ ] Update existing renders to use `renderApp()` and rename the expected chart heading to `Usage Over Time`.

- [ ] Add tests for the approved interaction and accessibility behavior:

```tsx
it("defaults to Daily and switches to the precomputed weekly and monthly series", () => {
  renderApp();

  expect(screen.getByRole("radio", { name: "Daily" })).toBeChecked();
  expect(screen.getByRole("img", { name: "Daily token usage by source" })).toBeInTheDocument();
  expect(screen.getByText("Jul 9")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));
  expect(screen.getByRole("radio", { name: "Weekly" })).toBeChecked();
  expect(screen.getByRole("img", { name: "Weekly token usage by source" })).toBeInTheDocument();
  expect(screen.getByText("Jul 6–12")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("radio", { name: "Monthly" }));
  expect(screen.getByRole("img", { name: "Monthly token usage by source" })).toBeInTheDocument();
  expect(screen.getByText("Jul 2026")).toBeInTheDocument();
});

it("marks the current bucket in progress and retains partial-source styling", () => {
  const { container } = renderApp("weekly");

  expect(screen.getByTitle(/In progress/u)).toBeInTheDocument();
  expect(container.querySelector(".chart-column.in-progress .bar-track")).not.toBeNull();
  expect(container.querySelector(".bar-partial.source-antigravity")).not.toBeNull();
});
```

### Step 2: Run the webview test and confirm it fails

- [ ] Run:

```sh
npx vitest run webview/src/App.test.tsx
```

Expected: failures for missing selector props, the old heading, and absent weekly/monthly rendering.

### Step 3: Make `App` a controlled consumer of the selected granularity

- [ ] Extend `AppProps` and its imports:

```ts
import type { CSSProperties } from "react";
import {
  SOURCES,
  type DashboardSnapshot,
  type TrendPoint,
  type UsageGranularity,
  type UsageSummary
} from "../../src/shared/dashboard.js";

interface AppProps {
  snapshot: DashboardSnapshot;
  loading: boolean;
  onRefresh: () => void;
  usageGranularity: UsageGranularity;
  onUsageGranularityChange: (granularity: UsageGranularity) => void;
}
```

- [ ] Add stable mode labels and local-date parsing. Appending noon prevents parsing from silently treating the `YYYY-MM-DD` value as UTC:

```ts
const GRANULARITY_LABELS: Record<UsageGranularity, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly"
};

function parseCalendarDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}
```

### Step 4: Add the native single-select control

- [ ] Implement the segmented control with native radio inputs so it has single-select semantics and keyboard behavior without custom key handlers:

```tsx
function AggregationSelector({
  value,
  onChange
}: {
  value: UsageGranularity;
  onChange: (granularity: UsageGranularity) => void;
}) {
  return (
    <fieldset className="aggregation-selector" aria-label="Usage aggregation">
      <legend className="sr-only">Usage aggregation</legend>
      {(Object.keys(GRANULARITY_LABELS) as UsageGranularity[]).map((granularity) => (
        <label key={granularity}>
          <input
            type="radio"
            name="usage-aggregation"
            value={granularity}
            checked={value === granularity}
            onChange={() => onChange(granularity)}
          />
          <span>{GRANULARITY_LABELS[granularity]}</span>
        </label>
      ))}
    </fieldset>
  );
}
```

### Step 5: Format labels and complete tooltips for each period

- [ ] Add formatter helpers with these observable outputs:

- Daily axis: `Jul 22`
- Weekly axis, same month: `Jul 20–26`
- Weekly axis, cross-month: `Jul 27–Aug 2`
- Monthly axis: `Jul 2026`
- Tooltip first line: the full date or date range
- Tooltip source lines: number when present, `Unavailable` when the source value is `null`
- Tooltip final line: `In progress` only for the current bucket

Use en dashes for date ranges and build the tooltip as newline-separated text:

```ts
function formatTooltip(point: TrendPoint): string {
  const total = SOURCES.reduce((sum, source) => sum + (point[source] ?? 0), 0);
  return [
    formatFullPeriod(point),
    `Total: ${numberFormatter.format(total)}`,
    ...SOURCES.map((source) =>
      `${SOURCE_LABELS[source]}: ${
        point[source] == null ? "Unavailable" : numberFormatter.format(point[source])
      }`
    ),
    ...(point.inProgress ? ["In progress"] : [])
  ].join("\n");
}
```

Keep `formatAxisLabel` and `formatFullPeriod` pure and cover cross-month/cross-year behavior either through exported helpers or representative rendered fixtures.

### Step 6: Render the selected series and dynamic chart metadata

- [ ] Change `TrendChart` to accept `usageGranularity` and its change callback, select `snapshot.trends[usageGranularity]`, and use that series for the maximum and bar rendering.

- [ ] Apply these rendering changes:

```tsx
<h2>Usage Over Time</h2>
<div className="trend-controls">
  <AggregationSelector value={usageGranularity} onChange={onUsageGranularityChange} />
  <div className="legend" aria-label="Chart legend">
    {SOURCES.map((source) => (
      <span key={source}>
        <i className={`source-dot source-${source}`} />
        {SOURCE_LABELS[source]}
      </span>
    ))}
  </div>
</div>
```

```tsx
<div
  className="chart"
  role="img"
  aria-label={`${GRANULARITY_LABELS[usageGranularity]} token usage by source`}
  style={{ "--bucket-count": points.length } as CSSProperties}
>
```

```tsx
<div
  className={`chart-column ${point.inProgress ? "in-progress" : ""}`}
  key={`${usageGranularity}:${point.startDate}`}
  title={formatTooltip(point)}
>
  <div className="bar-track">
    {SOURCES.map((source) => {
      const value = point[source] ?? 0;
      return (
        <div
          key={source}
          className={`bar-segment source-${source} ${
            point.partialSources?.includes(source) ? "bar-partial" : ""
          }`}
          style={{ height: `${(value / maximum) * 100}%` }}
        />
      );
    })}
  </div>
  <span>{formatAxisLabel(usageGranularity, point)}</span>
</div>
```

- [ ] Pass the two controlled props from `App` to `TrendChart`. Do not connect this callback to `onRefresh`.

### Step 7: Style the segmented control, dynamic columns, and current bucket

- [ ] In `webview/src/styles.css`:

```css
.trend-controls {
  display: flex;
  align-items: center;
  gap: 16px;
}

.aggregation-selector {
  display: inline-flex;
  margin: 0;
  padding: 0;
  border: 1px solid var(--vscode-button-border, #44484a);
  border-radius: 3px;
  overflow: hidden;
}

.aggregation-selector label {
  position: relative;
  cursor: pointer;
}

.aggregation-selector input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.aggregation-selector span {
  display: block;
  padding: 4px 8px;
  color: var(--vscode-descriptionForeground, #b1b3b4);
  font-size: 10px;
}

.aggregation-selector label + label span {
  border-left: 1px solid var(--vscode-button-border, #44484a);
}

.aggregation-selector input:checked + span {
  color: var(--vscode-button-foreground, #fff);
  background: var(--vscode-button-background, #0e639c);
}

.aggregation-selector input:focus-visible + span {
  outline: 1px solid var(--vscode-focusBorder, #007fd4);
  outline-offset: -2px;
}

.chart {
  grid-template-columns: repeat(var(--bucket-count), minmax(16px, 1fr));
}

.chart-column.in-progress .bar-track {
  outline: 1px dashed var(--vscode-descriptionForeground, #9c9fa1);
  outline-offset: 2px;
}
```

- [ ] At `max-width: 720px`, allow `.panel-heading` and `.trend-controls` to wrap cleanly and keep the selector usable without hiding the legend.

### Step 8: Run the webview tests

- [ ] Run:

```sh
npx vitest run webview/src/App.test.tsx
```

Expected: all App tests pass, including selector, dynamic accessible name, in-progress tooltip, and partial styling.

### Step 9: Verify and commit the complete green contract change

- [ ] Run:

```sh
npm run typecheck
npm test
git add src/shared/dashboard.ts src/services/dashboard.ts tests/services/dashboard.test.ts webview/src/App.tsx webview/src/App.test.tsx webview/src/styles.css
git commit -m "feat: add usage aggregation selector"
```

---

## Task 2: Persist and validate the selected mode with webview state

**Files:**

- Create: `webview/src/usage-state.ts`
- Create: `webview/src/usage-state.test.ts`
- Create: `webview/src/Root.tsx`
- Create: `webview/src/Root.test.tsx`
- Modify: `webview/src/main.tsx:1-76`

### Step 1: Write failing persistence-boundary tests

- [ ] Create `webview/src/usage-state.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  readUsageGranularity,
  writeUsageGranularity
} from "./usage-state.js";

describe("usage aggregation webview state", () => {
  it("defaults missing and malformed values to daily", () => {
    expect(readUsageGranularity(undefined)).toBe("daily");
    expect(readUsageGranularity({})).toBe("daily");
    expect(readUsageGranularity({ usageGranularity: "yearly" })).toBe("daily");
    expect(readUsageGranularity({ usageGranularity: 12 })).toBe("daily");
  });

  it("restores every supported value", () => {
    expect(readUsageGranularity({ usageGranularity: "daily" })).toBe("daily");
    expect(readUsageGranularity({ usageGranularity: "weekly" })).toBe("weekly");
    expect(readUsageGranularity({ usageGranularity: "monthly" })).toBe("monthly");
  });

  it("stores only the selected usage granularity", () => {
    const setState = vi.fn();
    writeUsageGranularity({ setState }, "weekly");
    expect(setState).toHaveBeenCalledWith({ usageGranularity: "weekly" });
  });
});
```

### Step 2: Run the state test and confirm it fails

- [ ] Run:

```sh
npx vitest run webview/src/usage-state.test.ts
```

Expected: failure because `usage-state.ts` does not exist.

### Step 3: Implement strict state validation and serialization

- [ ] Create `webview/src/usage-state.ts`:

```ts
import type { UsageGranularity } from "../../src/shared/dashboard.js";

interface UsageStateWriter {
  setState(state: { usageGranularity: UsageGranularity }): void;
}

export function readUsageGranularity(state: unknown): UsageGranularity {
  if (!state || typeof state !== "object" || !("usageGranularity" in state)) {
    return "daily";
  }
  const value = state.usageGranularity;
  return value === "daily" || value === "weekly" || value === "monthly"
    ? value
    : "daily";
}

export function writeUsageGranularity(
  api: UsageStateWriter,
  usageGranularity: UsageGranularity
): void {
  api.setState({ usageGranularity });
}
```

### Step 4: Wire state into the webview root without extension messages

- [ ] Extract the current `Root` component from `webview/src/main.tsx` into `webview/src/Root.tsx`. Export `Root` and make its VS Code API dependency an explicit prop so its complete interaction can be tested:

```ts
export interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: { usageGranularity: UsageGranularity }): void;
}

export function Root({ vscode }: { vscode: VsCodeApi | null }) {
  // Existing snapshot, loading, error, and message-listener behavior moves here.
}
```

- [ ] Initialize once from saved state and persist only from the selector callback:

```ts
const [usageGranularity, setUsageGranularity] = useState<UsageGranularity>(() =>
  readUsageGranularity(vscode?.getState())
);

const changeUsageGranularity = (next: UsageGranularity) => {
  setUsageGranularity(next);
  if (vscode) {
    writeUsageGranularity(vscode, next);
  }
};
```

- [ ] Pass `usageGranularity` and `onUsageGranularityChange={changeUsageGranularity}` to `App`. Keep `webview/src/main.tsx` as the thin `acquireVsCodeApi` and `createRoot` bootstrap.

- [ ] Create `webview/src/Root.test.tsx` with a typed fake API. Deliver a real snapshot through the existing `window` message listener, verify a valid saved Monthly value is selected, click Weekly, and assert exactly:

```tsx
expect(vscode.setState).toHaveBeenLastCalledWith({ usageGranularity: "weekly" });
expect(vscode.postMessage).toHaveBeenCalledWith({ type: "ready" });
expect(vscode.postMessage).not.toHaveBeenCalledWith({ type: "refresh" });
```

- [ ] Add a second Root assertion with malformed saved state and verify Daily is selected. This is the integration proof that restoration, selection, and persistence are connected through the production root rather than only testing serialization helpers.

### Step 5: Run persistence, App, and type tests

- [ ] Run:

```sh
npx vitest run webview/src/usage-state.test.ts webview/src/Root.test.tsx webview/src/App.test.tsx
npm run typecheck
```

Expected: all focused tests pass and both extension and webview TypeScript projects report no errors.

### Step 6: Commit only persistence integration

- [ ] Run:

```sh
git add webview/src/usage-state.ts webview/src/usage-state.test.ts webview/src/Root.tsx webview/src/Root.test.tsx webview/src/main.tsx
git commit -m "feat: remember usage aggregation mode"
```

---

## Task 3: Update visual fixtures and perform full verification

**Files:**

- Modify: `scripts/visual-qa.mjs:93-120,127-150`
- Regenerate: `docs/design/token-usage-dashboard-implementation.png`
- Regenerate: `docs/design/token-usage-dashboard-mobile.png`

### Step 1: Update the browser fixture to the new snapshot contract

- [ ] Replace `snapshot.trend` in `scripts/visual-qa.mjs` with `snapshot.trends`. Supply 14 daily, 12 weekly, and 12 monthly points using the same `startDate`, `endDate`, `inProgress`, three source totals, and `partialSources` contract used by production.

- [ ] Mark only the final point in each fixture series as `inProgress: true`.

- [ ] Add a visual-QA interaction before the desktop screenshot:

```js
await page.getByRole("radio", { name: "Weekly" }).check();
await page.getByRole("img", { name: "Weekly token usage by source" }).waitFor();
```

This verifies that selecting Weekly changes only the chart before capturing desktop and mobile layouts.

### Step 2: Run the full automated verification suite

- [ ] Run:

```sh
npm run verify
```

Expected: all Vitest suites pass, both TypeScript projects pass, and extension/webview builds complete successfully.

### Step 3: Run visual QA and inspect both layouts

- [ ] Run:

```sh
node scripts/visual-qa.mjs
```

Expected output includes:

```text
Visual QA passed: /Users/operational40/Documents/Personal/Token-Usage/docs/design/token-usage-dashboard-implementation.png
Mobile QA captured: /Users/operational40/Documents/Personal/Token-Usage/docs/design/token-usage-dashboard-mobile.png
```

- [ ] Inspect both regenerated PNGs. Confirm:

- The chart heading is `Usage Over Time`.
- Weekly is visibly selected.
- The source legend remains readable.
- Twelve bars fit without horizontal overflow.
- The final bar has a subtle dashed in-progress outline.
- The selector and legend wrap cleanly at 390 px.
- The summary cards, import health, filters, table, and details remain intact.

### Step 4: Audit scope and stale contract references

- [ ] Run:

```sh
rg -n '\bsnapshot\.trend\b|\btrend:' src tests webview scripts
rg -n 'Daily usage' src tests webview scripts
git diff --check
git status --short
```

Expected:

- No stale singular `snapshot.trend` or fixture `trend:` references.
- No old `Daily usage` chart title.
- No whitespace errors.
- The status shows only the task's visual files plus the pre-existing unrelated OpenCode/version changes and `graphify-out/`.

### Step 5: Commit only the visual fixture and approved baselines

- [ ] Run:

```sh
git add scripts/visual-qa.mjs docs/design/token-usage-dashboard-implementation.png docs/design/token-usage-dashboard-mobile.png
git commit -m "test: cover aggregation selector visual states"
```

### Step 6: Final repository verification

- [ ] Run once more after the commit:

```sh
npm run verify
git status --short
```

Expected: verification stays green. Pre-existing OpenCode/version changes and `graphify-out/` remain untouched and clearly distinguishable from the completed aggregation commits.

---

## Completion Checklist

- [ ] All approved modes and bucket counts are implemented: 14 daily, 12 Monday–Sunday weekly, 12 monthly.
- [ ] Current periods are included and marked `In progress`; completed periods are not.
- [ ] The selector is a single accessible radio group labeled `Usage aggregation`.
- [ ] Switching modes is immediate and sends no refresh/import message.
- [ ] Valid saved state is restored; missing or malformed state becomes Daily.
- [ ] Empty source values remain `null`; partial styling remains source-specific.
- [ ] Summary cards and all non-chart dashboard behavior are unchanged.
- [ ] `npm run verify`, visual QA, stale-reference audit, and `git diff --check` pass.
