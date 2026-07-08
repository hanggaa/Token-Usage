import { readFile } from "node:fs/promises";
import type {
  ImportResult,
  SourceAdapter,
  SourceAvailability,
  SourceCheckpoint
} from "../domain/types.js";
import { parseCodexSession } from "./codex.js";
import { walkFiles } from "./files.js";
import { importResult } from "./result.js";

export class CodexAdapter implements SourceAdapter {
  readonly source = "codex" as const;

  constructor(private readonly sessionsRoot: string) {}

  async detect(): Promise<SourceAvailability> {
    const files = (await walkFiles(this.sessionsRoot)).filter((file) => file.endsWith(".jsonl"));
    return {
      available: files.length > 0,
      detail: files.length > 0 ? `${files.length} session files found` : "No Codex sessions found",
      roots: [this.sessionsRoot]
    };
  }

  async scan(_checkpoint?: SourceCheckpoint): Promise<ImportResult> {
    const files = (await walkFiles(this.sessionsRoot)).filter((file) => file.endsWith(".jsonl"));
    const sessions = [];
    const turns = [];
    const issues = [];

    for (const file of files) {
      try {
        const parsed = parseCodexSession(await readFile(file, "utf8"), file);
        sessions.push(parsed.session);
        turns.push(...parsed.turns);
      } catch (error) {
        issues.push({
          sourcePath: file,
          severity: "error" as const,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return importResult("codex", sessions, turns, issues, issues.length === 0);
  }
}

