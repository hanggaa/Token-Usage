# Antigravity CLI Token Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Antigravity CLI conversation history as a separate, read-only source with exact recorded token metrics, WAL-safe snapshots, and CLI-first deduplication against Antigravity IDE.

**Architecture:** Add a pure TypeScript SQLite WAL snapshot reader and focused protobuf wire decoder, then use them in a new `AntigravityCliAdapter` that normalizes each persisted conversation into the existing session/turn model. Reconcile CLI and IDE results in the import coordinator before storage, then extend existing source-aware dashboard contracts and UI without introducing a second selector or budget system.

**Tech Stack:** TypeScript ES modules, Node.js filesystem APIs, `sql.js`, Vitest, React 19, React Testing Library, VS Code extension configuration, Playwright visual QA.

## Global Constraints

- Use the internal source ID `"antigravity-cli"` and display label **Antigravity CLI**; retain `"antigravity"` as **Antigravity IDE**.
- Default data root is `~/.gemini/antigravity-cli`; add `tokenUsage.sources.antigravityCli.enabled` and `tokenUsage.paths.antigravityCli`.
- Source files are read-only. Do not execute `agy`, touch `-shm`, checkpoint source WAL files, or access settings, logs, authentication files, or keyrings.
- Use `sql.js` on an in-memory snapshot; do not add a native SQLite dependency or depend on a system `sqlite3` executable.
- Validate and apply only committed WAL frames. Never ignore a present WAL silently.
- Preserve exact, estimated, partial, and unavailable quality distinctions. Cached input is a subset of request input; reasoning output is a subset of output.
- A parsed CLI conversation wins over the same Antigravity IDE cascade ID; an unparsed CLI file does not suppress the IDE copy.
- Background refresh stays disabled by default. No recursive filesystem watcher is added.
- Keep strict TypeScript, ES modules, two-space indentation, semicolons, and double quotes.
- Do not update the extension version or create a VSIX in this feature plan.
- Stage only files listed by the active task and preserve unrelated changes.

---

## File Structure

### New production files

- `src/adapters/protobuf-wire.ts`: bounded protobuf wire decoding and typed field accessors.
- `src/adapters/sqlite-wal-snapshot.ts`: stable read-only base/WAL snapshots and committed-frame overlay.
- `src/adapters/antigravity-cli-protobuf.ts`: Antigravity CLI step, metadata, usage, timestamp, prompt, and response field mappings.
- `src/adapters/antigravity-cli.ts`: group decoded steps into normalized turns and apply metric-quality rules.
- `src/adapters/antigravity-cli-source.ts`: discover SQLite conversations, query snapshots, read optional summaries, and produce `ImportResult` health.

### New test files

- `tests/helpers/sqlite-wal-fixtures.ts`
- `tests/helpers/antigravity-cli-fixtures.ts`
- `tests/adapters/protobuf-wire.test.ts`
- `tests/adapters/sqlite-wal-snapshot.test.ts`
- `tests/adapters/antigravity-cli.test.ts`
- `tests/adapters/antigravity-cli-source.test.ts`

### Existing files modified across tasks

- Domain/shared contracts: `src/domain/types.ts`, `src/shared/dashboard.ts`
- Paths/configuration/wiring: `src/adapters/paths.ts`, `src/extension.ts`, `package.json`, `tests/extension-config.test.ts`
- Import reconciliation: `src/services/import-coordinator.ts`, `tests/services/import-coordinator.test.ts`, `tests/storage/tracker-store.test.ts`
- Aggregation/labels: `src/services/dashboard.ts`, `src/services/usage-insights.ts`, `src/services/usage-comparison.ts` and their tests
- Webview: `webview/src/App.tsx`, `webview/src/UsageGuardrails.tsx`, `webview/src/styles.css`, related component tests, and `scripts/visual-qa.mjs`
- Documentation/smoke support: `README.md`, `scripts/import-local-smoke.ts`
- Approved source: `docs/superpowers/specs/2026-08-04-antigravity-cli-token-import-design.md` is read-only during implementation.

### Task 1: Extend source contracts and aggregation services

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/shared/dashboard.ts`
- Modify: `src/services/dashboard.ts`
- Modify: `src/services/usage-insights.ts`
- Modify: `src/services/usage-comparison.ts`
- Modify: `webview/src/App.tsx`
- Modify: `webview/src/UsageGuardrails.tsx`
- Test: `tests/services/dashboard.test.ts`
- Test: `tests/services/usage-insights.test.ts`
- Test: `tests/services/usage-comparison.test.ts`

**Interfaces:**
- Consumes: existing `Source`, `TrendPoint`, `SOURCES`, source-label maps, and dashboard aggregation helpers.
- Produces: `Source` including `"antigravity-cli"`; `TrendPoint["antigravity-cli"]`; source maps that are exhaustive for all five sources.

- [ ] **Step 1: Write failing aggregation tests for the new source**

Add a CLI turn to `tests/services/dashboard.test.ts`:

```ts
it("aggregates Antigravity CLI separately from Antigravity IDE", () => {
  const snapshot = buildDashboardSnapshot(
    [
      turn("ide", localTimestamp(2026, 6, 9), "antigravity", 40, "partial"),
      turn("cli", localTimestamp(2026, 6, 9), "antigravity-cli", 90, "exact")
    ],
    [],
    new Date(2026, 6, 9, 12)
  );

  expect(snapshot.trends.daily.at(-1)).toMatchObject({
    antigravity: 40,
    "antigravity-cli": 90,
    partialSources: ["antigravity"]
  });
});
```

Add assertions to the insight and comparison tests that a `"antigravity-cli"` contributor is labeled `Antigravity CLI`, while `"antigravity"` is labeled `Antigravity IDE`.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
npm run test -- tests/services/dashboard.test.ts tests/services/usage-insights.test.ts tests/services/usage-comparison.test.ts
```

