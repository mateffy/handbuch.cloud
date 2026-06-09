/**
 * push-db.ts – Manually upload docs/db/full.sqlite3 to Cloudflare R2.
 *
 * This is intentionally NOT part of the main build so you can review the
 * generated DB before publishing it. Run after `bun run build:content`.
 *
 * Usage:
 *   bun run scripts/push-db.ts
 *   op run --env-file=.env -- bun run scripts/push-db.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { S3Client } from "bun";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const DB_PATH = resolve(scriptDir, "..", "docs", "db", "full.sqlite3");

async function main(): Promise<void> {
  if (!existsSync(DB_PATH)) {
    console.error("✗  docs/db/full.sqlite3 not found. Run 'bun run build:content' first.");
    process.exit(1);
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET ?? "handbuch-db";

  if (!accountId || !accessKeyId || !secretAccessKey) {
    console.error("✗  R2 credentials not set. Define R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.");
    process.exit(1);
  }

  const dbBytes = readFileSync(DB_PATH).length;

  const r2 = new S3Client({
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  });

  console.log(`  Uploading full.sqlite3 (${(dbBytes / 1024).toFixed(0)} KB) → R2 bucket "${bucket}" …`);
  await r2.write("full.sqlite3", Bun.file(DB_PATH), {
    type: "application/octet-stream",
  });
  console.log(`✓  R2 upload complete`);
}

await main();
