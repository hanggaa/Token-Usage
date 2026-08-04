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
  stepIndex: number;
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
const MAXIMUM_SAFE_TOKENS = BigInt(Number.MAX_SAFE_INTEGER);

interface MetricResult {
  metrics: TokenMetric[];
  issues: string[];
}

function unavailable(kind: TokenMetric["kind"], basis: string): TokenMetric {
  return { kind, value: null, quality: "unavailable", basis };
}

function sumUsage(
  usages: AntigravityCliUsage[],
  select: (usage: AntigravityCliUsage) => readonly number[]
): bigint {
  return usages.reduce(
    (sum, usage) => select(usage).reduce(
      (usageSum, value) => usageSum + BigInt(value),
      sum
    ),
    0n
  );
}

function exactMetric(
  kind: TokenMetric["kind"],
  value: bigint,
  basis: string,
  label: string
): { metric: TokenMetric; issue: string | null } {
  if (value > MAXIMUM_SAFE_TOKENS) {
    return {
      metric: unavailable(kind, `${basis} exceeds JavaScript's safe integer range`),
      issue: `Antigravity CLI ${label} exceeds JavaScript's safe integer range`
    };
  }
  return {
    metric: { kind, value: Number(value), quality: "exact", basis },
    issue: null
  };
}

function exactMetrics(usages: AntigravityCliUsage[]): MetricResult {
  const requestInput = sumUsage(
    usages,
    (usage) => [usage.inputTokens, usage.cacheReadTokens, usage.cacheWriteTokens]
  );
  const results = [
    exactMetric(
      "request_input",
      requestInput,
      "recorded input + cache read + cache write",
      "request input"
    ),
    exactMetric(
      "cached_input",
      sumUsage(usages, (usage) => [usage.cacheReadTokens]),
      "recorded cache-read tokens",
      "cached input"
    ),
    exactMetric(
      "output",
      sumUsage(usages, (usage) => [usage.outputTokens]),
      "recorded output tokens, including thinking and response subsets",
      "output"
    ),
    exactMetric(
      "reasoning_output",
      sumUsage(usages, (usage) => [usage.thinkingOutputTokens]),
      "recorded thinking-output subset",
      "reasoning output"
    )
  ];
  return {
    metrics: results.map((result) => result.metric),
    issues: results
      .map((result) => result.issue)
      .filter((issue): issue is string => issue != null)
  };
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

function totalMetric(metrics: TokenMetric[]): { metric: TokenMetric; issue: string | null } {
  const requestInput = metrics.find((metric) => metric.kind === "request_input");
  const output = metrics.find((metric) => metric.kind === "output");
  if (requestInput?.value != null && output?.value != null) {
    const total = BigInt(requestInput.value) + BigInt(output.value);
    if (total > MAXIMUM_SAFE_TOKENS) {
      return {
        metric: unavailable(
          "total",
          "recorded request input + output exceeds JavaScript's safe integer range"
        ),
        issue: "Antigravity CLI total exceeds JavaScript's safe integer range"
      };
    }
  }
  return { metric: calculateTotalMetric(metrics), issue: null };
}

function turnMetrics(pending: PendingTurn): MetricResult {
  const response = pending.responses.join("\n\n");
  const metrics: TokenMetric[] = [estimateTypedInput(pending.prompt, pending.model)];
  const result = pending.usages.length > 0
    ? exactMetrics(pending.usages)
    : { metrics: estimatedMetrics(pending.prompt, response, pending.model), issues: [] };
  metrics.push(...result.metrics);
  const total = totalMetric(metrics);
  metrics.push(total.metric);
  return {
    metrics,
    issues: total.issue ? [...result.issues, total.issue] : result.issues
  };
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
    const metricResult = turnMetrics(pending);
    const stepIndex = pending.stepIndex;
    issues.push(...metricResult.issues.map((message) => ({
      idx: stepIndex,
      message
    })));
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
      metrics: metricResult.metrics,
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
    if (row.stepType === USER_INPUT_STEP) {
      finalize();
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
      pending = {
        stepIndex: step.idx,
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