Expected: FAIL because `"antigravity-cli"` is not assignable to `Source` or absent from trend/source maps.

- [ ] **Step 3: Extend the source and trend contracts**

Update the contracts exactly as follows:

```ts
export type Source =
  | "codex"
  | "claude"
  | "opencode"
  | "antigravity"
  | "antigravity-cli";
```

```ts
export interface TrendPoint {
  startDate: string;
  endDate: string;
  inProgress: boolean;
  codex: number | null;
  claude: number | null;
  opencode: number | null;
  antigravity: number | null;
  "antigravity-cli": number | null;
  partialSources?: Source[];
}

export const SOURCES: Source[] = [
  "codex",
  "claude",
  "opencode",
  "antigravity",
  "antigravity-cli"
];
```

Add `"antigravity-cli"` to `emptySources()` and every constructed trend point. Update every exhaustive `Record<Source, string>` in service and webview code to use these labels:

```ts
const SOURCE_LABELS: Record<Source, string> = {
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
  antigravity: "Antigravity IDE",
  "antigravity-cli": "Antigravity CLI"
};
```

Because the labels now include the interface name, replace the Import Health expression `{SOURCE_LABELS[source]} {source === "antigravity" ? "IDE" : "CLI"}` with `{SOURCE_LABELS[source]}` in the same step. This prevents temporary `Antigravity IDE IDE` and `Antigravity CLI CLI` text.

- [ ] **Step 4: Run focused tests and both typechecks**

Run:

```bash
npm run test -- tests/services/dashboard.test.ts tests/services/usage-insights.test.ts tests/services/usage-comparison.test.ts
npm run typecheck
```

Expected: all focused tests PASS and both TypeScript projects report no errors.

- [ ] **Step 5: Commit the source-contract slice**

```bash
git add src/domain/types.ts src/shared/dashboard.ts src/services/dashboard.ts src/services/usage-insights.ts src/services/usage-comparison.ts webview/src/App.tsx webview/src/UsageGuardrails.tsx tests/services/dashboard.test.ts tests/services/usage-insights.test.ts tests/services/usage-comparison.test.ts
git commit -m "feat: add Antigravity CLI source contract"
```

### Task 2: Add bounded protobuf wire decoding

**Files:**
- Create: `src/adapters/protobuf-wire.ts`
- Create: `tests/adapters/protobuf-wire.test.ts`

**Interfaces:**
- Consumes: raw `Uint8Array` protobuf messages.
- Produces: `decodeProtobufMessage(bytes, maximumLength?)`, `varintValue(fields, number)`, `bytesValue(fields, number)`, `allBytesValues(fields, number)`, and `utf8Value(fields, number)`.

- [ ] **Step 1: Write failing wire-decoder tests**

Create tests that encode messages locally and assert exact field behavior:

```ts
function varint(value: bigint): Uint8Array {
  const bytes: number[] = [];
  let remaining = value;
  do {
    const next = Number(remaining & 0x7fn);
    remaining >>= 7n;
    bytes.push(next | (remaining > 0n ? 0x80 : 0));
  } while (remaining > 0n);
  return Uint8Array.from(bytes);
}

function field(number: number, wireType: number, value: Uint8Array): Uint8Array {
  return Uint8Array.from([...varint(BigInt((number << 3) | wireType)), ...value]);
}

it("decodes varint, fixed, bytes, and repeated fields while preserving unknowns", () => {
  const text = new TextEncoder().encode("hello");
  const message = Uint8Array.from([
    ...field(1, 0, varint(150n)),
    ...field(2, 2, Uint8Array.from([...varint(BigInt(text.length)), ...text])),
    ...field(2, 2, Uint8Array.from([...varint(1n), 0x78])),
    ...field(99, 5, Uint8Array.from([1, 2, 3, 4]))
  ]);
  const fields = decodeProtobufMessage(message);

  expect(varintValue(fields, 1)).toBe(150n);
  expect(utf8Value(fields, 2)).toBe("hello");
  expect(allBytesValues(fields, 2)).toHaveLength(2);
  expect(fields.some((item) => item.number === 99 && item.wireType === 5)).toBe(true);
});

it.each([
  Uint8Array.from([0x00]),
  Uint8Array.from([0x0f]),
  Uint8Array.from([0x12, 0x05, 0x61])
])("rejects malformed protobuf bytes", (message) => {
  expect(() => decodeProtobufMessage(message)).toThrow();
});
```

- [ ] **Step 2: Run the decoder tests to verify they fail**

Run:

```bash
npm run test -- tests/adapters/protobuf-wire.test.ts
```

