import type {
  ImportResult,
  SourceAdapter
} from "../domain/types.js";

export type PromptRetention = "full" | "countsOnly";

export interface ImportStore {
  applyImport(result: ImportResult): Promise<void>;
}

export class ImportCoordinator {
  private activeRefresh: Promise<ImportResult[]> | null = null;

  constructor(
    private readonly adapters: SourceAdapter[],
    private readonly store: ImportStore
  ) {}

  refresh(retention: PromptRetention): Promise<ImportResult[]> {
    if (this.activeRefresh) {
      return this.activeRefresh;
    }

    this.activeRefresh = this.runRefresh(retention).finally(() => {
      this.activeRefresh = null;
    });
    return this.activeRefresh;
  }

  private async runRefresh(retention: PromptRetention): Promise<ImportResult[]> {
    const scanned = await Promise.all(
      this.adapters.map(async (adapter): Promise<ImportResult> => {
        try {
          return await adapter.scan();
        } catch (error) {
          return {
            source: adapter.source,
            complete: false,
            sessions: [],
            turns: [],
            seenSessionIds: [],
            issues: [
              {
                sourcePath: adapter.source,
                severity: "error",
                message: error instanceof Error ? error.message : String(error)
              }
            ],
            checkpoint: {
              completedAt: new Date().toISOString(),
              fingerprints: {}
            }
          };
        }
      })
    );

    for (const result of scanned) {
      const retained =
        retention === "full"
          ? result
          : {
              ...result,
              turns: result.turns.map((turn) => ({
                ...turn,
                prompt: "",
                response: ""
              }))
            };
      await this.store.applyImport(retained);
    }
    return scanned;
  }
}

