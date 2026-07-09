import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const webviewRoot = resolve(root, "dist", "webview");
const screenshotPath = resolve(
  root,
  "docs",
  "design",
  "token-usage-dashboard-implementation.png"
);
const mobileScreenshotPath = resolve(
  root,
  "docs",
  "design",
  "token-usage-dashboard-mobile.png"
);
const browserPath =
  process.platform === "win32"
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    : undefined;

const mimeTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm"
};

const server = createServer(async (request, response) => {
  try {
    const requestPath = request.url === "/" ? "/index.html" : request.url;
    const path = resolve(webviewRoot, `.${requestPath}`);
    const content = await readFile(path);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(path)] ?? "application/octet-stream"
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;

const sources = ["codex", "opencode", "antigravity"];
const models = ["gpt-5", "claude-sonnet-4", "gemini-3-pro"];
const prompts = [
  "Refactor auth middleware to support API key auth",
  "Add rate limiting to the upload endpoint",
  "Explain why the CI workflow is failing",
  "Implement soft delete for user accounts",
  "Optimize file watcher CPU usage",
  "Improve deployment documentation",
  "Write the database migration"
];

const turns = prompts.map((prompt, index) => {
  const source = sources[index % sources.length];
  const exact = source !== "antigravity";
  const request = 3_812 + index * 173;
  const output = 873 + index * 91;
  return {
    id: `${source}:session-${index}:turn`,
    source,
    sourceSessionId: `session-${index}`,
    sourceTurnId: `turn-${index}`,
    timestamp: new Date(2026, 6, 9, 11 - Math.floor(index / 2), 23 - index * 2, 41).toISOString(),
    model: models[index % models.length],
    provider: source === "opencode" ? "anthropic" : source === "codex" ? "openai" : "google",
    project: index % 2 ? "/Users/dev/atlas-web" : "/Users/dev/infra-tools",
    prompt,
    response:
      "Implemented the requested change with focused validation, backwards-compatible behavior, and regression tests. The visible response stays local to this machine.",
    toolEventCount: index + 1,
    fingerprint: `fixture-${index}`,
    metrics: [
      { kind: "typed_input", value: 140 + index * 19, quality: "estimated", basis: "offline estimate" },
      { kind: "request_input", value: request, quality: exact ? "exact" : "partial", basis: exact ? "source usage" : "visible context lower bound" },
      { kind: "cached_input", value: exact ? 8_732 + index * 240 : null, quality: exact ? "exact" : "unavailable", basis: "source cache" },
      { kind: "output", value: output, quality: exact ? "exact" : "estimated", basis: "visible output" },
      { kind: "reasoning_output", value: index * 32, quality: exact ? "exact" : "partial", basis: "exposed reasoning" },
      { kind: "total", value: request + output, quality: exact ? "exact" : "partial", basis: "request + output" }
    ]
  };
});

const snapshot = {
  generatedAt: new Date(2026, 6, 9, 11, 24, 30).toISOString(),
  summaries: {
    today: { total: 1_842_357, exact: 1_302_891, estimated: 339_466, partial: 200_000 },
    sevenDays: { total: 12_842_196, exact: 9_275_104, estimated: 2_567_092, partial: 1_000_000 },
    allTime: { total: 98_421_583, exact: 71_232_991, estimated: 22_188_592, partial: 5_000_000 }
  },
  trend: Array.from({ length: 14 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    codex: 650_000 + (index % 5) * 70_000,
    opencode: 420_000 + (index % 4) * 80_000,
    antigravity: 250_000 + (index % 3) * 60_000,
    partialSources: ["antigravity"]
  })),
  turns,
  health: [
    { source: "codex", complete: true, completedAt: new Date().toISOString(), sessionCount: 12, turnCount: 64, issues: [] },
    { source: "opencode", complete: true, completedAt: new Date().toISOString(), sessionCount: 9, turnCount: 48, issues: [] },
    {
      source: "antigravity",
      complete: false,
      completedAt: new Date().toISOString(),
      sessionCount: 6,
      turnCount: 29,
      issues: [{ sourcePath: "legacy.pb", severity: "warning", message: "Legacy language server unavailable" }]
    }
  ]
};

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true
});

try {
  const page = await browser.newPage({ viewport: { width: 1586, height: 992 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.evaluate((data) => {
    window.postMessage({ type: "snapshot", snapshot: data }, "*");
  }, snapshot);
  await page.getByRole("heading", { name: "Token Usage" }).waitFor();

  await page.getByPlaceholder("Search prompts").fill("rate limiting");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  await page.getByPlaceholder("Search prompts").fill("");
  await page.getByLabel("Source", { exact: true }).selectOption("opencode");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 2);
  await page.getByLabel("Source", { exact: true }).selectOption("all");
  await page.getByText("Add rate limiting to the upload endpoint", { exact: true }).first().click();
  await page.getByRole("complementary", { name: "Turn details" }).getByText(
    "Add rate limiting to the upload endpoint",
    { exact: true }
  ).waitFor();
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: mobileScreenshotPath, fullPage: true });
  console.log(`Visual QA passed: ${screenshotPath}`);
  console.log(`Mobile QA captured: ${mobileScreenshotPath}`);
} finally {
  await browser.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
