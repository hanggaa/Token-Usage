import { rm, mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await esbuild({
  entryPoints: [resolve(root, "src/extension.ts")],
  outfile: resolve(dist, "extension.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: false
});

await viteBuild({ configFile: resolve(root, "vite.config.ts") });
await copyFile(
  resolve(root, "node_modules/sql.js/dist/sql-wasm.wasm"),
  resolve(dist, "sql-wasm.wasm")
);
