import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import initSqlJs, { type Database } from "sql.js";
import type {
  ImportResult,
  SourceAdapter,
  SourceAvailability,
  SourceCheckpoint
} from "../domain/types.js";
import { parseOpenCodeExport } from "./opencode.js";
import { importResult } from "./result.js";

export type OpenCodeExecutor = (args: string[]) => Promise<string>;

const execFileAsync = promisify(execFile);

async function firstExisting(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next platform-specific candidate.
    }
  }
  return process.platform === "win32" ? "opencode.exe" : "opencode";
}

export async function defaultOpenCodeExecutor(args: string[]): Promise<string> {
  const binary = await firstExisting([
    process.env.OPENCODE_BIN ?? "",
    process.platform === "win32" && process.env.APPDATA
      ? join(process.env.APPDATA, "npm", "node_modules", "opencode-ai", "bin", "opencode.exe")
      : "",
    join(homedir(), ".opencode", "bin", "opencode")
  ].filter(Boolean));
  const result = await execFileAsync(binary, args, {
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024
  });
  return result.stdout;
}

function parseJsonOutput(output: string): unknown {
  const clean = output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "").trim();
  const arrayStart = clean.indexOf("[");
  const objectStart = clean.indexOf("{");
  const start =
    arrayStart < 0
      ? objectStart
      : objectStart < 0
        ? arrayStart
        : Math.min(arrayStart, objectStart);
  if (start < 0) {
    throw new Error("OpenCode did not return JSON");
  }
  return JSON.parse(clean.slice(start));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function queryRows(database: Database, sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const statement = database.prepare(sql);
  const rows: Record<string, unknown>[] = [];
  try {
    statement.bind(params as never[]);
    while (statement.step()) {
      rows.push(statement.getAsObject());
    }
  } finally {
    statement.free();
  }
  return rows;
}

async function scanDatabaseFallback(
  dataRoot: string,
  wasmPath?: string
): Promise<{ sessions: ReturnType<typeof parseOpenCodeExport>[]; databasePath: string }> {
  const databasePath = join(dataRoot, "opencode.db");
  if (await pathExists(`${databasePath}-wal`)) {
    throw new Error("OpenCode database has an active WAL; close OpenCode or use CLI export");
  }
  const bytes = await readFile(databasePath);
  const SQL = await initSqlJs({
    locateFile: (file) =>
      wasmPath ?? join(process.cwd(), "node_modules", "sql.js", "dist", file)
  });
  const database = new SQL.Database(bytes);
  try {
    const parsed = [];
    const sessionRows = queryRows(
      database,
      "SELECT id, directory, title, time_created, time_updated FROM session ORDER BY time_created"
    );
    for (const session of sessionRows) {
      const sessionId = String(session.id);
      const messages = queryRows(
        database,
        "SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, rowid",
        [sessionId]
      ).map((message) => {
        const storedInfo = JSON.parse(String(message.data)) as Record<string, unknown>;
        return {
          info: {
            ...storedInfo,
            id: String(message.id),
            sessionID: sessionId
          },
          parts: queryRows(
            database,
            "SELECT data FROM part WHERE message_id = ? ORDER BY rowid",
            [String(message.id)]
          ).map((part) => JSON.parse(String(part.data)))
        };
      });
      parsed.push(
        parseOpenCodeExport(
          {
            info: {
              id: sessionId,
              directory: session.directory,
              title: session.title,
              time: {
                created: session.time_created,
                updated: session.time_updated
              }
            },
            messages
          },
          databasePath
        )
      );
    }
    return { sessions: parsed, databasePath };
  } finally {
    database.close();
  }
}

export class OpenCodeAdapter implements SourceAdapter {
  readonly source = "opencode" as const;

  constructor(
    private readonly dataRoot: string,
    private readonly execute: OpenCodeExecutor = defaultOpenCodeExecutor,
    private readonly wasmPath?: string
  ) {}

  async detect(): Promise<SourceAvailability> {
    try {
      const sessions = parseJsonOutput(await this.execute(["session", "list", "--format", "json"]));
      const count = Array.isArray(sessions) ? sessions.length : 0;
      return {
        available: true,
        detail: `${count} sessions reported by OpenCode`,
        roots: [this.dataRoot]
      };
    } catch (error) {
      return {
        available: false,
        detail: error instanceof Error ? error.message : String(error),
        roots: [this.dataRoot]
      };
    }
  }

  async scan(_checkpoint?: SourceCheckpoint): Promise<ImportResult> {
    const sessions = [];
    const turns = [];
    const issues = [];
    try {
      const listed = parseJsonOutput(await this.execute(["session", "list", "--format", "json"]));
      if (!Array.isArray(listed)) {
        throw new Error("OpenCode session list was not an array");
      }
      for (const row of listed) {
        const id =
          row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"
            ? (row as { id: string }).id
            : null;
        if (!id) {
          continue;
        }
        try {
          const parsed = parseOpenCodeExport(
            parseJsonOutput(await this.execute(["export", id])),
            `opencode:${id}`
          );
          sessions.push(parsed.session);
          turns.push(...parsed.turns);
        } catch (error) {
          issues.push({
            sourcePath: `opencode:${id}`,
            severity: "error" as const,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
      return importResult("opencode", sessions, turns, issues, issues.length === 0);
    } catch (error) {
      const cliMessage = error instanceof Error ? error.message : String(error);
      try {
        const fallback = await scanDatabaseFallback(this.dataRoot, this.wasmPath);
        for (const parsed of fallback.sessions) {
          sessions.push(parsed.session);
          turns.push(...parsed.turns);
        }
        issues.push({
          sourcePath: fallback.databasePath,
          severity: "warning" as const,
          message: `OpenCode CLI unavailable; used consistent database fallback: ${cliMessage}`
        });
        return importResult("opencode", sessions, turns, issues, true);
      } catch (fallbackError) {
        issues.push({
          sourcePath: this.dataRoot,
          severity: "error" as const,
          message: `${cliMessage}; database fallback failed: ${
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          }`
        });
        return importResult("opencode", sessions, turns, issues, false);
      }
    }
  }
}
