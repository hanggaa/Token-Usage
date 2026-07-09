import type { NormalizedTurn, TokenMetric } from "../domain/types.js";
import {
  calculateTotalMetric,
  estimateTypedInput
} from "../domain/token-metrics.js";
import {
  fingerprint,
  parseJsonLines,
  textPreview,
  toIso,
  type ParsedSession
} from "./shared.js";

interface JsonObject {
  [key: string]: unknown;
}

interface PendingTurn {
  stepIndex: string;
  timestamp: string;
  prompt: string;
  model: string | null;
  replies: string[];
  toolEventCount: number;
  visibleRequestTokens: number;
  visibleOutputTokens: number;
  visibleReasoningTokens: number;
  modelCallCount: number;
}

const VISIBLE_MODEL_TYPES = new Set([
  "PLANNER_RESPONSE",
  "GENERIC",
  "ASK_QUESTION"
]);

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function unavailable(kind: TokenMetric["kind"], basis: string): TokenMetric {
  return { kind, value: null, quality: "unavailable", basis };
}

function estimateValue(text: string, model: string | null): number {
  return estimateTypedInput(text, model).value ?? 0;
}

function serializeToolCalls(value: unknown): string {
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function extractTaggedContent(content: string, tag: string): string | null {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(`<${escapedTag}>\\s*([\\s\\S]*?)\\s*</${escapedTag}>`, "i")
  );
  return match?.[1]?.trim() || null;
}

function extractModelSelection(content: string): string | null {
  const settings = extractTaggedContent(content, "USER_SETTINGS_CHANGE");
  if (!settings || !/Model Selection/i.test(settings)) {
    return null;
  }
  const match = settings.match(
    /\bModel Selection\b[\s\S]*?\bfrom\b[\s\S]*?\bto\s+(.+?)(?:\.\s+(?:No need|If reporting)|$)/i
  );
  return match?.[1]?.trim().replace(/\.$/, "") || null;
}

function cleanUserPrompt(content: string): string {
  const request = extractTaggedContent(content, "USER_REQUEST");
  if (request) {
    return request;
  }
  return content
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, "")
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, "")
    .replace(/<\/?USER_REQUEST>/gi, "")
    .trim();
}

export function parseAntigravityTranscript(
  content: string,
  sessionId: string,
  sourcePath: string
): ParsedSession {
  const rows = parseJsonLines(content).map(asObject);
  const turns: NormalizedTurn[] = [];
  let pending: PendingTurn | null = null;
  let activeModel: string | null = null;
  const visibleContextParts: string[] = [];

  const finalize = (): void => {
    if (!pending) {
      return;
    }
    const response = pending.replies.join("\n\n");
    const requestMetric: TokenMetric =
      pending.modelCallCount > 0
        ? {
            kind: "request_input",
            value: pending.visibleRequestTokens,
            quality: "partial",
            basis: `lower bound from cumulative visible context across ${pending.modelCallCount} model call${pending.modelCallCount === 1 ? "" : "s"}; hidden system and injected context excluded`
          }
        : unavailable("request_input", "No observable Antigravity model call");
    const outputMetric: TokenMetric = {
      kind: "output",
      value: pending.visibleOutputTokens,
      quality: "estimated",
      basis: "visible response and serialized tool-call output; UTF-8 bytes ÷ 4 heuristic"
    };
    const reasoningMetric: TokenMetric =
      pending.visibleReasoningTokens > 0
        ? {
            kind: "reasoning_output",
            value: pending.visibleReasoningTokens,
            quality: "partial",
            basis: "exposed Antigravity thinking text only; hidden reasoning may be larger"
          }
        : unavailable("reasoning_output", "No exposed Antigravity thinking text");
    const metrics: TokenMetric[] = [
      estimateTypedInput(pending.prompt, pending.model),
      requestMetric,
      unavailable("cached_input", "Antigravity does not report cached input"),
      outputMetric,
      reasoningMetric
    ];
    metrics.push(calculateTotalMetric(metrics));
    const turn: NormalizedTurn = {
      id: `antigravity:${sessionId}:${pending.stepIndex}`,
      source: "antigravity",
      sourceSessionId: sessionId,
      sourceTurnId: pending.stepIndex,
      timestamp: pending.timestamp,
      model: pending.model,
      provider: null,
      project: null,
      prompt: pending.prompt,
      response,
      toolEventCount: pending.toolEventCount,
      metrics,
      fingerprint: ""
    };
    turn.fingerprint = fingerprint(turn);
    turns.push(turn);
    pending = null;
  };

  for (const row of rows) {
    if (row.source === "USER_EXPLICIT" && row.type === "USER_INPUT" && typeof row.content === "string") {
      finalize();
      const rowModel = typeof row.model === "string" ? row.model : null;
      const selectedModel = extractModelSelection(row.content);
      activeModel = rowModel ?? selectedModel ?? activeModel;
      visibleContextParts.push(row.content);
      pending = {
        stepIndex: String(row.step_index ?? turns.length),
        timestamp: toIso(row.created_at) ?? new Date(0).toISOString(),
        prompt: cleanUserPrompt(row.content),
        model: activeModel,
        replies: [],
        toolEventCount: 0,
        visibleRequestTokens: 0,
        visibleOutputTokens: 0,
        visibleReasoningTokens: 0,
        modelCallCount: 0
      };
      continue;
    }

    if (!pending || row.status !== "DONE") {
      continue;
    }
    if (row.source === "SYSTEM") {
      if (typeof row.content === "string" && row.content.trim()) {
        visibleContextParts.push(row.content);
      }
      continue;
    }
    if (row.source !== "MODEL") {
      continue;
    }
    if (typeof row.model === "string") {
      pending.model = row.model;
      activeModel = row.model;
    }
    if (VISIBLE_MODEL_TYPES.has(String(row.type))) {
      pending.visibleRequestTokens += estimateValue(
        visibleContextParts.join("\n"),
        pending.model
      );
      pending.modelCallCount += 1;

      const outputParts: string[] = [];
      const toolCalls = serializeToolCalls(row.tool_calls);
      if (toolCalls) {
        outputParts.push(toolCalls);
      }
      if (typeof row.content === "string" && row.content.trim()) {
        pending.replies.push(row.content);
        outputParts.push(row.content);
      }
      if (outputParts.length > 0) {
        const visibleOutput = outputParts.join("\n");
        pending.visibleOutputTokens += estimateValue(visibleOutput, pending.model);
        visibleContextParts.push(visibleOutput);
      }
      if (typeof row.thinking === "string" && row.thinking.trim()) {
        pending.visibleReasoningTokens += estimateValue(row.thinking, pending.model);
      }
    } else {
      pending.toolEventCount += 1;
      if (typeof row.content === "string" && row.content.trim()) {
        visibleContextParts.push(row.content);
      }
    }
  }
  finalize();

  return {
    session: {
      source: "antigravity",
      sourceSessionId: sessionId,
      title: textPreview(turns[0]?.prompt ?? "", "Antigravity session"),
      project: null,
      startedAt: turns[0]?.timestamp ?? null,
      updatedAt: turns.at(-1)?.timestamp ?? null,
      sourcePath,
      fingerprint: fingerprint({ sessionId, turns: turns.map((turn) => turn.fingerprint) })
    },
    turns
  };
}
