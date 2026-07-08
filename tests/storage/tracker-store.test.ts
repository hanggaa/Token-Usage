import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ImportResult,
  NormalizedSession,
  NormalizedTurn,
  Source
} from "../../src/domain/types.js";
import { TrackerStore } from "../../src/storage/tracker-store.js";

const temporaryRoots: string[] = [];

async function createStore(name = "usage.sqlite"): Promise<TrackerStore> {
  const root = await mkdtemp(join(tmpdir(), "token-store-test-"));
  temporaryRoots.push(root);
  return TrackerStore.open({
    databasePath: join(root, name),
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

