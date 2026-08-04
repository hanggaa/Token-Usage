import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import type {
  ImportResult,
  NormalizedSession,
  NormalizedTurn,
  SourceAdapter,
  Source
} from "../../src/domain/types.js";
import { AntigravityCliAdapter } from "../../src/adapters/antigravity-cli-source.js";
import type { AntigravityCliStepRow } from "../../src/adapters/antigravity-cli.js";
import { ImportCoordinator } from "../../src/services/import-coordinator.js";
import { TrackerStore } from "../../src/storage/tracker-store.js";
import {
  plannerStep,
  plannerStepWithoutUsage,
  userStep
} from "../helpers/antigravity-cli-fixtures.js";

const temporaryRoots: string[] = [];

async function createStore(name = "usage.sqlite"): Promise<TrackerStore> {
  const root = await mkdtemp(join(tmpdir(), "token-store-test-"));
  temporaryRoots.push(root);
  return TrackerStore.open({
    databasePath: join(root, name),
    wasmPath: resolve("node_modules/sql.js/dist/sql-wasm.wasm")
  });
}

async function createLegacyStore(): Promise<TrackerStore> {
  const root = await mkdtemp(join(tmpdir(), "token-store-legacy-test-"));
  temporaryRoots.push(root);
  const databasePath = join(root, "usage.sqlite");
  const SQL = await initSqlJs({
    locateFile: (file) => resolve("node_modules/sql.js/dist", file)
  });
  const database = new SQL.Database();
  database.run(`
    CREATE TABLE turns (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      source_turn_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      project TEXT,
      prompt TEXT NOT NULL,
      response TEXT NOT NULL,
      tool_event_count INTEGER NOT NULL,
      fingerprint TEXT NOT NULL
    )
  `);
  database.run(
    `INSERT INTO turns
      (id, source, source_session_id, source_turn_id, timestamp, model, provider, project,
       prompt, response, tool_event_count, fingerprint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "codex:legacy:turn",
      "codex",
      "legacy",
      "turn",
      "2026-07-09T00:00:00.000Z",
      "gpt-5",
      "openai",
      "/project",
      "Legacy prompt",
      "Legacy response",
      0,
      "legacy-turn"
    ]
  );
  await writeFile(databasePath, database.export());
  database.close();
  return TrackerStore.open({
    databasePath,
    wasmPath: resolve("node_modules/sql.js/dist/sql-wasm.wasm")
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fixtureImport(source: Source, sessionId: string, complete = true): ImportResult {
  const session: NormalizedSession = {
    source,
    sourceSessionId: sessionId,
    title: `${source} session`,
    project: "/project",
    startedAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:01:00.000Z",
    sourcePath: `/source/${sessionId}`,
    fingerprint: `session-${sessionId}`
  };
  const turn: NormalizedTurn = {
    id: `${source}:${sessionId}:turn-1`,
    source,
    sourceSessionId: sessionId,
    sourceTurnId: "turn-1",
    executionScope: "main",
    timestamp: "2026-07-09T00:00:00.000Z",
    model: "test-model",
    provider: "test-provider",
    project: "/project",
    prompt: "Test prompt",
    response: "Test response",
    toolEventCount: 1,
    fingerprint: `turn-${sessionId}`,
    metrics: [
      { kind: "typed_input", value: 3, quality: "estimated", basis: "fixture" },
      { kind: "request_input", value: 100, quality: "exact", basis: "fixture" },
      { kind: "output", value: 20, quality: "exact", basis: "fixture" },
      { kind: "total", value: 120, quality: "exact", basis: "fixture" }
    ]
  };
  return {
    source,
    complete,
    sessions: [session],
    turns: [turn],
    seenSessionIds: [sessionId],
    issues: [],
    checkpoint: {
      completedAt: "2026-07-09T00:02:00.000Z",
      fingerprints: { [sessionId]: session.fingerprint }
    }
  };
}

function additionalTurn(
  imported: ImportResult,
  sourceTurnId: string,
  timestamp: string
): NormalizedTurn {
  const original = imported.turns[0];
  return {
    ...original,
    id: `${original.source}:${original.sourceSessionId}:${sourceTurnId}`,
    sourceTurnId,
    timestamp,
    response: `Response for ${sourceTurnId}`,
    fingerprint: `turn-${original.sourceSessionId}-${sourceTurnId}`
  };
}

async function conversationDatabase(
  cascadeId: string,
  stepRows: AntigravityCliStepRow[]
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
    ["trajectory-fixture", cascadeId, 4, 17]
  );
  for (const row of stepRows) {
    database.run(
      "INSERT INTO steps VALUES (?, ?, ?, ?, ?)",
      [row.idx, row.stepType, row.status, row.metadata, row.stepPayload]
    );
  }
  const bytes = database.export();
  database.close();
  return bytes;
}

describe("TrackerStore", () => {
  it("persists normalized turns and metrics idempotently", async () => {
    const store = await createStore();
    const imported = fixtureImport("codex", "session-1");

    await store.applyImport(imported);
    await store.applyImport(imported);

    const turns = await store.getTurns();
    expect(turns).toHaveLength(1);
    expect(turns[0].metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "request_input", value: 100, quality: "exact" }),
        expect.objectContaining({ kind: "total", value: 120, quality: "exact" })
      ])
    );
  });

  it("migrates pre-0.5 turns to the main execution scope", async () => {
    const store = await createLegacyStore();

    expect(await store.getTurns()).toEqual([
      expect.objectContaining({
        id: "codex:legacy:turn",
        executionScope: "main"
      })
    ]);
  });

  it("persists Claude subagent scope", async () => {
    const store = await createStore();
    const imported = fixtureImport("claude", "session-1");
    imported.turns[0].executionScope = "subagent";

    await store.applyImport(imported);

    expect(await store.getTurns()).toEqual([
      expect.objectContaining({
        source: "claude",
        executionScope: "subagent"
      })
    ]);
  });

  it("does not mirror deletions after an incomplete source scan", async () => {
    const store = await createStore();
    await store.applyImport(fixtureImport("codex", "session-1"));

    await store.applyImport({
      ...fixtureImport("codex", "session-2", false),
      sessions: [],
      turns: [],
      seenSessionIds: []
    });

    expect(await store.getTurns()).toHaveLength(1);
  });

  it("retains prior turns and exact conflicts for a partially observed session", async () => {
    const store = await createStore();
    const initial = fixtureImport("antigravity-cli", "shared");
    initial.turns.push(additionalTurn(
      initial,
      "turn-2",
      "2026-07-09T00:01:00.000Z"
    ));
    await store.applyImport(initial);
    const partialTurn = {
      ...initial.turns[0],
      response: "Partial replacement",
      fingerprint: "partial-turn",
      metrics: initial.turns[0].metrics.map((metric) => (
        metric.kind === "request_input" || metric.kind === "output" || metric.kind === "total"
          ? { ...metric, quality: "partial" as const }
          : metric
      ))
    };
    const safeNewTurn = additionalTurn(
      initial,
      "turn-3",
      "2026-07-09T00:02:00.000Z"
    );

    await store.applyImport({
      ...initial,
      complete: false,
      turns: [partialTurn, safeNewTurn],
      fullyObservedSessionIds: [],
      issues: [{
        sourcePath: "/source/shared",
        severity: "error",
        message: "Step 1 was malformed"
      }]
    });

    const turns = await store.getTurns();
    expect(turns.map((turn) => turn.sourceTurnId).toSorted()).toEqual([
      "turn-1",
      "turn-2",
      "turn-3"
    ]);
    expect(turns.find((turn) => turn.sourceTurnId === "turn-1")).toMatchObject({
      response: "Test response",
      metrics: expect.arrayContaining([
        expect.objectContaining({ kind: "total", value: 120, quality: "exact" })
      ])
    });
    expect(turns.find((turn) => turn.sourceTurnId === "turn-3")).toMatchObject({
      response: "Response for turn-3"
    });
  });

  it("replaces a fully observed session even when another source session failed", async () => {
    const store = await createStore();
    const initial = fixtureImport("antigravity-cli", "shared");
    initial.turns.push(additionalTurn(
      initial,
      "turn-2",
      "2026-07-09T00:01:00.000Z"
    ));
    await store.applyImport(initial);
    const replacement = {
      ...initial.turns[0],
      response: "Fresh complete response",
      fingerprint: "fresh-complete-turn"
    };

    await store.applyImport({
      ...initial,
      complete: false,
      turns: [replacement],
      fullyObservedSessionIds: ["shared"],
      issues: [{
        sourcePath: "/source/another-session",
        severity: "error",
        message: "Another session failed"
      }]
    });

    expect(await store.getTurns()).toEqual([
      expect.objectContaining({
        sourceTurnId: "turn-1",
        response: "Fresh complete response"
      })
    ]);
  });

  it("keeps legacy adapter sessions fully observed when no completeness list is supplied", async () => {
    const store = await createStore();
    const initial = fixtureImport("codex", "session-1");
    initial.turns.push(additionalTurn(
      initial,
      "turn-2",
      "2026-07-09T00:01:00.000Z"
    ));
    await store.applyImport(initial);

    await store.applyImport({
      ...initial,
      complete: false,
      turns: [initial.turns[0]]
    });

    expect((await store.getTurns()).map((turn) => turn.sourceTurnId)).toEqual([
      "turn-1"
    ]);
  });

  it("removes missing source sessions after a complete scan", async () => {
    const store = await createStore();
    await store.applyImport(fixtureImport("codex", "session-1"));

    await store.applyImport({
      ...fixtureImport("codex", "session-2"),
      sessions: [],
      turns: [],
      seenSessionIds: []
    });

    expect(await store.getTurns()).toHaveLength(0);
  });

  it("removes a previously indexed IDE duplicate after a complete reconciled scan", async () => {
    const store = await createStore();
    await store.applyImport(fixtureImport("antigravity", "shared"));
    await store.applyImport({
      ...fixtureImport("antigravity", "ide-only"),
      sessions: [fixtureImport("antigravity", "ide-only").sessions[0]],
      turns: [fixtureImport("antigravity", "ide-only").turns[0]],
      seenSessionIds: ["ide-only"]
    });

    expect((await store.getTurns()).map((turn) => turn.sourceSessionId)).toEqual([
      "ide-only"
    ]);
  });

  it("keeps partial CLI history and the IDE copy across parser-to-store reconciliation", async () => {
    const root = await mkdtemp(join(tmpdir(), "token-store-antigravity-integration-"));
    temporaryRoots.push(root);
    const conversations = join(root, "conversations");
    await mkdir(conversations, { recursive: true });
    const sourcePath = join(conversations, "shared.db");
    await writeFile(sourcePath, "snapshot supplied by controlled test reader");
    const malformedPlanner: AntigravityCliStepRow = {
      ...plannerStepWithoutUsage(1, "Unreadable."),
      stepPayload: Uint8Array.from([0xa2, 0x01, 0x05, 0x61])
    };
    const snapshot = await conversationDatabase("shared", [
      userStep(0, "Current partial turn.", "2026-08-04T01:00:00.000Z"),
      malformedPlanner,
      plannerStep(2, "Current visible response.", { inputTokens: 8, outputTokens: 3 })
    ]);
    const cliAdapter = new AntigravityCliAdapter(root, undefined, async () => snapshot);
    const ideImport = fixtureImport("antigravity", "shared");
    const ideAdapter: SourceAdapter = {
      source: "antigravity",
      detect: async () => ({ available: true, detail: "fixture", roots: [root] }),
      scan: async () => ideImport
    };
    const store = await createStore();
    const priorCli = fixtureImport("antigravity-cli", "shared");
    priorCli.turns[0] = {
      ...priorCli.turns[0],
      id: "antigravity-cli:shared:0",
      sourceTurnId: "0",
      response: "Prior complete response",
      fingerprint: "prior-complete-turn"
    };
    priorCli.turns.push(additionalTurn(
      priorCli,
      "prior-extra",
      "2026-07-09T00:01:00.000Z"
    ));
    await store.applyImport(priorCli);

    await new ImportCoordinator([cliAdapter, ideAdapter], store).refresh("full");

    const turns = await store.getTurns();
    expect(turns.map((turn) => `${turn.source}:${turn.sourceTurnId}`).toSorted()).toEqual([
      "antigravity-cli:0",
      "antigravity-cli:prior-extra",
      "antigravity:turn-1"
    ]);
    expect(turns.find((turn) => turn.id === "antigravity-cli:shared:0")).toMatchObject({
      response: "Prior complete response",
      metrics: expect.arrayContaining([
        expect.objectContaining({ kind: "total", quality: "exact" })
      ])
    });
    expect((await store.getHealth()).find((health) => health.source === "antigravity-cli"))
      .toMatchObject({
        complete: false,
        issues: [expect.objectContaining({
          sourcePath,
          message: expect.stringMatching(/Step 1:.*protobuf/i)
        })]
      });
  });

  it("never persists informational dedup diagnostics as health issues", async () => {
    const store = await createStore();
    await store.applyImport({
      ...fixtureImport("antigravity-cli", "shared"),
      diagnostics: [
        "Excluded 1 Antigravity IDE session duplicated by Antigravity CLI"
      ]
    });

    expect(await store.getHealth()).toEqual([
      expect.objectContaining({
        source: "antigravity-cli",
        complete: true,
        issues: []
      })
    ]);
  });

  it("reloads under the write lock so two IDE instances do not overwrite each other", async () => {
    const first = await createStore("shared.sqlite");
    const databasePath = first.databasePath;
    const second = await TrackerStore.open({
      databasePath,
      wasmPath: resolve("node_modules/sql.js/dist/sql-wasm.wasm")
    });

    await first.applyImport(fixtureImport("codex", "codex-1"));
    await second.applyImport(fixtureImport("opencode", "open-1"));

    const turns = await first.getTurns();
    expect(turns.map((turn) => turn.source).toSorted()).toEqual(["codex", "opencode"]);
  });

  it("clears all derived tracker data", async () => {
    const store = await createStore();
    await store.applyImport(fixtureImport("codex", "session-1"));

    await store.clear();

    expect(await store.getTurns()).toEqual([]);
    expect(await store.getHealth()).toEqual([]);
  });
});
