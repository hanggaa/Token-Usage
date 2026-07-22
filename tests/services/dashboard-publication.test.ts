import { describe, expect, it, vi } from "vitest";
import { DashboardPublicationCoordinator } from "../../src/services/dashboard-publication.js";
import type { UsageBudgets } from "../../src/shared/dashboard.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function configuration(initial: UsageBudgets = { daily: 1, weekly: 2, monthly: 3 }) {
  const values = new Map<string, number>([
    ["budgets.daily", initial.daily],
    ["budgets.weekly", initial.weekly],
    ["budgets.monthly", initial.monthly]
  ]);
  return {
    values,
    readBudgets: () => ({
      daily: values.get("budgets.daily") ?? 0,
      weekly: values.get("budgets.weekly") ?? 0,
      monthly: values.get("budgets.monthly") ?? 0
    })
  };
}

describe("DashboardPublicationCoordinator", () => {
  it("suppresses internal configuration events and publishes one final saved snapshot before returning", async () => {
    const config = configuration();
    const events: string[] = [];
    let delayedInternalEvent: Promise<void> | null = null;
    let coordinator!: DashboardPublicationCoordinator<UsageBudgets>;
    coordinator = new DashboardPublicationCoordinator({
      readBudgets: config.readBudgets,
      updateBudget: async (key, value) => {
        config.values.set(key, value);
        events.push(`update:${key}`);
        await coordinator.onBudgetConfigurationChanged();
      },
      buildSnapshotFromStore: async () => config.readBudgets(),
      publishSnapshot: async (snapshot) => {
        events.push(`snapshot:${snapshot.daily}/${snapshot.weekly}/${snapshot.monthly}`);
        if (!delayedInternalEvent) {
          delayedInternalEvent = coordinator.onBudgetConfigurationChanged();
        }
      },
      publishError: async (message) => {
        events.push(`error:${message}`);
      }
    });

    await coordinator.saveBudgets({ daily: 10, weekly: 20, monthly: 30 });
    await delayedInternalEvent;
    events.push("acknowledgement-ready");

    expect(events).toEqual([
      "update:budgets.daily",
      "update:budgets.weekly",
      "update:budgets.monthly",
      "snapshot:10/20/30",
      "acknowledgement-ready"
    ]);
  });

  it("publishes one final restored snapshot when a save fails", async () => {
    const config = configuration();
    const published: UsageBudgets[] = [];
    const coordinator = new DashboardPublicationCoordinator({
      readBudgets: config.readBudgets,
      updateBudget: async (key, value) => {
        if (key === "budgets.monthly" && value === 30) throw new Error("monthly rejected");
        config.values.set(key, value);
      },
      buildSnapshotFromStore: async () => config.readBudgets(),
      publishSnapshot: async (snapshot) => {
        published.push(snapshot);
      },
      publishError: async () => undefined
    });

    await expect(coordinator.saveBudgets({ daily: 10, weekly: 20, monthly: 30 }))
      .rejects.toThrow("monthly rejected");
    expect(published).toEqual([{ daily: 1, weekly: 2, monthly: 3 }]);
  });

  it("coalesces external changes into one stored-data publication without writing settings", async () => {
    const config = configuration({ daily: 7, weekly: 8, monthly: 9 });
    const updateBudget = vi.fn(async () => undefined);
    const buildSnapshotFromStore = vi.fn(async () => config.readBudgets());
    const publishSnapshot = vi.fn(async () => undefined);
    const coordinator = new DashboardPublicationCoordinator({
      readBudgets: config.readBudgets,
      updateBudget,
      buildSnapshotFromStore,
      publishSnapshot,
      publishError: async () => undefined
    });

    await Promise.all([
      coordinator.onBudgetConfigurationChanged(),
      coordinator.onBudgetConfigurationChanged(),
      coordinator.onBudgetConfigurationChanged()
    ]);

    expect(updateBudget).not.toHaveBeenCalled();
    expect(buildSnapshotFromStore).toHaveBeenCalledOnce();
    expect(publishSnapshot).toHaveBeenCalledWith({ daily: 7, weekly: 8, monthly: 9 });
  });

  it("serializes stored reads, snapshot posts, and errors in request order", async () => {
    const firstReadStarted = deferred<void>();
    const releaseFirstRead = deferred<void>();
    const events: string[] = [];
    let readCount = 0;
    const coordinator = new DashboardPublicationCoordinator({
      readBudgets: () => ({ daily: 0, weekly: 0, monthly: 0 }),
      updateBudget: async () => undefined,
      buildSnapshotFromStore: async () => {
        const id = ++readCount;
        events.push(`read:${id}`);
        if (id === 1) {
          firstReadStarted.resolve();
          await releaseFirstRead.promise;
        }
        return id;
      },
      publishSnapshot: async (snapshot) => {
        events.push(`snapshot:${snapshot}`);
      },
      publishError: async (message) => {
        events.push(`error:${message}`);
      }
    });

    const first = coordinator.publishSnapshot();
    await firstReadStarted.promise;
    const second = coordinator.publishSnapshot();
    const error = coordinator.publishError("newer failure");
    await Promise.resolve();
    expect(events).toEqual(["read:1"]);

    releaseFirstRead.resolve();
    await Promise.all([first, second, error]);

    expect(events).toEqual([
      "read:1",
      "snapshot:1",
      "read:2",
      "snapshot:2",
      "error:newer failure"
    ]);
  });
});
