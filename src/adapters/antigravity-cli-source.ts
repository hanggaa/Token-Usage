import { access, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import initSqlJs, { type Database } from "sql.js";
import type {
  ImportResult,
  SourceAdapter,
  SourceAvailability,
  SourceCheckpoint
} from "../domain/types.js";
import {
  parseAntigravityCliConversation,
  type AntigravityCliStepRow
} from "./antigravity-cli.js";
import { importResult } from "./result.js";
import { readSqliteSnapshot } from "./sqlite-wal-snapshot.js";

export type SqliteSnapshotReader = (databasePath: string) => Promise<Uint8Array>;

interface ConversationSummary {
  executionScope: "main" | "subagent";
  project: string | null;
  title: string | null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function conversationPaths(dataRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(join(dataRoot, "conversations"), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && extname(entry.name) === ".db")
      .map((entry) => join(dataRoot, "conversations", entry.name))
      .toSorted();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function queryRows(database: Database, sql: string): Record<string, unknown>[] {
  const statement = database.prepare(sql);
  const rows: Record<string, unknown>[] = [];
  try {
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

function requireTable(database: Database, tableName: string): void {
  const escapedName = tableName.replaceAll("'", "''");
  const rows = queryRows(
    database,
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${escapedName}'`
  );
  if (rows.length === 0) {
    throw new Error(`Missing required SQLite table: ${tableName}`);
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid ${field} value in Antigravity CLI database`);
  }
  return value;
}

function conversationId(value: unknown, sourcePath: string): string {
  if (value == null || (typeof value === "string" && !value.trim())) {
    return basename(sourcePath, extname(sourcePath));
  }
  if (typeof value !== "string") {
    throw new Error("Invalid cascade_id value in Antigravity CLI database");
  }
  return value.trim();
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`Invalid ${field} value in Antigravity CLI summary database`);
  }
  return value;
}

function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Invalid ${field} value in Antigravity CLI database`);
  }
  return value;
}

function requiredBlob(value: unknown, field: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error(`Invalid ${field} value in Antigravity CLI database`);
  }
  return value;
}

function projectFromWorkspaceUris(value: string | null): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (!text.startsWith("[") && !text.startsWith('"')) return text;
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed === "string") return parsed.trim() || null;
  if (
    Array.isArray(parsed)
    && parsed.every((entry) => typeof entry === "string")
  ) {
    return parsed.find((entry) => entry.trim())?.trim() ?? null;
  }
  throw new Error("Invalid workspace_uris value in Antigravity CLI summary database");
}

function readConversation(
  database: Database,
  sourcePath: string
): { conversationId: string; rows: AntigravityCliStepRow[] } {
  requireTable(database, "trajectory_meta");
  requireTable(database, "steps");
  const metadataRows = queryRows(
    database,
    `SELECT trajectory_id, cascade_id, trajectory_type, source
FROM trajectory_meta
LIMIT 1`
  );
  if (metadataRows.length === 0) {
    throw new Error("Antigravity CLI trajectory_meta table is empty");
  }
  const metadata = metadataRows[0];
  requiredString(metadata.trajectory_id, "trajectory_id");
  const canonicalConversationId = conversationId(metadata.cascade_id, sourcePath);
  requiredInteger(metadata.trajectory_type, "trajectory_type");
  requiredInteger(metadata.source, "source");
  const rows = queryRows(
    database,
    `SELECT idx, step_type, status, metadata, step_payload
FROM steps
ORDER BY idx`
  ).map((row): AntigravityCliStepRow => ({
    idx: requiredInteger(row.idx, "steps.idx"),
    stepType: requiredInteger(row.step_type, "steps.step_type"),
    status: requiredInteger(row.status, "steps.status"),
    metadata: requiredBlob(row.metadata, "steps.metadata"),
    stepPayload: requiredBlob(row.step_payload, "steps.step_payload")
  }));
  return { conversationId: canonicalConversationId, rows };
}

function findSummaryTable(database: Database): string {
  const requiredColumns = new Set([
    "conversation_id",
    "title",
    "workspace_uris",
    "parent_conversation_id",
    "nesting_depth"
  ]);
  const tables = queryRows(
    database,
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  );
  for (const row of tables) {
    if (typeof row.name !== "string") continue;
    const quotedName = row.name.replaceAll('"', '""');
    const columns = new Set(
      queryRows(database, `PRAGMA table_info("${quotedName}")`)
        .map((column) => column.name)
        .filter((name): name is string => typeof name === "string")
    );
    if ([...requiredColumns].every((column) => columns.has(column))) return row.name;
  }
  throw new Error("Antigravity CLI summary database has no compatible table");
}

function readSummaries(database: Database): Map<string, ConversationSummary> {
  const tableName = findSummaryTable(database).replaceAll('"', '""');
  const rows = queryRows(
    database,
    `SELECT conversation_id, title, workspace_uris, parent_conversation_id, nesting_depth
FROM "${tableName}"`
  );
  const summaries = new Map<string, ConversationSummary>();
  for (const row of rows) {
    const conversationId = requiredString(row.conversation_id, "conversation_id");
    const title = nullableString(row.title, "title");
    const workspaceUris = nullableString(row.workspace_uris, "workspace_uris");
    const parentConversationId = nullableString(
      row.parent_conversation_id,
      "parent_conversation_id"
    );
    const nestingDepth = requiredInteger(row.nesting_depth, "nesting_depth");
    summaries.set(conversationId, {
      title,
      project: projectFromWorkspaceUris(workspaceUris),
      executionScope:
        parentConversationId?.trim() || nestingDepth > 0 ? "subagent" : "main"
    });
  }
  return summaries;
}

export class AntigravityCliAdapter implements SourceAdapter {
  readonly source = "antigravity-cli" as const;

  constructor(
    private readonly dataRoot: string,
    private readonly wasmPath?: string,
    private readonly readSnapshot: SqliteSnapshotReader = readSqliteSnapshot
  ) {}

  async detect(): Promise<SourceAvailability> {
    try {
      const paths = await conversationPaths(this.dataRoot);
      return {
        available: paths.length > 0,
        detail: paths.length > 0
          ? `${paths.length} Antigravity CLI session databases found`
          : "No persisted Antigravity CLI sessions found",
        roots: [this.dataRoot]
      };
    } catch (error) {
      return {
        available: false,
        detail: message(error),
        roots: [this.dataRoot]
      };
    }
  }

  async scan(_checkpoint?: SourceCheckpoint): Promise<ImportResult> {
    let paths: string[];
    try {
      paths = await conversationPaths(this.dataRoot);
    } catch (error) {
      return {
        ...importResult("antigravity-cli", [], [], [{
          sourcePath: join(this.dataRoot, "conversations"),
          severity: "error",
          message: message(error)
        }], false),
        fullyObservedSessionIds: []
      };
    }
    if (paths.length === 0) {
      return {
        ...importResult("antigravity-cli", [], [], [], true),
        fullyObservedSessionIds: []
      };
    }

    const SQL = await initSqlJs({
      locateFile: (file) =>
        this.wasmPath ?? join(process.cwd(), "node_modules", "sql.js", "dist", file)
    });
    const sessions: ImportResult["sessions"] = [];
    const turns: ImportResult["turns"] = [];
    const issues: ImportResult["issues"] = [];
    const fullyObservedSessionIds: string[] = [];
    const summaryPath = join(this.dataRoot, "conversation_summaries.db");
    let summaries = new Map<string, ConversationSummary>();
    try {
      if (await pathExists(summaryPath)) {
        const database = new SQL.Database(await this.readSnapshot(summaryPath));
        try {
          summaries = readSummaries(database);
        } finally {
          database.close();
        }
      }
    } catch (error) {
      issues.push({
        sourcePath: summaryPath,
        severity: "warning",
        message: `Antigravity CLI summary metadata unavailable: ${message(error)}`
      });
    }

    let complete = true;
    let estimatedSessions = 0;
    for (const path of paths) {
      try {
        const database = new SQL.Database(await this.readSnapshot(path));
        let conversation;
        try {
          conversation = readConversation(database, path);
        } finally {
          database.close();
        }
        const summary = summaries.get(conversation.conversationId);
        const parsed = parseAntigravityCliConversation({
          conversationId: conversation.conversationId,
          sourcePath: path,
          title: summary?.title ?? null,
          project: summary?.project ?? null,
          executionScope: summary?.executionScope ?? "main",
          rows: conversation.rows
        });
        sessions.push(parsed.session);
        turns.push(...parsed.turns);
        if (parsed.usedEstimatedFallback) estimatedSessions += 1;
        if (parsed.issues.length > 0) complete = false;
        if (parsed.issues.length === 0) {
          fullyObservedSessionIds.push(parsed.session.sourceSessionId);
        }
        issues.push(...parsed.issues.map((issue) => ({
          sourcePath: path,
          severity: "error" as const,
          message: `Step ${issue.idx}: ${issue.message}`
        })));
      } catch (error) {
        complete = false;
        issues.push({
          sourcePath: path,
          severity: "error",
          message: message(error)
        });
      }
    }
    if (estimatedSessions > 0) {
      issues.push({
        sourcePath: this.dataRoot,
        severity: "warning",
        message: `${estimatedSessions} Antigravity CLI ${
          estimatedSessions === 1 ? "session" : "sessions"
        } used visible-content estimates because recorded usage was absent`
      });
    }
    return {
      ...importResult("antigravity-cli", sessions, turns, issues, complete),
      fullyObservedSessionIds
    };
  }
}
