# Change Log

## 0.4.0

- Add optional Daily, Weekly, and Monthly token budgets with clear usage-status thresholds.
- Show top source, project, and model contributors for the selected calendar period.
- Identify unusually heavy turns using local, evidence-based historical comparisons.
- Keep budget saves request-scoped, conflict-aware, and synchronized with VS Code global settings.

## 0.3.0

- Add a single Daily, Weekly, and Monthly selector to the Usage Over Time chart.
- Precompute local-calendar daily, Monday–Sunday weekly, and monthly usage buckets.
- Include the current period with an In progress treatment and remember the selected view.

## 0.2.3

- Fix OpenCode CLI import health on macOS when OpenCode is installed through NVM.
- Import all OpenCode sessions from a consistent SQLite snapshot while its WAL is active.
- Preserve compatible CLI and direct-database fallbacks for other OpenCode versions and platforms.

## 0.2.1

- Disable background history imports by default to conserve battery.
- Remove recursive filesystem watchers that could trigger repeated full scans.
- Use a 30-minute interval when background imports are explicitly enabled.
- Add a PNG marketplace icon.

## 0.2.0

- Add partial lower-bound token quality, displayed with `≥`.
- Estimate cumulative visible Antigravity request context across model calls.
- Estimate exposed Antigravity thinking and serialized tool-call output.
- Include partial usage in summaries, charts, filters, and turn details.

## 0.1.1

- Clean Antigravity prompt wrappers and omit injected workspace metadata.
- Extract and carry forward Antigravity model-selection changes.
- Use the `axhpx1` Open VSX publisher namespace.

## 0.1.0

- Import Codex, OpenCode, and Antigravity local sessions.
- Distinguish typed-input estimates from full request usage.
- Add overview, trend, per-turn table, detail view, and import health.
- Add local-only shared storage, safe deletion mirroring, and diagnostics.
