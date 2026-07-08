import { describe, expect, it } from "vitest";
import {
  calculateTotalMetric,
  estimateTypedInput
} from "../../src/domain/token-metrics.js";
import type { TokenMetric } from "../../src/domain/types.js";

function metric(
  kind: TokenMetric["kind"],
  value: number | null,
  quality: TokenMetric["quality"]
): TokenMetric {
  return { kind, value, quality, basis: "fixture" };
}

describe("calculateTotalMetric", () => {
  it("adds request input and output without double-counting cached or reasoning tokens", () => {
    const result = calculateTotalMetric([
      metric("typed_input", 42, "estimated"),
      metric("request_input", 1_000, "exact"),
      metric("cached_input", 600, "exact"),
      metric("output", 250, "exact"),
      metric("reasoning_output", 90, "exact")
    ]);

    expect(result).toEqual({
      kind: "total",
      value: 1_250,
      quality: "exact",
      basis: "request input + output"
    });
  });

  it("marks the total estimated when either compatible component is estimated", () => {
    const result = calculateTotalMetric([
      metric("request_input", 800, "exact"),
      metric("output", 200, "estimated")
    ]);

    expect(result.value).toBe(1_000);
    expect(result.quality).toBe("estimated");
  });

  it("leaves total unavailable when full request input is unavailable", () => {
    const result = calculateTotalMetric([
      metric("typed_input", 50, "estimated"),
      metric("output", 100, "exact")
    ]);

    expect(result.value).toBeNull();
    expect(result.quality).toBe("unavailable");
  });
});

describe("estimateTypedInput", () => {
  it("uses a byte-based estimate for unknown model families", () => {
    expect(estimateTypedInput("hello", "gemini-3-pro")).toEqual({
      kind: "typed_input",
      value: 2,
      quality: "estimated",
      basis: "UTF-8 bytes ÷ 4 heuristic"
    });
  });

  it("uses an offline OpenAI tokenizer for recognized model names", () => {
    const result = estimateTypedInput("Refactor this function.", "gpt-4o");

    expect(result.value).toBeGreaterThan(0);
    expect(result.quality).toBe("estimated");
    expect(result.basis).toContain("offline OpenAI tokenizer");
  });
});

