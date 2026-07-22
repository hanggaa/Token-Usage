# Token Budget and Insights Design

## Goal

Turn the Token Usage Tracker from a reporting dashboard into a local usage-control tool by adding token budgets, contributor explanations, and evidence-based efficiency signals.

## Product Outcome

The tracker already shows how many tokens were used across daily, weekly, and monthly calendar periods. The next feature should make those totals actionable:

- **Control usage** with optional calendar-period token budgets.
- **Understand usage** through ranked source, project, and model contributors.
- **Improve efficiency** by surfacing unusually token-heavy turns relative to the user's own recent history.

The feature remains local-first. It provides warnings and evidence but never blocks Codex CLI, OpenCode CLI, or Antigravity IDE usage.

## Scope

Add a **Usage Guardrails** panel connected to the existing single aggregation selector:

`Daily | Weekly | Monthly`

The selected aggregation determines which current period appears:

| Mode | Current period | Budget used |
| --- | --- | --- |
| Daily | Today in the device's local timezone | Daily token budget |
| Weekly | Current Monday through Sunday | Weekly token budget |
| Monthly | Current local calendar month | Monthly token budget |

The panel contains three sections:

1. Budget progress
2. Top Contributors
3. Unusually Heavy Turns

The Today, Last 7 Days, and All Time summary cards remain unchanged. Import Health, the Usage Over Time chart, turn filters, the turn table, and turn details also retain their existing behavior.

## Budget Progress

### Budget configuration

Users can configure three independent, optional token budgets:

- Daily
- Weekly
- Monthly

Each value is a whole, non-negative token count. A value of `0` means that budget is disabled.

The selected period displays:

- Tokens used
- Budget limit
- Tokens remaining
- Percentage consumed
- Period end date
- Current status

When usage exceeds the limit, remaining tokens display as `0`; the panel may additionally show the number of tokens over budget.

### Status rules

Status is calculated from `used / budget`:

| Percentage | Status |
| ---: | --- |
| Below 80% | On track |
| 80% through less than 100% | Approaching limit |
| 100% or more | Budget exceeded |

These thresholds are fixed in version 1.

When the selected budget is disabled, the panel shows **No budget set** and a **Set token budget** action instead of a percentage status.

### Measurement quality

Budget usage includes every usable `total` metric, matching the dashboard's existing summary semantics:

- Exact totals contribute their measured value.
- Estimated totals contribute their estimated value.
- Partial totals contribute their known lower-bound value.
- Unavailable totals do not contribute a numeric value.

If any contributing total is partial, the used value is displayed with `>=` semantics in accessible text and `≥` visually. The budget status is based on that known lower bound and is accompanied by a **Partial data** indicator so it is not presented as a complete measurement.

## Budget Editor

Selecting **Set token budget** or **Edit budgets** opens a compact editor inside the Usage Guardrails panel. It contains labeled inputs for daily, weekly, and monthly limits plus Save and Cancel actions.

Editor behavior:

- Blank input is normalized to `0` and disables that budget.
- Decimal, negative, non-numeric, and unsafe-integer values are rejected inline.
- Save writes all three values as one operation.
- Cancel restores the last saved values.
- A failed save leaves the editor open and preserves the entered values.
- Saving budgets does not scan or reimport source histories.

The control uses native numeric inputs with accessible labels. Status is not communicated through color alone; each state includes visible text.

## Top Contributors

The **Top Contributors** section explains the selected current period with three ranked groups:

- Top three sources
- Top three projects
- Top three models

Each row shows:

- Contributor name
- Token total
- Percentage of the selected period's usable total

### Grouping and display rules

- Source uses the existing Codex, OpenCode, and Antigravity labels.
- Projects are grouped by their full normalized project value.
- A project row displays the final folder name; its full local path appears in the tooltip and accessible description.
- Missing or empty project and model values are grouped under **Unknown**.
- Contributor totals use the same exact, estimated, partial, and unavailable semantics as budget progress.
- A contributor containing partial usage displays lower-bound styling.
- Percentages use the selected period's usable total as the denominator.
- When the period total is zero, contributor percentages are `0%` and no ranked rows are shown.
- Rank by token total descending, then display label ascending for deterministic ties.

Contributor rows are read-only in version 1. They do not modify the turn-table filters or introduce a separate date filter.

## Unusually Heavy Turns

The **Unusually Heavy Turns** section identifies selected-period turns that are large relative to comparable historical usage. It does not label them wasteful or recommend deleting content.

### Candidate rules

A current-period turn is eligible when:

- Its `total` metric is exact or estimated.
- Its numeric total is positive.
- A valid historical baseline exists.
- Its total is at least `1.5` times the applicable baseline median.

Partial and unavailable totals are excluded from candidates and baseline samples to avoid false precision.

### Baseline window

For each aggregation, the baseline contains the 30 completed local calendar days immediately before the selected current period begins:

- Daily baseline ends when today begins.
- Weekly baseline ends when the current Monday begins.
- Monthly baseline ends when the current month's first day begins.

The baseline never overlaps the candidate period. Calendar boundaries use local `Date` construction rather than fixed millisecond durations.

### Comparison fallback

For each candidate:

1. Use the median of historical turns with the same source and model when at least five samples exist.
2. Otherwise use the median of historical turns from the same source when at least five samples exist.
3. Otherwise do not flag that turn.

An empty model is treated as **Unknown** and may form a same-source-and-model cohort. A zero or non-finite median is invalid.

### Ranking and display

