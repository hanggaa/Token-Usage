import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import initSqlJs from "sql.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  AntigravityCliAdapter,
  type SqliteSnapshotReader
} from "../../src/adapters/antigravity-cli-source.js";
import type { AntigravityCliStepRow } from "../../src/adapters/antigravity-cli.js";
import {
  plannerStep,
  plannerStepWithInternalContent,
  plannerStepWithInternalMarker,
  plannerStepWithoutUsage,
  userStep
} from "../helpers/antigravity-cli-fixtures.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "token-usage-antigravity-cli-"));
  temporaryRoots.push(root);
  return root;
}

async function conversationDatabase(
  cascadeId: string | Uint8Array | null,
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
    ["trajectory-fixture", cascadeId, 4, 17]
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

async function summaryDatabase(
  conversationId: string,
  overrides: {
    title?: string | null;
    workspaceUris?: string | null;
    parentConversationId?: string | null;
    nestingDepth?: number;
  } = {}
): Promise<Uint8Array> {
  const SQL = await initSqlJs({
    locateFile: (file) => resolve("node_modules/sql.js/dist", file)
  });
  const database = new SQL.Database();
  database.run(
    "CREATE TABLE conversation_summaries (conversation_id TEXT, title TEXT, workspace_uris TEXT, parent_conversation_id TEXT, nesting_depth INTEGER)"
  );
  database.run(
    "INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?)",
    [
      conversationId,
      overrides.title ?? "Summary title",
      overrides.workspaceUris ?? JSON.stringify(["file:///work/token-usage"]),
      overrides.parentConversationId ?? null,
      overrides.nestingDepth ?? 0
    ]
  );
  const bytes = database.export();
  database.close();
  return bytes;
}

async function discoveredDatabase(root: string, name: string): Promise<string> {
  const conversations = join(root, "conversations");
  await mkdir(conversations, { recursive: true });
  const path = join(conversations, name);
  await writeFile(path, "snapshot supplied by test reader");
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("AntigravityCliAdapter", () => {
  it("keeps usage-only internal planner steps healthy and counts their tokens", async () => {
    const root = await temporaryRoot();
    const conversationPath = await discoveredDatabase(root, "internal-planner.db");
    const bytes = await conversationDatabase("cascade-internal", [
      userStep(0, "Complete this task.", "2026-08-04T00:30:00.000Z"),
      plannerStepWithInternalContent(1, {
        inputTokens: 30,
        outputTokens: 10,
        provider: 24
      }),
      plannerStepWithInternalMarker(2, {
        inputTokens: 7,
        outputTokens: 3,
        provider: 24
      }),
      plannerStep(3, "Task complete.", {
        inputTokens: 5,
        outputTokens: 2,
        provider: 24
      })
    ]);

    const result = await new AntigravityCliAdapter(
      root,
      undefined,
      async () => bytes
    ).scan();

    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.fullyObservedSessionIds).toEqual(["cascade-internal"]);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toMatchObject({ response: "Task complete." });
    expect(result.turns[0].metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "request_input", value: 42, quality: "exact" }),
      expect.objectContaining({ kind: "output", value: 15, quality: "exact" }),
      expect.objectContaining({ kind: "total", value: 57, quality: "exact" })
    ]));
  });

  it("isolates a failed conversation snapshot while retaining exact usage", async () => {
    const root = await temporaryRoot();
    const readablePath = await discoveredDatabase(root, "a-readable.db");
    const failedPath = await discoveredDatabase(root, "z-failed.db");
    await writeFile(`${readablePath}-wal`, "active WAL belongs to the snapshot reader");
    const readableBytes = await conversationDatabase("cascade-1", [
      userStep(0, "Fix the importer.", "2026-08-04T01:00:00.000Z"),
      plannerStep(1, "Importer fixed.", {
        inputTokens: 100,
        outputTokens: 40,
        cacheReadTokens: 60,
        cacheWriteTokens: 10,
        thinkingOutputTokens: 12,
        provider: 24
      })
    ]);
    const calls: string[] = [];
    const readSnapshot: SqliteSnapshotReader = async (path) => {
      calls.push(path);
      if (path === failedPath) throw new Error("snapshot failed");
      if (path === readablePath) return readableBytes;
      throw new Error(`Unexpected snapshot: ${path}`);
    };

    const result = await new AntigravityCliAdapter(root, undefined, readSnapshot).scan();

    expect(calls).toEqual([readablePath, failedPath]);
    expect(result.complete).toBe(false);
    expect(result.fullyObservedSessionIds).toEqual(["cascade-1"]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      source: "antigravity-cli",
      sourceSessionId: "cascade-1",
      sourcePath: readablePath
    });
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "request_input", value: 170, quality: "exact" }),
      expect.objectContaining({ kind: "total", value: 210, quality: "exact" })
    ]));
    expect(result.issues).toEqual([
      expect.objectContaining({
        sourcePath: failedPath,
        severity: "error",
        message: "snapshot failed"
      })
    ]);
  });

  it("uses summary metadata to classify nested conversations as subagents", async () => {
    const root = await temporaryRoot();
    const conversationPath = await discoveredDatabase(root, "nested.db");
    const summaryPath = join(root, "conversation_summaries.db");
    await writeFile(summaryPath, "snapshot supplied by test reader");
    const snapshots = new Map<string, Uint8Array>([
      [conversationPath, await conversationDatabase("cascade-nested", [
        userStep(0, "Inspect this.", "2026-08-04T02:00:00.000Z"),
        plannerStep(1, "Inspection complete.", { inputTokens: 20, outputTokens: 5 })
      ])],
      [summaryPath, await summaryDatabase("cascade-nested", {
        title: "Nested inspection",
        workspaceUris: JSON.stringify(["file:///work/nested"]),
        parentConversationId: "cascade-parent",
        nestingDepth: 1
      })]
    ]);

    const result = await new AntigravityCliAdapter(
      root,
      undefined,
      async (path) => snapshots.get(path) ?? Promise.reject(new Error(`Missing ${path}`))
    ).scan();

    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.sessions[0]).toMatchObject({
      title: "Nested inspection",
      project: "file:///work/nested"
    });
    expect(result.turns[0]).toMatchObject({
      executionScope: "subagent",
      project: "file:///work/nested"
    });
  });

  it("degrades malformed optional summaries to one warning without losing conversations", async () => {
    const root = await temporaryRoot();
    const conversationPath = await discoveredDatabase(root, "conversation.db");
    const summaryPath = join(root, "conversation_summaries.db");
    await writeFile(summaryPath, "snapshot supplied by test reader");
    const bytes = await conversationDatabase("cascade-1", [
      userStep(0, "Keep this.", "2026-08-04T03:00:00.000Z"),
      plannerStep(1, "Kept.", { inputTokens: 3, outputTokens: 2 })
    ]);

    const result = await new AntigravityCliAdapter(root, undefined, async (path) => {
      if (path === conversationPath) return bytes;
      throw new Error("summary snapshot failed");
    }).scan();

    expect(result.complete).toBe(true);
    expect(result.sessions).toHaveLength(1);
    expect(result.turns).toHaveLength(1);
    expect(result.issues).toEqual([
      expect.objectContaining({
        sourcePath: summaryPath,
        severity: "warning",
        message: expect.stringContaining("summary snapshot failed")
      })
    ]);
  });

  it("coalesces visible-content estimate notices across sessions", async () => {
    const root = await temporaryRoot();
    const firstPath = await discoveredDatabase(root, "first.db");
    const secondPath = await discoveredDatabase(root, "second.db");
    const snapshots = new Map<string, Uint8Array>([
      [firstPath, await conversationDatabase("cascade-1", [
        userStep(0, "First.", "2026-08-04T04:00:00.000Z"),
        plannerStepWithoutUsage(1, "First result.")
      ])],
      [secondPath, await conversationDatabase("cascade-2", [
        userStep(0, "Second.", "2026-08-04T05:00:00.000Z"),
        plannerStepWithoutUsage(1, "Second result.")
      ])]
    ]);

    const result = await new AntigravityCliAdapter(
      root,
      undefined,
      async (path) => snapshots.get(path) ?? Promise.reject(new Error(`Missing ${path}`))
    ).scan();

    expect(result.complete).toBe(true);
    expect(result.sessions).toHaveLength(2);
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: "2 Antigravity CLI sessions used visible-content estimates because recorded usage was absent"
      })
    ]);
  });

  it("falls back to each database filename when the cascade ID is absent or blank", async () => {
    const root = await temporaryRoot();
    const nullPath = await discoveredDatabase(root, "null-cascade.db");
    const blankPath = await discoveredDatabase(root, "blank-cascade.db");
    const snapshots = new Map<string, Uint8Array>([
      [nullPath, await conversationDatabase(null, [
        userStep(0, "Null cascade.", "2026-08-04T06:00:00.000Z"),
        plannerStep(1, "Imported.", { inputTokens: 3, outputTokens: 2 })
      ])],
      [blankPath, await conversationDatabase("   ", [
        userStep(0, "Blank cascade.", "2026-08-04T06:05:00.000Z"),
        plannerStep(1, "Imported.", { inputTokens: 4, outputTokens: 2 })
      ])]
    ]);

    const result = await new AntigravityCliAdapter(
      root,
      undefined,
      async (path) => snapshots.get(path) ?? Promise.reject(new Error(`Missing ${path}`))
    ).scan();

    expect(result.sessions.map((session) => session.sourceSessionId).toSorted()).toEqual([
      "blank-cascade",
      "null-cascade"
    ]);
    expect(result.fullyObservedSessionIds?.toSorted()).toEqual([
      "blank-cascade",
      "null-cascade"
    ]);
    expect(result.complete).toBe(true);
  });

  it("rejects a present non-string cascade ID instead of using the filename", async () => {
    const root = await temporaryRoot();
    const conversationPath = await discoveredDatabase(root, "numeric-cascade.db");
    const bytes = await conversationDatabase(Uint8Array.from([0x34, 0x32]), [
      userStep(0, "Do not import this.", "2026-08-04T06:10:00.000Z")
    ]);

    const result = await new AntigravityCliAdapter(
      root,
      undefined,
      async () => bytes
    ).scan();

    expect(result).toMatchObject({
      complete: false,
      sessions: [],
      turns: [],
      fullyObservedSessionIds: []
    });
    expect(result.issues).toEqual([
      expect.objectContaining({
        sourcePath: conversationPath,
        severity: "error",
        message: expect.stringMatching(/cascade_id/i)
      })
    ]);
  });

  it("keeps valid observable data but withholds authority after a malformed step", async () => {
    const root = await temporaryRoot();
    const conversationPath = await discoveredDatabase(root, "partial.db");
    const malformedPlanner: AntigravityCliStepRow = {
      ...plannerStepWithoutUsage(1, "Unreadable."),
      stepPayload: Uint8Array.from([0xa2, 0x01, 0x05, 0x61])
    };
    const bytes = await conversationDatabase("cascade-partial", [
      userStep(0, "Retain this turn.", "2026-08-04T06:15:00.000Z"),
      malformedPlanner,
      plannerStep(2, "Visible result.", { inputTokens: 8, outputTokens: 3 })
    ]);

    const result = await new AntigravityCliAdapter(
      root,
      undefined,
      async () => bytes
    ).scan();

    expect(result.complete).toBe(false);
    expect(result.sessions).toHaveLength(1);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "total", value: 11, quality: "partial" })
    ]));
    expect(result.fullyObservedSessionIds).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        sourcePath: conversationPath,
        severity: "error",
        message: expect.stringMatching(/Step 1:.*protobuf/i)
      })
    ]);
  });

  it("treats a missing conversations directory as healthy no-history", async () => {
    const root = await temporaryRoot();
    const adapter = new AntigravityCliAdapter(root);

    await expect(adapter.detect()).resolves.toEqual({
      available: false,
      detail: "No persisted Antigravity CLI sessions found",
      roots: [root]
    });
    await expect(adapter.scan()).resolves.toMatchObject({
      source: "antigravity-cli",
      complete: true,
      sessions: [],
      turns: [],
      fullyObservedSessionIds: [],
      issues: []
    });
  });
});
