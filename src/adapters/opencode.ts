import type { NormalizedTurn, TokenMetric } from "../domain/types.js";
import { estimateTypedInput } from "../domain/token-metrics.js";
import {
  fingerprint,
  textPreview,
  toIso,
  type ParsedSession
} from "./shared.js";

interface JsonObject {
  [key: string]: unknown;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function exactMetric(kind: TokenMetric["kind"], value: unknown, basis: string): TokenMetric {
  return typeof value === "number" && Number.isFinite(value)
    ? { kind, value, quality: "exact", basis }
    : { kind, value: null, quality: "unavailable", basis: `${basis} not reported` };
}

function messageText(parts: unknown[]): string {
  return parts
    .map(asObject)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text).trim())
    .filter(Boolean)
    .join("\n\n");
}

export function parseOpenCodeExport(raw: unknown, sourcePath: string): ParsedSession {
  const root = asObject(raw);
  const sessionInfo = asObject(root.info ?? root.session);
  const sessionId =
    typeof sessionInfo.id === "string"
      ? sessionInfo.id
      : fingerprint(sourcePath).slice(0, 24);
  const messages = asArray(root.messages);
  const users = new Map<string, { info: JsonObject; parts: unknown[] }>();

  for (const message of messages) {
    const record = asObject(message);
    const info = asObject(record.info);
    if (info.role === "user" && typeof info.id === "string") {
      users.set(info.id, { info, parts: asArray(record.parts) });
    }
  }

  const turns: NormalizedTurn[] = [];
  for (const message of messages) {
    const record = asObject(message);
    const info = asObject(record.info);
    if (info.role !== "assistant" || typeof info.id !== "string") {
      continue;
    }
    const parentId = typeof info.parentID === "string" ? info.parentID : "";
    const user = users.get(parentId);
    if (!user) {
      continue;
    }

    const modelObject = asObject(user.info.model);
    const model =
      typeof info.modelID === "string"
        ? info.modelID
        : typeof modelObject.modelID === "string"
          ? modelObject.modelID
          : null;
    const provider =
      typeof info.providerID === "string"
        ? info.providerID
        : typeof modelObject.providerID === "string"
          ? modelObject.providerID
          : null;
    const prompt = messageText(user.parts);
    const response = messageText(asArray(record.parts));
    const tokens = asObject(info.tokens);
    const cache = asObject(tokens.cache);
    const requestInput = exactMetric("request_input", tokens.input, "OpenCode tokens.input");
    const output = exactMetric("output", tokens.output, "OpenCode tokens.output");
    const metrics: TokenMetric[] = [
      estimateTypedInput(prompt, model),
      requestInput,
      exactMetric("cached_input", cache.read, "OpenCode tokens.cache.read"),
      output,
      exactMetric("reasoning_output", tokens.reasoning, "OpenCode tokens.reasoning"),
      requestInput.value != null && output.value != null
        ? {
            kind: "total",
            value: requestInput.value + output.value,
            quality: "exact",
            basis: "OpenCode input + output"
          }
        : { kind: "total", value: null, quality: "unavailable", basis: "requires OpenCode input and output" }
    ];
    const parts = asArray(record.parts).map(asObject);
    const userTime = asObject(user.info.time);
    const project = typeof sessionInfo.directory === "string" ? sessionInfo.directory : null;
    const turn: NormalizedTurn = {
      id: `opencode:${sessionId}:${info.id}`,
      source: "opencode",
      sourceSessionId: sessionId,
      sourceTurnId: info.id,
      executionScope: "main",
      timestamp: toIso(userTime.created) ?? new Date(0).toISOString(),
      model,
      provider,
      project,
      prompt,
      response,
      toolEventCount: parts.filter((part) => part.type !== "text").length,
      metrics,
      fingerprint: ""
    };
    turn.fingerprint = fingerprint(turn);
    turns.push(turn);
  }

  const sessionTime = asObject(sessionInfo.time);
  const project = typeof sessionInfo.directory === "string" ? sessionInfo.directory : null;
  return {
    session: {
      source: "opencode",
      sourceSessionId: sessionId,
      title:
        typeof sessionInfo.title === "string"
          ? sessionInfo.title
          : textPreview(turns[0]?.prompt ?? "", "OpenCode session"),
      project,
      startedAt: toIso(sessionTime.created) ?? turns[0]?.timestamp ?? null,
      updatedAt: toIso(sessionTime.updated) ?? turns.at(-1)?.timestamp ?? null,
      sourcePath,
      fingerprint: fingerprint({ sessionInfo, turns: turns.map((turn) => turn.fingerprint) })
    },
    turns
  };
}
