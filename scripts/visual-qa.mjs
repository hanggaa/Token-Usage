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

const sources = ["codex", "claude", "opencode", "antigravity"];
const models = ["gpt-5", "claude-sonnet-4", "gpt-5", "gemini-3-pro"];
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
    executionScope: source === "claude" && index === 5 ? "subagent" : "main",
    timestamp: new Date(2026, 6, 9, 11 - Math.floor(index / 2), 23 - index * 2, 41).toISOString(),
    model: models[index % models.length],
    provider: source === "claude" ? "anthropic" : source === "antigravity" ? "google" : "openai",
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

function makeInsights(startDate, endDate, total) {
  const tokens = [Math.round(total * 0.55), Math.round(total * 0.3)];
  tokens.push(total - tokens[0] - tokens[1]);
  const ranked = (labels, paths = []) => labels.map((label, index) => ({
    key: label.toLowerCase(),
    label,
    ...(paths[index] ? { fullLabel: paths[index] } : {}),
    tokens: tokens[index],
    share: tokens[index] / total,
    partial: index === 1
  }));
  return {
    startDate,
    endDate,
    total,
    partial: true,
    contributors: {
      sources: ranked(["Codex", "OpenCode", "Antigravity"]),
      projects: ranked(
        ["token-usage", "notes", "Unknown"],
        ["/Users/demo/work/token-usage", "/Users/demo/work/notes", undefined]
      ),
      models: ranked(["gpt-5", "claude-sonnet", "gemini-pro"])
    },
    heavyTurns: [
      {
        turnId: "heavy-1",
        prompt: "Refactor import health detection",
        source: "opencode",
        model: "claude-sonnet",
        project: "/Users/demo/work/token-usage",
        total: 230_000,
        quality: "exact",
        baselineMedian: 100_000,
        multiplier: 2.3,
        baselineScope: "source-model"
      },
      {
        turnId: "heavy-2",
        prompt: "Generate release verification",
        source: "codex",
        model: "gpt-5",
        project: "/Users/demo/work/token-usage",
        total: 180_000,
        quality: "estimated",
        baselineMedian: 100_000,
        multiplier: 1.8,
        baselineScope: "source"
      }
    ],
    hasComparableHistory: true
  };
}

function makeComparison(
  currentStartDate,
  currentThrough,
  previousStartDate,
  previousThrough,
  currentTokens,
  previousTokens
) {
  const delta = currentTokens - previousTokens;
  const usage = (tokens, quality = "exact") => ({ tokens, quality });
  const mover = (key, label, previous, current, quality = "exact", fullLabel) => {
    const itemDelta = current - previous;
    return {
      key,
      label,
      ...(fullLabel ? { fullLabel } : {}),
      current: usage(current, quality),
      previous: usage(previous),
      delta: itemDelta,
      deltaPercent: previous > 0 ? (itemDelta / previous) * 100 : null,
      quality,
      kind:
        previous === 0
          ? "new"
          : current === 0
            ? "stopped"
            : itemDelta > 0
              ? "increase"
              : "decrease"
    };
  };
  return {
    currentStartDate,
    currentThrough,
    previousStartDate,
    previousThrough,
    current: usage(currentTokens, "estimated"),
    previous: usage(previousTokens),
    delta,
    deltaPercent: previousTokens > 0 ? (delta / previousTokens) * 100 : null,
    quality: "estimated",
    kind: delta > 0 ? "increase" : delta < 0 ? "decrease" : "unchanged",
    movers: {
      sources: {
        increases: [
          mover("codex", "Codex", 3_100_000, 4_050_000, "estimated"),
          mover("claude", "Claude Code", 2_650_000, 3_100_000)
        ],
        decreases: [mover("opencode", "OpenCode", 2_150_000, 1_500_000)],
        omittedCount: 1
      },
      projects: {
        increases: [
          mover(
            "/Users/demo/work/token-usage",
            "token-usage",
            2_400_000,
            3_500_000,
            "estimated",
            "/Users/demo/work/token-usage"
          )
        ],
        decreases: [mover("/Users/demo/work/notes", "notes", 1_700_000, 1_200_000)],
        omittedCount: 1
      },
      models: {
        increases: [mover("gpt-5", "gpt-5", 2_900_000, 3_800_000, "estimated")],
        decreases: [mover("claude-sonnet", "claude-sonnet", 2_200_000, 1_750_000)],
        omittedCount: 1
      }
    }
  };
}

