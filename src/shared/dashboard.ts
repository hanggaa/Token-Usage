import type { NormalizedTurn, Source } from "../domain/types.js";
import type { SourceHealth } from "../storage/tracker-store.js";

export interface UsageSummary {
  total: number;
  exact: number;
  estimated: number;
}

export interface TrendPoint {
  date: string;
  codex: number | null;
  opencode: number | null;
  antigravity: number | null;
}

export interface DashboardSnapshot {
  generatedAt: string;
  summaries: {
    today: UsageSummary;
    sevenDays: UsageSummary;
    allTime: UsageSummary;
  };
  trend: TrendPoint[];
  turns: NormalizedTurn[];
  health: SourceHealth[];
}

export interface WebviewMessage {
  type: "refresh" | "ready" | "deleteAll" | "rebuild";
}

export interface ExtensionMessage {
  type: "snapshot" | "loading" | "error";
  snapshot?: DashboardSnapshot;
  message?: string;
}

export const SOURCES: Source[] = ["codex", "opencode", "antigravity"];