Expected: FAIL because `protobuf-wire.ts` does not exist.

- [ ] **Step 3: Implement the bounded wire reader and accessors**

Use these public types and limits:

```ts
export type ProtobufWireType = 0 | 1 | 2 | 5;

export interface ProtobufField {
  number: number;
  wireType: ProtobufWireType;
  value: bigint | Uint8Array;
}

const DEFAULT_MAXIMUM_LENGTH = 64 * 1024 * 1024;
const MAXIMUM_FIELD_NUMBER = 536_870_911;
```

Implement varints with `bigint`, reject values requiring more than ten bytes, and enforce bounds before slicing. `decodeProtobufMessage` must advance by 8 bytes for wire type 1, read a bounded length and slice for wire type 2, and advance by 4 bytes for wire type 5. Wire types 3, 4, 6, and 7 throw an error containing the byte offset.

Implement accessors with strict wire-type checks:

```ts
export function varintValue(fields: ProtobufField[], number: number): bigint | null {
  const field = fields.find((item) => item.number === number && item.wireType === 0);
  return typeof field?.value === "bigint" ? field.value : null;
}

export function allBytesValues(fields: ProtobufField[], number: number): Uint8Array[] {
  return fields
    .filter((item) => item.number === number && item.wireType === 2)
    .map((item) => item.value)
    .filter((value): value is Uint8Array => value instanceof Uint8Array);
}

export function bytesValue(fields: ProtobufField[], number: number): Uint8Array | null {
  return allBytesValues(fields, number)[0] ?? null;
}

export function utf8Value(fields: ProtobufField[], number: number): string | null {
  const value = bytesValue(fields, number);
  return value ? new TextDecoder("utf-8", { fatal: true }).decode(value) : null;
}
```

- [ ] **Step 4: Run decoder tests and typecheck**

Run:

```bash
npm run test -- tests/adapters/protobuf-wire.test.ts
npm run typecheck
```

Expected: PASS with malformed data rejected deterministically.

- [ ] **Step 5: Commit the decoder**

```bash
git add src/adapters/protobuf-wire.ts tests/adapters/protobuf-wire.test.ts
git commit -m "feat: decode bounded protobuf messages"
```

### Task 3: Build read-only SQLite WAL snapshots

**Files:**
- Create: `src/adapters/sqlite-wal-snapshot.ts`
- Create: `tests/helpers/sqlite-wal-fixtures.ts`
- Create: `tests/adapters/sqlite-wal-snapshot.test.ts`

**Interfaces:**
- Consumes: a SQLite database path and optional `<path>-wal` bytes.
- Produces: `applyCommittedWal(databaseBytes, walBytes): Uint8Array` and `readSqliteSnapshot(databasePath, options?): Promise<Uint8Array>`.

- [ ] **Step 1: Write failing tests for committed, uncommitted, and corrupt WAL data**

Create `tests/helpers/sqlite-wal-fixtures.ts` with these exports:

```ts
export interface WalFrameFixture {
  pageNumber: number;
  committedPageCount: number;
  page: Uint8Array;
}

export function page(pageNumber: number, fill: number, pageSize = 1_024): Uint8Array;
export function databaseWithPages(pages: Uint8Array[]): Uint8Array;
export function frame(
  pageNumber: number,
  committedPageCount: number,
  pageBytes: Uint8Array
): WalFrameFixture;
export function walFile(frames: WalFrameFixture[], pageSize = 1_024): Uint8Array;
export function byteFromPage(
  database: Uint8Array,
  pageNumber: number,
  pageSize?: number
): number;
```

`page(1, fill)` must write `SQLite format 3\0` at bytes 0–15 and encode the page size at bytes 16–17; other bytes use `fill`. `databaseWithPages` concatenates pages without gaps. `walFile` writes a 32-byte header, fixed salts `0x11223344` and `0x55667788`, then 24-byte frame headers plus page bytes. Its independent checksum helper processes pairs of 32-bit words with unsigned arithmetic:

```ts
s1 = (s1 + word0 + s2) >>> 0;
s2 = (s2 + word1 + s1) >>> 0;
```

Continue the accumulator from the WAL header through every frame's first eight header bytes and page content, then store the resulting pair in that frame. Use magic `0x377f0682` for little-endian checksum words.

Import those helpers in the test and cover these behaviors:

```ts
it("overlays frames only through the last commit and honors committed database size", () => {
  const base = databaseWithPages([page(1, 0x11), page(2, 0x22)]);
  const wal = walFile([
    frame(2, 0, page(2, 0x33)),
    frame(1, 2, page(1, 0x44)),
    frame(2, 0, page(2, 0x55))
  ]);

  const snapshot = applyCommittedWal(base, wal);

  expect(byteFromPage(snapshot, 1)).toBe(0x44);
  expect(byteFromPage(snapshot, 2)).toBe(0x33);
});

it("rejects a checksum mismatch instead of ignoring the WAL", () => {
  const base = databaseWithPages([page(1, 0x11)]);
  const wal = walFile([frame(1, 1, page(1, 0x22))]);
  wal[wal.length - 1] ^= 0xff;

  expect(() => applyCommittedWal(base, wal)).toThrow(/checksum/i);
});
```

