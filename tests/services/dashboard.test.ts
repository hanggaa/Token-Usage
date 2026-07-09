import { describe, expect, it } from "vitest";
import type { NormalizedTurn } from "../../src/domain/types.js";
import { buildDashboardSnapshot } from "../../src/services/dashboard.js";

function turn(
  id: string,
  timestamp: string,
  source: NormalizedTurn["source"],
  total: number | null,
  quality: "exact" | "estimated" | "partial" | "unavailable"
): NormalizedTurn {
  return {
    id,
    source,
    sourceSessionId: `${source}-session`,
    sourceTurnId: id,
    timestamp,
    model: "model",
    provider: "provider",
    project: "/project",
    prompt: `Prompt ${id}`,
    response: `Response ${id}`,
    toolEventCount: 0,
    fingerprint: id,
    metrics: [
      {
        kind: "total",
        value: total,
        quality,
        basis: "fixture"
      }
    ]
  };
}

describe("buildDashboardSnapshot", () => {
  it("builds today, seven-day, and all-time exact/estimated summaries", () => {
    const snapshot = buildDashboardSnapshot(
      [
        turn("today-exact", "2026-07-09T02:00:00.000Z", "codex", 100, "exact"),
        turn("today-estimated", "2026-07-09T03:00:00.000Z", "antigravity", 40, "estimated"),
        turn("today-partial", "2026-07-09T03:30:00.000Z", "antigravity", 30, "partial"),
        turn("week", "2026-07-05T03:00:00.000Z", "opencode", 60, "exact"),
        turn("old", "2026-06-01T03:00:00.000Z", "codex", 20, "exact"),
        turn("unknown", "2026-07-09T04:00:00.000Z", "antigravity", null, "unavailable")
      ],
      [],
      new Date("2026-07-09T12:00:00.000Z")
    );

    expect(snapshot.summaries.today).toEqual({
      total: 170,
      exact: 100,
      estimated: 40,
      partial: 30
    });
    expect(snapshot.summaries.sevenDays.total).toBe(230);
    expect(snapshot.summaries.allTime.total).toBe(250);
  });

  it("creates daily source series without treating unavailable metrics as zero usage", () => {
    const snapshot = buildDashboardSnapshot(
      [
        turn("codex", "2026-07-09T02:00:00.000Z", "codex", 100, "exact"),
        turn("open", "2026-07-09T03:00:00.000Z", "opencode", 50, "exact"),
        turn("partial", "2026-07-09T03:30:00.000Z", "antigravity", 25, "partial"),
        turn("ag", "2026-07-09T04:00:00.000Z", "antigravity", null, "unavailable")
      ],
      [],
      new Date("2026-07-09T12:00:00.000Z")
    );

    expect(snapshot.trend.at(-1)).toEqual({
      date: "2026-07-09",
      codex: 100,
      opencode: 50,
      antigravity: 25,
      partialSources: ["antigravity"]
    });
  });
});
