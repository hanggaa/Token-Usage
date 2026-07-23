import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeSession } from "../../src/adapters/claude.js";

describe("parseClaudeSession", () => {
  it("groups tool loops and imports exact Claude usage without duplicate messages", async () => {
    const sourcePath = resolve("tests/fixtures/claude-session.jsonl");
    const content = await readFile(sourcePath, "utf8");
    const result = parseClaudeSession(content, sourcePath, "main");

    expect(result.session).toMatchObject({
      source: "claude",
      sourceSessionId: "claude-session-1",
      project: "/Users/dev/project"
    });
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]).toMatchObject({
      sourceTurnId: "user-1",
      executionScope: "main",
      prompt: "Refactor the parser.",
      response: "I am checking the parser.\n\nThe parser is now refactored.",
      model: "claude-sonnet-4-20250514",
      provider: "anthropic",
      toolEventCount: 2
    });
    expect(result.turns[0].response).not.toContain("private tool output");
    expect(result.turns[0].metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "request_input", value: 210, quality: "exact" }),
      expect.objectContaining({ kind: "cached_input", value: 40, quality: "exact" }),
      expect.objectContaining({ kind: "output", value: 30, quality: "exact" }),
      expect.objectContaining({ kind: "reasoning_output", value: null, quality: "unavailable" }),
      expect.objectContaining({ kind: "total", value: 240, quality: "exact" })
    ]));
  });

  it("marks omitted cache fields as a partial lower bound", async () => {
    const sourcePath = resolve("tests/fixtures/claude-session.jsonl");
    const result = parseClaudeSession(
      await readFile(sourcePath, "utf8"),
      sourcePath,
      "main"
    );

    expect(result.turns[1].metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "request_input", value: 40, quality: "partial" }),
      expect.objectContaining({ kind: "cached_input", value: null, quality: "unavailable" }),
      expect.objectContaining({ kind: "output", value: 8, quality: "exact" }),
      expect.objectContaining({ kind: "total", value: 48, quality: "partial" })
    ]));
  });

  it("uses a distinct session identity and scope for nested subagents", async () => {
    const sourcePath = resolve(
      "tests/fixtures/subagents/agent-researcher.jsonl"
    );
    const result = parseClaudeSession(
      await readFile(resolve("tests/fixtures/claude-subagent.jsonl"), "utf8"),
      sourcePath,
      "subagent"
    );

    expect(result.session.sourceSessionId).toBe(
      "claude-session-1:subagent:researcher"
    );
    expect(result.turns[0]).toMatchObject({
      executionScope: "subagent",
      prompt: "Inspect the parser tests.",
      response: "The parser tests cover the main path."
    });
  });

  it("deduplicates assistant usage through a caller-owned message set", async () => {
    const content = await readFile(
      resolve("tests/fixtures/claude-session.jsonl"),
      "utf8"
    );
    const seen = new Set<string>();
    const first = parseClaudeSession(content, "first.jsonl", "main", seen);
    const duplicate = parseClaudeSession(content, "second.jsonl", "main", seen);

    expect(first.turns).toHaveLength(2);
    expect(duplicate.turns).toEqual([]);
  });
});
