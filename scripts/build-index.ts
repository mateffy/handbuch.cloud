/**
 * build-index.ts – Compile JSON indexes and a full SQLite database from docs JSON files.
 *
 * Scans every .json file under docs/ (except schema.json and the generated
 * index/ / tags/ / db/ directories themselves), extracts all metadata, and produces:
 *
 *   JSON:
 *     docs/index/{registry}.json   – sorted array of package names per registry
 *     docs/tags/{tag}.json         – sorted array of package names per tag
 *     docs/tags/index.json         – sorted array of all known tag names
 *
 *   SQLite:
 *     docs/db/full.sqlite          – relational database with tables:
 *       packages                    name, registry, timestamps, readme
 *       tags                        canonical tag names
 *       package_tags                many-to-many: packages ←→ tags (package-level tags)
 *       docs                        documentation entries (url, title, description, kind, sort_order)
 *       doc_tags                    many-to-many: docs ←→ tags (per-source tags)
 *
 * Usage:
 *   bun run scripts/build-index.ts
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Database, type Statement } from "bun:sqlite";

// ── Paths ──────────────────────────────────────────────────────────
const __dirname = fileURLToPath(new URL("..", import.meta.url));
const DOCS = join(__dirname, "docs");
const DB_PATH = join(DOCS, "db", "full.sqlite");

const EXCLUDED_DIRS = new Set(["index", "tags", "db"]);
const EXCLUDED_FILES = new Set(["schema.json"]);

// ── Types ──────────────────────────────────────────────────────────
interface DocSource {
  url: string;
  title: string;
  description?: string;
  kind?: string;
  tags?: string[];
}

interface FlatPackage {
  name: string;
  registry: string;
  updatedAt: string;
  checkedAt: string;
  readme: string | null;
  tags: string[];
  docs: DocSource[];
}

// ── Helpers ────────────────────────────────────────────────────────

/** Type-safe row getter — throws if the query returns no rows. */
function getRow<T>(stmt: Statement, params?: unknown): T {
  const row = stmt.get(params);
  if (row === undefined) {
    throw new Error(`Expected row not found`);
  }
  return row as T;
}

/**
 * Group items by a key function that returns a single key or an array of keys.
 * Items that map to multiple keys appear in multiple buckets.
 */
function groupBy<T, K extends string>(
  items: T[],
  keyFn: (item: T) => K | readonly K[],
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const keys = Array.isArray(keyFn(item)) ? keyFn(item) : [keyFn(item)];
    for (const key of keys) {
      const bucket = map.get(key);
      if (bucket) {
        bucket.push(item);
      } else {
        map.set(key, [item]);
      }
    }
  }
  return map;
}

/** Sluggify a tag name into a safe filesystem component. */
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._~-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Walk ───────────────────────────────────────────────────────────
function collectPackages(root: string): FlatPackage[] {
  const entries: FlatPackage[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      if (EXCLUDED_FILES.has(entry.name)) continue;

      const rel = relative(root, full);

      let raw: string;
      try {
        raw = readFileSync(full, "utf-8");
      } catch (err) {
        console.error(`✗  Failed to read ${rel}: ${err}`);
        continue;
      }

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(raw);
      } catch (err) {
        console.error(`✗  Failed to parse ${rel}: ${err}`);
        continue;
      }

      // ── Validate required fields ──────────────────────────────
      const name = obj.name;
      const registry = obj.registry;
      const updatedAt = obj.updatedAt;
      const checkedAt = obj.checkedAt;

      if (typeof name !== "string" || name.length === 0) {
        console.error(`✗  ${rel}: missing or invalid "name"`);
        continue;
      }
      if (typeof registry !== "string" || registry.length === 0) {
        console.error(`✗  ${rel}: missing or invalid "registry"`);
        continue;
      }
      if (typeof updatedAt !== "string") {
        console.error(`✗  ${rel}: missing or invalid "updatedAt"`);
        continue;
      }
      if (typeof checkedAt !== "string") {
        console.error(`✗  ${rel}: missing or invalid "checkedAt"`);
        continue;
      }

      const readme = typeof obj.readme === "string" ? obj.readme : null;

      // ── Top-level tags ────────────────────────────────────────
      const rawTags = obj.tags;
      const tags: string[] = Array.isArray(rawTags)
        ? rawTags.filter((t): t is string => typeof t === "string")
        : [];

      // ── Docs ──────────────────────────────────────────────────
      const rawDocs = obj.docs;
      const docs: DocSource[] = Array.isArray(rawDocs)
        ? rawDocs
            .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
            .map((d) => ({
              url: typeof d.url === "string" ? d.url : "",
              title: typeof d.title === "string" ? d.title : "",
              description: typeof d.description === "string" ? d.description : undefined,
              kind: typeof d.kind === "string" ? d.kind : undefined,
              tags: Array.isArray(d.tags)
                ? d.tags.filter((t): t is string => typeof t === "string")
                : undefined,
            }))
            .filter((d) => d.url.length > 0 && d.title.length > 0)
        : [];

      if (docs.length === 0) {
        console.warn(`⚠  ${rel}: no valid docs entries`);
      }

      entries.push({ name, registry, updatedAt, checkedAt, readme, tags, docs });
    }
  }

  walk(root);
  return entries;
}

