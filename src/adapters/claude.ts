import { basename } from "node:path";
import type {
  ExecutionScope,
  NormalizedTurn,
  TokenMetric
} from "../domain/types.js";
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

interface MetricAccumulator {
  value: number;
  seen: boolean;
  missing: boolean;
}

interface PendingTurn {
  turnId: string;
  timestamp: string;
  executionScope: ExecutionScope;
  model: string | null;
  project: string | null;
  prompt: string;
  replies: string[];
  toolEventCount: number;
  assistantMessageCount: number;
  requestInput: MetricAccumulator;
  cachedInput: MetricAccumulator;
  output: MetricAccumulator;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function newAccumulator(): MetricAccumulator {
  return { value: 0, seen: false, missing: false };
}

function addComponent(accumulator: MetricAccumulator, value: unknown): void {
  const numeric = numberOrNull(value);
  if (numeric == null) {
    accumulator.missing = true;
    return;
  }
  accumulator.value += numeric;
  accumulator.seen = true;
}

function addRequestUsage(accumulator: MetricAccumulator, usage: JsonObject): void {
  addComponent(accumulator, usage.input_tokens);
  addComponent(accumulator, usage.cache_creation_input_tokens);
  addComponent(accumulator, usage.cache_read_input_tokens);
}

function metricFromAccumulator(
  kind: TokenMetric["kind"],
  accumulator: MetricAccumulator,
  exactBasis: string,
  unavailableBasis: string
): TokenMetric {
  if (!accumulator.seen) {
    return {
      kind,
      value: null,
      quality: "unavailable",
      basis: unavailableBasis
    };
  }
  return {
    kind,
    value: accumulator.value,
    quality: accumulator.missing ? "partial" : "exact",
    basis: accumulator.missing
      ? `${exactBasis}; missing components make this a lower bound`
      : exactBasis
  };
}

function contentBlocks(content: unknown): JsonObject[] {
  return asArray(content).map(asObject);
}

function visibleText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  return contentBlocks(content)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text).trim())
    .filter(Boolean)
    .join("\n\n");
}

function countBlocks(content: unknown, types: Set<string>): number {
  return contentBlocks(content).filter(
    (block) => typeof block.type === "string" && types.has(block.type)
  ).length;
}

function unavailableReasoning(): TokenMetric {
  return {
    kind: "reasoning_output",
    value: null,
    quality: "unavailable",
    basis: "Claude Code does not report distinct reasoning-output tokens"
  };
}

function sourceSessionId(
  rawSessionId: string,
  sourcePath: string,
  executionScope: ExecutionScope,
  rows: JsonObject[]
): string {
  if (executionScope === "main") {
    return rawSessionId;
  }
  const reportedAgentId = rows
    .map((row) => row.agentId)
    .find((value): value is string => typeof value === "string" && value.length > 0);
  const fileAgentId = basename(sourcePath, ".jsonl").replace(/^agent-/u, "");
  return `${rawSessionId}:subagent:${reportedAgentId ?? fileAgentId}`;
}

export function firstClaudeTimestamp(content: string): string {
  const timestamps = parseJsonLines(content)
    .map(asObject)
    .map((row) => toIso(row.timestamp))
    .filter((value): value is string => value != null)
    .toSorted();
  return timestamps[0] ?? new Date(0).toISOString();
}

