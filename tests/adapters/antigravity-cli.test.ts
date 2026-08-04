import { describe, expect, it } from "vitest";
import {
  decodeAntigravityCliStep
} from "../../src/adapters/antigravity-cli-protobuf.js";
import {
  parseAntigravityCliConversation,
  type AntigravityCliConversationInput,
  type AntigravityCliStepRow
} from "../../src/adapters/antigravity-cli.js";
import {
  completedStep,
  plannerStep,
  plannerStepWithOriginalResponse,
  plannerStepWithUsages,
  plannerStepWithoutUsage,
  userStep,
  userStepWithoutTimestamp,
  withUnknownField
} from "../helpers/antigravity-cli-fixtures.js";

function conversation(
  rows: AntigravityCliStepRow[],
  overrides: Partial<AntigravityCliConversationInput> = {}
): AntigravityCliConversationInput {
  return {
    conversationId: "cascade-1",
    sourcePath: "/history/cascade-1.db",
    title: "Fix importer",
    project: "/work/token-usage",
    executionScope: "main",
    rows,
    ...overrides
  };
}

function metricsByKind(parsed: ReturnType<typeof parseAntigravityCliConversation>) {
  return Object.fromEntries(
    parsed.turns[0].metrics.map((metric) => [metric.kind, metric])
  );
}

