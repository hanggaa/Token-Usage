import {
  access,
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
  type FileHandle
} from "node:fs/promises";
import { dirname } from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type {
  ImportResult,
  MeasurementQuality,
  NormalizedTurn,
  Source,
  TokenKind,
  TokenMetric
} from "../domain/types.js";

export interface TrackerStoreOptions {
  databasePath: string;
  wasmPath: string;
}

export interface SourceHealth {
  source: Source;
  complete: boolean;
  completedAt: string;
  sessionCount: number;
  turnCount: number;
  issues: ImportResult["issues"];
}

const SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS sessions (
    source TEXT NOT NULL,
    source_session_id TEXT NOT NULL,
    title TEXT NOT NULL,
    project TEXT,
    started_at TEXT,
    updated_at TEXT,
    source_path TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    PRIMARY KEY (source, source_session_id)
  );
  CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_session_id TEXT NOT NULL,
    source_turn_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    model TEXT,
    provider TEXT,
    project TEXT,
    prompt TEXT NOT NULL,
    response TEXT NOT NULL,
    tool_event_count INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    FOREIGN KEY (source, source_session_id)
      REFERENCES sessions(source, source_session_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS turns_timestamp_idx ON turns(timestamp DESC);
  CREATE INDEX IF NOT EXISTS turns_source_idx ON turns(source);
  CREATE TABLE IF NOT EXISTS token_metrics (
    turn_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    value INTEGER,
    quality TEXT NOT NULL,
    basis TEXT NOT NULL,
    PRIMARY KEY (turn_id, kind),
    FOREIGN KEY (turn_id) REFERENCES turns(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS source_health (
    source TEXT PRIMARY KEY,
    complete INTEGER NOT NULL,
    completed_at TEXT NOT NULL,
    session_count INTEGER NOT NULL,
    turn_count INTEGER NOT NULL,
    issues_json TEXT NOT NULL
  );
`;

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function rows(database: Database, sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const statement = database.prepare(sql);
  const result: Record<string, unknown>[] = [];
  try {
    statement.bind(params as never[]);
    while (statement.step()) {
      result.push(statement.getAsObject());
    }
  } finally {
    statement.free();
  }
  return result;
}

export class TrackerStore {
  readonly databasePath: string;
  private database: Database;

  private constructor(
    private readonly SQL: SqlJsStatic,
    options: TrackerStoreOptions,
    database: Database
  ) {
    this.databasePath = options.databasePath;
    this.wasmPath = options.wasmPath;
    this.database = database;
  }

  private readonly wasmPath: string;

  static async open(options: TrackerStoreOptions): Promise<TrackerStore> {
    await mkdir(dirname(options.databasePath), { recursive: true });
    const backupPath = `${options.databasePath}.bak`;
    if (!(await exists(options.databasePath)) && (await exists(backupPath))) {
      await copyFile(backupPath, options.databasePath);
    }
    const SQL = await initSqlJs({ locateFile: () => options.wasmPath });
    const database = await TrackerStore.loadDatabase(SQL, options.databasePath);
    database.run(SCHEMA);
    return new TrackerStore(SQL, options, database);
  }

  private static async loadDatabase(SQL: SqlJsStatic, path: string): Promise<Database> {
    if (!(await exists(path))) {
      return new SQL.Database();
    }
    return new SQL.Database(await readFile(path));
  }

  private async reload(): Promise<void> {
    this.database.close();
    this.database = await TrackerStore.loadDatabase(this.SQL, this.databasePath);
    this.database.run(SCHEMA);
  }

  private async acquireLock(): Promise<FileHandle> {
    const lockPath = `${this.databasePath}.lock`;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        const handle = await open(lockPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
        return handle;
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : null;
        if (code !== "EEXIST") {
          throw error;
        }
        try {
          const lockStat = await stat(lockPath);
          if (Date.now() - lockStat.mtimeMs > 30_000) {
            await rm(lockPath, { force: true });
            continue;
          }
        } catch {
          continue;
        }
        await sleep(50);
      }
    }
    throw new Error("Tracker database is busy in another IDE instance");
  }

  private async withWriteLock<T>(operation: () => Promise<T> | T): Promise<T> {
    const handle = await this.acquireLock();
    const lockPath = `${this.databasePath}.lock`;
    try {
      await this.reload();
      const result = await operation();
      await this.persist();
      return result;
    } finally {
      await handle.close();
      await rm(lockPath, { force: true });
    }
  }

  private async persist(): Promise<void> {
    const temporaryPath = `${this.databasePath}.tmp-${process.pid}`;
    const backupPath = `${this.databasePath}.bak`;
    await writeFile(temporaryPath, this.database.export(), { mode: 0o600 });
    if (await exists(this.databasePath)) {
      await copyFile(this.databasePath, backupPath);
      await rm(this.databasePath, { force: true });
    }
    await rename(temporaryPath, this.databasePath);
    await rm(backupPath, { force: true });
  }

  async applyImport(result: ImportResult): Promise<void> {
    await this.withWriteLock(() => {
      this.database.run("BEGIN");
      try {
        for (const session of result.sessions) {
          this.database.run(
            `INSERT OR REPLACE INTO sessions
              (source, source_session_id, title, project, started_at, updated_at, source_path, fingerprint)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              session.source,
              session.sourceSessionId,
              session.title,
              session.project,
              session.startedAt,
              session.updatedAt,
              session.sourcePath,
              session.fingerprint
            ]
          );
          this.database.run(
            "DELETE FROM turns WHERE source = ? AND source_session_id = ?",
            [session.source, session.sourceSessionId]
          );
        }

        for (const turn of result.turns) {
          this.database.run(
            `INSERT OR REPLACE INTO turns
              (id, source, source_session_id, source_turn_id, timestamp, model, provider, project,
               prompt, response, tool_event_count, fingerprint)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              turn.id,
              turn.source,
              turn.sourceSessionId,
              turn.sourceTurnId,
              turn.timestamp,
              turn.model,
              turn.provider,
              turn.project,
              turn.prompt,
              turn.response,
              turn.toolEventCount,
              turn.fingerprint
            ]
          );
          for (const metric of turn.metrics) {
            this.database.run(
              `INSERT OR REPLACE INTO token_metrics
                (turn_id, kind, value, quality, basis)
               VALUES (?, ?, ?, ?, ?)`,
              [turn.id, metric.kind, metric.value, metric.quality, metric.basis]
            );
          }
        }

        if (result.complete) {
          if (result.seenSessionIds.length === 0) {
            this.database.run("DELETE FROM sessions WHERE source = ?", [result.source]);
          } else {
            const placeholders = result.seenSessionIds.map(() => "?").join(", ");
            this.database.run(
              `DELETE FROM sessions WHERE source = ? AND source_session_id NOT IN (${placeholders})`,
              [result.source, ...result.seenSessionIds]
            );
          }
        }

        this.database.run(
          `INSERT OR REPLACE INTO source_health
            (source, complete, completed_at, session_count, turn_count, issues_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            result.source,
            result.complete ? 1 : 0,
            result.checkpoint.completedAt,
            result.sessions.length,
            result.turns.length,
            JSON.stringify(result.issues)
          ]
        );
        this.database.run("COMMIT");
      } catch (error) {
        this.database.run("ROLLBACK");
        throw error;
      }
    });
  }

  async getTurns(): Promise<NormalizedTurn[]> {
    await this.reload();
    return rows(
      this.database,
      `SELECT id, source, source_session_id, source_turn_id, timestamp, model, provider, project,
              prompt, response, tool_event_count, fingerprint
       FROM turns ORDER BY timestamp DESC, id`
    ).map((row) => ({
      id: String(row.id),
      source: row.source as Source,
      sourceSessionId: String(row.source_session_id),
      sourceTurnId: String(row.source_turn_id),
      timestamp: String(row.timestamp),
      model: row.model == null ? null : String(row.model),
      provider: row.provider == null ? null : String(row.provider),
      project: row.project == null ? null : String(row.project),
      prompt: String(row.prompt),
      response: String(row.response),
      toolEventCount: Number(row.tool_event_count),
      fingerprint: String(row.fingerprint),
      metrics: rows(
        this.database,
        `SELECT kind, value, quality, basis
         FROM token_metrics WHERE turn_id = ? ORDER BY kind`,
        [row.id]
      ).map(
        (metric): TokenMetric => ({
          kind: metric.kind as TokenKind,
          value: metric.value == null ? null : Number(metric.value),
          quality: metric.quality as MeasurementQuality,
          basis: String(metric.basis)
        })
      )
    }));
  }

  async getHealth(): Promise<SourceHealth[]> {
    await this.reload();
    return rows(
      this.database,
      `SELECT source, complete, completed_at, session_count, turn_count, issues_json
       FROM source_health ORDER BY source`
    ).map((row) => ({
      source: row.source as Source,
      complete: Number(row.complete) === 1,
      completedAt: String(row.completed_at),
      sessionCount: Number(row.session_count),
      turnCount: Number(row.turn_count),
      issues: JSON.parse(String(row.issues_json)) as ImportResult["issues"]
    }));
  }

  async clear(): Promise<void> {
    await this.withWriteLock(() => {
      this.database.run("DELETE FROM source_health");
      this.database.run("DELETE FROM sessions");
    });
  }
}

