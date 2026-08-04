import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import {
  AntigravityAdapter,
  parseLegacyAntigravitySteps
} from "../../src/adapters/antigravity-source.js";
import { ClaudeAdapter } from "../../src/adapters/claude-source.js";
import { CodexAdapter } from "../../src/adapters/codex-source.js";
import {
  OpenCodeAdapter,
  resolveOpenCodeBinary
} from "../../src/adapters/opencode-source.js";
import { resolveSourcePaths } from "../../src/adapters/paths.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "token-usage-test-"));
  temporaryRoots.push(root);
  return root;
}

async function writeOpenCodeDatabase(path: string): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: (file) => resolve("node_modules/sql.js/dist", file)
  });
  const database = new SQL.Database();
  database.run(
    "CREATE TABLE session (id TEXT, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER)"
  );
  database.run(
    "CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT)"
  );
  database.run("CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, data TEXT)");
  database.run(
    "INSERT INTO session VALUES (?, ?, ?, ?, ?)",
    ["ses_db_1", "/Users/dev/db-project", "Database session", 1000, 2000]
  );
  database.run(
    "INSERT INTO message VALUES (?, ?, ?, ?)",
    [
      "user-db",
      "ses_db_1",
      1000,
      JSON.stringify({
        role: "user",
        time: { created: 1000 },
        model: { providerID: "openai", modelID: "gpt-5" }
      })
    ]
  );
  database.run(
    "INSERT INTO message VALUES (?, ?, ?, ?)",
    [
      "assistant-db",
      "ses_db_1",
      1500,
      JSON.stringify({
        parentID: "user-db",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5",
        time: { created: 1500 },
        tokens: {
          input: 500,
          output: 100,
          reasoning: 20,
          cache: { read: 300, write: 0 }
        }
      })
    ]
  );
  database.run(
    "INSERT INTO part VALUES (?, ?, ?, ?)",
    ["part-user", "user-db", "ses_db_1", JSON.stringify({ type: "text", text: "Fix the query." })]
  );
  database.run(
    "INSERT INTO part VALUES (?, ?, ?, ?)",
    [
      "part-assistant",
      "assistant-db",
      "ses_db_1",
      JSON.stringify({ type: "text", text: "The query is fixed." })
    ]
  );
  await writeFile(path, database.export());
  database.close();
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resolveSourcePaths", () => {
  it("uses portable home-relative defaults for macOS and Windows", () => {
    const paths = resolveSourcePaths("/Users/dev");

    expect(paths.codex).toBe(join("/Users/dev", ".codex", "sessions"));
    expect(paths.claude).toBe(join("/Users/dev", ".claude", "projects"));
    expect(paths.opencode).toBe(join("/Users/dev", ".local", "share", "opencode"));
    expect(paths.antigravityCli).toBe(
      join("/Users/dev", ".gemini", "antigravity-cli")
    );
    expect(paths.antigravityCurrent).toBe(join("/Users/dev", ".gemini", "antigravity-ide"));
    expect(paths.antigravityLegacy).toBe(join("/Users/dev", ".gemini", "antigravity"));
  });

  it("honors CLAUDE_CONFIG_DIR for Claude Code projects", () => {
    const paths = resolveSourcePaths("/Users/dev", {
      CLAUDE_CONFIG_DIR: "/Volumes/private/claude"
    });

    expect(paths.claude).toBe(join("/Volumes/private/claude", "projects"));
  });
});

