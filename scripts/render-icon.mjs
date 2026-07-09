import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "media", "icon.svg");
const target = resolve(root, "media", "icon.png");
const browserPath =
  process.platform === "win32"
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    : undefined;
const svg = await readFile(source, "utf8");
const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true
});

try {
  const page = await browser.newPage({
    viewport: { width: 256, height: 256 },
    deviceScaleFactor: 2
  });
  await page.setContent(
    `<style>html,body{margin:0;width:256px;height:256px;overflow:hidden;background:transparent}svg{display:block;width:256px;height:256px}</style>${svg}`
  );
  await page.screenshot({
    path: target,
    omitBackground: true,
    clip: { x: 0, y: 0, width: 256, height: 256 }
  });
} finally {
  await browser.close();
}
