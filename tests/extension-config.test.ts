import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("extension background-import defaults", () => {
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

  it("republishes budget changes without importing source history", async () => {
    const source = await readFile("src/extension.ts", "utf8");
    const branchStart = source.indexOf('message.type === "setBudgets"');
    const branchEnd = source.indexOf("provider = new DashboardWebviewProvider", branchStart);
    const budgetBranch = source.slice(branchStart, branchEnd);
    const listenerStart = source.indexOf("onDidChangeConfiguration");
    const listenerEnd = source.indexOf("),", listenerStart) + 2;
    const listener = source.slice(listenerStart, listenerEnd);

    expect(branchStart).toBeGreaterThan(-1);
    expect(budgetBranch).toContain("saveUsageBudgets");
    expect(budgetBranch).toContain("provider.budgetsSaved()");
    expect(budgetBranch).toContain("provider.setBudgetError(errorMessage)");
    expect(budgetBranch).not.toContain("coordinator.refresh");
    expect(listener).toContain("publishSnapshot()");
    expect(listener).not.toContain("refresh()");
  });
});