export function parseClaudeSession(
  content: string,
  sourcePath: string,
  executionScope: ExecutionScope,
  seenAssistantMessageIds: Set<string> = new Set()
): ParsedSession {
  const rows = parseJsonLines(content).map(asObject);
  const rawSessionId = rows
    .map((row) => row.sessionId)
    .find((value): value is string => typeof value === "string" && value.length > 0)
    ?? fingerprint(sourcePath).slice(0, 24);
  const sessionId = sourceSessionId(rawSessionId, sourcePath, executionScope, rows);
  const defaultProject = rows
    .map((row) => row.cwd)
    .find((value): value is string => typeof value === "string" && value.length > 0)
    ?? null;
  let pending: PendingTurn | null = null;
  let turnIndex = 0;
  const turns: NormalizedTurn[] = [];

  const finalize = (): void => {
    if (!pending || pending.assistantMessageCount === 0) {
      pending = null;
      return;
    }
    const metrics: TokenMetric[] = [
      estimateTypedInput(pending.prompt, pending.model),
      metricFromAccumulator(
        "request_input",
        pending.requestInput,
        "Claude input_tokens + cache_creation_input_tokens + cache_read_input_tokens",
        "Claude request-input usage not reported"
      ),
      metricFromAccumulator(
        "cached_input",
        pending.cachedInput,
        "Claude cache_read_input_tokens",
        "Claude cached-input usage not reported"
      ),
      metricFromAccumulator(
        "output",
        pending.output,
        "Claude output_tokens",
        "Claude output usage not reported"
      ),
      unavailableReasoning()
    ];
    metrics.push(calculateTotalMetric(metrics));
    const turn: NormalizedTurn = {
      id: `claude:${sessionId}:${pending.turnId}`,
      source: "claude",
      sourceSessionId: sessionId,
      sourceTurnId: pending.turnId,
      executionScope: pending.executionScope,
      timestamp: pending.timestamp,
      model: pending.model,
      provider: "anthropic",
      project: pending.project,
      prompt: pending.prompt,
      response: pending.replies.join("\n\n"),
      toolEventCount: pending.toolEventCount,
      metrics,
      fingerprint: ""
    };
    turn.fingerprint = fingerprint(turn);
    turns.push(turn);
    pending = null;
  };

  for (const row of rows) {
    const message = asObject(row.message);
    const rowScope: ExecutionScope =
      executionScope === "subagent" || row.isSidechain === true ? "subagent" : "main";

    if (
      row.type === "user"
      && row.isMeta !== true
      && message.role === "user"
    ) {
      const prompt = visibleText(message.content);
      const toolResults = countBlocks(message.content, new Set(["tool_result"]));
      if (!prompt) {
        if (pending) {
          pending.toolEventCount += toolResults;
        }
        continue;
      }
      finalize();
      turnIndex += 1;
      pending = {
        turnId:
          typeof row.uuid === "string" && row.uuid.length > 0
            ? row.uuid
            : `turn-${turnIndex}`,
        timestamp: toIso(row.timestamp) ?? new Date(0).toISOString(),
        executionScope: rowScope,
        model: null,
        project: typeof row.cwd === "string" ? row.cwd : defaultProject,
        prompt,
        replies: [],
        toolEventCount: toolResults,
        assistantMessageCount: 0,
        requestInput: newAccumulator(),
        cachedInput: newAccumulator(),
        output: newAccumulator()
      };
      continue;
    }

    if (row.type !== "assistant" || message.role !== "assistant") {
      continue;
    }

    const reportedMessageId =
      typeof message.id === "string" && message.id.length > 0 ? message.id : null;
    if (reportedMessageId && seenAssistantMessageIds.has(reportedMessageId)) {
      continue;
    }
    if (reportedMessageId) {
      seenAssistantMessageIds.add(reportedMessageId);
    }

    if (!pending) {
      turnIndex += 1;
      pending = {
        turnId:
          typeof row.uuid === "string" && row.uuid.length > 0
            ? `assistant-${row.uuid}`
            : `assistant-${turnIndex}`,
        timestamp: toIso(row.timestamp) ?? new Date(0).toISOString(),
        executionScope: rowScope,
        model: null,
        project: typeof row.cwd === "string" ? row.cwd : defaultProject,
        prompt: "",
        replies: [],
        toolEventCount: 0,
        assistantMessageCount: 0,
        requestInput: newAccumulator(),
        cachedInput: newAccumulator(),
        output: newAccumulator()
      };
    }

    pending.assistantMessageCount += 1;
    pending.executionScope =
      pending.executionScope === "subagent" || rowScope === "subagent" ? "subagent" : "main";
    if (typeof message.model === "string" && message.model.length > 0) {
      pending.model = message.model;
    }
    const reply = visibleText(message.content);
    if (reply && pending.replies.at(-1) !== reply) {
      pending.replies.push(reply);
    }
    pending.toolEventCount += countBlocks(message.content, new Set(["tool_use"]));

    const usage = asObject(message.usage);
    if (Object.keys(usage).length === 0) {
      pending.requestInput.missing = true;
      pending.cachedInput.missing = true;
      pending.output.missing = true;
      continue;
    }
    addRequestUsage(pending.requestInput, usage);
    addComponent(pending.cachedInput, usage.cache_read_input_tokens);
    addComponent(pending.output, usage.output_tokens);
  }
  finalize();

  const firstTimestamp = turns[0]?.timestamp ?? firstClaudeTimestamp(content);
  const lastTimestamp = turns.at(-1)?.timestamp ?? firstTimestamp;
  return {
    session: {
      source: "claude",
      sourceSessionId: sessionId,
      title: textPreview(
        turns[0]?.prompt ?? "",
        executionScope === "subagent" ? "Claude Code subagent" : "Claude Code session"
      ),
      project: defaultProject,
      startedAt: firstTimestamp,
      updatedAt: lastTimestamp,
      sourcePath,
      fingerprint: fingerprint({
        sessionId,
        defaultProject,
        turns: turns.map((turn) => turn.fingerprint)
      })
    },
    turns
  };
}
