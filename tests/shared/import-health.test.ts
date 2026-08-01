import { describe, expect, it } from "vitest";
import type { SourceHealth } from "../../src/storage/tracker-store.js";
import { classifyImportHealth } from "../../src/shared/import-health.js";

function health(overrides: Partial<SourceHealth> = {}): SourceHealth {
  return {
    source: "claude",
    complete: true,
    completedAt: "2026-07-24T14:01:21.643Z",
    sessionCount: 60,
    turnCount: 520,
    issues: [],
    ...overrides
  };
}

describe("classifyImportHealth", () => {
  it("shows usable warning-only imports as healthy with warnings", () => {
    expect(classifyImportHealth(health({
      complete: false,
      issues: [{
        sourcePath: "session.jsonl",
        severity: "warning",
        message: "1 malformed line was ignored"
      }]
    }))).toBe("healthy_with_warnings");
  });

  it("keeps errors and empty incomplete scans in needs attention", () => {
    expect(classifyImportHealth(health({
      issues: [{ sourcePath: "session.jsonl", severity: "error", message: "Access denied" }]
    }))).toBe("needs_attention");
    expect(classifyImportHealth(health({
      complete: false,
      turnCount: 0,
      issues: [{ sourcePath: "session.jsonl", severity: "warning", message: "Ignored" }]
    }))).toBe("needs_attention");
  });

  it("distinguishes clean and unscanned sources", () => {
    expect(classifyImportHealth(health())).toBe("healthy");
    expect(classifyImportHealth(undefined)).toBe("not_scanned");
  });
});
