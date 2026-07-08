import { encodingForModel, getEncoding, type Tiktoken } from "js-tiktoken";
import type { TokenMetric } from "./types.js";

const encoders = new Map<string, Tiktoken>();
const OPENAI_MODEL_PATTERN = /(?:^|[-_/])(gpt|o[134]|codex)(?:[-_/]|$)/i;

function getOpenAiEncoder(model: string): Tiktoken {
  const cached = encoders.get(model);
  if (cached) {
    return cached;
  }

  let encoder: Tiktoken;
  try {
    encoder = encodingForModel(model as Parameters<typeof encodingForModel>[0]);
  } catch {
    encoder = getEncoding("cl100k_base");
  }
  encoders.set(model, encoder);
  return encoder;
}

export function estimateTypedInput(text: string, model?: string | null): TokenMetric {
  if (model && OPENAI_MODEL_PATTERN.test(model)) {
    return {
      kind: "typed_input",
      value: getOpenAiEncoder(model).encode(text).length,
      quality: "estimated",
      basis: "offline OpenAI tokenizer; typed text only"
    };
  }

  const bytes = new TextEncoder().encode(text).length;
  return {
    kind: "typed_input",
    value: bytes === 0 ? 0 : Math.ceil(bytes / 4),
    quality: "estimated",
    basis: "UTF-8 bytes ÷ 4 heuristic"
  };
}

export function calculateTotalMetric(metrics: TokenMetric[]): TokenMetric {
  const requestInput = metrics.find((metric) => metric.kind === "request_input");
  const output = metrics.find((metric) => metric.kind === "output");

  if (requestInput?.value == null || output?.value == null) {
    return {
      kind: "total",
      value: null,
      quality: "unavailable",
      basis: "requires request input and output"
    };
  }

  return {
    kind: "total",
    value: requestInput.value + output.value,
    quality:
      requestInput.quality === "exact" && output.quality === "exact"
        ? "exact"
        : "estimated",
    basis: "request input + output"
  };
}

