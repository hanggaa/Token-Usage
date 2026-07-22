import type { UsageBudgets } from "../shared/dashboard.js";
import { saveUsageBudgets } from "./usage-budgets.js";

interface DashboardPublicationDependencies<Snapshot> {
  readBudgets(): UsageBudgets;
  updateBudget(key: string, value: number): Promise<void>;
  buildSnapshotFromStore(): Promise<Snapshot>;
  publishSnapshot(snapshot: Snapshot): Promise<void>;
  publishError(message: string): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DashboardPublicationCoordinator<Snapshot> {
  private operationTail: Promise<void> = Promise.resolve();
  private externalBudgetPublication: Promise<void> | null = null;
  private savingBudgets = false;

  constructor(private readonly dependencies: DashboardPublicationDependencies<Snapshot>) {}

  publishSnapshot(): Promise<void> {
    return this.enqueue(() => this.buildAndPublishSnapshot());
  }

  publishError(message: string): Promise<void> {
    return this.enqueue(() => this.dependencies.publishError(message));
  }

  saveBudgets(budgets: UsageBudgets): Promise<void> {
    return this.enqueue(async () => {
      this.savingBudgets = true;
      try {
        let saveError: unknown;
        try {
          await saveUsageBudgets(
            budgets,
            this.dependencies.readBudgets(),
            this.dependencies.updateBudget
          );
        } catch (error) {
          saveError = error;
        }

        let publicationError: unknown;
        try {
          await this.buildAndPublishSnapshot();
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
      } finally {
        this.savingBudgets = false;
      }
    });
  }

  onBudgetConfigurationChanged(): Promise<void> {
    if (this.savingBudgets) return Promise.resolve();
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

  private async buildAndPublishSnapshot(): Promise<void> {
    const snapshot = await this.dependencies.buildSnapshotFromStore();
    await this.dependencies.publishSnapshot(snapshot);
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