const snapshot = {
  generatedAt: new Date(2026, 6, 9, 11, 24, 30).toISOString(),
  summaries: {
    today: { total: 1_842_357, exact: 1_302_891, estimated: 339_466, partial: 200_000 },
    sevenDays: { total: 12_842_196, exact: 9_275_104, estimated: 2_567_092, partial: 1_000_000 },
    allTime: { total: 98_421_583, exact: 71_232_991, estimated: 22_188_592, partial: 5_000_000 }
  },
  trends: {
    daily: Array.from({ length: 14 }, (_, index) => {
      const day = String(index + 26).padStart(2, "0");
      const date = index < 5 ? `2026-06-${day}` : `2026-07-${String(index - 4).padStart(2, "0")}`;
      return {
        startDate: date,
        endDate: date,
        inProgress: index === 13,
        codex: 650_000 + (index % 5) * 70_000,
        claude: 510_000 + (index % 4) * 65_000,
        opencode: 420_000 + (index % 4) * 80_000,
        antigravity: 250_000 + (index % 3) * 60_000,
        partialSources: ["antigravity"]
      };
    }),
    weekly: Array.from({ length: 12 }, (_, index) => {
      const start = new Date(2026, 3, 20 + index * 7);
      const end = new Date(2026, 3, 26 + index * 7);
      const formatDate = (date) =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      return {
        startDate: formatDate(start),
        endDate: formatDate(end),
        inProgress: index === 11,
        codex: 3_750_000 + (index % 5) * 420_000,
        claude: 3_100_000 + (index % 4) * 390_000,
        opencode: 2_450_000 + (index % 4) * 480_000,
        antigravity: 1_500_000 + (index % 3) * 360_000,
        partialSources: ["antigravity"]
      };
    }),
    monthly: Array.from({ length: 12 }, (_, index) => {
      const start = new Date(2025, 7 + index, 1);
      const end = new Date(2025, 8 + index, 0);
      const formatDate = (date) =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      return {
        startDate: formatDate(start),
        endDate: formatDate(end),
        inProgress: index === 11,
        codex: 15_600_000 + (index % 5) * 1_700_000,
        claude: 12_400_000 + (index % 4) * 1_520_000,
        opencode: 10_080_000 + (index % 4) * 1_920_000,
        antigravity: 6_000_000 + (index % 3) * 1_440_000,
        partialSources: ["antigravity"]
      };
    })
  },
  turns,
  budgets: { daily: 2_000_000, weekly: 10_000_000, monthly: 40_000_000 },
  forecasts: {
    daily: {
      projectedTotal: 3_878_646,
      projectedBudgetPercent: 193.93,
      remainingBudget: 157_643,
      recommendedAllowance: 12_948,
      allowanceUnit: "hour",
      confidence: "medium",
      quality: "partial",
      status: "likely_to_exceed",
      elapsedRatio: 0.475
    },
    weekly: {
      projectedTotal: 17_300_000,
      projectedBudgetPercent: 173,
      remainingBudget: 1_350_000,
      recommendedAllowance: 385_714,
      allowanceUnit: "day",
      confidence: "medium",
      quality: "partial",
      status: "likely_to_exceed",
      elapsedRatio: 0.5
    },
    monthly: {
      projectedTotal: 116_058_394,
      projectedBudgetPercent: 290.15,
      remainingBudget: 8_200_000,
      recommendedAllowance: 372_727,
      allowanceUnit: "day",
      confidence: "medium",
      quality: "estimated",
      status: "likely_to_exceed",
      elapsedRatio: 0.274
    }
  },
  insights: {
    daily: makeInsights("2026-07-09", "2026-07-09", 1_842_357),
    weekly: makeInsights("2026-07-06", "2026-07-12", 8_650_000),
    monthly: makeInsights("2026-07-01", "2026-07-31", 31_800_000)
  },
  comparisons: {
    daily: makeComparison(
      "2026-07-09",
      new Date(2026, 6, 9, 11, 24, 30).toISOString(),
      "2026-07-08",
      new Date(2026, 6, 8, 11, 24, 30).toISOString(),
      1_842_357,
      1_495_200
    ),
    weekly: makeComparison(
      "2026-07-06",
      new Date(2026, 6, 9, 11, 24, 30).toISOString(),
      "2026-06-29",
      new Date(2026, 6, 2, 11, 24, 30).toISOString(),
      8_650_000,
      7_900_000
    ),
    monthly: makeComparison(
      "2026-07-01",
      new Date(2026, 6, 9, 11, 24, 30).toISOString(),
      "2026-06-01",
      new Date(2026, 5, 9, 11, 24, 30).toISOString(),
      31_800_000,
      28_950_000
    )
  },
  health: [
    { source: "codex", complete: true, completedAt: new Date().toISOString(), sessionCount: 12, turnCount: 64, issues: [] },
    {
      source: "claude",
      complete: false,
      completedAt: new Date().toISOString(),
      sessionCount: 60,
      turnCount: 520,
      issues: [{
        sourcePath: "C:\\Users\\demo\\.claude\\projects\\session.jsonl",
        severity: "warning",
        message: "1 malformed Claude Code JSONL line was ignored"
      }]
    },
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
  await page.getByText("Improve deployment documentation", { exact: true }).first().click();
  await page.getByRole("complementary", { name: "Turn details" }).getByText(
    "Improve deployment documentation",
    { exact: true }
  ).waitFor();
  await page.getByRole("complementary", { name: "Turn details" }).getByText(
    "Subagent",
    { exact: true }
  ).first().waitFor();
  await page.getByText("Weekly", { exact: true }).click();
  await page.getByRole("radio", { name: "Weekly" }).check();
  await page.getByRole("img", { name: "Weekly token usage by source" }).waitFor();
  await page.getByRole("heading", { name: "Usage Guardrails" }).waitFor();
  await page.getByText("Projected total", { exact: true }).waitFor();
  await page.getByText("Likely to exceed", { exact: true }).waitFor();
  await page.getByText("Confidence", { exact: true }).waitFor();
  await page.getByText("Medium", { exact: true }).waitFor();
  await page.getByText("Approaching limit", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Period Comparison" }).waitFor();
  await page.getByText("Top increases", { exact: true }).waitFor();
  await page.getByText("Top decreases", { exact: true }).waitFor();
  await page.getByText("Healthy · 1 warning", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Edit budgets" }).click();
  const budgetEditor = page.locator(".budget-editor");
  await budgetEditor.getByLabel("Daily", { exact: true }).waitFor();
  await budgetEditor.getByLabel("Weekly", { exact: true }).waitFor();
  await budgetEditor.getByLabel("Monthly", { exact: true }).waitFor();
  await budgetEditor.getByRole("button", { name: "Cancel" }).click();
  await budgetEditor.waitFor({ state: "hidden" });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: mobileScreenshotPath, fullPage: true });
  console.log(`Visual QA passed: ${screenshotPath}`);
  console.log(`Mobile QA captured: ${mobileScreenshotPath}`);
} finally {
  await browser.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