Add injected-I/O tests for `readSqliteSnapshot` that simulate one changing read followed by a stable read, and a source that changes on all three attempts.

- [ ] **Step 2: Run the snapshot tests to verify they fail**

Run:

```bash
npm run test -- tests/adapters/sqlite-wal-snapshot.test.ts
```

Expected: FAIL because the snapshot module does not exist.

- [ ] **Step 3: Implement WAL validation and committed-page overlay**

Use these constants and interfaces:

```ts
const WAL_HEADER_BYTES = 32;
const WAL_FRAME_HEADER_BYTES = 24;
const SQLITE_HEADER = new TextEncoder().encode("SQLite format 3\0");
const WAL_MAGIC_LITTLE_CHECKSUM = 0x377f0682;
const WAL_MAGIC_BIG_CHECKSUM = 0x377f0683;

export interface SnapshotIo {
  readFile(path: string): Promise<Uint8Array>;
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
}

export interface SqliteSnapshotOptions {
  attempts?: number;
  io?: SnapshotIo;
}
```

`applyCommittedWal` must validate the database header and page size, validate the WAL header and matching page size, carry the two rolling checksum accumulators across every frame, and require each frame salt to match the WAL header. Track the last frame whose database-size field is nonzero. Apply frames only through that commit and resize the result to `committedPageCount * pageSize`.

`readSqliteSnapshot` must perform this sequence for each attempt:

```ts
const before = await io.stat(databasePath);
const databaseBytes = await io.readFile(databasePath);
const walBefore = await optionalStat(`${databasePath}-wal`, io);
const walBytes = walBefore ? await io.readFile(`${databasePath}-wal`) : null;
const after = await io.stat(databasePath);
const walAfter = await optionalStat(`${databasePath}-wal`, io);
```

Define `optionalStat` so only a filesystem `ENOENT` becomes `null`; permission and I/O errors must propagate:

```ts
async function optionalStat(path: string, io: SnapshotIo) {
  try {
    return await io.stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
```

Accept the read only when base size/mtime and WAL presence/size/mtime are unchanged. Return base bytes when no WAL exists; otherwise return `applyCommittedWal(databaseBytes, walBytes)`. After the configured attempts, throw `SQLite source changed during 3 snapshot attempts`.

- [ ] **Step 4: Run the WAL test matrix and typecheck**

Run:

```bash
npm run test -- tests/adapters/sqlite-wal-snapshot.test.ts
npm run typecheck
```

Expected: committed overlay, uncommitted-frame exclusion, checksum, salt, torn-frame, and retry tests all PASS.

- [ ] **Step 5: Commit the snapshot reader**

```bash
git add src/adapters/sqlite-wal-snapshot.ts tests/helpers/sqlite-wal-fixtures.ts tests/adapters/sqlite-wal-snapshot.test.ts
git commit -m "feat: read SQLite histories with active WAL"
```

### Task 4: Decode and normalize Antigravity CLI conversations

**Files:**
- Create: `src/adapters/antigravity-cli-protobuf.ts`
- Create: `src/adapters/antigravity-cli.ts`
- Create: `tests/helpers/antigravity-cli-fixtures.ts`
- Create: `tests/adapters/antigravity-cli.test.ts`

**Interfaces:**
- Consumes: SQLite step rows `{ idx, stepType, status, metadata, stepPayload }` and conversation identity metadata.
- Produces: `decodeAntigravityCliStep(row): DecodedAntigravityCliStep` and `parseAntigravityCliConversation(input): ParsedAntigravityCliSession`.

- [ ] **Step 1: Write failing exact-metric and fallback tests**

Create `tests/helpers/antigravity-cli-fixtures.ts` with the same `varint` and length-delimited encoding rules used in Task 2, plus these concrete helpers:

```ts
export interface UsageFixture {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  thinkingOutputTokens?: number;
  responseOutputTokens?: number;
  model?: number;
  provider?: number;
}

export function userStep(
  idx: number,
  prompt: string,
  timestamp: string
): AntigravityCliStepRow;

export function plannerStep(
  idx: number,
  response: string,
  usage: UsageFixture,
  timestamp?: string
): AntigravityCliStepRow;
```

`userStep` must encode the whole Cortex step as type field `1 = 14`, status field `4 = 3`, metadata field `5`, and user-input payload field `19` whose user-response field is `2`. `plannerStep` uses type `15`, status `3`, metadata field `9` for usage, and planner payload field `20` with modified-response field `8`. Metadata field `1` contains a protobuf timestamp derived from the supplied ISO value. Usage uses fields `1, 2, 3, 4, 5, 6, 9, 10` exactly as listed in Step 3.

Use those helpers to construct a completed user-input step followed by a completed planner response:

