import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import type {
  ImportResult,
  SourceAdapter,
  SourceAvailability,
  SourceCheckpoint
} from "../domain/types.js";
import { parseAntigravityTranscript } from "./antigravity.js";
import { walkFiles } from "./files.js";
import { importResult } from "./result.js";

export interface AntigravityLegacyBridge {
  fetchSteps(sessionId: string): Promise<unknown[] | null>;
}

export function parseLegacyAntigravitySteps(
  steps: unknown[],
  sessionId: string,
  sourcePath: string
) {
  const transcriptRows: unknown[] = [];
  for (const value of steps) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const step = value as Record<string, unknown>;
    const metadata =
      step.metadata && typeof step.metadata === "object"
        ? (step.metadata as Record<string, unknown>)
        : {};
    if (step.type === "CORTEX_STEP_TYPE_USER_INPUT") {
      const userInput =
        step.userInput && typeof step.userInput === "object"
          ? (step.userInput as Record<string, unknown>)
          : {};
      if (typeof userInput.userResponse === "string") {
        transcriptRows.push({
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: metadata.createdAt,
          step_index: transcriptRows.length,
          content: userInput.userResponse,
          model: metadata.generatorModel
        });
      }
      continue;
    }
    if (step.type === "CORTEX_STEP_TYPE_PLANNER_RESPONSE") {
      const planner =
        step.plannerResponse && typeof step.plannerResponse === "object"
          ? (step.plannerResponse as Record<string, unknown>)
          : {};
      const content =
        typeof planner.modifiedResponse === "string"
          ? planner.modifiedResponse
          : planner.response;
      transcriptRows.push({
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: metadata.createdAt,
        step_index: transcriptRows.length,
        content,
        model: metadata.generatorModel
      });
      continue;
    }
    transcriptRows.push({
      source: "MODEL",
      type: String(step.type ?? "TOOL"),
      status: "DONE",
      created_at: metadata.createdAt,
      step_index: transcriptRows.length,
      content: "",
      model: metadata.generatorModel
    });
  }
  return parseAntigravityTranscript(
    transcriptRows.map((row) => JSON.stringify(row)).join("\n"),
    sessionId,
    sourcePath
  );
}

function sessionIdFromTranscript(currentRoot: string, file: string): string {
  const brainRoot = join(currentRoot, "brain");
  return relative(brainRoot, file).split(/[\\/]/u)[0] || basename(dirname(file));
}

export class AntigravityAdapter implements SourceAdapter {
  readonly source = "antigravity" as const;

  constructor(
    private readonly currentRoot: string,
    private readonly legacyRoot: string,
    private readonly legacyBridge: AntigravityLegacyBridge | null
  ) {}

  async detect(): Promise<SourceAvailability> {
    const current = (await walkFiles(join(this.currentRoot, "brain"))).filter((file) =>
      /transcript(?:_full)?\.jsonl$/u.test(file)
    );
    const legacy = (await walkFiles(join(this.legacyRoot, "conversations"))).filter(
      (file) => extname(file) === ".pb"
    );
    return {
      available: current.length + legacy.length > 0,
      detail: `${current.length} transcripts and ${legacy.length} legacy sessions found`,
      roots: [this.currentRoot, this.legacyRoot]
    };
  }

  async scan(_checkpoint?: SourceCheckpoint): Promise<ImportResult> {
    const sessions = [];
    const turns = [];
    const issues = [];
    let complete = true;
    const transcriptFiles = (await walkFiles(join(this.currentRoot, "brain"))).filter((file) =>
      /transcript(?:_full)?\.jsonl$/u.test(file)
    );
    const preferredBySession = new Map<string, string>();
    for (const file of transcriptFiles) {
      const id = sessionIdFromTranscript(this.currentRoot, file);
      const previous = preferredBySession.get(id);
      if (!previous || basename(file) === "transcript_full.jsonl") {
        preferredBySession.set(id, file);
      }
    }

    for (const [id, file] of preferredBySession) {
      try {
        const parsed = parseAntigravityTranscript(await readFile(file, "utf8"), id, file);
        sessions.push(parsed.session);
        turns.push(...parsed.turns);
      } catch (error) {
        complete = false;
        issues.push({
          sourcePath: file,
          severity: "error" as const,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const legacyFiles = (await walkFiles(join(this.legacyRoot, "conversations"))).filter(
      (file) => extname(file) === ".pb"
    );
    for (const file of legacyFiles) {
      const id = basename(file, ".pb");
      if (preferredBySession.has(id)) {
        continue;
      }
      const steps = this.legacyBridge ? await this.legacyBridge.fetchSteps(id) : null;
      if (!steps) {
        complete = false;
        issues.push({
          sourcePath: file,
          severity: "warning" as const,
          message: `Legacy session ${id} requires a running Antigravity language server`
        });
        continue;
      }
      const parsed = parseLegacyAntigravitySteps(steps, id, file);
      sessions.push(parsed.session);
      turns.push(...parsed.turns);
    }

    return importResult("antigravity", sessions, turns, issues, complete);
  }
}

