import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { LocalAntigravityBridge } from "./adapters/antigravity-bridge.js";
import { AntigravityAdapter } from "./adapters/antigravity-source.js";
import { CodexAdapter } from "./adapters/codex-source.js";
import { OpenCodeAdapter } from "./adapters/opencode-source.js";
import { resolveSourcePaths } from "./adapters/paths.js";
import type { SourceAdapter } from "./domain/types.js";
import { buildDashboardSnapshot } from "./services/dashboard.js";
import {
  ImportCoordinator,
  type PromptRetention
} from "./services/import-coordinator.js";
import { startRefreshScheduler } from "./services/refresh-scheduler.js";
import { TrackerStore } from "./storage/tracker-store.js";
import {
  DashboardWebviewProvider,
  type WebviewAction
} from "./webview/provider.js";

function configuredPath(
  configuration: vscode.WorkspaceConfiguration,
  key: string,
  fallback: string
): string {
  const value = configuration.get<string>(key, "").trim();
  return value || fallback;
}

function formatStatusTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(value);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("tokenUsage");
  const defaults = resolveSourcePaths(homedir());
  const codexRoot = configuredPath(configuration, "paths.codex", defaults.codex);
  const openCodeRoot = configuredPath(configuration, "paths.opencode", defaults.opencode);
  const antigravityRoot = configuredPath(
    configuration,
    "paths.antigravity",
    defaults.antigravityCurrent
  );
  const storagePath = configuredPath(
    configuration,
    "storagePath",
    join(homedir(), ".token-usage-tracker", "usage.sqlite")
  );
  const wasmPath = context.asAbsolutePath(join("dist", "sql-wasm.wasm"));
  const store = await TrackerStore.open({ databasePath: storagePath, wasmPath });
  const adapters: SourceAdapter[] = [];

  if (configuration.get<boolean>("sources.codex.enabled", true)) {
    adapters.push(new CodexAdapter(codexRoot));
  }
  if (configuration.get<boolean>("sources.opencode.enabled", true)) {
    adapters.push(new OpenCodeAdapter(openCodeRoot, undefined, wasmPath));
  }
  if (configuration.get<boolean>("sources.antigravity.enabled", true)) {
    adapters.push(
      new AntigravityAdapter(
        antigravityRoot,
        defaults.antigravityLegacy,
        new LocalAntigravityBridge()
      )
    );
  }

  const coordinator = new ImportCoordinator(adapters, store);
  const output = vscode.window.createOutputChannel("Token Usage Tracker");
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  status.command = "tokenUsage.openDashboard";
  status.name = "Token Usage";
  status.text = "$(pulse) Tokens —";
  status.tooltip = "Open Token Usage dashboard";
  status.show();

  let refreshPromise: Promise<void> | null = null;
  let provider: DashboardWebviewProvider;

  const publishSnapshot = async (): Promise<void> => {
    const snapshot = buildDashboardSnapshot(
      await store.getTurns(),
      await store.getHealth()
    );
    provider.update(snapshot);
    const prefix =
      snapshot.summaries.today.partial > 0
        ? "≥"
        : snapshot.summaries.today.estimated > 0
          ? "≈"
          : "";
    status.text = `$(pulse) Tokens ${prefix}${formatStatusTokens(snapshot.summaries.today.total)}`;
    status.tooltip = `${snapshot.summaries.today.total.toLocaleString()} tracked tokens today`;
  };

  const refresh = (): Promise<void> => {
    if (refreshPromise) {
      return refreshPromise;
    }
    refreshPromise = (async () => {
      provider.setLoading();
      try {
        const retention = configuration.get<PromptRetention>("promptRetention", "full");
        const results = await coordinator.refresh(retention);
        output.appendLine(`[${new Date().toISOString()}] Import completed`);
        for (const result of results) {
          output.appendLine(
            `${result.source}: ${result.sessions.length} sessions, ${result.turns.length} turns, ` +
              `${result.issues.length} issues, complete=${result.complete}`
          );
          for (const issue of result.issues) {
            output.appendLine(`  ${issue.severity}: ${issue.sourcePath}: ${issue.message}`);
          }
        }
        await publishSnapshot();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`[${new Date().toISOString()}] Import failed: ${message}`);
        provider.setError(message);
        status.text = "$(error) Tokens";
        status.tooltip = message;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  };

  const handleWebviewAction = async (action: WebviewAction): Promise<void> => {
    if (action === "ready") {
      await publishSnapshot();
    } else if (action === "refresh") {
      await refresh();
    } else if (action === "rebuild") {
      await store.clear();
      await refresh();
    } else if (action === "deleteAll") {
      await store.clear();
      await publishSnapshot();
    }
  };

  provider = new DashboardWebviewProvider(context.extensionUri, handleWebviewAction);
  context.subscriptions.push(
    output,
    status,
    vscode.window.registerWebviewViewProvider(
      DashboardWebviewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.commands.registerCommand("tokenUsage.openDashboard", async () => {
      provider.openPanel();
      await publishSnapshot();
    }),
    vscode.commands.registerCommand("tokenUsage.refresh", refresh),
    vscode.commands.registerCommand("tokenUsage.rebuildIndex", async () => {
      const answer = await vscode.window.showWarningMessage(
        "Rebuild the local Token Usage index from source history?",
        { modal: true },
        "Rebuild"
      );
      if (answer === "Rebuild") {
        await store.clear();
        await refresh();
      }
    }),
    vscode.commands.registerCommand("tokenUsage.showDiagnostics", async () => {
      const health = await store.getHealth();
      output.appendLine(`[${new Date().toISOString()}] Current import health`);
      for (const source of health) {
        output.appendLine(
          `${source.source}: complete=${source.complete}, sessions=${source.sessionCount}, ` +
            `turns=${source.turnCount}, issues=${source.issues.length}`
        );
      }
      output.show(true);
    }),
    vscode.commands.registerCommand("tokenUsage.deleteAllData", async () => {
      const answer = await vscode.window.showWarningMessage(
        "Permanently delete the Token Usage Tracker database? Source-tool history is not changed.",
        { modal: true },
        "Delete Tracker Data"
      );
      if (answer === "Delete Tracker Data") {
        await store.clear();
        await publishSnapshot();
        void vscode.window.showInformationMessage("Token Usage Tracker data deleted.");
      }
    })
  );

  const backgroundRefreshEnabled = configuration.get<boolean>(
    "backgroundRefresh.enabled",
    false
  );
  const refreshScheduler = startRefreshScheduler(
    () => void refresh(),
    {
      enabled: backgroundRefreshEnabled,
      intervalMinutes: configuration.get<number>("refreshIntervalMinutes", 30)
    }
  );
  context.subscriptions.push(refreshScheduler);

  if (backgroundRefreshEnabled) {
    void refresh();
  } else {
    output.appendLine(
      "Background imports are disabled to conserve battery. Use Refresh Now to import source history."
    );
  }
}

export function deactivate(): void {
  // VS Code disposes all registered resources through the extension context.
}
