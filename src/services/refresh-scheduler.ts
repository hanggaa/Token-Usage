export interface RefreshSchedulerOptions {
  enabled: boolean;
  intervalMinutes: number;
}

export interface RefreshScheduler {
  dispose(): void;
}

export function startRefreshScheduler(
  refresh: () => void,
  options: RefreshSchedulerOptions
): RefreshScheduler {
  if (!options.enabled) {
    return { dispose: () => undefined };
  }

  const intervalMinutes = Math.max(5, options.intervalMinutes);
  const timer = setInterval(refresh, intervalMinutes * 60_000);
  return {
    dispose: () => clearInterval(timer)
  };
}
