import { describe, expect, it } from "vitest";
import type {
  ImportResult,
  SourceAdapter,
  SourceAvailability
} from "../../src/domain/types.js";
import {
  ImportCoordinator,
  reconcileAntigravityResults
} from "../../src/services/import-coordinator.js";

const importResult: ImportResult = {
  source: "codex",
  complete: true,
  sessions: [
    {
      source: "codex",
      sourceSessionId: "session",
      title: "Session",
      project: "/project",
      startedAt: null,
      updatedAt: null,
      sourcePath: "/source",
      fingerprint: "session"
    }
  ],
  turns: [
    {
      id: "codex:session:turn",
      source: "codex",
      sourceSessionId: "session",
      sourceTurnId: "turn",
      executionScope: "main",
      timestamp: "2026-07-09T00:00:00.000Z",
      model: "gpt-5",
      provider: "openai",
      project: "/project",
      prompt: "private prompt",
      response: "private response",
      toolEventCount: 0,
      metrics: [],
      fingerprint: "turn"
    }
  ],
  seenSessionIds: ["session"],
  issues: [],
  checkpoint: { completedAt: "2026-07-09T00:00:00.000Z", fingerprints: {} }
};

function adapter(): SourceAdapter {
  return {
    source: "codex",
    detect: async (): Promise<SourceAvailability> => ({
      available: true,
      detail: "available",
      roots: ["/source"]
    }),
    scan: async () => importResult
  };
}

function sourceResult(source: ImportResult["source"], sessionIds: string[]): ImportResult {
  return {
    ...importResult,
    source,
    sessions: sessionIds.map((sourceSessionId) => ({
      ...importResult.sessions[0],
      source,
      sourceSessionId,
      fingerprint: `${source}-${sourceSessionId}`
    })),
    turns: sessionIds.map((sourceSessionId) => ({
      ...importResult.turns[0],
      id: `${source}:${sourceSessionId}:turn`,
      source,
      sourceSessionId,
      fingerprint: `${source}-${sourceSessionId}-turn`
    })),
    seenSessionIds: sessionIds
  };
}

function sourceAdapter(result: ImportResult): SourceAdapter {
  return {
    source: result.source,
    detect: async (): Promise<SourceAvailability> => ({
      available: true,
      detail: "available",
      roots: ["/source"]
    }),
    scan: async () => result
  };
}