describe("parseAntigravityCliConversation", () => {
  it("maps recorded cache and reasoning usage without double counting", () => {
    const parsed = parseAntigravityCliConversation(conversation([
      userStep(0, "Fix the importer.", "2026-08-04T01:00:00.000Z"),
      plannerStep(1, "Importer fixed.", {
        inputTokens: 100,
        outputTokens: 40,
        cacheWriteTokens: 10,
        cacheReadTokens: 60,
        thinkingOutputTokens: 12,
        responseOutputTokens: 28,
        provider: 24
      })
    ]));

    expect(parsed.session.sourceSessionId).toBe("cascade-1");
    expect(parsed.session).toMatchObject({
      source: "antigravity-cli",
      title: "Fix importer",
      project: "/work/token-usage",
      startedAt: "2026-08-04T01:00:00.000Z"
    });
    expect(parsed.turns[0]).toMatchObject({
      source: "antigravity-cli",
      provider: "google",
      prompt: "Fix the importer.",
      response: "Importer fixed."
    });
    expect(metricsByKind(parsed)).toMatchObject({
      request_input: { value: 170, quality: "exact" },
      cached_input: { value: 60, quality: "exact" },
      output: { value: 40, quality: "exact" },
      reasoning_output: { value: 12, quality: "exact" },
      total: { value: 210, quality: "exact" }
    });
    expect(parsed.usedEstimatedFallback).toBe(false);
  });

  it("sums every model-usage entry associated with one user turn", () => {
    const parsed = parseAntigravityCliConversation(conversation([
      userStep(3, "Compare both calls.", "2026-08-04T02:00:00.000Z"),
      plannerStepWithUsages(4, "First and second results.", [
        {
          inputTokens: 20,
          outputTokens: 8,
          cacheWriteTokens: 2,
          cacheReadTokens: 5,
          thinkingOutputTokens: 3,
          responseOutputTokens: 5,
          provider: 24
        },
        {
          inputTokens: 30,
          outputTokens: 12,
          cacheWriteTokens: 4,
          cacheReadTokens: 7,
          thinkingOutputTokens: 4,
          responseOutputTokens: 8,
          provider: 24
        }
      ]),
      plannerStep(5, "Final result.", {
        inputTokens: 10,
        outputTokens: 5,
        cacheWriteTokens: 1,
        cacheReadTokens: 2,
        thinkingOutputTokens: 1,
        responseOutputTokens: 4,
        provider: 24
      })
    ]));

    expect(parsed.turns).toHaveLength(1);
    expect(parsed.turns[0].response).toBe("First and second results.\n\nFinal result.");
    expect(metricsByKind(parsed)).toMatchObject({
      request_input: { value: 81, quality: "exact" },
      cached_input: { value: 14, quality: "exact" },
      output: { value: 25, quality: "exact" },
      reasoning_output: { value: 8, quality: "exact" },
      total: { value: 106, quality: "exact" }
    });
  });

  it("ignores unknown protobuf fields and does not invent enum names", () => {
    const planner = withUnknownField(plannerStepWithOriginalResponse(1, "Original response.", {
      inputTokens: 5,
      outputTokens: 2,
      model: 777,
      provider: 999
    }));

    const decoded = decodeAntigravityCliStep(planner);
    const parsed = parseAntigravityCliConversation(conversation([
      userStep(0, "Use unknown enums.", "2026-08-04T03:00:00.000Z"),
      planner
    ], { title: null }));

    expect(decoded).toMatchObject({
      response: "Original response.",
      model: null,
      provider: null
    });
    expect(decoded.usages[0]).toMatchObject({ modelCode: 777, providerCode: 999 });
    expect(parsed.turns[0]).toMatchObject({
      model: null,
      provider: null,
      response: "Original response."
    });
    expect(parsed.session.title).toBe("Use unknown enums.");
  });

  it("uses visible-content estimates when a response has no recorded usage", () => {
    const parsed = parseAntigravityCliConversation(conversation([
      userStep(0, "Explain this.", "2026-08-04T04:00:00.000Z"),
      plannerStepWithoutUsage(1, "Visible answer.")
    ]));
    const metrics = metricsByKind(parsed);

    expect(parsed.usedEstimatedFallback).toBe(true);
    expect(metrics.typed_input).toMatchObject({ value: 4, quality: "estimated" });
    expect(metrics.request_input).toMatchObject({
      value: 4,
      quality: "partial"
    });
    expect(metrics.cached_input).toMatchObject({ value: null, quality: "unavailable" });
    expect(metrics.output).toMatchObject({ value: 4, quality: "estimated" });
    expect(metrics.total).toMatchObject({
      value: 8,
      quality: "partial"
    });
  });

  it("marks request, output, and total unavailable when no content is visible", () => {
    const parsed = parseAntigravityCliConversation(conversation([
      userStep(0, "", "2026-08-04T05:00:00.000Z"),
      plannerStepWithoutUsage(1, "")
    ]));

    expect(metricsByKind(parsed)).toMatchObject({
      request_input: { value: null, quality: "unavailable" },
      output: { value: null, quality: "unavailable" },
      total: { value: null, quality: "unavailable" }
    });
    expect(parsed.session.title).toBe("Fix importer");
    expect(parsed.usedEstimatedFallback).toBe(true);
  });

  it("preserves completed subagent scope and ignores incomplete steps", () => {
    const ignored = plannerStep(1, "Do not include.", {
      inputTokens: 900,
      outputTokens: 900,
      provider: 24
    });
    ignored.status = 2;
    const parsed = parseAntigravityCliConversation(conversation([
      userStep(0, "Subtask.", "2026-08-04T06:00:00.000Z"),
      ignored,
      plannerStep(2, "Done.", {
        inputTokens: 10,
        outputTokens: 4,
        provider: 24
      })
    ], { executionScope: "subagent" }));

    expect(parsed.turns[0]).toMatchObject({
      executionScope: "subagent",
      response: "Done."
    });
    expect(metricsByKind(parsed).total).toMatchObject({ value: 14, quality: "exact" });
  });

  it("downgrades surviving usage after a malformed in-turn planner row", () => {
    const malformedPlanner: AntigravityCliStepRow = {
      ...plannerStepWithoutUsage(1, "ignored"),
      stepPayload: Uint8Array.from([0xa2, 0x01, 0x05, 0x61])
    };
    const parsed = parseAntigravityCliConversation(conversation([
      userStep(0, "Recover this turn.", "2026-08-04T07:00:00.000Z"),
      malformedPlanner,
      plannerStep(2, "Recovered.", {
        inputTokens: 12,
        outputTokens: 3,
        provider: 24
      })
    ]));

    expect(parsed.turns).toHaveLength(1);
    expect(parsed.turns[0].response).toBe("Recovered.");
    expect(metricsByKind(parsed)).toMatchObject({
      request_input: { value: 12, quality: "partial" },
      output: { value: 3, quality: "partial" },
      total: { value: 15, quality: "partial" }
    });
    expect(parsed.issues).toEqual([
      expect.objectContaining({ idx: 1, message: expect.stringContaining("protobuf") })
    ]);
    expect(() => decodeAntigravityCliStep(malformedPlanner)).toThrow();
  });

  it("counts only evidenced view-file and list-directory tool steps", () => {
    const viewFile = completedStep(1, 8);
    const listDirectory = completedStep(2, 9);
    const checkpoint = completedStep(3, 10);
    const parsed = parseAntigravityCliConversation(conversation([
      userStep(0, "Inspect the project.", "2026-08-04T07:30:00.000Z"),
      viewFile,
      listDirectory,
      checkpoint,
      plannerStep(4, "Inspection complete.", {
        inputTokens: 12,
        outputTokens: 3,
        provider: 24
      })
    ]));

    expect(decodeAntigravityCliStep(viewFile).toolEvent).toBe("view-file");
    expect(decodeAntigravityCliStep(listDirectory).toolEvent).toBe("list-directory");
    expect(decodeAntigravityCliStep(checkpoint).toolEvent).toBeNull();
    expect(parsed.turns[0].toolEventCount).toBe(2);
  });

  it("downgrades surviving usage after a malformed known tool row", () => {
    const malformedTool: AntigravityCliStepRow = {
      ...completedStep(2, 8),
      stepPayload: Uint8Array.from([0xaa, 0x01, 0x05, 0x61])
    };
    const parsed = parseAntigravityCliConversation(conversation([
      userStep(0, "Inspect safely.", "2026-08-04T07:35:00.000Z"),
      plannerStep(1, "Partial inspection.", {
        inputTokens: 9,
        outputTokens: 3,
        provider: 24
      }),
      malformedTool
    ]));

    expect(metricsByKind(parsed).total).toMatchObject({
      value: 12,
      quality: "partial"
    });
    expect(parsed.turns[0].toolEventCount).toBe(0);
    expect(parsed.issues).toEqual([
      expect.objectContaining({ idx: 2, message: expect.stringContaining("protobuf") })
    ]);
  });

  it.each([1016, 1050])(
    "preserves unsupported model code %i without inventing a readable name",
    (model) => {
      const planner = plannerStep(1, "Done.", {
        inputTokens: 4,
        outputTokens: 2,
        model,
        provider: 24
      });
      const decoded = decodeAntigravityCliStep(planner);
      const parsed = parseAntigravityCliConversation(conversation([
        userStep(0, "Use the persisted model code.", "2026-08-04T07:45:00.000Z"),
        planner
      ]));

      expect(decoded.usages[0].modelCode).toBe(model);
      expect(decoded.model).toBeNull();
      expect(parsed.turns[0].model).toBeNull();
    }
  );

  it("keeps request input unavailable when only a response is visible", () => {
    const parsed = parseAntigravityCliConversation(conversation([
      userStep(0, "", "2026-08-04T07:50:00.000Z"),
      plannerStepWithoutUsage(1, "Visible response.")
    ]));

    expect(metricsByKind(parsed)).toMatchObject({
      request_input: { value: null, quality: "unavailable" },
      output: { value: 5, quality: "estimated" },
      total: { value: null, quality: "unavailable" }
    });
  });

  it("keeps output unavailable when only a prompt is visible", () => {
    const parsed = parseAntigravityCliConversation(conversation([
      userStep(0, "Visible prompt.", "2026-08-04T07:55:00.000Z"),
      plannerStepWithoutUsage(1, "")
    ]));

    expect(metricsByKind(parsed)).toMatchObject({
      request_input: { value: 4, quality: "partial" },
      output: { value: null, quality: "unavailable" },
      total: { value: null, quality: "unavailable" }
    });
  });

  it("uses a later persisted step timestamp when the user timestamp is absent", () => {
    const parsed = parseAntigravityCliConversation(conversation([
      userStepWithoutTimestamp(0, "Use the later timestamp."),
      plannerStepWithoutUsage(1, "Done.", "2026-08-04T08:05:00.000Z")
    ]));

    expect(parsed.turns[0].timestamp).toBe("2026-08-04T08:05:00.000Z");
    expect(parsed.issues).toEqual([]);
  });

  it("skips a turn with no persisted timestamp instead of inventing epoch", () => {
    const parsed = parseAntigravityCliConversation(conversation([
      userStepWithoutTimestamp(0, "No timestamp."),
      plannerStepWithoutUsage(1, "Still no timestamp.")
    ]));

    expect(parsed.turns).toEqual([]);
    expect(parsed.session).toMatchObject({ startedAt: null, updatedAt: null });
    expect(parsed.issues).toEqual([
      expect.objectContaining({
        idx: 0,
        message: expect.stringMatching(/persisted timestamp.*skipped/i)
      })
    ]);
  });

  it("marks cross-record aggregate overflow unavailable instead of throwing", () => {
    const parsed = parseAntigravityCliConversation(conversation([
      userStep(0, "Overflow safely.", "2026-08-04T08:00:00.000Z"),
      plannerStep(1, "First.", {
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 0,
        provider: 24
      }),
      plannerStep(2, "Second.", {
        inputTokens: 1,
        outputTokens: 0,
        provider: 24
      })
    ]));

    expect(metricsByKind(parsed)).toMatchObject({
      request_input: { value: null, quality: "unavailable" },
      output: { value: 0, quality: "exact" },
      total: { value: null, quality: "unavailable" }
    });
    expect(parsed.issues).toEqual([
      expect.objectContaining({
        idx: 0,
        message: expect.stringContaining("request input")
      })
    ]);
  });

  it("marks an unsafe request-plus-output total unavailable", () => {
    const parsed = parseAntigravityCliConversation(conversation([
      userStep(0, "Overflow only the total.", "2026-08-04T08:30:00.000Z"),
      plannerStep(1, "Result.", {
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 1,
        provider: 24
      })
    ]));

    expect(metricsByKind(parsed)).toMatchObject({
      request_input: { value: Number.MAX_SAFE_INTEGER, quality: "exact" },
      output: { value: 1, quality: "exact" },
      total: { value: null, quality: "unavailable" }
    });
    expect(parsed.issues).toEqual([
      expect.objectContaining({ idx: 0, message: expect.stringContaining("total") })
    ]);
  });

  it("keeps a malformed completed user row as a hard turn boundary", () => {
    const malformedUser: AntigravityCliStepRow = {
      ...userStep(2, "Unreadable.", "2026-08-04T09:01:00.000Z"),
      stepPayload: Uint8Array.from([0x9a, 0x01, 0x05, 0x61])
    };
    const parsed = parseAntigravityCliConversation(conversation([
      userStep(0, "First turn.", "2026-08-04T09:00:00.000Z"),
      plannerStep(1, "First response.", {
        inputTokens: 10,
        outputTokens: 2,
        provider: 24
      }),
      malformedUser,
      plannerStep(3, "Must not attach.", {
        inputTokens: 100,
        outputTokens: 20,
        provider: 24
      })
    ]));

    expect(parsed.turns).toHaveLength(1);
    expect(parsed.turns[0].response).toBe("First response.");
    expect(metricsByKind(parsed).total).toMatchObject({ value: 12, quality: "exact" });
    expect(parsed.issues).toEqual([
      expect.objectContaining({ idx: 2, message: expect.stringContaining("protobuf") })
    ]);
  });
});
