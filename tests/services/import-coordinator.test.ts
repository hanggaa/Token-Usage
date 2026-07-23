import { describe, expect, it } from "vitest";
import type {
  ImportResult,
  SourceAdapter,
  SourceAvailability
} from "../../src/domain/types.js";
import { ImportCoordinator } from "../../src/services/import-coordinator.js";

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
});