// ── SQLite database ────────────────────────────────────────────────

function createSchema(db: Database): void {
  db.run(`
    CREATE TABLE packages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      registry    TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL,
      checked_at  TEXT    NOT NULL,
      readme      TEXT
    )
  `);

  db.run(`
    CREATE TABLE tags (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT    NOT NULL UNIQUE
    )
  `);

  db.run(`
    CREATE TABLE package_tags (
      package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
      tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (package_id, tag_id)
    )
  `);

  db.run(`
    CREATE TABLE docs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id  INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
      url         TEXT    NOT NULL,
      title       TEXT    NOT NULL,
      description TEXT,
      kind        TEXT,
      sort_order  INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE doc_tags (
      doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (doc_id, tag_id)
    )
  `);

  // ── Performance indexes ──────────────────────────────────────
  db.run("CREATE INDEX idx_packages_registry ON packages(registry)");
  db.run("CREATE INDEX idx_docs_package_id ON docs(package_id)");
  db.run("CREATE INDEX idx_package_tags_tag_id ON package_tags(tag_id)");
  db.run("CREATE INDEX idx_doc_tags_tag_id ON doc_tags(tag_id)");
}

function insertData(db: Database, packages: FlatPackage[]): void {
  // Step 1 — collect every unique tag name from packages and docs
  const allTagNames = new Set<string>();
  for (const pkg of packages) {
    for (const t of pkg.tags) allTagNames.add(t);
    for (const doc of pkg.docs) {
      if (doc.tags) for (const t of doc.tags) allTagNames.add(t);
    }
  }

  // Step 2 — batch-insert all tags, then build an in-memory name→id map
  const insertTag = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES ($name)");
  db.transaction(() => {
    for (const name of allTagNames) insertTag.run({ $name: name });
  })();

  const tagIds = new Map<string, number>(
    (db.query("SELECT id, name FROM tags").all() as { id: number; name: string }[]).map(
      (r) => [r.name, r.id] as const,
    ),
  );

  // Step 3 — insert packages, docs, and their tag associations
  const insertPackage = db.prepare(`
    INSERT INTO packages (name, registry, updated_at, checked_at, readme)
    VALUES ($name, $registry, $updatedAt, $checkedAt, $readme)
  `);

  const insertPackageTag = db.prepare(`
    INSERT OR IGNORE INTO package_tags (package_id, tag_id) VALUES ($packageId, $tagId)
  `);

  const insertDoc = db.prepare(`
    INSERT INTO docs (package_id, url, title, description, kind, sort_order)
    VALUES ($packageId, $url, $title, $description, $kind, $sortOrder)
  `);

  const insertDocTag = db.prepare(`
    INSERT OR IGNORE INTO doc_tags (doc_id, tag_id) VALUES ($docId, $tagId)
  `);

  db.transaction(() => {
    for (const pkg of packages) {
      const pkgResult = insertPackage.run({
        $name: pkg.name,
        $registry: pkg.registry,
        $updatedAt: pkg.updatedAt,
        $checkedAt: pkg.checkedAt,
        $readme: pkg.readme,
      });
      const packageId = Number(pkgResult.lastInsertRowid);

      // ── Package-level tags ────────────────────────────────
      for (const tagName of pkg.tags) {
        const tagId = tagIds.get(tagName)!;
        insertPackageTag.run({ $packageId: packageId, $tagId: tagId });
      }

      // ── Documentation sources ─────────────────────────────
      for (let i = 0; i < pkg.docs.length; i++) {
        const doc = pkg.docs[i];

        const docResult = insertDoc.run({
          $packageId: packageId,
          $url: doc.url,
          $title: doc.title,
          $description: doc.description ?? null,
          $kind: doc.kind ?? null,
          $sortOrder: i,
        });
        const docId = Number(docResult.lastInsertRowid);

        // ── Per-source tags ────────────────────────────────
        if (doc.tags) {
          for (const tagName of doc.tags) {
            const tagId = tagIds.get(tagName)!;
            insertDocTag.run({ $docId: docId, $tagId: tagId });
          }
        }
      }
    }
  })();
}

