import type { NormalizedTurn, TokenMetric } from "../domain/types.js";
import { estimateTypedInput } from "../domain/token-metrics.js";
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
  turnId: string;
  timestamp: string;
  model: string | null;
  project: string | null;
  prompt: string;
  replies: string[];
  usage: JsonObject | null;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function usageMetric(
  kind: TokenMetric["kind"],
  value: number | null,
  field: string
): TokenMetric {
  return value == null
    ? { kind, value: null, quality: "unavailable", basis: `${field} not reported by Codex` }
    : { kind, value, quality: "exact", basis: `Codex ${field}` };
}

export function parseCodexSession(content: string, sourcePath: string): ParsedSession {
  const rows = parseJsonLines(content).map(asObject);
  let sessionId = fingerprint(sourcePath).slice(0, 24);
  let sessionTimestamp: string | null = null;
  let provider: string | null = null;
  let defaultProject: string | null = null;
  let contextTurnId = "turn-0";
  let contextModel: string | null = null;
  let contextProject: string | null = null;
  let pending: PendingTurn | null = null;
  const turns: NormalizedTurn[] = [];

  const finalize = (): void => {
    if (!pending) {
      return;
    }

    const usage = pending.usage ?? {};
    const requestInput = numberOrNull(usage.input_tokens);
    const cachedInput = numberOrNull(usage.cached_input_tokens);
    const output = numberOrNull(usage.output_tokens);
    const reasoning = numberOrNull(usage.reasoning_output_tokens);
    const total = numberOrNull(usage.total_tokens);
    const metrics: TokenMetric[] = [
      estimateTypedInput(pending.prompt, pending.model),
      usageMetric("request_input", requestInput, "input_tokens"),
      usageMetric("cached_input", cachedInput, "cached_input_tokens"),
      usageMetric("output", output, "output_tokens"),
      usageMetric("reasoning_output", reasoning, "reasoning_output_tokens"),
      usageMetric("total", total ?? (requestInput != null && output != null ? requestInput + output : null), "total_tokens")
    ];
    const turnIdentity = `${sessionId}:${pending.turnId}`;
    turns.push({
      id: `codex:${turnIdentity}`,
      source: "codex",
      sourceSessionId: sessionId,
      sourceTurnId: pending.turnId,
      executionScope: "main",
      timestamp: pending.timestamp,
      model: pending.model,
      provider,
      project: pending.project,
      prompt: pending.prompt,
      response: pending.replies.join("\n\n"),
      toolEventCount: 0,
      metrics,
      fingerprint: fingerprint({ pending, metrics })
    });
    pending = null;
  };

  for (const row of rows) {
    const payload = asObject(row.payload);
    if (row.type === "session_meta") {
      sessionId = typeof payload.id === "string" ? payload.id : sessionId;
      sessionTimestamp = toIso(payload.timestamp ?? row.timestamp);
      provider = typeof payload.model_provider === "string" ? payload.model_provider : null;
      defaultProject = typeof payload.cwd === "string" ? payload.cwd : null;
      continue;
    }

    if (row.type === "turn_context") {
      contextTurnId = typeof payload.turn_id === "string" ? payload.turn_id : contextTurnId;
      contextModel = typeof payload.model === "string" ? payload.model : contextModel;
      contextProject = typeof payload.cwd === "string" ? payload.cwd : defaultProject;
      continue;
    }

    if (row.type !== "event_msg") {
      continue;
    }

    if (payload.type === "user_message" && typeof payload.message === "string") {
      finalize();
      pending = {
        turnId: contextTurnId,
        timestamp: toIso(row.timestamp) ?? new Date(0).toISOString(),
        model: contextModel,
        project: contextProject ?? defaultProject,
        prompt: payload.message,
        replies: [],
        usage: null
      };
      continue;
    }

    if (!pending) {
      continue;
    }

    if (payload.type === "agent_message" && typeof payload.message === "string") {
      if (payload.message.trim() && pending.replies.at(-1) !== payload.message) {
        pending.replies.push(payload.message);
      }
      continue;
    }

    if (payload.type === "token_count") {
      const info = asObject(payload.info);
      const lastUsage = asObject(info.last_token_usage);
      if (Object.keys(lastUsage).length > 0) {
        pending.usage = lastUsage;
      }
    }
  }
  finalize();

  const firstTimestamp = turns[0]?.timestamp ?? sessionTimestamp;
  const lastTimestamp = turns.at(-1)?.timestamp ?? sessionTimestamp;
  return {
    session: {
      source: "codex",
      sourceSessionId: sessionId,
      title: textPreview(turns[0]?.prompt ?? "", "Codex session"),
      project: defaultProject,
      startedAt: firstTimestamp,
      updatedAt: lastTimestamp,
      sourcePath,
      fingerprint: fingerprint({ sessionId, defaultProject, turns: turns.map((turn) => turn.fingerprint) })
    },
    turns
  };
}
