import type { UsageBudgets } from "../shared/dashboard.js";
import {
  UsageBudgetConflictError,
  saveUsageBudgets,
  usageBudgetsEqual
} from "./usage-budgets.js";

interface DashboardPublicationDependencies<Snapshot> {
  readBudgets(): UsageBudgets;
  updateBudget(key: string, value: number): Promise<void>;
  buildSnapshotFromStore(budgets: UsageBudgets): Promise<Snapshot>;
  publishSnapshot(snapshot: Snapshot): Promise<void>;
  publishError(message: string): Promise<void>;
}

interface ActiveBudgetTransaction {
  expected: UsageBudgets;
  latestExternalBudgets: UsageBudgets | null;
}

const budgetNamesByKey: Record<string, keyof UsageBudgets> = {
  "budgets.daily": "daily",
  "budgets.weekly": "weekly",
  "budgets.monthly": "monthly"
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DashboardPublicationCoordinator<Snapshot> {
  private operationTail: Promise<void> = Promise.resolve();
  private externalBudgetPublication: Promise<void> | null = null;
  private activeBudgetTransaction: ActiveBudgetTransaction | null = null;
  private lastPublishedBudgets: UsageBudgets | null = null;

  constructor(private readonly dependencies: DashboardPublicationDependencies<Snapshot>) {}

  publishSnapshot(): Promise<void> {
    return this.enqueue(async () => {
      await this.publishCurrentBudgetsUntilStable();
    });
  }

  publishError(message: string): Promise<void> {
    return this.enqueue(() => this.dependencies.publishError(message));
  }

  saveBudgets(budgets: UsageBudgets): Promise<void> {
    return this.enqueue(async () => {
      const previousBudgets = this.dependencies.readBudgets();
      this.activeBudgetTransaction = {
        expected: { ...previousBudgets },
        latestExternalBudgets: null
      };
      try {
        let saveError: unknown;
        try {
          await saveUsageBudgets(
            budgets,
            previousBudgets,
            () => this.dependencies.readBudgets(),
            async (key, value) => {
              const name = budgetNamesByKey[key];
              const transaction = this.activeBudgetTransaction;
              const previousExpected = name && transaction
                ? transaction.expected[name]
                : undefined;
              if (name && transaction) transaction.expected[name] = value;
              try {
                await this.dependencies.updateBudget(key, value);
              } catch (error) {
                if (name && transaction && previousExpected !== undefined) {
                  transaction.expected[name] = previousExpected;
                }
                throw error;
              }
            }
          );
        } catch (error) {
          saveError = error;
        }

        let publicationError: unknown;
        let activeBudgets: UsageBudgets | null = null;
        try {
          activeBudgets = await this.publishCurrentBudgetsUntilStable(
            this.activeBudgetTransaction.latestExternalBudgets ?? undefined
          );
        } catch (error) {
          publicationError = error;
        }

        if (saveError && publicationError) {
          throw new Error(
            `${errorMessage(saveError)} Snapshot publication also failed: ${errorMessage(publicationError)}`,
            { cause: saveError }
          );
        }
        if (saveError) throw saveError;
        if (publicationError) throw publicationError;
        if (!activeBudgets || !usageBudgetsEqual(activeBudgets, budgets)) {
          throw new UsageBudgetConflictError();
        }
      } finally {
        this.activeBudgetTransaction = null;
      }
    });
  }

  onBudgetConfigurationChanged(): Promise<void> {
    const current = this.dependencies.readBudgets();
    if (this.activeBudgetTransaction) {
      if (!usageBudgetsEqual(current, this.activeBudgetTransaction.expected)) {
        this.activeBudgetTransaction.latestExternalBudgets = current;
      }
      return Promise.resolve();
    }
    if (this.lastPublishedBudgets && usageBudgetsEqual(current, this.lastPublishedBudgets)) {
      return Promise.resolve();
    }
    if (this.externalBudgetPublication) return this.externalBudgetPublication;

    const scheduled = Promise.resolve().then(() => this.publishSnapshot());
    const tracked = scheduled.finally(() => {
      if (this.externalBudgetPublication === tracked) {
        this.externalBudgetPublication = null;
      }
    });
    this.externalBudgetPublication = tracked;
    return tracked;
  }

  private async publishCurrentBudgetsUntilStable(
    observedBudgets?: UsageBudgets
  ): Promise<UsageBudgets> {
    let budgets = observedBudgets ?? this.dependencies.readBudgets();
    const activeBeforeBuild = this.dependencies.readBudgets();
    if (!usageBudgetsEqual(activeBeforeBuild, budgets)) budgets = activeBeforeBuild;
    while (true) {
      const snapshot = await this.dependencies.buildSnapshotFromStore(budgets);
      await this.dependencies.publishSnapshot(snapshot);
      this.lastPublishedBudgets = budgets;
      const current = this.dependencies.readBudgets();
      if (usageBudgetsEqual(current, budgets)) return current;
      budgets = current;
    }
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