function buildDatabase(packages: FlatPackage[]): void {
  // Remove existing database so we build clean every time
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  mkdirSync(join(DB_PATH, ".."), { recursive: true });

  const db = new Database(DB_PATH);

  // DELETE journal → single-file database suitable for static serving
  db.run("PRAGMA journal_mode = DELETE");
  db.run("PRAGMA foreign_keys = ON");

  createSchema(db);
  insertData(db, packages);

  // ── Summary counts ──────────────────────────────────────────
  const pkgCount = getRow<{ c: number }>(
    db.prepare("SELECT COUNT(*) AS c FROM packages"),
  ).c;
  const tagCount = getRow<{ c: number }>(db.prepare("SELECT COUNT(*) AS c FROM tags")).c;
  const docCount = getRow<{ c: number }>(db.prepare("SELECT COUNT(*) AS c FROM docs")).c;

  db.run("VACUUM");
  db.close();

  const dbSize =
    (existsSync(DB_PATH) ? readFileSync(DB_PATH).length : 0) / 1024;
  console.log(
    `✓  db/full.sqlite  (${dbSize.toFixed(0)} KB  •  ${pkgCount} packages  •  ${docCount} docs  •  ${tagCount} tags)`,
  );
}

// ── JSON index builder ─────────────────────────────────────────────

function buildJsonIndexes(packages: FlatPackage[]): void {
  // ── 1. Group by registry ──────────────────────────────────────
  const byRegistry = groupBy(packages, (p) => p.registry);
  for (const pkgs of byRegistry.values()) {
    pkgs.sort((a, b) => a.name.localeCompare(b.name));
  }

  const indexDir = join(DOCS, "index");
  mkdirSync(indexDir, { recursive: true });

  for (const [registry, pkgs] of byRegistry) {
    const file = join(indexDir, `${registry}.json`);
    writeFileSync(file, JSON.stringify(pkgs.map((p) => p.name), null, 2) + "\n");
    console.log(`✓  index/${registry}.json  (${pkgs.length} package(s))`);
  }

  // ── 2. Group by tag (top-level package tags only) ──────────────
  const byTag = groupBy(packages, (p) => p.tags);
  for (const pkgs of byTag.values()) {
    pkgs.sort((a, b) => a.name.localeCompare(b.name));
  }

  const tagsDir = join(DOCS, "tags");
  mkdirSync(tagsDir, { recursive: true });

  for (const [tag, pkgs] of byTag) {
    const file = join(tagsDir, `${slugify(tag)}.json`);
    writeFileSync(file, JSON.stringify(pkgs.map((p) => p.name), null, 2) + "\n");
    console.log(`✓  tags/${slugify(tag)}.json  ← "${tag}"  (${pkgs.length} package(s))`);
  }

  // ── 3. tags/index.json ─────────────────────────────────────────
  const allTags = Array.from(byTag.keys()).sort((a, b) => a.localeCompare(b));
  writeFileSync(join(tagsDir, "index.json"), JSON.stringify(allTags, null, 2) + "\n");
  console.log(`\n✓  tags/index.json  (${allTags.length} tag(s))`);
}

// ── Main ───────────────────────────────────────────────────────────
function main(): void {
  console.log("Scanning docs/ for package entries …\n");

  const packages = collectPackages(DOCS);

  if (packages.length === 0) {
    console.log("No packages found. Nothing to do.");
    return;
  }

  console.log(`Found ${packages.length} package(s)\n`);

  console.log("── JSON indexes ──");
  buildJsonIndexes(packages);

  console.log("\n── SQLite database ──");
  buildDatabase(packages);

  // ── Summary ──────────────────────────────────────────────────
  const registryCount = new Set(packages.map((p) => p.registry)).size;
  const topLevelTagCount = packages.reduce((acc, p) => {
    for (const t of p.tags) acc.add(t);
    return acc;
  }, new Set<string>()).size;
  const docCount = packages.reduce((acc, p) => acc + p.docs.length, 0);
  const docTagCount = packages.reduce((acc, p) => {
    for (const d of p.docs) if (d.tags) for (const t of d.tags) acc.add(t);
    return acc;
  }, new Set<string>()).size;

  console.log(
    `\nDone  •  ${packages.length} packages  •  ${registryCount} registr(ies/y)  •  ${topLevelTagCount} top-level tag(s)  •  ${docCount} docs  •  ${docTagCount} doc-level tag(s)`,
  );
}

main();
