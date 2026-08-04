import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("extension background-import defaults", () => {
  it("enables and wires Claude Code CLI history by default", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
      contributes: {
        configuration: {
          properties: Record<string, { type?: string; default: unknown }>;
        };
      };
    };
    const properties = manifest.contributes.configuration.properties;
    const source = await readFile("src/extension.ts", "utf8");

    expect(properties["tokenUsage.sources.claude.enabled"]).toMatchObject({
      type: "boolean",
      default: true
    });
    expect(properties["tokenUsage.paths.claude"]).toMatchObject({
      type: "string",
      default: ""
    });
    expect(source).toContain("new ClaudeAdapter(claudeRoot)");
    expect(source).toContain('"sources.claude.enabled"');
  });

  it("enables and wires Antigravity CLI history by default", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
      contributes: {
        configuration: {
          properties: Record<string, { type?: string; default: unknown; description?: string }>;
        };
      };
    };
    const properties = manifest.contributes.configuration.properties;
    const source = await readFile("src/extension.ts", "utf8");

    expect(properties["tokenUsage.sources.antigravityCli.enabled"]).toMatchObject({
      type: "boolean",
      default: true,
      description: "Import Antigravity CLI sessions."
    });
    expect(properties["tokenUsage.paths.antigravityCli"]).toMatchObject({
      type: "string",
      default: "",
      description: "Optional Antigravity CLI data-root override."
    });
    expect(source).toContain("new AntigravityCliAdapter(antigravityCliRoot, wasmPath)");
    expect(source).toContain('"sources.antigravityCli.enabled"');
  });

  it("keeps background imports opt-in with a battery-conscious interval", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
      contributes: {
        configuration: {
          properties: Record<string, { type?: string; default: unknown; minimum?: number }>;
        };
      };
    };
    const properties = manifest.contributes.configuration.properties;

    expect(properties["tokenUsage.backgroundRefresh.enabled"].default).toBe(false);
    expect(properties["tokenUsage.refreshIntervalMinutes"]).toMatchObject({
      default: 30,
      minimum: 5
    });
  });

  it("does not register recursive source-history filesystem watchers", async () => {
    const source = await readFile("src/extension.ts", "utf8");

    expect(source).not.toContain('from "node:fs"');
    expect(source).not.toContain("recursive: true");
  });

  it("contributes disabled-by-default token budget settings", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
      contributes: { configuration: { properties: Record<string, unknown> } };
    };
    const properties = manifest.contributes.configuration.properties;

    for (const key of ["daily", "weekly", "monthly"]) {
      expect(properties[`tokenUsage.budgets.${key}`]).toMatchObject({
        type: "number",
        default: 0,
        minimum: 0
      });
    }
  });

  it("wires budget saves and configuration changes through the publication coordinator", async () => {
    const source = await readFile("src/extension.ts", "utf8");
    const branchStart = source.indexOf('message.type === "setBudgets"');
    const branchEnd = source.indexOf("provider = new DashboardWebviewProvider", branchStart);
    const budgetBranch = source.slice(branchStart, branchEnd);
    const listenerStart = source.indexOf("onDidChangeConfiguration");
    const listenerEnd = source.indexOf("),", listenerStart) + 2;
    const listener = source.slice(listenerStart, listenerEnd);

    expect(branchStart).toBeGreaterThan(-1);
    expect(source).toContain("new DashboardPublicationCoordinator");
    expect(budgetBranch).toContain("publications.saveBudgets(message.budgets)");
    expect(budgetBranch).toContain('respond({ type: "budgetsSaved", requestId: message.requestId })');
    expect(budgetBranch).toContain('type: "budgetError", requestId: message.requestId, message: errorMessage');
    expect(budgetBranch).not.toContain("coordinator.refresh");
    expect(listener).toContain("publications.onBudgetConfigurationChanged()");
    expect(listener).not.toContain("refresh()");
  });
});
