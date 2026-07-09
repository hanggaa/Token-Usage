import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("extension background-import defaults", () => {
  it("keeps background imports opt-in with a battery-conscious interval", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
      contributes: {
        configuration: {
          properties: Record<string, { default: unknown; minimum?: number }>;
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
});
