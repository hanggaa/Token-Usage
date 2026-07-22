import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type {
  DashboardSnapshot,
  BudgetResponse,
  ExtensionMessage,
  WebviewMessage
} from "../shared/dashboard.js";
import { renderWebviewHtml } from "./html.js";
import { createWebviewMessageReceiver } from "./messages.js";

export class DashboardWebviewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "tokenUsage.dashboard";

  private readonly webviews = new Set<vscode.Webview>();
  private panel: vscode.WebviewPanel | null = null;
  private latestSnapshot: DashboardSnapshot | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onAction: (
      message: WebviewMessage,
      respond: (message: BudgetResponse) => Promise<void>
    ) => void | Promise<void>
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.configure(view.webview);
    this.webviews.add(view.webview);
    view.onDidDispose(() => this.webviews.delete(view.webview));
    if (this.latestSnapshot) {
      void this.post(view.webview, {
        type: "snapshot",
        snapshot: this.latestSnapshot
      });
    }
  }

  openPanel(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "tokenUsage.dashboardPanel",
      "Token Usage",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")]
      }
    );
    this.configure(this.panel.webview);
    this.webviews.add(this.panel.webview);
    this.panel.onDidDispose(() => {
      if (this.panel) {
        this.webviews.delete(this.panel.webview);
      }
      this.panel = null;
    });
    if (this.latestSnapshot) {
      void this.post(this.panel.webview, {
        type: "snapshot",
        snapshot: this.latestSnapshot
      });
    }
  }

  async update(snapshot: DashboardSnapshot): Promise<void> {
    this.latestSnapshot = snapshot;
    await this.broadcast({ type: "snapshot", snapshot });
  }

  setLoading(): void {
    void this.broadcast({ type: "loading" });
  }

  async setError(message: string): Promise<void> {
    await this.broadcast({ type: "error", message });
  }

  private configure(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")]
    };
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "assets", "index.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "assets", "index.css")
    );
    webview.html = renderWebviewHtml({
      cspSource: webview.cspSource,
      scriptUri: scriptUri.toString(),
      styleUri: styleUri.toString(),
      nonce: randomBytes(18).toString("base64url")
    });
    const respond = async (message: BudgetResponse) => this.post(webview, message);
    const receive = createWebviewMessageReceiver(this.onAction, respond);
    webview.onDidReceiveMessage((value: unknown) => {
      void receive(value);
    });
  }

  private async broadcast(message: ExtensionMessage): Promise<void> {
    await Promise.all([...this.webviews].map((webview) => this.post(webview, message)));
  }

  private async post(webview: vscode.Webview, message: ExtensionMessage): Promise<void> {
    await webview.postMessage(message);
  }
}
