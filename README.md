# Token Usage Tracker

Token Usage Tracker is a private, local-first VS Code-compatible extension for understanding and controlling token usage across:

- Codex CLI
- OpenCode CLI
- Antigravity IDE

It imports persisted local histories into a local SQLite index, then presents summaries, calendar trends, budgets, contributors, unusually heavy turns, import health, and per-turn details in one dashboard. Usage data never leaves your machine.

## Dashboard

- Review **Today**, **Last 7 Days**, and **All Time** token summaries.
- Switch one Usage Over Time chart between **Daily**, **Weekly**, and **Monthly** calendar periods.
- Daily, Weekly, and Monthly calendar periods use your local time.
- Include the current calendar period, visually marked **In progress**.
- Set optional Daily, Monday-Sunday Weekly, and calendar-month token budgets.
- See the top source, project, and model contributors for the selected period.
- Find unusually heavy turns relative to your own recent local history.
- Filter turns by source and measurement quality, inspect individual turns, and monitor Import Health.

The dashboard separates the text you typed from the full request context and marks every metric as exact, estimated, partial lower bound, or unavailable.

## What's new in 0.4.0

- Optional Daily, Weekly, and Monthly token budgets.
- Clear budget states: **On track** below 80%, **Approaching limit** from 80% to below 100%, and **Budget exceeded** at 100% or more.
- Top source, project, and model explanations for the active calendar period.
- Unusually heavy-turn detection using your own 30-day local history. A turn is highlighted only after at least five comparable turns and when it is at least 1.5 times the median.
- Request-scoped, conflict-aware budget saves that stay synchronized with VS Code global settings.

Budgets and insights are informational. They do not interrupt, throttle, or block any source tool.

## Privacy

- All indexed data stays in `~/.token-usage-tracker/usage.sqlite` by default.
- No telemetry, cloud synchronization, or external network requests.
- Source histories are read-only.
- Authentication files are never read.
- Budgets and insights are calculated locally.
- Full project paths are retained only as local metadata; contributor cards display shortened project labels.
- The optional legacy Antigravity bridge only calls the running language server on `127.0.0.1`; its temporary CSRF value is never stored or logged.
- Deleting a source session removes its indexed copy after a complete successful scan. Partial scans never trigger deletion.

## Accuracy

| Source | Request and output usage | Typed prompt |
| --- | --- | --- |
| Codex | Exact when reported in session JSONL | Offline estimate |
| OpenCode | Exact from exported message usage | Offline estimate |
| Antigravity | Cumulative visible request context is a `≥` lower bound; visible output and exposed thinking are estimated; cache remains unavailable | Offline estimate from cleaned `<USER_REQUEST>` text |

Cached-input and reasoning-output values are shown separately and are not double-counted in totals.

Antigravity does not expose authoritative Gemini usage metadata in its local transcripts. Its lower bounds include observable prompt metadata, conversation history, tool calls, and tool results across model calls, but exclude unknown system context and caching.

Partial lower-bound totals are included in summaries and insights as known minimums. Unavailable values are excluded rather than treated as zero.

## Install

1. Build or download `token-usage-tracker-0.4.0.vsix`.
2. In VS Code or Antigravity, open **Extensions**.
3. Choose **Install from VSIX...** and select the package.
4. Open **Token Usage** from the Activity Bar or run **Token Usage: Open Dashboard** from the command palette.
5. Run **Token Usage: Refresh Now** to import persisted source histories.
6. Optionally set Daily, Weekly, and Monthly budgets from the dashboard or VS Code Settings.

You can also install the package from a terminal:

```sh
code --install-extension token-usage-tracker-0.4.0.vsix
```

The VSIX is platform-neutral. The extension includes Windows and macOS source-path discovery, including OpenCode CLI installations managed through NVM on macOS.

## Battery usage and refreshing

Background imports are disabled by default. The source tools retain their own histories, so **Token Usage: Refresh Now** safely catches up whenever you want updated numbers without continuously scanning while you work.

To opt into automatic imports, enable `tokenUsage.backgroundRefresh.enabled`. The default interval is 30 minutes and can be changed with `tokenUsage.refreshIntervalMinutes`. Recursive source-file watchers are not used.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `tokenUsage.sources.codex.enabled` | `true` | Import Codex CLI sessions. |
| `tokenUsage.sources.opencode.enabled` | `true` | Import OpenCode CLI sessions. |
| `tokenUsage.sources.antigravity.enabled` | `true` | Import Antigravity IDE sessions. |
| `tokenUsage.paths.codex` | Empty | Optional Codex data-root override. |
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

## Commands

- **Token Usage: Open Dashboard**
- **Token Usage: Refresh Now**
- **Token Usage: Rebuild Local Index**
- **Token Usage: Show Import Diagnostics**
- **Token Usage: Delete All Tracker Data**

Use **Show Import Diagnostics** when a source reports **Needs attention**. Use **Rebuild Local Index** when you intentionally want to re-import all persisted source histories; routine upgrades do not require it.

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
| `src/adapters/` | Discover and import Codex, OpenCode, and Antigravity histories. |
| `src/services/` | Coordinate imports and calculate dashboard periods, budgets, and insights. |
| `src/storage/` | Maintain the local SQLite-backed tracker index. |
| `src/webview/` | Connect the VS Code extension host to the dashboard. |
| `webview/src/` | Render the React dashboard and its interaction states. |
| `tests/` | Cover adapters, services, storage, extension configuration, and webview behavior. |

## License

[MIT](LICENSE)