```ts
it("maps recorded cache and reasoning usage without double counting", () => {
  const parsed = parseAntigravityCliConversation({
    conversationId: "cascade-1",
    sourcePath: "/history/cascade-1.db",
    title: "Fix importer",
    project: "/work/token-usage",
    executionScope: "main",
    rows: [
      userStep(0, "Fix the importer.", "2026-08-04T01:00:00.000Z"),
      plannerStep(1, "Importer fixed.", {
        inputTokens: 100,
        outputTokens: 40,
        cacheWriteTokens: 10,
        cacheReadTokens: 60,
        thinkingOutputTokens: 12,
        responseOutputTokens: 28,
        provider: 24
      })
    ]
  });

  expect(parsed.session.sourceSessionId).toBe("cascade-1");
  expect(parsed.turns[0]).toMatchObject({
    source: "antigravity-cli",
    provider: "google",
    prompt: "Fix the importer.",
    response: "Importer fixed."
  });
  expect(Object.fromEntries(parsed.turns[0].metrics.map((metric) => [metric.kind, metric])))
    .toMatchObject({
      request_input: { value: 170, quality: "exact" },
      cached_input: { value: 60, quality: "exact" },
      output: { value: 40, quality: "exact" },
      reasoning_output: { value: 12, quality: "exact" },
      total: { value: 210, quality: "exact" }
    });
});
```

Add tests for multiple model-usage entries in one user turn, unknown fields/enums, a visible response without usage, missing visible content, completed subagent scope, and malformed required step payloads.

- [ ] **Step 2: Run the parser tests to verify they fail**

Run:

```bash
npm run test -- tests/adapters/antigravity-cli.test.ts
```

Expected: FAIL because the CLI protobuf and normalization modules do not exist.

- [ ] **Step 3: Implement schema-specific protobuf mapping**

Define these constants in `antigravity-cli-protobuf.ts`:

```ts
const DONE_STATUS = 3;
const USER_INPUT_STEP = 14;
const PLANNER_RESPONSE_STEP = 15;
const STEP_METADATA_FIELD = 5;
const USER_INPUT_PAYLOAD_FIELD = 19;
const PLANNER_RESPONSE_PAYLOAD_FIELD = 20;
const CREATED_AT_FIELD = 1;
const MODEL_USAGE_FIELD = 9;
const GENERATOR_MODEL_FIELD = 11;
const USER_RESPONSE_FIELD = 2;
const PLANNER_RESPONSE_FIELD = 3;
const MODIFIED_RESPONSE_FIELD = 8;
```

Decode `ModelUsageStats` with this exact mapping:

```ts
export interface AntigravityCliUsage {
  modelCode: number | null;              // field 1
  inputTokens: number;                   // field 2
  outputTokens: number;                  // field 3
  cacheWriteTokens: number;              // field 4
  cacheReadTokens: number;               // field 5
  providerCode: number | null;           // field 6
  thinkingOutputTokens: number;          // field 9
  responseOutputTokens: number;          // field 10
}
```

Decode timestamps from protobuf `Timestamp` seconds field `1` and nanoseconds field `2`. Use modified planner response field `8` when nonempty, otherwise response field `3`. Map provider code `24` to `"google"`; unknown provider and model codes return `null` rather than a fabricated name.

- [ ] **Step 4: Implement turn grouping and quality rules**

Use these inputs and output:

```ts
export interface AntigravityCliStepRow {
  idx: number;
  stepType: number;
  status: number;
  metadata: Uint8Array;
  stepPayload: Uint8Array;
}

export interface AntigravityCliConversationInput {
  conversationId: string;
  sourcePath: string;
  title: string | null;
  project: string | null;
  executionScope: "main" | "subagent";
  rows: AntigravityCliStepRow[];
}

export interface ParsedAntigravityCliSession extends ParsedSession {
  usedEstimatedFallback: boolean;
}
```

Ignore non-completed rows. Start a pending turn on each decoded user input. Add every subsequent model-usage record until the next user input. Sum request input as `input + cacheRead + cacheWrite`, cached input as `cacheRead`, output as `output`, and reasoning as `thinkingOutput`. Use `calculateTotalMetric` so reasoning and cache are not added again.

When no usage record exists, estimate typed input and visible output, mark request input as a visible-context `partial` lower bound, and return `usedEstimatedFallback: true`. When neither prompt nor response is visible, return unavailable request/output/total metrics. Set the session title from optional summary title, otherwise `textPreview(firstPrompt, "Antigravity CLI session")`.

- [ ] **Step 5: Run parser tests and typecheck**

Run:

```bash
npm run test -- tests/adapters/antigravity-cli.test.ts
npm run typecheck
```

Expected: exact, fallback, malformed-data, and subagent tests PASS.

- [ ] **Step 6: Commit the CLI decoder and normalizer**

```bash
git add src/adapters/antigravity-cli-protobuf.ts src/adapters/antigravity-cli.ts tests/helpers/antigravity-cli-fixtures.ts tests/adapters/antigravity-cli.test.ts
git commit -m "feat: normalize Antigravity CLI token usage"
```

### Task 5: Add the Antigravity CLI source adapter and configuration

**Files:**
- Create: `src/adapters/antigravity-cli-source.ts`
- Create: `tests/adapters/antigravity-cli-source.test.ts`
- Modify: `src/adapters/paths.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`
- Modify: `tests/adapters/scanners.test.ts`
- Modify: `tests/extension-config.test.ts`

**Interfaces:**
- Consumes: `readSqliteSnapshot`, `parseAntigravityCliConversation`, `sql.js`, `<root>/conversations/*.db`, and optional `<root>/conversation_summaries.db`.
- Produces: `AntigravityCliAdapter implements SourceAdapter` with `source = "antigravity-cli"`.

- [ ] **Step 1: Write failing path, configuration, and adapter tests**

