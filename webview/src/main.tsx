import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  DashboardSnapshot,
  ExtensionMessage,
  UsageGranularity,
  WebviewMessage
} from "../../src/shared/dashboard.js";
import { App } from "./App.js";
import "./styles.css";

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;

function Root() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usageGranularity, setUsageGranularity] = useState<UsageGranularity>("daily");

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
      }
    };
    window.addEventListener("message", receive);
    vscode?.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", receive);
  }, []);

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
      onUsageGranularityChange={setUsageGranularity}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
