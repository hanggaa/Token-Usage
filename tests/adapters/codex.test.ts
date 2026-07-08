import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCodexSession } from "../../src/adapters/codex.js";

describe("parseCodexSession", () => {
  it("pairs a prompt with visible replies and authoritative last-turn usage", async () => {
    const sourcePath = resolve("tests/fixtures/codex-session.jsonl");
    const content = await readFile(sourcePath, "utf8");
    const result = parseCodexSession(content, sourcePath);

    expect(result.session.sourceSessionId).toBe("codex-session-1");
    expect(result.session.project).toBe("/Users/dev/project");
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toMatchObject({
      sourceTurnId: "turn-1",
      prompt: "Refactor the parser.",
      response: "I am checking the parser.\n\nThe parser is now refactored.",
      model: "gpt-5",
      provider: "openai"
    });
    expect(result.turns[0].metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "request_input", value: 1200, quality: "exact" }),
        expect.objectContaining({ kind: "cached_input", value: 800, quality: "exact" }),
        expect.objectContaining({ kind: "output", value: 240, quality: "exact" }),
        expect.objectContaining({ kind: "reasoning_output", value: 60, quality: "exact" }),
        expect.objectContaining({ kind: "total", value: 1440, quality: "exact" })
      ])
    );
  });
});

