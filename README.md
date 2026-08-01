# Token Usage Tracker

Token Usage Tracker is a private, local-first VS Code-compatible extension for understanding and controlling token usage across:

- Codex CLI
- Claude Code CLI
- OpenCode CLI
- Antigravity IDE

It imports persisted local histories into a local SQLite index, then presents summaries, calendar trends, budgets, period comparisons, contributors, unusually heavy turns, import health, and per-turn details in one dashboard. Usage data never leaves your machine.

## Dashboard

- Review **Today**, **Last 7 Days**, and **All Time** token summaries.
- Switch one Usage Over Time chart between **Daily**, **Weekly**, and **Monthly** calendar periods.
- Daily, Weekly, and Monthly calendar periods use your local time.
- Include the current calendar period, visually marked **In progress**.
- Set optional Daily, Monday-Sunday Weekly, and calendar-month token budgets.
- See the current period's projected usage, budget pace, remaining budget, recommended allowance, and forecast confidence.
- See the top source, project, and model contributors for the selected period.
- Compare the current period with the same elapsed calendar position in the previous period.
- Inspect the top three usage increases and decreases by source, project, or model.
- Find unusually heavy turns relative to your own recent local history.
- Filter turns by source and measurement quality, inspect individual turns, and expand Import Health warnings.

The dashboard separates the text you typed from the full request context and marks every metric as exact, estimated, partial lower bound, or unavailable.

## What's new in 0.7.0

- Compare today through the current time with yesterday through the same time, the current Monday-Sunday week with the previous week through the same weekday/time, or the current month with the previous month through the same calendar position.
- See overall change and switch one breakdown between Source, Project, and Model movers.
- Review the top three increases and decreases while partial or unavailable contributors are clearly omitted from unsafe rankings.
- Keep successfully imported Claude Code history healthy when malformed JSONL lines are ignored, with warning counts and expandable local diagnostics.

Budgets and insights are informational. They do not interrupt, throttle, or block any source tool.

Version 0.7.0 does not add cost tracking, notifications, arbitrary date ranges, or comparison chart overlays.

## Privacy

- All indexed data stays in `~/.token-usage-tracker/usage.sqlite` by default.
- No telemetry, cloud synchronization, or external network requests.
- Source histories are read-only.
- Authentication files are never read.
- Claude tool inputs and tool-result payloads are counted as events but are not retained in the tracker.
- Budgets, insights, and forecasts are calculated locally.
- Full project paths are retained only as local metadata; contributor cards display shortened project labels.
- The optional legacy Antigravity bridge only calls the running language server on `127.0.0.1`; its temporary CSRF value is never stored or logged.
- Deleting a source session removes its indexed copy after a complete successful scan. Partial scans never trigger deletion.

## Accuracy

| Source | Request and output usage | Typed prompt |
| --- | --- | --- |
| Codex | Exact when reported in session JSONL | Offline estimate |
| Claude Code | Exact from assistant usage when input, cache creation, cache read, and output components are all reported; otherwise a partial lower bound | Offline estimate |
| OpenCode | Exact from exported message usage | Offline estimate |
| Antigravity | Cumulative visible request context is a `≥` lower bound; visible output and exposed thinking are estimated; cache remains unavailable | Offline estimate from cleaned `<USER_REQUEST>` text |

Cached-input and reasoning-output values are shown separately and are not double-counted in totals.

Claude Code reasoning output remains unavailable as a separate metric because local transcripts do not report a distinct reasoning-token value. Nested `subagents/agent-*.jsonl` histories are imported separately, but their usage remains part of the same dashboard summaries, charts, budgets, and insights. If Claude Code session persistence is disabled, or older histories have been removed by Claude Code retention settings, those sessions cannot be imported.

Antigravity does not expose authoritative Gemini usage metadata in its local transcripts. Its lower bounds include observable prompt metadata, conversation history, tool calls, and tool results across model calls, but exclude unknown system context and caching.

Partial lower-bound totals are included in summaries and insights as known minimums. Unavailable values are excluded rather than treated as zero.

### Period comparison behavior

Period Comparison follows the active Daily, Weekly, or Monthly selector. It compares usage through the current local time with the same calendar position in the immediately previous period. For unequal month lengths, the previous cutoff is capped at that calendar month's end.

Exact comparisons show signed token and percentage changes. Comparisons containing estimates display `≈`. When either total is a partial lower bound or unavailable, both period totals remain visible but the tracker suppresses the signed and percentage delta because subtracting incomplete values is not reliable. Partial or unavailable contributors are likewise omitted from the top-three mover rankings and counted in an explanatory note.

### Forecast behavior

Usage Pace & Forecast applies only to the current active Daily, Weekly, or Monthly calendar period. It linearly projects the current known usage over the complete period, so the calculation remains transparent and does not use historical weighting. Forecasts are calculated on demand and are never stored in SQLite.

Projected usage is shown even without a configured budget. With a budget, the tracker reports:

- **On pace** when projected usage is below 80% of the budget.
- **At risk** from 80% to below 100%.
- **Likely to exceed** at 100% or more.
- **Budget exceeded** when actual known usage has already reached the budget.
- **Incomplete data** when a partial lower bound is below 80% and cannot safely establish that usage is on pace.

