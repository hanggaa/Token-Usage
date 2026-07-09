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
        expect.objectContaining({ kind: "request_input", quality: "partial" }),
        expect.objectContaining({ kind: "output", quality: "estimated" }),
        expect.objectContaining({ kind: "total", quality: "partial" })
      ])
    );
  });

  it("stores only the user request, extracts model changes, and carries the model forward", () => {
    const wrappedPrompt = [
      "<USER_REQUEST> Saya penasaran workspace ini itu untuk apa sih? </USER_REQUEST>",
      "<ADDITIONAL_METADATA> The current local time is: 2026-07-09T06:41:58+07:00. Active Document: d:\\Personal-File\\Personal-Project\\Agent\\AGENTS.md </ADDITIONAL_METADATA>",
      "<USER_SETTINGS_CHANGE> The user changed setting `Model Selection` from None to Gemini 3.1 Pro (High). No need to comment on this change if the user doesn't ask about it. </USER_SETTINGS_CHANGE>"
    ].join(" ");
    const content = [
      JSON.stringify({
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        content: wrappedPrompt,
        step_index: 1,
        created_at: "2026-07-09T06:41:58+07:00"
      }),
      JSON.stringify({
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        tool_calls: [{ name: "view_file", arguments: { path: "AGENTS.md" } }],
        step_index: 1
      }),
      JSON.stringify({
        source: "MODEL",
        type: "VIEW_FILE",
        status: "DONE",
        content: "Isi AGENTS.md yang dikirim kembali kepada model.",
        step_index: 1
      }),
      JSON.stringify({
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        content: "Workspace ini berisi panduan agen.",
        thinking: "Saya perlu merangkum isi file.",
        step_index: 1
      }),
      JSON.stringify({
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        content: "<USER_REQUEST> Lalu bagaimana cara memakainya? </USER_REQUEST><ADDITIONAL_METADATA>private path</ADDITIONAL_METADATA>",
        step_index: 2,
        created_at: "2026-07-09T06:42:58+07:00"
      }),
      JSON.stringify({
        source: "MODEL",
        type: "GENERIC",
        status: "DONE",
        content: "Buka panduannya terlebih dahulu.",
        step_index: 2
      })
    ].join("\n");

    const result = parseAntigravityTranscript(content, "ag-wrapped", "transcript.jsonl");

    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]).toMatchObject({
      prompt: "Saya penasaran workspace ini itu untuk apa sih?",
      model: "Gemini 3.1 Pro (High)"
    });
    expect(result.turns[1]).toMatchObject({
      prompt: "Lalu bagaimana cara memakainya?",
      model: "Gemini 3.1 Pro (High)"
    });
    expect(result.turns[0].prompt).not.toContain("ADDITIONAL_METADATA");
    expect(result.turns[0].prompt).not.toContain("USER_SETTINGS_CHANGE");
    expect(result.turns[0].metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "typed_input", quality: "estimated" }),
        expect.objectContaining({ kind: "request_input", quality: "partial" }),
        expect.objectContaining({ kind: "cached_input", value: null, quality: "unavailable" }),
        expect.objectContaining({ kind: "reasoning_output", quality: "partial" }),
        expect.objectContaining({ kind: "total", quality: "partial" })
      ])
    );
    const typed = result.turns[0].metrics.find((metric) => metric.kind === "typed_input")!;
    const request = result.turns[0].metrics.find((metric) => metric.kind === "request_input")!;
    const output = result.turns[0].metrics.find((metric) => metric.kind === "output")!;
    const total = result.turns[0].metrics.find((metric) => metric.kind === "total")!;
    expect(request.value).toBeGreaterThan(typed.value!);
    expect(total.value).toBe(request.value! + output.value!);

    const secondTyped = result.turns[1].metrics.find((metric) => metric.kind === "typed_input")!;
    const secondRequest = result.turns[1].metrics.find((metric) => metric.kind === "request_input")!;
    expect(secondRequest.value).toBeGreaterThan(secondTyped.value!);
  });
});
