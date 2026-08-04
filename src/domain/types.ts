export type Source =
  | "codex"
  | "claude"
  | "opencode"
  | "antigravity"
  | "antigravity-cli";

export type ExecutionScope = "main" | "subagent";

export type MeasurementQuality = "exact" | "estimated" | "partial" | "unavailable";

export type TokenKind =
  | "typed_input"
  | "request_input"
  | "cached_input"
  | "output"
  | "reasoning_output"
  | "total";

export interface TokenMetric {
  kind: TokenKind;
  value: number | null;
  quality: MeasurementQuality;
  basis: string;
}

export interface NormalizedSession {
  source: Source;
  sourceSessionId: string;
  title: string;
  project: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  sourcePath: string;
  fingerprint: string;
}

export interface NormalizedTurn {
  id: string;
  source: Source;
  sourceSessionId: string;
  sourceTurnId: string;
  executionScope: ExecutionScope;
  timestamp: string;
  model: string | null;
  provider: string | null;
  project: string | null;
  prompt: string;
  response: string;
  toolEventCount: number;
  metrics: TokenMetric[];
  fingerprint: string;
}

export interface SourceAvailability {
  available: boolean;
  detail: string;
  roots: string[];
}

export interface SourceCheckpoint {
  completedAt: string;
  fingerprints: Record<string, string>;
}

export interface ImportIssue {
  sourcePath: string;
  severity: "warning" | "error";
  message: string;
}

export interface ImportResult {
  source: Source;
  complete: boolean;
  sessions: NormalizedSession[];
  turns: NormalizedTurn[];
  seenSessionIds: string[];
  fullyObservedSessionIds?: string[];
  issues: ImportIssue[];
  checkpoint: SourceCheckpoint;
  diagnostics?: string[];
}

export interface SourceAdapter {
  readonly source: Source;
  detect(): Promise<SourceAvailability>;
  scan(checkpoint?: SourceCheckpoint): Promise<ImportResult>;
}