describe("ImportCoordinator", () => {
  it("strips future prompt content when counts-only retention is selected", async () => {
    const applied: ImportResult[] = [];
    const store = {
      applyImport: async (result: ImportResult) => {
        applied.push(result);
      }
    };
    const coordinator = new ImportCoordinator([adapter()], store);

    await coordinator.refresh("countsOnly");

    expect(applied[0].turns[0]).toMatchObject({
      prompt: "",
      response: ""
    });
  });

  it("coalesces simultaneous refresh requests into one adapter scan", async () => {
    let scans = 0;
    const source = adapter();
    source.scan = async () => {
      scans += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return importResult;
    };
    const store = { applyImport: async () => undefined };
    const coordinator = new ImportCoordinator([source], store);

    await Promise.all([coordinator.refresh("full"), coordinator.refresh("full")]);

    expect(scans).toBe(1);
  });

  it("prefers parsed Antigravity CLI sessions over duplicate IDE sessions", async () => {
    const ide = {
      ...sourceResult("antigravity", ["shared", "ide-only"]),
      issues: [
        {
          sourcePath: "/ide/history",
          severity: "warning" as const,
          message: "IDE warning"
        }
      ]
    };
    const cli = {
      ...sourceResult("antigravity-cli", ["shared"]),
      fullyObservedSessionIds: ["shared"],
      diagnostics: ["Existing CLI detail"]
    };
    const applied: ImportResult[] = [];
    const coordinator = new ImportCoordinator(
      [sourceAdapter(ide), sourceAdapter(cli)],
      {
        applyImport: async (result) => {
          applied.push(result);
        }
      }
    );

    await coordinator.refresh("full");

    const ideApplied = applied.find((result) => result.source === "antigravity");
    const cliApplied = applied.find((result) => result.source === "antigravity-cli");
    expect(ideApplied?.sessions.map((session) => session.sourceSessionId)).toEqual([
      "ide-only"
    ]);
    expect(ideApplied?.turns.map((turn) => turn.sourceSessionId)).toEqual(["ide-only"]);
    expect(ideApplied?.seenSessionIds).toEqual(["ide-only"]);
    expect(ideApplied?.issues).toEqual(ide.issues);
    expect(cliApplied?.issues).toEqual(cli.issues);
    expect(cliApplied?.diagnostics).toContain(
      "Excluded 1 Antigravity IDE session duplicated by Antigravity CLI"
    );
  });

  it("keeps the IDE copy when the CLI scan has no parsed sessions", async () => {
    const ide = sourceResult("antigravity", ["shared"]);
    const cli: ImportResult = {
      ...sourceResult("antigravity-cli", []),
      complete: false,
      issues: [
        {
          sourcePath: "/cli/history.pb",
          severity: "error",
          message: "Could not parse CLI history"
        }
      ]
    };
    const applied: ImportResult[] = [];
    const coordinator = new ImportCoordinator(
      [sourceAdapter(cli), sourceAdapter(ide)],
      {
        applyImport: async (result) => {
          applied.push(result);
        }
      }
    );

    await coordinator.refresh("full");

    const ideApplied = applied.find((result) => result.source === "antigravity");
    const cliApplied = applied.find((result) => result.source === "antigravity-cli");
    expect(ideApplied?.sessions.map((session) => session.sourceSessionId)).toEqual([
      "shared"
    ]);
    expect(ideApplied?.turns.map((turn) => turn.sourceSessionId)).toEqual(["shared"]);
    expect(ideApplied?.seenSessionIds).toEqual(["shared"]);
    expect(cliApplied?.issues).toEqual(cli.issues);
    expect(cliApplied?.diagnostics).toBeUndefined();
  });

  it("keeps a valid IDE copy when the matching CLI session is not fully observed", async () => {
    const ide = sourceResult("antigravity", ["shared"]);
    const cli = {
      ...sourceResult("antigravity-cli", ["shared"]),
      complete: false,
      fullyObservedSessionIds: [],
      issues: [{
        sourcePath: "/cli/shared.db",
        severity: "error" as const,
        message: "Step 2: malformed planner payload"
      }]
    };
    const applied: ImportResult[] = [];
    const coordinator = new ImportCoordinator(
      [sourceAdapter(cli), sourceAdapter(ide)],
      { applyImport: async (result) => { applied.push(result); } }
    );

    await coordinator.refresh("full");

    const ideApplied = applied.find((result) => result.source === "antigravity");
    const cliApplied = applied.find((result) => result.source === "antigravity-cli");
    expect(ideApplied?.sessions.map((session) => session.sourceSessionId)).toEqual([
      "shared"
    ]);
    expect(ideApplied?.turns.map((turn) => turn.sourceSessionId)).toEqual(["shared"]);
    expect(ideApplied?.seenSessionIds).toEqual(["shared"]);
    expect(cliApplied?.diagnostics).toBeUndefined();
  });

  it("deduplicates authoritative sessions with adapters in CLI-first order", async () => {
    const cli = {
      ...sourceResult("antigravity-cli", ["shared"]),
      fullyObservedSessionIds: ["shared"]
    };
    const ide = sourceResult("antigravity", ["shared", "ide-only"]);
    const applied: ImportResult[] = [];
    const coordinator = new ImportCoordinator(
      [sourceAdapter(cli), sourceAdapter(ide)],
      { applyImport: async (result) => { applied.push(result); } }
    );

    await coordinator.refresh("full");

    expect(applied.map((result) => result.source)).toEqual([
      "antigravity-cli",
      "antigravity"
    ]);
    expect(applied[1].sessions.map((session) => session.sourceSessionId)).toEqual([
      "ide-only"
    ]);
  });

  it("keeps reconciliation idempotent across repeated calls", () => {
    const cli = {
      ...sourceResult("antigravity-cli", ["shared"]),
      fullyObservedSessionIds: ["shared"]
    };
    const ide = sourceResult("antigravity", ["shared", "ide-only"]);

    const reconciled = reconcileAntigravityResults([ide, cli]);

    expect(reconcileAntigravityResults(reconciled)).toEqual(reconciled);
    expect(reconciled.find((result) => result.source === "antigravity-cli")?.diagnostics)
      .toEqual(["Excluded 1 Antigravity IDE session duplicated by Antigravity CLI"]);
  });

  it("leaves nonduplicate Antigravity results unchanged", () => {
    const cli = {
      ...sourceResult("antigravity-cli", ["cli-only"]),
      fullyObservedSessionIds: ["cli-only"]
    };
    const ide = sourceResult("antigravity", ["ide-only"]);
    const results = [cli, ide];

    expect(reconcileAntigravityResults(results)).toBe(results);
  });
});