Extend the path test:

```ts
expect(paths.antigravityCli).toBe(
  join("/Users/dev", ".gemini", "antigravity-cli")
);
```

Add extension-configuration assertions:

```ts
expect(properties["tokenUsage.sources.antigravityCli.enabled"]).toMatchObject({
  type: "boolean",
  default: true
});
expect(properties["tokenUsage.paths.antigravityCli"]).toMatchObject({
  type: "string",
  default: ""
});
expect(source).toContain("new AntigravityCliAdapter(antigravityCliRoot, wasmPath)");
```

In the new adapter test, import `userStep` and `plannerStep` from `tests/helpers/antigravity-cli-fixtures.ts`. Add this database builder:

```ts
async function conversationDatabase(
  cascadeId: string,
  rows: AntigravityCliStepRow[]
): Promise<Uint8Array> {
  const SQL = await initSqlJs({
    locateFile: (file) => resolve("node_modules/sql.js/dist", file)
  });
  const database = new SQL.Database();
  database.run(
    "CREATE TABLE trajectory_meta (trajectory_id TEXT, cascade_id TEXT, trajectory_type INTEGER, source INTEGER)"
  );
  database.run(
    "CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, metadata BLOB, step_payload BLOB)"
  );
  database.run(
    "INSERT INTO trajectory_meta VALUES (?, ?, ?, ?)",
    [`trajectory-${cascadeId}`, cascadeId, 4, 17]
  );
  for (const row of rows) {
    database.run(
      "INSERT INTO steps VALUES (?, ?, ?, ?, ?)",
      [row.idx, row.stepType, row.status, row.metadata, row.stepPayload]
    );
  }
  const bytes = database.export();
  database.close();
  return bytes;
}
```

Create two discovered `.db` paths; return valid bytes for one and throw `new Error("snapshot failed")` for the other through the injected reader. Assert one exact session is returned, the failed path is an error, and `complete` is false. Add a second test with a summary database row whose `parent_conversation_id` is nonempty and `nesting_depth = 1`, then assert its turns use `executionScope: "subagent"`.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
npm run test -- tests/adapters/antigravity-cli-source.test.ts tests/adapters/scanners.test.ts tests/extension-config.test.ts
```

Expected: FAIL because the adapter, path, and settings do not exist.

- [ ] **Step 3: Implement discovery, optional summaries, and per-file isolation**

Expose an injectable snapshot function for deterministic tests:

```ts
export type SqliteSnapshotReader = (databasePath: string) => Promise<Uint8Array>;

export class AntigravityCliAdapter implements SourceAdapter {
  readonly source = "antigravity-cli" as const;

  constructor(
    private readonly dataRoot: string,
    private readonly wasmPath?: string,
    private readonly readSnapshot: SqliteSnapshotReader = readSqliteSnapshot
  ) {}
}
```

`detect()` counts `.db` files directly under `conversations`. `scan()` sorts paths for deterministic output, initializes `sql.js` once, and validates that every conversation has `trajectory_meta` and `steps` tables. Query:

```sql
SELECT trajectory_id, cascade_id, trajectory_type, source
FROM trajectory_meta
LIMIT 1
```

```sql
SELECT idx, step_type, status, metadata, step_payload
FROM steps
ORDER BY idx
```

If `conversation_summaries.db` exists, snapshot it with the same reader and use `conversation_id`, `title`, `workspace_uris`, `parent_conversation_id`, and `nesting_depth`. A summary with a parent or positive nesting depth sets `executionScope: "subagent"`; malformed or unavailable summaries create one coalesced warning but do not make otherwise readable conversations incomplete.

For each parsed session that used estimated fallback, add its path to an estimate counter. Emit one warning such as `3 Antigravity CLI sessions used visible-content estimates because recorded usage was absent`. Hard snapshot, schema, or protobuf failures add file-specific errors and set `complete: false`.

- [ ] **Step 4: Wire paths, settings, and extension activation**

Add `antigravityCli: join(home, ".gemini", "antigravity-cli")` to `SourcePaths`. In `activate`, resolve `paths.antigravityCli`, then add:

```ts
if (configuration.get<boolean>("sources.antigravityCli.enabled", true)) {
  adapters.push(new AntigravityCliAdapter(antigravityCliRoot, wasmPath));
}
```

Add manifest properties with the exact descriptions `Import Antigravity CLI sessions.` and `Optional Antigravity CLI data-root override.` Do not change background-refresh defaults or register a watcher.

- [ ] **Step 5: Run adapter/config tests and typecheck**

Run:

```bash
npm run test -- tests/adapters/antigravity-cli-source.test.ts tests/adapters/scanners.test.ts tests/extension-config.test.ts
npm run typecheck
```

Expected: adapter health isolation, portable path, enabled-by-default setting, and activation wiring tests PASS.

- [ ] **Step 6: Commit the adapter integration**

```bash
git add src/adapters/antigravity-cli-source.ts tests/adapters/antigravity-cli-source.test.ts src/adapters/paths.ts src/extension.ts package.json tests/adapters/scanners.test.ts tests/extension-config.test.ts
git commit -m "feat: import Antigravity CLI histories"
```

### Task 6: Deduplicate CLI and IDE sessions before storage

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/services/import-coordinator.ts`
- Modify: `src/extension.ts`
- Modify: `tests/services/import-coordinator.test.ts`
- Modify: `tests/storage/tracker-store.test.ts`

