import type { NormalizedTurn, Source } from "../domain/types.js";
import type { SourceHealth } from "../storage/tracker-store.js";

export interface UsageSummary {
  total: number;
  exact: number;
  estimated: number;
  partial: number;
}

export type UsageGranularity = "daily" | "weekly" | "monthly";

export interface UsageBudgets {
  daily: number;
  weekly: number;
  monthly: number;
}

export const ZERO_USAGE_BUDGETS: UsageBudgets = { daily: 0, weekly: 0, monthly: 0 };

export interface RankedContributor {
  key: string;
  label: string;
  fullLabel?: string;
  tokens: number;
  share: number;
  partial: boolean;
}

export interface HeavyTurnInsight {
  turnId: string;
  prompt: string;
  source: Source;
  model: string;
  project: string;
  total: number;
  quality: "exact" | "estimated";
  baselineMedian: number;
  multiplier: number;
  baselineScope: "source-model" | "source";
}

export interface PeriodInsights {
  startDate: string;
  endDate: string;
  total: number;
  partial: boolean;
  contributors: {
    sources: RankedContributor[];
    projects: RankedContributor[];
    models: RankedContributor[];
  };
  heavyTurns: HeavyTurnInsight[];
  hasComparableHistory: boolean;
}

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
  budgets: UsageBudgets;
  insights: Record<UsageGranularity, PeriodInsights>;
  turns: NormalizedTurn[];
  health: SourceHealth[];
}

export type WebviewMessage =
  | { type: "refresh" | "ready" | "deleteAll" | "rebuild" }
  | { type: "setBudgets"; requestId: string; budgets: UsageBudgets };

export type ExtensionMessage =
  | { type: "snapshot"; snapshot: DashboardSnapshot }
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "budgetsSaved"; requestId: string }
  | { type: "budgetError"; requestId: string; message: string };

export type BudgetResponse = Extract<
  ExtensionMessage,
  { type: "budgetsSaved" | "budgetError" }
>;

export const SOURCES: Source[] = ["codex", "opencode", "antigravity"];
