import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalAntigravityBridge } from "../src/adapters/antigravity-bridge.js";
import { AntigravityAdapter } from "../src/adapters/antigravity-source.js";
import { CodexAdapter } from "../src/adapters/codex-source.js";
import { OpenCodeAdapter } from "../src/adapters/opencode-source.js";
import { resolveSourcePaths } from "../src/adapters/paths.js";
import { ImportCoordinator } from "../src/services/import-coordinator.js";
import { TrackerStore } from "../src/storage/tracker-store.js";

const root = await mkdtemp(join(tmpdir(), "token-usage-local-smoke-"));
const paths = resolveSourcePaths(homedir());

try {
  const store = await TrackerStore.open({
    databasePath: join(root, "usage.sqlite"),
    wasmPath: resolve("node_modules/sql.js/dist/sql-wasm.wasm")
  });
  const coordinator = new ImportCoordinator(
    [
      new CodexAdapter(paths.codex),
      new OpenCodeAdapter(paths.opencode),
      new AntigravityAdapter(
        paths.antigravityCurrent,
        paths.antigravityLegacy,
        new LocalAntigravityBridge()
      )
    ],
    store
  );
  const results = await coordinator.refresh("full");
  const turns = await store.getTurns();
  const antigravityTurns = turns.filter((turn) => turn.source === "antigravity");
  const newestAntigravityTurn = antigravityTurns.toSorted((left, right) =>
    right.timestamp.localeCompare(left.timestamp)
  )[0];
  console.log(
    JSON.stringify(
      {
        sources: results.map((result) => ({
          source: result.source,
          complete: result.complete,
          sessions: result.sessions.length,
          turns: result.turns.length,
          issues: result.issues.length
        })),
        indexedTurns: turns.length,
        antigravitySanitization: {
          wrappedPrompts: antigravityTurns.filter((turn) =>
            /<(?:USER_REQUEST|ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>/i.test(turn.prompt)
          ).length,
          turnsWithModel: antigravityTurns.filter((turn) => Boolean(turn.model)).length,
          partialTotals: antigravityTurns.filter((turn) =>
            turn.metrics.some(
              (metric) => metric.kind === "total" && metric.quality === "partial"
            )
          ).length,
          newestMetrics: Object.fromEntries(
            (newestAntigravityTurn?.metrics ?? []).map((metric) => [
              metric.kind,
              { value: metric.value, quality: metric.quality }
            ])
          )
        }
      },
      null,
      2
    )
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
