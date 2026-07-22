# Usage Aggregation Selector Design

## Goal

Let users switch the Usage Over Time chart between daily, weekly, and monthly calendar views without refreshing or reimporting source histories.

## Product Outcome

The existing dashboard explains recent daily usage but does not make medium- or long-term patterns easy to compare. A single aggregation selector will add those comparisons while preserving the dashboard's compact layout and existing source and measurement-quality semantics.

## Scope

The Usage Over Time panel will add one segmented selector:

`Daily | Weekly | Monthly`

The modes are defined as follows:

| Mode | Buckets | Calendar rule | Label example |
| --- | ---: | --- | --- |
| Daily | 14 | Local calendar days, including today | `Jul 22` |
| Weekly | 12 | Monday through Sunday, including the current week | `Jul 20–26` |
| Monthly | 12 | Local calendar months, including the current month | `Jul 2026` |

The Today, Last 7 Days, and All Time summary cards remain unchanged. The filters, turn table, turn details, import health, and import process also remain unchanged.

## Interaction Design

- Rename the current chart heading from **Daily usage** to **Usage Over Time**.
- Place the segmented selector in the chart header alongside the existing source legend.
- Daily is the default for users without saved chart state.
- Changing modes updates the chart immediately from the existing dashboard snapshot. It does not trigger a source scan or extension-host request.
- Persist the last selected mode with VS Code webview state and restore it when that webview is reopened.
- Use an actual single-select control with keyboard navigation and an accessible name of **Usage aggregation**.
- Set the chart's accessible description dynamically, for example **Weekly token usage by source**.

The current day, week, or month is an incomplete comparison period. Its bar will have a subtle dashed outline and its tooltip will include **In progress**. Completed buckets use the existing bar treatment.

## Chart Content

Every bucket retains the stacked breakdown for:

- Codex
- OpenCode
- Antigravity

Existing partial lower-bound styling remains source-specific. If any usable total metric for a source in a bucket has `partial` quality, that source appears in the bucket's `partialSources` collection and uses the current partial styling.

An empty calendar bucket remains in the series so spacing and chronology are stable. A source with no usable total metric in a bucket remains `null`, rather than being presented as measured zero usage. The bucket tooltip may show a combined total of zero when all sources are unavailable.

Tooltips show:

- The full calendar period
- Combined token total
- Token total for each source
- **In progress** when applicable

## Data Model

Add a shared aggregation type:

```ts
export type UsageGranularity = "daily" | "weekly" | "monthly";
```

Replace the single `DashboardSnapshot.trend` collection with:

```ts
trends: Record<UsageGranularity, TrendPoint[]>;
```

Each `TrendPoint` will contain:

```ts
interface TrendPoint {
  startDate: string;
  endDate: string;
  inProgress: boolean;
  codex: number | null;
  opencode: number | null;
  antigravity: number | null;
  partialSources?: Source[];
}
```

`startDate` and `endDate` use local calendar dates formatted as `YYYY-MM-DD`. Daily points use the same value for both fields. React keys use the selected granularity plus `startDate`.

## Aggregation Architecture

The extension service remains the source of truth for aggregation. `buildDashboardSnapshot` will precompute all 38 points—14 daily, 12 weekly, and 12 monthly—and send them in the existing snapshot message.

A focused aggregation helper will:

1. Calculate ordered calendar bucket boundaries in the device's local timezone.
2. Assign each turn to a bucket using an inclusive start and exclusive next-period boundary.
3. Sum usable `total` metrics by source.
4. Preserve `null` for unseen or unavailable source totals.
5. Track partial quality by source.
6. Mark only the final current-period bucket as `inProgress: true`.

Calendar arithmetic uses local `Date` constructors and `setDate` or `setMonth`, rather than fixed millisecond durations, so daylight-saving changes do not shift bucket boundaries. Weekly calculation converts JavaScript Sunday-based weekdays to a Monday start.

The webview only selects and renders one of the precomputed collections. It does not duplicate token-quality or calendar aggregation logic.

## State Persistence

Extend the webview API typing with `getState` and `setState`. Store only:

```ts
{ usageGranularity: "daily" | "weekly" | "monthly" }
```

Unknown or missing stored values fall back to `daily`. This state is presentation-only and does not belong in the tracker SQLite database or extension settings.

## Error and Empty-State Behavior

- Mode selection remains available when a series contains no usage; the chart renders its calendar buckets with empty bars.
- A malformed persisted mode is ignored and replaced with `daily`.
- Snapshot import or loading errors continue to use the dashboard's existing error handling.
- Switching modes cannot create a new extension error because it performs no asynchronous request.

## Testing

Service tests will verify:

- Fourteen daily, twelve weekly, and twelve monthly points are generated in chronological order.
- Monday and Sunday turns land in the same weekly bucket, while the following Monday starts a new bucket.
- Month and year transitions group correctly.
- The current day, week, and month are marked in progress.
- Completed buckets are not marked in progress.
- Missing metrics remain `null` and partial sources remain identified.

Webview tests will verify:

- Daily is selected by default.
- Selecting Weekly or Monthly renders the matching labels and accessible chart description.
- The current bucket exposes the **In progress** treatment.
- Selecting a mode persists it, and a valid saved mode is restored.
- Invalid saved state falls back to Daily.
- The existing source legend and partial-bar styling remain present.

The full repository verification command remains:

```sh
npm run verify
```

## Out of Scope

- Arbitrary date ranges
- A second date-range control
- Rolling seven-day or rolling thirty-day buckets
- Cost conversion, budgets, forecasts, or alerts
- Filtering summary cards by the selected aggregation
- Reimporting data when the selector changes
