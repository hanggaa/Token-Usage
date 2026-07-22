import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { VsCodeApi } from "./Root.js";
import { Root } from "./Root.js";
import "./styles.css";

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root vscode={vscode} />
  </StrictMode>
);
