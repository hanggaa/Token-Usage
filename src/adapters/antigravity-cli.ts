import type { NormalizedTurn, TokenMetric } from "../domain/types.js";
import {
  calculateTotalMetric,
  estimateTypedInput
} from "../domain/token-metrics.js";
import {
  fingerprint,
  textPreview,
  type ParsedSession
} from "./shared.js";
import {
  decodeAntigravityCliStep,
  type AntigravityCliUsage
} from "./antigravity-cli-protobuf.js";

export interface AntigravityCliStepRow {
  idx: number;
  stepType: number;
  status: number;
  metadata: Uint8Array;
  stepPayload: Uint8Array;
}

export interface AntigravityCliConversationInput {
  conversationId: string;
  sourcePath: string;
  title: string | null;
  project: string | null;
  executionScope: "main" | "subagent";
  rows: AntigravityCliStepRow[];
}

export interface ParsedAntigravityCliSession extends ParsedSession {
  usedEstimatedFallback: boolean;
  issues: AntigravityCliParseIssue[];
}

export interface AntigravityCliParseIssue {
  idx: number;
  message: string;
}

interface PendingTurn {
  turnId: string;
  timestamp: string;
  prompt: string;
  responses: string[];
  usages: AntigravityCliUsage[];
  model: string | null;
  provider: string | null;
}

const DONE_STATUS = 3;
const USER_INPUT_STEP = 14;
const PLANNER_RESPONSE_STEP = 15;
const EPOCH = new Date(0).toISOString();

function unavailable(kind: TokenMetric["kind"], basis: string): TokenMetric {
  return { kind, value: null, quality: "unavailable", basis };
}

function sumUsage(
  usages: AntigravityCliUsage[],
  select: (usage: AntigravityCliUsage) => readonly number[]
): number {
  const total = usages.reduce(
    (sum, usage) => select(usage).reduce(
      (usageSum, value) => usageSum + BigInt(value),
      sum
    ),
    0n
  );
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Antigravity CLI token usage exceeds JavaScript's safe integer range");
  }
  return Number(total);
}

function exactMetrics(usages: AntigravityCliUsage[]): TokenMetric[] {
  const requestInput = sumUsage(
    usages,
    (usage) => [usage.inputTokens, usage.cacheReadTokens, usage.cacheWriteTokens]
  );
  const metrics: TokenMetric[] = [
    {
      kind: "request_input",
      value: requestInput,
      quality: "exact",
      basis: "recorded input + cache read + cache write"
    },
    {
      kind: "cached_input",
      value: sumUsage(usages, (usage) => [usage.cacheReadTokens]),
      quality: "exact",
      basis: "recorded cache-read tokens"
    },
    {
      kind: "output",
      value: sumUsage(usages, (usage) => [usage.outputTokens]),
      quality: "exact",
      basis: "recorded output tokens, including thinking and response subsets"
    },
    {
      kind: "reasoning_output",
      value: sumUsage(usages, (usage) => [usage.thinkingOutputTokens]),
      quality: "exact",
      basis: "recorded thinking-output subset"
    }
  ];
  return metrics;
}

function estimatedMetrics(
  prompt: string,
  response: string,
  model: string | null
): TokenMetric[] {
  if (!prompt.trim() && !response.trim()) {
    return [
      unavailable("request_input", "No visible Antigravity CLI request context"),
      unavailable("cached_input", "Antigravity CLI cache usage was not recorded"),
      unavailable("output", "No visible Antigravity CLI output"),
      unavailable("reasoning_output", "Antigravity CLI reasoning usage was not recorded")
    ];
  }

  const visibleInput = estimateTypedInput(prompt, model);
  const visibleOutput = estimateTypedInput(response, model);
  return [
    {
      kind: "request_input",
      value: visibleInput.value,
      quality: "partial",
      basis: "lower bound from visible prompt; hidden and injected context excluded"
    },
    unavailable("cached_input", "Antigravity CLI cache usage was not recorded"),
    {
      kind: "output",
      value: visibleOutput.value,
      quality: "estimated",
      basis: "visible response; UTF-8 bytes ÷ 4 heuristic"
    },
    unavailable("reasoning_output", "Antigravity CLI reasoning usage was not recorded")
  ];
}

function turnMetrics(pending: PendingTurn): TokenMetric[] {
  const response = pending.responses.join("\n\n");
  const metrics: TokenMetric[] = [estimateTypedInput(pending.prompt, pending.model)];
  metrics.push(...(
    pending.usages.length > 0
      ? exactMetrics(pending.usages)
      : estimatedMetrics(pending.prompt, response, pending.model)
  ));
  metrics.push(calculateTotalMetric(metrics));
  return metrics;
}

export function parseAntigravityCliConversation(
  input: AntigravityCliConversationInput
): ParsedAntigravityCliSession {
  const turns: NormalizedTurn[] = [];
  const issues: AntigravityCliParseIssue[] = [];
  let pending: PendingTurn | null = null;
  let usedEstimatedFallback = false;

  const finalize = (): void => {
    if (!pending) {
      return;
    }
    const response = pending.responses.join("\n\n");
    if (pending.usages.length === 0) {
      usedEstimatedFallback = true;
    }
    const turn: NormalizedTurn = {
      id: `antigravity-cli:${input.conversationId}:${pending.turnId}`,
      source: "antigravity-cli",
      sourceSessionId: input.conversationId,
      sourceTurnId: pending.turnId,
      executionScope: input.executionScope,
      timestamp: pending.timestamp,
      model: pending.model,
      provider: pending.provider,
      project: input.project,
      prompt: pending.prompt,
      response,
      toolEventCount: 0,
      metrics: turnMetrics(pending),
      fingerprint: ""
    };
    turn.fingerprint = fingerprint(turn);
    turns.push(turn);
    pending = null;
  };

  const rows = [...input.rows].sort((left, right) => left.idx - right.idx);
  for (const row of rows) {
    if (row.status !== DONE_STATUS) {
      continue;
    }

    let step;
    try {
      step = decodeAntigravityCliStep(row);
    } catch (error) {
      issues.push({
        idx: row.idx,
        message: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    if (!step.completed) {
      continue;
    }

    if (step.stepType === USER_INPUT_STEP) {
      finalize();
      pending = {
        turnId: String(step.idx),
        timestamp: step.timestamp ?? EPOCH,
        prompt: step.prompt?.trim() ?? "",
        responses: [],
        usages: [...step.usages],
        model: step.model,
        provider: step.provider
      };
      continue;
    }

    if (!pending) {
      continue;
    }
    pending.usages.push(...step.usages);
    pending.model ??= step.model;
    pending.provider ??= step.provider;
    if (step.stepType === PLANNER_RESPONSE_STEP && step.response?.trim()) {
      pending.responses.push(step.response.trim());
    }
  }
  finalize();

  const firstPrompt = turns[0]?.prompt ?? "";
  return {
    session: {
      source: "antigravity-cli",
      sourceSessionId: input.conversationId,
      title: input.title?.trim() || textPreview(firstPrompt, "Antigravity CLI session"),
      project: input.project,
      startedAt: turns[0]?.timestamp ?? null,
      updatedAt: turns.at(-1)?.timestamp ?? null,
      sourcePath: input.sourcePath,
      fingerprint: fingerprint({
        conversationId: input.conversationId,
        title: input.title,
        project: input.project,
        turns: turns.map((turn) => turn.fingerprint)
      })
    },
    turns,
    usedEstimatedFallback,
    issues
  };
}
