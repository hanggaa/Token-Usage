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

export function parseAntigravityTranscript(
  content: string,
  sessionId: string,
  sourcePath: string
): ParsedSession {
  const rows = parseJsonLines(content).map(asObject);
  const turns: NormalizedTurn[] = [];
  let pending: PendingTurn | null = null;

  const finalize = (): void => {
    if (!pending) {
      return;
    }
    const response = pending.replies.join("\n\n");
    const outputEstimate = estimateTypedInput(response, pending.model);
    const metrics: TokenMetric[] = [
      estimateTypedInput(pending.prompt, pending.model),
      unavailable("request_input", "Antigravity does not report full request input"),
      unavailable("cached_input", "Antigravity does not report cached input"),
      {
        kind: "output",
        value: outputEstimate.value,
        quality: "estimated",
        basis: outputEstimate.basis.replace("typed text only", "visible response only")
      },
      unavailable("reasoning_output", "Antigravity does not report reasoning token counts")
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
      pending = {
        stepIndex: String(row.step_index ?? turns.length),
        timestamp: toIso(row.created_at) ?? new Date(0).toISOString(),
        prompt: row.content,
        model: typeof row.model === "string" ? row.model : null,
        replies: [],
        toolEventCount: 0
      };
      continue;
    }

    if (!pending || row.source !== "MODEL" || row.status !== "DONE") {
      continue;
    }
    if (typeof row.model === "string") {
      pending.model = row.model;
    }
    if (VISIBLE_MODEL_TYPES.has(String(row.type)) && typeof row.content === "string") {
      if (row.content.trim()) {
        pending.replies.push(row.content);
      }
    } else {
      pending.toolEventCount += 1;
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

