# Token Usage Tracker

A private VS Code-compatible extension that imports local usage history from:

- Codex CLI
- OpenCode CLI
- Antigravity IDE

The dashboard separates the text you typed from the full request context and
marks every metric as exact, estimated, partial lower bound, or unavailable.

## Privacy

- All indexed data stays in `~/.token-usage-tracker/usage.sqlite` by default.
- No telemetry, cloud synchronization, or outbound network requests.
- Source histories are read-only.
- Authentication files are never read.
- The optional legacy Antigravity bridge only calls the running language server
  on `127.0.0.1`; its temporary CSRF value is never stored or logged.
- Deleting a source session removes its indexed copy after a complete successful
  scan. Partial scans never trigger deletion.

## Accuracy

| Source | Request and output usage | Typed prompt |
| --- | --- | --- |
| Codex | Exact when reported in session JSONL | Offline estimate |
| OpenCode | Exact from exported message usage | Offline estimate |
| Antigravity | Cumulative visible request context is a `≥` lower bound; visible output and exposed thinking are estimated; cache remains unavailable | Offline estimate from cleaned `<USER_REQUEST>` text |

Cached-input and reasoning-output values are shown separately and are not
double-counted in totals.

Antigravity does not expose authoritative Gemini usage metadata in its local
transcripts. Its lower bounds include observable prompt metadata, conversation
history, tool calls, and tool results across model calls, but exclude unknown
system context and caching.

## Install

1. Build or download `token-usage-tracker-0.2.1.vsix`.
2. In VS Code or Antigravity, open Extensions.
3. Choose **Install from VSIX…** and select the package.
4. Open **Token Usage** from the Activity Bar or run
   **Token Usage: Open Dashboard**.

After upgrading from an earlier version, run **Token Usage: Rebuild Local Index** once to
replace previously stored Antigravity prompts with their cleaned versions.

The VSIX is platform-neutral. The implementation includes Windows and macOS
source paths and Antigravity process discovery.

## Battery usage and refreshing

Background imports are disabled by default. The source tools retain their own
histories, so **Token Usage: Refresh Now** safely catches up whenever you want
updated numbers without continuously scanning while you work.

To opt into automatic imports, enable
`tokenUsage.backgroundRefresh.enabled`. The default interval is 30 minutes and
can be changed with `tokenUsage.refreshIntervalMinutes`. Recursive source-file
watchers are not used.

## Commands

- Token Usage: Open Dashboard
- Token Usage: Refresh Now
- Token Usage: Rebuild Local Index
- Token Usage: Show Import Diagnostics
- Token Usage: Delete All Tracker Data

## Development

```sh
npm install
npm run verify
npm run package
```

Visual QA uses:

```sh
node scripts/visual-qa.mjs
```
