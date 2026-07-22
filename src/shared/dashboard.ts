import type { NormalizedTurn, Source } from "../domain/types.js";
import type { SourceHealth } from "../storage/tracker-store.js";

export interface UsageSummary {
  total: number;
  exact: number;
  estimated: number;
  partial: number;
}

export type UsageGranularity = "daily" | "weekly" | "monthly";

export interface TrendPoint {
  startDate: string;
  endDate: string;
  inProgress: boolean;
  codex: number | null;
  opencode: number | null;
  antigravity: number | null;
  partialSources?: Source[];
}

export interface DashboardSnapshot {
  generatedAt: string;
  summaries: {
    today: UsageSummary;
    sevenDays: UsageSummary;
    allTime: UsageSummary;
  };
  trends: Record<UsageGranularity, TrendPoint[]>;
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