**Interfaces:**
- Consumes: completed adapter `ImportResult[]` using canonical source session IDs.
- Produces: `reconcileAntigravityResults(results): ImportResult[]`; optional `ImportResult.diagnostics?: string[]` for non-warning output details.

- [ ] **Step 1: Write failing reconciliation and persistence tests**

Add a coordinator test with IDE sessions `shared` and `ide-only`, plus CLI session `shared`. Assert the applied IDE result contains only `ide-only`, its `seenSessionIds` excludes `shared`, and the CLI result has this diagnostic:

```ts
expect(cliApplied.diagnostics).toContain(
  "Excluded 1 Antigravity IDE session duplicated by Antigravity CLI"
);
```

Add a store integration test:

```ts
it("removes a previously indexed IDE duplicate after a complete reconciled scan", async () => {
  const store = await createStore();
  await store.applyImport(fixtureImport("antigravity", "shared"));
  await store.applyImport({
    ...fixtureImport("antigravity", "ide-only"),
    sessions: [fixtureImport("antigravity", "ide-only").sessions[0]],
    turns: [fixtureImport("antigravity", "ide-only").turns[0]],
    seenSessionIds: ["ide-only"]
  });

  expect((await store.getTurns()).map((turn) => turn.sourceSessionId)).toEqual(["ide-only"]);
});
```

- [ ] **Step 2: Run reconciliation tests to verify they fail**

Run:

```bash
npm run test -- tests/services/import-coordinator.test.ts tests/storage/tracker-store.test.ts
```

Expected: FAIL because results are currently applied without cross-source reconciliation.

- [ ] **Step 3: Implement immutable CLI-first reconciliation**

Add the optional field:

```ts
export interface ImportResult {
  // existing fields remain unchanged
  diagnostics?: string[];
}
```

Implement and export:

```ts
export function reconcileAntigravityResults(results: ImportResult[]): ImportResult[] {
  const cli = results.find((result) => result.source === "antigravity-cli");
  const ide = results.find((result) => result.source === "antigravity");
  if (!cli || !ide || cli.sessions.length === 0) return results;

  const cliIds = new Set(cli.sessions.map((session) => session.sourceSessionId));
  const duplicateIds = new Set(
    ide.sessions
      .map((session) => session.sourceSessionId)
      .filter((sessionId) => cliIds.has(sessionId))
  );
  if (duplicateIds.size === 0) return results;

  const noun = duplicateIds.size === 1 ? "session" : "sessions";
  return results.map((result) => {
    if (result.source === "antigravity-cli") {
      return {
        ...result,
        diagnostics: [
          ...(result.diagnostics ?? []),
          `Excluded ${duplicateIds.size} Antigravity IDE ${noun} duplicated by Antigravity CLI`
        ]
      };
    }
    if (result.source !== "antigravity") return result;
    return {
      ...result,
      sessions: result.sessions.filter(
        (session) => !duplicateIds.has(session.sourceSessionId)
      ),
      turns: result.turns.filter(
        (turn) => !duplicateIds.has(turn.sourceSessionId)
      ),
      seenSessionIds: result.seenSessionIds.filter(
        (sessionId) => !duplicateIds.has(sessionId)
      )
    };
  });
}
```

Call this function after `Promise.all` scanning and before retention stripping or `store.applyImport`.

- [ ] **Step 4: Log diagnostics without affecting health**

After logging issues in `extension.ts`, add:

```ts
for (const diagnostic of result.diagnostics ?? []) {
  output.appendLine(`  info: ${diagnostic}`);
}
```

Do not persist diagnostics into `source_health.issues_json` and do not include them in the health warning count.

- [ ] **Step 5: Run reconciliation, store, and type tests**

Run:

```bash
npm run test -- tests/services/import-coordinator.test.ts tests/storage/tracker-store.test.ts
npm run typecheck
```

Expected: parsed CLI sessions win, unparsed CLI files do not suppress IDE sessions, complete IDE results prune old duplicates, and diagnostics remain informational.

- [ ] **Step 6: Commit deduplication**

```bash
git add src/domain/types.ts src/services/import-coordinator.ts src/extension.ts tests/services/import-coordinator.test.ts tests/storage/tracker-store.test.ts
git commit -m "feat: deduplicate Antigravity CLI and IDE sessions"
```

### Task 7: Complete dashboard presentation and visual coverage

**Files:**
- Modify: `webview/src/App.tsx`
- Modify: `webview/src/UsageGuardrails.tsx`
- Modify: `webview/src/styles.css`
- Modify: `webview/src/App.test.tsx`
- Modify: `webview/src/Root.test.tsx`
- Modify: `webview/src/UsageGuardrails.test.tsx`
- Modify: `scripts/visual-qa.mjs`

**Interfaces:**
- Consumes: five-source `SOURCES`, `TrendPoint`, health, contributor, comparison, and turn data.
- Produces: independently labeled Antigravity IDE/CLI health rows, filters, chart segments, tooltips, insights, and details.

- [ ] **Step 1: Write failing webview assertions**

