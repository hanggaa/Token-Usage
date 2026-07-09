import { afterEach, describe, expect, it, vi } from "vitest";
import { startRefreshScheduler } from "../../src/services/refresh-scheduler.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("startRefreshScheduler", () => {
  it("does no background work when disabled", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const scheduler = startRefreshScheduler(refresh, {
      enabled: false,
      intervalMinutes: 30
    });

    vi.advanceTimersByTime(24 * 60 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  it("uses a low-frequency interval and can be disposed", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const scheduler = startRefreshScheduler(refresh, {
      enabled: true,
      intervalMinutes: 30
    });

    vi.advanceTimersByTime(29 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.dispose();
    vi.advanceTimersByTime(30 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("clamps enabled intervals to five minutes", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const scheduler = startRefreshScheduler(refresh, {
      enabled: true,
      intervalMinutes: 1
    });

    vi.advanceTimersByTime(4 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });
});