Show at most five turns, ranked by comparison multiplier descending and then token total descending.

Each item displays:

- Prompt preview, or **Prompt unavailable** when prompt retention prevents it
- Source and model
- Project
- Total tokens, including estimated styling when applicable
- Comparison such as **2.3x your recent median**
- Whether the comparison used the same source and model or the source fallback

If no turn qualifies and valid baselines exist, show **No unusually heavy turns in this period**. If no candidate can obtain five comparable samples, show **Not enough history yet**.

All calculations remain local. Prompt and response content is never transmitted externally.

## Configuration

Store budgets as VS Code user configuration so they can participate in Settings UI and Settings Sync:

```text
tokenUsage.budgets.daily
tokenUsage.budgets.weekly
tokenUsage.budgets.monthly
```

Each setting has:

- Type: `number`
- Default: `0`
- Minimum: `0`
- Description that states `0` disables the budget

Dashboard saves target global user configuration, not workspace configuration. Budgets do not belong in tracker SQLite because they are user preferences rather than imported usage data.

Changes made through the normal VS Code Settings UI should update the dashboard snapshot without triggering a source import.

## Shared Data Model

Add shared models equivalent to:

```ts
export interface UsageBudgets {
  daily: number;
  weekly: number;
  monthly: number;
}

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

Extend `DashboardSnapshot` with:

```ts
budgets: UsageBudgets;
insights: Record<UsageGranularity, PeriodInsights>;
```

The exact interfaces may include the prompt, source, model, and project display fields needed to render heavy-turn items, but the extension service remains the source of truth for ranking, medians, calendar windows, and measurement quality.

## Architecture and Data Flow

### Dashboard service

Extend the dashboard service with focused helpers for:

- Current-period boundaries per granularity
- Contributor grouping and deterministic ranking
- Median calculation
- Comparable-baseline selection
- Heavy-turn selection and ranking

These helpers consume normalized turns and return presentation-ready insight data. They do not read VS Code configuration directly.

`buildDashboardSnapshot` receives validated budgets from its caller and returns them with all three precomputed insight collections. The existing trend collections and summary calculations remain unchanged.

### Extension and webview provider

Add a `setBudgets` webview message containing all three values. The extension or provider:

1. Validates the payload again at the trust boundary.
2. Writes the values to global VS Code configuration.
3. Rebuilds and publishes a dashboard snapshot from the existing tracker store.
4. Does not call source adapters or the import coordinator.

The extension listens for changes affecting the three budget settings and republishes a snapshot from existing stored data. This supports edits made outside the dashboard without creating an import.

### Webview

The webview:

- Uses the existing persisted `UsageGranularity` selection.
- Selects `snapshot.insights[usageGranularity]` and the matching budget.
- Calculates simple display values such as remaining tokens and percentage from service-provided totals and validated budgets.
- Retains unsaved editor values locally until Save or Cancel.
- Sends only the `setBudgets` message when the user saves.

The webview does not calculate contributor rankings, historical medians, or calendar boundaries.

## Error and Empty-State Behavior

- Invalid dashboard inputs show field-specific errors and do not send a message.
- Invalid message payloads are rejected by the extension and produce an error response.
- Configuration write failures use the existing webview error channel with a budget-specific message while preserving the open editor.
- A disabled budget does not hide contributors or efficiency insights.
- A period with no usable usage shows zero used tokens and empty contributor rows.
- Missing project, model, or prompt fields use the explicit fallback labels defined above.
- Existing snapshot import and loading errors retain their current behavior.

## Testing

### Service tests

Verify:

- Daily, Monday-Sunday weekly, and monthly current-period boundaries.
- The 30-day baseline ends at the current period start and never overlaps it.
- Local calendar arithmetic remains correct through daylight-saving transitions.
- Contributor totals, shares, partial flags, top-three limits, and deterministic tie ordering.
- Unknown project and model grouping.
- Same-source-and-model median selection with five or more samples.
- Same-source fallback when model samples are insufficient.
- No insight when neither cohort has five samples.
- The `1.5x` threshold, top-five ranking, and exact/estimated eligibility.
- Partial and unavailable metrics are excluded from efficiency candidates and baselines.

### Extension/provider tests

Verify:

- Valid values save all three global settings.
- Zero disables a budget.
- Negative, decimal, non-numeric, and unsafe-integer message values are rejected.
- Successful saves and external setting changes publish a new snapshot without importing sources.
- Failed configuration writes return an error and do not report success.

### Webview tests

Verify:

- Daily, Weekly, and Monthly select the matching budget and insights.
- No-budget, On track, Approaching limit, and Budget exceeded states.
- Exact threshold behavior at 80% and 100%.
- Partial lower-bound presentation.
- Budget editor validation, Save, Cancel, failed-save preservation, and disable behavior.
- Contributor labels, percentages, project-path tooltip, and empty state.
- Heavy-turn content, multiplier, baseline-scope label, insufficient-history state, and no-outlier state.
- Accessible names, text status independent of color, keyboard operation, desktop layout, and narrow layout.

The repository-wide verification command remains:

```sh
npm run verify
```

## Out of Scope

- Monetary cost conversion
- Provider pricing maintenance
- Background or operating-system notifications
- Automatic blocking or throttling of CLI and IDE usage
- Custom warning thresholds
- Per-source, per-project, or per-model budgets
- Arbitrary date ranges
- Contributor rows that alter table filters
- AI-generated optimization advice
- Sending prompt or response content to an external service
