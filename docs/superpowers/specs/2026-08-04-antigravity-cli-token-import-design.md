# Antigravity CLI Token Import Design

## Goal

Add read-only Antigravity CLI history import so the tracker can report its usage independently from Antigravity IDE, preserve authoritative recorded token counts, and avoid counting shared conversations twice.

## Product Outcome

Antigravity CLI appears as a fifth source named **Antigravity CLI**. Its import health, charts, filters, comparisons, contributors, recent turns, and diagnostics remain distinct from **Antigravity IDE**.

The feature follows the existing local-first contract:

- Source histories are read-only.
- Authentication files, keyrings, settings, and logs are not accessed.
- Exact, estimated, partial, and unavailable values remain visibly distinct.
- Background refresh remains opt-in, while **Refresh Now** imports all enabled sources.

## Source Identity and Configuration

Add `"antigravity-cli"` to the `Source` union and use that value in normalized session, turn, health, trend, filter, and insight data. Existing `"antigravity"` data remains the Antigravity IDE source.

Add an `AntigravityCliAdapter` with the default root:

```text
~/.gemini/antigravity-cli
```

Add these VS Code settings:

```text
tokenUsage.sources.antigravityCli.enabled
tokenUsage.paths.antigravityCli
```

The source is enabled by default, matching the other supported tools. The path setting defaults to an empty override and resolves through `resolveSourcePaths`.

## Discovery and Database Snapshot

Discover persisted conversations from:

```text
<antigravity-cli-root>/conversations/*.db
```

Each file is an independent SQLite conversation. The adapter reads the `trajectory_meta` and `steps` tables and uses the persisted cascade ID as the canonical conversation ID, falling back to the database filename only when the canonical value is absent.

The adapter must support an active Antigravity CLI session without modifying or locking its source database. It creates an in-memory, WAL-aware snapshot:

1. Read the base database header and file metadata.
2. Read the `-wal` sidecar when present; the `-shm` file is not needed.
3. Validate the WAL magic, page size, salts, frame boundaries, checksum chain, and last committed transaction.
4. Overlay committed WAL pages onto a copy of the base database and truncate or extend it to the committed database-page count.
5. Confirm the source files did not change incompatibly during the read. Retry up to three times when they did.
6. Open only the resulting in-memory bytes with `sql.js`.

An absent WAL uses the stable base database directly. An invalid, torn, or continuously changing WAL produces a file-specific issue after retries are exhausted; it never falls back to silently ignoring committed WAL data.

## Protobuf Decoding

Conversation rows store step metadata and payloads as protobuf blobs. Implement a focused wire-format decoder for the fields required by this feature rather than depending on a generated, version-locked schema.

The decoder must:

- Support varint, fixed32, fixed64, and length-delimited wire types.
- Skip unknown fields safely.
- Reject truncated fields, invalid field numbers, unsupported wire types, and unreasonable lengths.
- Decode user input, visible model output, tool-event identity, timestamps, model/provider identity, parent/subtrajectory identity, and model-usage metadata.
- Keep schema-specific field mappings isolated and covered by fixtures.

Known enum values map to readable model and provider names. Unknown values remain unidentified and generate no invented label.

## Turn Construction and Metrics

Each user input starts one normalized turn. Subsequent model calls and tool events are associated with that turn until the next user input. Persisted subagent usage is included and uses `executionScope: "subagent"` when parent/subtrajectory metadata identifies it.

Sum every recorded model-usage entry for the normalized turn. Map fields as follows:

| Tracker metric | Antigravity CLI fields | Quality |
| --- | --- | --- |
| Typed input | Existing offline estimate of visible user text | Estimated |
| Request input | `input_tokens + cache_read_tokens + cache_write_tokens` | Exact |
| Cached input | `cache_read_tokens` | Exact |
| Output | `output_tokens` | Exact |
| Reasoning output | `thinking_output_tokens` | Exact |
| Total | Request input + output | Exact when both components are exact |

Cached input is a subset of request input. Reasoning output is a subset of output. Neither is added to the total a second time. Response-output metadata may be used for validation but does not create another tracker metric.

