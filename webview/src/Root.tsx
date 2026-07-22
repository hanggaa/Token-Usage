import { useEffect, useState } from "react";
import type {
  DashboardSnapshot,
  ExtensionMessage,
  UsageBudgets,
  UsageGranularity,
  WebviewMessage
} from "../../src/shared/dashboard.js";
import { App } from "./App.js";
import type { BudgetSaveState } from "./UsageGuardrails.js";
import { readUsageGranularity, writeUsageGranularity } from "./usage-state.js";

export interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: { usageGranularity: UsageGranularity }): void;
}

export function Root({ vscode }: { vscode: VsCodeApi | null }) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [budgetSaveState, setBudgetSaveState] = useState<BudgetSaveState>("idle");
  const [budgetSaveError, setBudgetSaveError] = useState<string | null>(null);
  const [usageGranularity, setUsageGranularity] = useState<UsageGranularity>(() =>
    readUsageGranularity(vscode?.getState())
  );

  useEffect(() => {
    const receive = (event: MessageEvent<ExtensionMessage>) => {
      if (event.data.type === "snapshot" && event.data.snapshot) {
        setSnapshot(event.data.snapshot);
        setLoading(false);
        setError(null);
      } else if (event.data.type === "loading") {
        setLoading(true);
      } else if (event.data.type === "error") {
        setLoading(false);
        setError(event.data.message ?? "Unable to load token usage.");
      } else if (event.data.type === "budgetsSaved") {
        setBudgetSaveState("saved");
        setBudgetSaveError(null);
      } else if (event.data.type === "budgetError") {
        setBudgetSaveState("error");
        setBudgetSaveError(event.data.message);
      }
    };
    window.addEventListener("message", receive);
    vscode?.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", receive);
  }, []);

  const changeUsageGranularity = (next: UsageGranularity) => {
    setUsageGranularity(next);
    if (vscode) {
      writeUsageGranularity(vscode, next);
    }
  };

  const saveBudgets = (budgets: UsageBudgets) => {
    setBudgetSaveState("saving");
    setBudgetSaveError(null);
    vscode?.postMessage({ type: "setBudgets", budgets });
  };

  const settleBudgetSave = () => setBudgetSaveState("idle");

  if (error) {
    return (
      <main className="center-state">
        <h1>Token Usage</h1>
        <p>{error}</p>
        <button type="button" onClick={() => vscode?.postMessage({ type: "refresh" })}>
          Try again
        </button>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="center-state">
        <div className="loading-ring" />
        <p>{loading ? "Importing local usage history…" : "No usage data available."}</p>
      </main>
    );
  }

  return (
    <App
      snapshot={snapshot}
      loading={loading}
      onRefresh={() => vscode?.postMessage({ type: "refresh" })}
      usageGranularity={usageGranularity}
      onUsageGranularityChange={changeUsageGranularity}
      budgetSaveState={budgetSaveState}
      budgetSaveError={budgetSaveError}
      onSaveBudgets={saveBudgets}
      onBudgetSaveSettled={settleBudgetSave}
    />
  );
}