Add a complete Antigravity CLI fixture turn and trend value. Assert:

```ts
expect(screen.getByText("Antigravity IDE")).toBeInTheDocument();
expect(screen.getByText("Antigravity CLI")).toBeInTheDocument();
expect(container.querySelector(".source-antigravity-cli")).not.toBeNull();
```

Add health fixtures for both sources and assert that the CLI row can be Healthy while the IDE row is Needs attention. Add a source-filter test selecting `antigravity-cli`, and add an insight test whose source contributor label is `Antigravity CLI`.

- [ ] **Step 2: Run webview tests to verify the missing behavior**

Run:

```bash
npm run test -- webview/src/App.test.tsx webview/src/Root.test.tsx webview/src/UsageGuardrails.test.tsx
```

Expected: FAIL because fixtures, labels, styles, or source filtering do not yet cover the new source fully.

- [ ] **Step 3: Verify complete health labels and add CLI styling**

Keep `ImportHealth` on the complete-label rendering introduced in Task 1:

```tsx
<span>
  <i className={`health-dot ${healthy ? "healthy" : "warning"}`} />
  {SOURCE_LABELS[source]}
</span>
```

Add a dedicated color:

```css
.source-antigravity-cli {
  --source-color: #a78bfa;
  background: var(--source-color);
}
```

Keep the existing Antigravity IDE color unchanged. Ensure bar segments, dots, legends, and partial outlines inherit `--source-color` through the same selectors used by the other sources.

- [ ] **Step 4: Extend the visual QA fixture completely**

Add `"antigravity-cli"` to `sources`, add a corresponding model/provider, include the quoted `"antigravity-cli"` property in every daily/weekly/monthly point, add CLI health, and include `Antigravity CLI` in contributor and mover fixtures. Keep at least one exact CLI turn and one partial IDE turn so both visual states remain exercised.

- [ ] **Step 5: Run webview tests, build, and visual QA**

Run:

```bash
npm run test -- webview/src/App.test.tsx webview/src/Root.test.tsx webview/src/UsageGuardrails.test.tsx
npm run build
node scripts/visual-qa.mjs
```

Expected: component tests PASS; visual QA reports successful desktop and mobile checks with five source entries and no clipping.

- [ ] **Step 6: Commit dashboard presentation**

```bash
git add webview/src/App.tsx webview/src/UsageGuardrails.tsx webview/src/styles.css webview/src/App.test.tsx webview/src/Root.test.tsx webview/src/UsageGuardrails.test.tsx scripts/visual-qa.mjs docs/design/token-usage-dashboard-implementation.png docs/design/token-usage-dashboard-mobile.png
git commit -m "feat: show Antigravity CLI across the dashboard"
```

### Task 8: Update support documentation and perform final verification

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `scripts/import-local-smoke.ts`

**Interfaces:**
- Consumes: completed adapter, configuration keys, health semantics, dashboard labels, and approved design specification.
- Produces: accurate public support documentation and a fully verified local feature branch.

- [ ] **Step 1: Update README support, accuracy, settings, and troubleshooting text**

Make these specific changes:

- Add Antigravity CLI to the supported-source description and project structure text.
- Explain that `~/.gemini/antigravity-cli/conversations/*.db` is imported read-only and active WAL data is included through an in-memory snapshot.
- State that recorded CLI input/output/cache/reasoning data is exact when present; older missing metadata uses labeled estimates or unavailable values.
- Explain that shared CLI/IDE cascade IDs are counted once with the CLI copy taking precedence.
- Add both new settings to the Settings table.
- Add troubleshooting guidance for a file-specific Needs attention result without recommending database repair or authentication access.
- Keep background refresh opt-in and retain existing battery guidance.

- [ ] **Step 2: Update package discoverability without changing version**

Change the package description to mention all five sources and add `agy` plus `antigravity-cli` keywords. Do not alter `version` or package a VSIX.

- [ ] **Step 3: Extend the local smoke summary**

Import `AntigravityCliAdapter`, add it to the coordinator with `paths.antigravityCli`, and add a JSON summary containing CLI session/turn counts, exact totals, estimated totals, and diagnostics. Keep the script read-only and continue writing its tracker database only under the temporary directory.

- [ ] **Step 4: Run the full verification pipeline**

Run:

```bash
npm run verify
node scripts/visual-qa.mjs
git diff --check
```

Expected: all Vitest files PASS, both TypeScript projects pass, production bundles build, desktop/mobile visual QA passes, and `git diff --check` exits 0.

- [ ] **Step 5: Inspect scope and verify source histories remain untouched**

Run:

```bash
git status --short
git diff --stat 4e06be7..HEAD
git diff --name-only 4e06be7..HEAD
```

Expected: only planned source, test, documentation, and refreshed visual-reference files appear. No file under `~/.gemini`, `.DS_Store`, `dist/`, `coverage/`, `node_modules/`, or a VSIX is staged.

- [ ] **Step 6: Commit final documentation and smoke support**

```bash
git add README.md package.json scripts/import-local-smoke.ts
git commit -m "docs: document Antigravity CLI tracking"
```

- [ ] **Step 7: Record final evidence for handoff**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
```

Expected: the worktree is clean, the branch contains the task commits, and no packaging or remote push has occurred.