If recorded usage is missing, decode the visible prompt and response and apply the existing estimation policy. Visible lower bounds are `partial`; text-only output estimates are `estimated`; insufficient content is `unavailable`. A total containing any partial component is partial, and a mix of exact and estimated values is never labeled exact.

## CLI and IDE Deduplication

Antigravity CLI and IDE can expose the same conversation. After adapters scan and before results are persisted, the import coordinator compares canonical cascade IDs across the two sources.

- A successfully parsed CLI session takes precedence because it contains recorded usage.
- Remove its matching IDE session, turns, and seen-session entry before applying the IDE result so previously stored IDE duplicates are deleted on a complete import.
- If the CLI copy could not be parsed, retain the IDE copy.
- Deduplication is session-scoped; unrelated IDE history remains unchanged.
- Report the number of excluded IDE duplicates in the import output without creating a warning or degrading source health.

## Import Health and Recovery

Process every database independently. A failure in one conversation does not block successfully parsed conversations.

- **Healthy:** every discovered database was imported successfully.
- **Healthy · N warnings:** all usable history was imported, but recoverable conditions occurred, such as missing optional metadata or older sessions that required estimates.
- **Needs attention:** at least one database could not be snapshotted or decoded and no safe fallback was available.

Coalesce repetitive estimate warnings to avoid one warning per turn. Unknown optional fields are ignored. Missing required tables, invalid required fields, unsupported required schema changes, and exhausted snapshot retries produce actionable diagnostics containing the affected path.

Incomplete results set `complete: false`, allowing the existing store to update healthy sessions while preserving previously indexed sessions that were not safely observed. Complete results retain the existing stale-session pruning behavior.

## Dashboard Changes

Rename the existing display label to **Antigravity IDE** and add **Antigravity CLI** with a distinct but related chart color.

Extend all source-aware shared models and UI maps, including:

- Daily, Weekly, and Monthly trend points
- Source legends and tooltips
- Import Health
- Source filters
- Period comparison movers
- Contributor insights and heavy-turn baselines
- Recent-turn rows and detail panels

Deduplicated IDE copies do not contribute to totals, budgets, forecasts, comparisons, or insights. Global budgets and the single aggregation selector remain unchanged. No new budget type or dashboard selector is introduced.

Update package metadata and README support, configuration, privacy, accuracy, and troubleshooting sections.

## Testing

Use behavior-focused Vitest coverage for:

- Default and overridden path resolution on macOS, Linux, and Windows.
- Database discovery and required-table validation.
- Stable base-database snapshots.
- Valid committed WAL overlay, uncommitted frames, bad checksums, torn frames, source changes, and exhausted retries.
- Protobuf unknown-field tolerance and malformed-wire rejection.
- Exact input, cache-read, cache-write, output, reasoning, and total mapping without double-counting.
- Estimated, partial, and unavailable fallbacks.
- Turn grouping, tool counts, model/provider handling, and persisted subagents.
- Independent per-file failure handling and incomplete-import retention.
- CLI-first cross-source deduplication, including removal of previously stored IDE duplicates.
- Dashboard labels, source filters, trend segments, health rows, partial styling, comparisons, and contributor calculations.

Run `npm run verify`, then run `node scripts/visual-qa.mjs` against the current production build.

## Acceptance Criteria

1. Antigravity CLI appears separately from Antigravity IDE throughout the product.
2. Recorded CLI usage is displayed as exact and maps cache and reasoning values without double-counting.
3. An active conversation imports safely while `agy` is running and its WAL contains committed data.
4. Older compatible history remains visible with honest quality labels.
5. A conversation shared by CLI and IDE contributes only once, using the CLI copy.
6. One damaged database produces a targeted diagnostic without deleting healthy or previously retained history.
7. Refresh and background-import behavior matches the existing sources.
8. Source databases remain unchanged, and authentication material is never accessed.

## Out of Scope

- Reading live quota or subscription limits from `/usage`
- Executing `agy` during detection or import
- Modifying, checkpointing, or repairing source databases
- Per-source token budgets
- Arbitrary date ranges or another aggregation selector
- Cost estimation or billing reconciliation
