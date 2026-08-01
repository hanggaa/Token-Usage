import type { SourceHealth } from "../storage/tracker-store.js";

export type ImportHealthState =
  | "healthy"
  | "healthy_with_warnings"
  | "needs_attention"
  | "not_scanned";

export function classifyImportHealth(health: SourceHealth | undefined): ImportHealthState {
  if (!health) {
    return "not_scanned";
  }
  if (health.issues.some((issue) => issue.severity === "error")) {
    return "needs_attention";
  }
  if (health.issues.length > 0 && (health.complete || health.turnCount > 0)) {
    return "healthy_with_warnings";
  }
  return health.complete ? "healthy" : "needs_attention";
}
