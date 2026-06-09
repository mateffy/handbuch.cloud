/**
 * build-assets.ts – Bundle the WASM SQLite search app and copy its runtime assets.
 *
 * Steps:
 *   1. `Bun.build` the search app entry point into docs/dist/
 *   2. Copy sqlite.worker.js and sql-wasm.wasm from sql.js-httpvfs into docs/dist/
 *
 * Usage:
 *   bun run scripts/build-assets.ts
 */

import { copyFileSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(scriptDir, "..");
const DIST = join(ROOT, "docs", "dist");

// Step 1 — bundle the search app
console.log("── Bundling search-app.ts ──");

const buildResult = await Bun.build({
  entrypoints: [
    join(ROOT, "scripts", "search-app.ts"),
    join(ROOT, "scripts", "library-app.ts"),
  ],
  outdir: DIST,
  target: "browser",
  format: "esm",
  external: ["*.wasm", "*.worker.js"],
});

if (!buildResult.success) {
  for (const err of buildResult.logs) {
    console.error(err);
  }
  process.exit(1);
}

console.log("✓  docs/dist/search-app.js");

// Step 2 — copy sql.js-httpvfs runtime assets
const WORKER_SRC = join(
  ROOT,
  "node_modules",
  "sql.js-httpvfs",
  "dist",
  "sqlite.worker.js",
);
const WASM_SRC = join(
  ROOT,
  "node_modules",
  "sql.js-httpvfs",
  "dist",
  "sql-wasm.wasm",
);

const ASSETS = [
  ["sqlite.worker.js", WORKER_SRC],
  ["sql-wasm.wasm", WASM_SRC],
] as const;

mkdirSync(DIST, { recursive: true });

for (const [name, src] of ASSETS) {
  if (!existsSync(src)) {
    console.error(`✗  Source not found: ${src}`);
    process.exit(1);
  }
  const dest = join(DIST, name);
  copyFileSync(src, dest);
  const kb = (Bun.file(dest).size / 1024).toFixed(0);
  console.log(`✓  docs/dist/${name}  (${kb} KB)`);
}

// Step 3 — patch sqlite.worker.js so fileLength works in serverMode:"full"
// The upstream lib ignores fileLength for full mode, causing HEAD/gzip
// failures on static hosts like GitHub Pages. See:
// https://github.com/phiresky/sql.js-httpvfs/issues/51
const workerDest = join(DIST, "sqlite.worker.js");
const workerSrc = readFileSync(workerDest, "utf-8");
const patched = workerSrc.replace(
  'fileLength:"chunked"===e.serverMode?e.databaseLengthBytes:void 0',
  'fileLength:e.fileLength||("chunked"===e.serverMode?e.databaseLengthBytes:void 0)',
);
if (patched === workerSrc) {
  console.warn("⚠  Could not apply sqlite.worker.js patch — fileLength may not work for serverMode:full");
} else {
  writeFileSync(workerDest, patched);
  console.log("✓  Patched sqlite.worker.js (fileLength now respected for serverMode:full)");
}

console.log("\nDone  •  search app ready in docs/dist/");
