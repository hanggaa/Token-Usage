import { readFile } from "node:fs/promises";
import { basename, relative } from "node:path";
import type {
  ExecutionScope,
  ImportResult,
  SourceAdapter,
  SourceAvailability,
  SourceCheckpoint
} from "../domain/types.js";
import {
  firstClaudeTimestamp,
  parseClaudeSession
} from "./claude.js";
import { walkFiles } from "./files.js";
import { importResult } from "./result.js";

interface TranscriptFile {
  content: string;
  executionScope: ExecutionScope;
  firstTimestamp: string;
  path: string;
}

function executionScope(root: string, path: string): ExecutionScope {
  const segments = relative(root, path).split(/[\\/]/u);
  return segments.includes("subagents") && /^agent-.*\.jsonl$/u.test(basename(path))
    ? "subagent"
    : "main";
}

function malformedLineCount(content: string): number {
  let malformed = 0;
  for (const line of content.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }
    try {
      JSON.parse(line);
    } catch {
      malformed += 1;
    }
  }
  return malformed;
}

export class ClaudeAdapter implements SourceAdapter {
  readonly source = "claude" as const;

  constructor(private readonly projectsRoot: string) {}

  async detect(): Promise<SourceAvailability> {
    const files = (await walkFiles(this.projectsRoot)).filter((file) => file.endsWith(".jsonl"));
    return {
      available: files.length > 0,
      detail:
        files.length > 0
          ? `${files.length} Claude Code transcript files found`
          : "No persisted Claude Code CLI sessions found",
      roots: [this.projectsRoot]
    };
  }

  async scan(_checkpoint?: SourceCheckpoint): Promise<ImportResult> {
    const files = (await walkFiles(this.projectsRoot))
      .filter((file) => file.endsWith(".jsonl"))
      .toSorted();
    const transcripts: TranscriptFile[] = [];
    const sessions: ImportResult["sessions"] = [];
    const turns: ImportResult["turns"] = [];
    const issues: ImportResult["issues"] = [];

    for (const path of files) {
      try {
        const content = await readFile(path, "utf8");
        const malformed = malformedLineCount(content);
        if (malformed > 0) {
          issues.push({
            sourcePath: path,
            severity: "error",
            message: `${malformed} malformed Claude Code JSONL ${
              malformed === 1 ? "line was" : "lines were"
            } ignored`
          });
        }
        transcripts.push({
          content,
          executionScope: executionScope(this.projectsRoot, path),
          firstTimestamp: firstClaudeTimestamp(content),
          path
        });
      } catch (error) {
        issues.push({
          sourcePath: path,
          severity: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const seenAssistantMessageIds = new Set<string>();
    for (const transcript of transcripts.toSorted((left, right) =>
      left.firstTimestamp.localeCompare(right.firstTimestamp)
      || left.path.localeCompare(right.path)
    )) {
      const parsed = parseClaudeSession(
        transcript.content,
        transcript.path,
        transcript.executionScope,
        seenAssistantMessageIds
      );
      if (parsed.turns.length > 0) {
        sessions.push(parsed.session);
        turns.push(...parsed.turns);
      }
    }

    return importResult("claude", sessions, turns, issues, issues.length === 0);
  }
}
