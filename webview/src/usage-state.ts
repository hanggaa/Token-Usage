import type { UsageGranularity } from "../../src/shared/dashboard.js";

interface UsageStateWriter {
  setState(state: { usageGranularity: UsageGranularity }): void;
}

export function readUsageGranularity(state: unknown): UsageGranularity {
  if (!state || typeof state !== "object" || !("usageGranularity" in state)) {
    return "daily";
  }
  const value = state.usageGranularity;
  return value === "daily" || value === "weekly" || value === "monthly"
    ? value
    : "daily";
}

export function writeUsageGranularity(
  api: UsageStateWriter,
  usageGranularity: UsageGranularity
): void {
  api.setState({ usageGranularity });
}