describe("source scanners", () => {
  it("scans Codex JSONL recursively", async () => {
    const root = await temporaryRoot();
    const nested = join(root, "2026", "07", "09");
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(nested, "rollout.jsonl"),
      await readFile(resolve("tests/fixtures/codex-session.jsonl"), "utf8")
    );

    const result = await new CodexAdapter(root).scan();

    expect(result.complete).toBe(true);
    expect(result.sessions).toHaveLength(1);
    expect(result.turns).toHaveLength(1);
  });

  it("scans Claude Code main and nested subagent transcripts without double counting", async () => {
    const root = await temporaryRoot();
    const project = join(root, "-Users-dev-project");
    const subagents = join(project, "subagents");
    await mkdir(subagents, { recursive: true });
    const main = await readFile(resolve("tests/fixtures/claude-session.jsonl"), "utf8");
    await writeFile(join(project, "main.jsonl"), main);
    await writeFile(join(project, "main-copy.jsonl"), main);
    await writeFile(
      join(subagents, "agent-researcher.jsonl"),
      await readFile(resolve("tests/fixtures/claude-subagent.jsonl"), "utf8")
    );

    const result = await new ClaudeAdapter(root).scan();

    expect(result.complete).toBe(true);
    expect(result.sessions).toHaveLength(2);
    expect(result.turns).toHaveLength(3);
    expect(result.turns.filter((turn) => turn.executionScope === "subagent")).toHaveLength(1);
    expect(
      result.turns
        .flatMap((turn) => turn.metrics)
        .filter((metric) => metric.kind === "total")
        .reduce((sum, metric) => sum + (metric.value ?? 0), 0)
    ).toBe(324);
  });

  it("reports malformed Claude JSONL without deleting successfully parsed usage", async () => {
    const root = await temporaryRoot();
    const project = join(root, "-Users-dev-project");
    await mkdir(project, { recursive: true });
    const fixture = await readFile(resolve("tests/fixtures/claude-session.jsonl"), "utf8");
    await writeFile(join(project, "main.jsonl"), `${fixture}\n{broken`);

    const result = await new ClaudeAdapter(root).scan();

    expect(result.complete).toBe(false);
    expect(result.turns).toHaveLength(2);
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: expect.stringContaining("1 malformed Claude Code JSONL line")
      })
    ]);
  });

  it("treats an empty Claude projects directory as a successful scan", async () => {
    const root = await temporaryRoot();
    const adapter = new ClaudeAdapter(root);

    await expect(adapter.detect()).resolves.toMatchObject({
      available: false,
      detail: "No persisted Claude Code CLI sessions found"
    });
    await expect(adapter.scan()).resolves.toMatchObject({
      source: "claude",
      complete: true,
      sessions: [],
      turns: [],
      issues: []
    });
  });

  it("falls back to OpenCode list and export commands without a shell", async () => {
    const exportJson = await readFile(resolve("tests/fixtures/opencode-export.json"), "utf8");
    const calls: string[][] = [];
    const execute = async (args: string[]): Promise<string> => {
      calls.push(args);
      return args[0] === "session"
        ? JSON.stringify([{ id: "ses_open_1" }])
        : exportJson;
    };

    const result = await new OpenCodeAdapter("/unused", execute).scan();

    expect(calls[0]).toEqual(["db", expect.stringMatching(/^VACUUM INTO '/u)]);
    expect(calls.slice(1)).toEqual([
      ["db", "SELECT id FROM session ORDER BY time_created", "--format", "json"],
      ["session", "list", "--format", "json"],
      ["export", "ses_open_1"]
    ]);
    expect(result.complete).toBe(true);
    expect(result.turns).toHaveLength(1);
  });

  it("discovers every OpenCode session through the WAL-safe database command", async () => {
    const exportJson = await readFile(resolve("tests/fixtures/opencode-export.json"), "utf8");
    const execute = async (args: string[]): Promise<string> => {
      if (args[0] === "db") {
        return JSON.stringify([{ id: "ses_open_1" }]);
      }
      if (args[0] === "export") {
        return exportJson;
      }
      return "[]";
    };

    const result = await new OpenCodeAdapter("/unused", execute).scan();

    expect(result.complete).toBe(true);
    expect(result.sessions.map((session) => session.sourceSessionId)).toEqual(["ses_open_1"]);
    expect(result.turns).toHaveLength(1);
  });

  it("resolves an OpenCode binary installed under NVM", async () => {
    const root = await temporaryRoot();
    const binary = join(root, ".nvm", "versions", "node", "v24.14.1", "bin", "opencode");
    await mkdir(dirname(binary), { recursive: true });
    await writeFile(binary, "test binary");

    await expect(resolveOpenCodeBinary(root, "darwin", {})).resolves.toBe(binary);
  });

  it("uses a consistent OpenCode snapshot when CLI exports are truncated", async () => {
    const execute = async (args: string[]): Promise<string> => {
      if (args[0] === "db" && args[1] === "SELECT id FROM session ORDER BY time_created") {
        return JSON.stringify([{ id: "ses_db_1" }]);
      }
      if (args[0] === "db" && args[1]?.startsWith("VACUUM INTO ")) {
        const quotedPath = args[1].match(/^VACUUM INTO '(.*)'$/u)?.[1];
        if (!quotedPath) {
          throw new Error("Missing snapshot path");
        }
        await writeOpenCodeDatabase(quotedPath.replaceAll("''", "'"));
        return "";
      }
      if (args[0] === "export") {
        return '{"info":{"id":"ses_db_1"';
      }
      throw new Error(`Unexpected OpenCode command: ${args.join(" ")}`);
    };

    const result = await new OpenCodeAdapter(
      "/unused",
      execute,
      resolve("node_modules/sql.js/dist/sql-wasm.wasm")
    ).scan();

    expect(result.complete).toBe(true);
    expect(result.sessions.map((session) => session.sourceSessionId)).toEqual(["ses_db_1"]);
    expect(result.sessions[0].sourcePath).toBe(join("/unused", "opencode.db"));
    expect(result.turns).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });

  it("falls back to a consistent OpenCode database when the CLI is unavailable", async () => {
    const root = await temporaryRoot();
    await writeOpenCodeDatabase(join(root, "opencode.db"));

    const result = await new OpenCodeAdapter(root, async () => {
      throw new Error("CLI unavailable");
    }).scan();

    expect(result.complete).toBe(true);
    expect(result.sessions[0].sourceSessionId).toBe("ses_db_1");
    expect(result.turns[0]).toMatchObject({
      prompt: "Fix the query.",
      response: "The query is fixed."
    });
  });

  it("scans current Antigravity transcripts and reports unavailable legacy sessions", async () => {
    const currentRoot = await temporaryRoot();
    const legacyRoot = await temporaryRoot();
    const transcriptDir = join(
      currentRoot,
      "brain",
      "ag-session-1",
      ".system_generated",
      "logs"
    );
    await mkdir(transcriptDir, { recursive: true });
    await writeFile(
      join(transcriptDir, "transcript.jsonl"),
      await readFile(resolve("tests/fixtures/antigravity-transcript.jsonl"), "utf8")
    );
    await mkdir(join(legacyRoot, "conversations"), { recursive: true });
    await writeFile(join(legacyRoot, "conversations", "legacy-session.pb"), "encrypted");

    const result = await new AntigravityAdapter(currentRoot, legacyRoot, null).scan();

    expect(result.sessions).toHaveLength(1);
    expect(result.turns).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(result.issues[0].message).toContain("legacy-session");
  });
});

describe("parseLegacyAntigravitySteps", () => {
  it("maps localhost trajectory steps into visible turns", () => {
    const result = parseLegacyAntigravitySteps(
      [
        {
          type: "CORTEX_STEP_TYPE_USER_INPUT",
          metadata: { createdAt: "2026-07-09T03:00:00Z" },
          userInput: { userResponse: "Review this migration." }
        },
        {
          type: "CORTEX_STEP_TYPE_VIEW_FILE",
          metadata: { createdAt: "2026-07-09T03:00:01Z" },
          viewFile: { absoluteUri: "migration.sql" }
        },
        {
          type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
          metadata: { createdAt: "2026-07-09T03:00:02Z", generatorModel: "gemini-3-pro" },
          plannerResponse: { modifiedResponse: "The migration needs a concurrent index." }
        }
      ],
      "legacy-session",
      "legacy-session.pb"
    );

    expect(result.turns[0]).toMatchObject({
      prompt: "Review this migration.",
      response: "The migration needs a concurrent index.",
      model: "gemini-3-pro",
      toolEventCount: 1
    });
  });
});
