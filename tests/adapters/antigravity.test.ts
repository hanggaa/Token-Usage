import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAntigravityTranscript } from "../../src/adapters/antigravity.js";

describe("parseAntigravityTranscript", () => {
  it("groups model events after a user input and retains only visible replies", async () => {
    const sourcePath = resolve("tests/fixtures/antigravity-transcript.jsonl");
    const content = await readFile(sourcePath, "utf8");
    const result = parseAntigravityTranscript(content, "ag-session-1", sourcePath);

    expect(result.session.sourceSessionId).toBe("ag-session-1");
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toMatchObject({
      prompt: "Explain why the CI workflow is failing.",
      response: "The workflow uses a Node version that is incompatible with the lockfile.",
      toolEventCount: 2
    });
    expect(result.turns[0].metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "typed_input", quality: "estimated" }),
        expect.objectContaining({ kind: "request_input", value: null, quality: "unavailable" }),
        expect.objectContaining({ kind: "output", quality: "estimated" }),
        expect.objectContaining({ kind: "total", value: null, quality: "unavailable" })
      ])
    );
  });
});

