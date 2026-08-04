import type {
  ImportResult,
  SourceAdapter
} from "../domain/types.js";

export type PromptRetention = "full" | "countsOnly";

export interface ImportStore {
  applyImport(result: ImportResult): Promise<void>;
}

export function reconcileAntigravityResults(results: ImportResult[]): ImportResult[] {
  const cli = results.find((result) => result.source === "antigravity-cli");
  const ide = results.find((result) => result.source === "antigravity");
  if (!cli || !ide || cli.sessions.length === 0) return results;

  const emittedCliIds = new Set(
    cli.sessions.map((session) => session.sourceSessionId)
  );
  const cliIds = new Set(
    (cli.fullyObservedSessionIds ?? [...emittedCliIds])
      .filter((sessionId) => emittedCliIds.has(sessionId))
  );
  const duplicateIds = new Set(
    ide.sessions
      .map((session) => session.sourceSessionId)
      .filter((sessionId) => cliIds.has(sessionId))
  );
  if (duplicateIds.size === 0) return results;

  const noun = duplicateIds.size === 1 ? "session" : "sessions";
  return results.map((result) => {
    if (result.source === "antigravity-cli") {
      return {
        ...result,
        diagnostics: [
          ...(result.diagnostics ?? []),
          `Excluded ${duplicateIds.size} Antigravity IDE ${noun} duplicated by Antigravity CLI`
        ]
      };
    }
    if (result.source !== "antigravity") return result;
    return {
      ...result,
      sessions: result.sessions.filter(
        (session) => !duplicateIds.has(session.sourceSessionId)
      ),
      turns: result.turns.filter(
        (turn) => !duplicateIds.has(turn.sourceSessionId)
      ),
      seenSessionIds: result.seenSessionIds.filter(
        (sessionId) => !duplicateIds.has(sessionId)
      )
    };
  });
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
    const reconciled = reconcileAntigravityResults(scanned);

    for (const result of reconciled) {
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
    return reconciled;
  }
}
