import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOpenCodeExport } from "../../src/adapters/opencode.js";

describe("parseOpenCodeExport", () => {
  it("pairs assistant messages by parent ID and imports exact usage", async () => {
    const sourcePath = resolve("tests/fixtures/opencode-export.json");
    const content = JSON.parse(await readFile(sourcePath, "utf8"));
    const result = parseOpenCodeExport(content, sourcePath);

    expect(result.session.sourceSessionId).toBe("ses_open_1");
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toMatchObject({
      prompt: "Add rate limiting to the upload endpoint.",
      response: "Implemented a sliding-window limiter and added tests.",
      toolEventCount: 1,
      model: "claude-sonnet-4",
      provider: "anthropic"
    });
    expect(result.turns[0].metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "request_input", value: 2941, quality: "exact" }),
        expect.objectContaining({ kind: "cached_input", value: 8732, quality: "exact" }),
        expect.objectContaining({ kind: "output", value: 1102, quality: "exact" }),
        expect.objectContaining({ kind: "reasoning_output", value: 256, quality: "exact" }),
        expect.objectContaining({ kind: "total", value: 4043, quality: "exact" })
      ])
    );
  });
});