Confidence is Low before 25% of the period has elapsed, Medium from 25% to below 60%, and High from 60% onward. Partial lower-bound forecasts are capped at Medium confidence and display `≥`; estimated forecasts display `≈`. Until 1% of a period has elapsed, the dashboard shows **Not enough elapsed time** instead of an unstable projection.

When a budget is configured, Daily view recommends an allowance per remaining hour; Weekly and Monthly views recommend an allowance per remaining day. With partial data, remaining budget and recommended allowance are upper bounds marked `≤`. Forecasts are guidance only: they do not notify, interrupt, throttle, or change the tracked tools.

## Install

1. Build or download `token-usage-tracker-0.7.0.vsix`.
2. In VS Code or Antigravity, open **Extensions**.
3. Choose **Install from VSIX...** and select the package.
4. Open **Token Usage** from the Activity Bar or run **Token Usage: Open Dashboard** from the command palette.
5. Run **Token Usage: Refresh Now** to import persisted source histories.
6. Optionally set Daily, Weekly, and Monthly budgets from the dashboard or VS Code Settings.

You can also install the package from a terminal:

```sh
code --install-extension token-usage-tracker-0.7.0.vsix
```

The VSIX is platform-neutral. The extension includes Windows and macOS source-path discovery, including OpenCode CLI installations managed through NVM on macOS.

## Battery usage and refreshing

Background imports are disabled by default. The source tools retain their own histories, so **Token Usage: Refresh Now** safely catches up whenever you want updated numbers without continuously scanning while you work.

To opt into automatic imports, enable `tokenUsage.backgroundRefresh.enabled`. The default interval is 30 minutes and can be changed with `tokenUsage.refreshIntervalMinutes`. Recursive source-file watchers are not used.

Each refresh scans all history still persisted by the enabled source tools; the tracker does not apply a one-year import cutoff. **All Time** and the turn table use every imported turn. The Usage Over Time chart displays the latest 14 days, 12 calendar weeks, or 12 calendar months. Source-tool retention settings may remove older histories before the tracker can import them.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `tokenUsage.sources.codex.enabled` | `true` | Import Codex CLI sessions. |
| `tokenUsage.sources.claude.enabled` | `true` | Import Claude Code CLI sessions. |
| `tokenUsage.sources.opencode.enabled` | `true` | Import OpenCode CLI sessions. |
| `tokenUsage.sources.antigravity.enabled` | `true` | Import Antigravity IDE sessions. |
| `tokenUsage.paths.codex` | Empty | Optional Codex data-root override. |
| `tokenUsage.paths.claude` | Empty | Optional Claude Code projects-directory override. |
| `tokenUsage.paths.opencode` | Empty | Optional OpenCode data-root override. |
| `tokenUsage.paths.antigravity` | Empty | Optional Antigravity data-root override. |
| `tokenUsage.storagePath` | Empty | Optional shared tracker-database path override. |
| `tokenUsage.backgroundRefresh.enabled` | `false` | Run full source-history imports in the background. |
| `tokenUsage.refreshIntervalMinutes` | `30` | Background refresh interval in minutes; valid range is 5-1440. |
| `tokenUsage.budgets.daily` | `0` | Daily token budget; `0` disables it. |
| `tokenUsage.budgets.weekly` | `0` | Monday-Sunday token budget; `0` disables it. |
| `tokenUsage.budgets.monthly` | `0` | Calendar-month token budget; `0` disables it. |
| `tokenUsage.promptRetention` | `full` | For future imports, retain full prompt/visible response text or use `countsOnly`. |

Budget settings can be edited from the dashboard or VS Code Settings. The extension stores them in VS Code's global configuration so they apply consistently across workspaces.

Claude Code defaults to `${CLAUDE_CONFIG_DIR}/projects` when `CLAUDE_CONFIG_DIR` is set, otherwise `~/.claude/projects`.

## Commands

- **Token Usage: Open Dashboard**
- **Token Usage: Refresh Now**
- **Token Usage: Rebuild Local Index**
- **Token Usage: Show Import Diagnostics**
- **Token Usage: Delete All Tracker Data**

Import Health shows **Healthy · N warnings** when usable history was preserved despite recoverable issues. Expand the source row to inspect its local path and message. Use **Show Import Diagnostics** for the complete output log when a source reports **Needs attention**. Use **Rebuild Local Index** when you intentionally want to re-import all persisted source histories; routine upgrades do not require it.

## Development

Install dependencies and run the complete verification pipeline:

```sh
npm install
npm run verify
```

`npm run verify` runs the Vitest suite, TypeScript checks for both the extension and webview, and the production build.

Create a versioned VSIX in the repository root:

```sh
npm run package
```

Run the Playwright-based visual check after dashboard UI changes:

```sh
node scripts/visual-qa.mjs
```

## Project structure

| Path | Responsibility |
| --- | --- |
| `src/adapters/` | Discover and import Codex, Claude Code, OpenCode, and Antigravity histories. |
| `src/services/` | Coordinate imports and calculate dashboard periods, budgets, and insights. |
| `src/storage/` | Maintain the local SQLite-backed tracker index. |
| `src/webview/` | Connect the VS Code extension host to the dashboard. |
| `webview/src/` | Render the React dashboard and its interaction states. |
| `tests/` | Cover adapters, services, storage, extension configuration, and webview behavior. |

## License

[MIT](LICENSE)
