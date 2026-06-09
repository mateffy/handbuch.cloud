/**
 * build-content.ts – Compile JSON indexes and a full SQLite database from docs JSON files.
 *
 * Scans every .json file under docs/ (except schema.json and the generated
 * index/ / tags/ / db/ directories themselves), extracts all metadata, and produces:
 *
 *   JSON:
 *     docs/index/{registry}.json   – sorted array of package names per registry
 *     docs/tags/{tag}.json         – sorted array of package names per tag
 *     docs/tags/index.json         – sorted array of all known tag names
 *
 *   HTML:
 *     docs/{registry}/{name}/index.html – static package detail page
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
 *   bun run scripts/build-content.ts
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Database, type Statement } from "bun:sqlite";

// ── Paths ──────────────────────────────────────────────────────────
const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(scriptDir, "..");
const DOCS = join(ROOT, "docs");
const DB_PATH = join(DOCS, "db", "full.sqlite3");

const EXCLUDED_DIRS = new Set(["index", "tags", "db", ".well-known"]);
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

  // ── FTS5 full-text search (trigram tokenizer for infix matching) ──
  // tokenize='trigram' → MATCH 'react' finds any name *containing* "react".
  // Case-insensitive by default. registry is stored but not tokenized.
  db.run(`
    CREATE VIRTUAL TABLE packages_fts USING fts5(
      name,
      registry UNINDEXED,
      tokenize = 'trigram'
    )
  `);
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

async function buildDatabase(packages: FlatPackage[]): Promise<void> {
  // Remove existing database so we build clean every time
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  mkdirSync(join(DB_PATH, ".."), { recursive: true });

  const db = new Database(DB_PATH);

  // DELETE journal → single-file database suitable for static serving
  db.run("PRAGMA journal_mode = DELETE");
  db.run("PRAGMA foreign_keys = ON");

  createSchema(db);
  insertData(db, packages);

  // ── Populate FTS5 index ────────────────────────────────────────
  db.run("INSERT INTO packages_fts(rowid, name, registry) SELECT id, name, registry FROM packages");

  // ── Summary counts ──────────────────────────────────────────
  const pkgCount = getRow<{ c: number }>(
    db.prepare("SELECT COUNT(*) AS c FROM packages"),
  ).c;
  const tagCount = getRow<{ c: number }>(db.prepare("SELECT COUNT(*) AS c FROM tags")).c;
  const docCount = getRow<{ c: number }>(db.prepare("SELECT COUNT(*) AS c FROM docs")).c;

  db.run("VACUUM");
  db.close();

  const dbBytes = existsSync(DB_PATH) ? readFileSync(DB_PATH).length : 0;
  const dbSize = dbBytes / 1024;

  // ── HTTP-VFS config for sql.js-httpvfs ────────────────────
  // DB is served from Cloudflare R2 which handles Range requests and
  // HEAD responses correctly — no gzip mangling, proper 206 responses.
  // requestChunkSize: 4096 enables real lazy loading (only fetches the
  // SQLite pages each query actually needs).
  //
  // R2_PUBLIC_URL env var → e.g. https://db.handbuch.cloud
  // Falls back to /db/full.sqlite3 for local development.
  const r2PublicUrl = process.env.R2_PUBLIC_URL;
  const dbUrl = r2PublicUrl ? `${r2PublicUrl}/full.sqlite3` : "/db/full.sqlite3";

  const dbConfig = {
    serverMode: "full",
    requestChunkSize: 4096,
    url: dbUrl,
  };
  writeFileSync(
    join(DB_PATH, "..", "config.json"),
    JSON.stringify(dbConfig, null, 2) + "\n",
  );

  console.log(
    `✓  db/full.sqlite3  (${dbSize.toFixed(0)} KB  •  ${pkgCount} packages  •  ${docCount} docs  •  ${tagCount} tags)`,
  );
  console.log(`✓  db/config.json  →  ${dbUrl}`);
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

// ── Package detail page builder ──────────────────────────────────

function buildPackagePages(packages: FlatPackage[]): void {
  const escapeHtml = (str: string): string =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const kindBadge = (kind: string | null): string => {
    const colors: Record<string, string> = {
      official: "bg-zinc-800 text-white",
      community: "bg-zinc-200 text-zinc-800",
      tutorial: "bg-zinc-200 text-zinc-800",
      api: "bg-zinc-200 text-zinc-800",
      guide: "bg-zinc-200 text-zinc-800",
      blog: "bg-zinc-200 text-zinc-800",
      video: "bg-zinc-200 text-zinc-800",
      course: "bg-zinc-200 text-zinc-800",
      cheatsheet: "bg-zinc-200 text-zinc-800",
    };
    const cls = colors[kind ?? ""] ?? "bg-zinc-200 text-zinc-800";
    return `<span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 ${cls}">${escapeHtml(kind ?? "doc")}</span>`;
  };

  const renderTag = (tag: string): string =>
    `<span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-zinc-100 border border-zinc-200 text-zinc-600">${escapeHtml(tag)}</span>`;

  const renderDoc = (doc: DocSource): string => `
    <a href="${escapeHtml(doc.url)}" target="_blank" class="group block border border-zinc-200 bg-white p-5 hover:border-zinc-400 transition-colors">
      <div class="flex items-start justify-between gap-4 mb-2">
        <h3 class="text-base font-semibold text-gray-800 group-hover:underline">${escapeHtml(doc.title)}</h3>
        ${doc.kind ? kindBadge(doc.kind) : ""}
      </div>
      ${doc.description ? `<p class="text-sm text-zinc-600 mb-3 leading-relaxed">${escapeHtml(doc.description)}</p>` : ""}
      <div class="flex flex-wrap gap-1.5">
        ${(doc.tags ?? []).map(renderTag).join("")}
      </div>
    </a>
  `;

  for (const pkg of packages) {
    const readmeLink = pkg.readme
      ? `<a href="${escapeHtml(pkg.readme)}" target="_blank" class="underline hover:opacity-75 text-zinc-500">README</a>`
      : "";

    const metaItems = [
      `<span class="text-zinc-500">${escapeHtml(pkg.registry.toUpperCase())}</span>`,
      readmeLink,
      `<span class="text-zinc-400">updated ${new Date(pkg.updatedAt).toLocaleDateString()}</span>`,
    ].filter(Boolean);

    const docsHtml = pkg.docs.map(renderDoc).join("");

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(pkg.name)} | handbuch – curated docs for AI coding agents</title>
<link rel="icon" href="data:image/svg+xml,&lt;svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22&gt;&lt;text y=%22.9em%22 font-size=%2290%22&gt;📚&lt;/text&gt;&lt;/svg&gt;" />
<style>
html { background-color: #f4f4f5; scrollbar-gutter: stable; }
@view-transition { navigation: auto; }
</style>
<link rel="stylesheet" href="/output.css" />
</head>
<body class="font-mono min-h-screen bg-zinc-100 text-gray-800">
<div class="mx-auto max-w-3xl py-10 px-5">
<header class="w-full flex items-start justify-between">
  <div class="text-left">
    <a href="/" class="block">
      <h1 class="text-3xl lowercase mb-1 font-display hover:opacity-75 transition-opacity">Handbuch</h1>
    </a>
    <p class="text-lg text-zinc-500">curated documentation <br />for AI coding agents</p>
  </div>
  <nav>
    <ul class="text-right space-y-2">
      <li><a href="/library" class="hover:underline hover:opacity-75">Library</a></li>
      <li><a href="/" class="hover:underline hover:opacity-75">Search</a></li>
      <li><a href="https://github.com/mateffy/handbuch" target="_blank" class="hover:underline hover:opacity-75">GitHub</a></li>
    </ul>
  </nav>
</header>

<div class="flex flex-col w-full py-18">
  <div class="mb-8">
    <h2 class="text-2xl font-display font-bold text-gray-800 mb-1">${escapeHtml(pkg.name)}</h2>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      ${metaItems.join('<span class="text-zinc-300">·</span>')}
    </div>
  </div>
  <div class="space-y-3">
    ${docsHtml}
  </div>
</div>
</div>
</body>
</html>
`;

    const dir = join(DOCS, pkg.registry, pkg.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), html);
  }

  console.log(`✓  ${packages.length} package page(s)`);
}

// ── Sitemap builder ────────────────────────────────────────────────

function buildSitemap(packages: FlatPackage[]): void {
  const domain = "https://handbuch.cloud";
  const now = new Date().toISOString().split("T")[0];

  const urls: { loc: string; changefreq: string; priority: string }[] = [
    { loc: `${domain}/`, changefreq: "weekly", priority: "1.0" },
    { loc: `${domain}/library/`, changefreq: "weekly", priority: "0.9" },
    { loc: `${domain}/schema.json`, changefreq: "monthly", priority: "0.8" },
    { loc: `${domain}/llms.txt`, changefreq: "weekly", priority: "0.9" },
    { loc: `${domain}/llms-full.txt`, changefreq: "weekly", priority: "0.9" },
    { loc: `${domain}/robots.txt`, changefreq: "monthly", priority: "0.5" },
    { loc: `${domain}/sitemap.xml`, changefreq: "weekly", priority: "0.5" },
    { loc: `${domain}/index/npm.json`, changefreq: "weekly", priority: "0.7" },
    { loc: `${domain}/index/packagist.json`, changefreq: "weekly", priority: "0.7" },
    { loc: `${domain}/tags/index.json`, changefreq: "weekly", priority: "0.6" },
    { loc: `${domain}/db/full.sqlite3`, changefreq: "weekly", priority: "0.8" },
  ];

  // Add all package JSON entries and HTML detail pages
  const registries = new Set(packages.map((p) => p.registry));
  for (const pkg of packages) {
    urls.push({
      loc: `${domain}/${pkg.registry}/${pkg.name}.json`,
      changefreq: "monthly",
      priority: "0.6",
    });
    urls.push({
      loc: `${domain}/${pkg.registry}/${pkg.name}/`,
      changefreq: "monthly",
      priority: "0.7",
    });
  }

  // Also add all tag indexes
  const tags = new Set<string>();
  for (const pkg of packages) {
    for (const t of pkg.tags) tags.add(t);
  }
  for (const tag of tags) {
    urls.push({
      loc: `${domain}/tags/${slugify(tag)}.json`,
      changefreq: "monthly",
      priority: "0.4",
    });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>\n`;

  writeFileSync(join(DOCS, "sitemap.xml"), xml);
  console.log(`✓  sitemap.xml  (${urls.length} URLs)`);
}

// ── Well-known endpoint builders ───────────────────────────────────

function buildWellKnown(packages: FlatPackage[]): void {
  const wkDir = join(DOCS, ".well-known");
  mkdirSync(wkDir, { recursive: true });

  // ── API Catalog (RFC 9727) ────────────────────────────────────
  // Lists the documentation JSON endpoints as discoverable APIs
  const catalog = {
    linkset: [
      {
        anchor: "https://handbuch.cloud/",
        "service-desc": [
          { href: "https://handbuch.cloud/schema.json", title: "handbuch.cloud schema" },
        ],
        "service-doc": [
          { href: "https://handbuch.cloud/llms.txt", title: "LLM entry point" },
          { href: "https://handbuch.cloud/llms-full.txt", title: "Full LLM documentation" },
        ],
        "http://www.w3.org/ns/hydra/core#search": [
          { href: "https://handbuch.cloud/index/npm.json", title: "npm package index" },
          { href: "https://handbuch.cloud/index/packagist.json", title: "Packagist package index" },
        ],
      },
    ],
  };

  writeFileSync(join(wkDir, "api-catalog"), JSON.stringify(catalog, null, 2) + "\n");
  console.log(`✓  .well-known/api-catalog`);

  // ── Agent Skills discovery index ──────────────────────────────
  // https://github.com/cloudflare/agent-skills-discovery-rfc
  //
  // Note: The skills array is minimal since handbuch.cloud doesn't
  // host skill artifacts — it's a documentation directory. The entry
  // points agents to the llms.txt which serves a similar purpose.

  const skills = {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: "handbuch-doc-lookup",
        type: "skill-md",
        description: "Look up curated documentation URLs for any open-source package",
        url: "https://handbuch.cloud/llms.txt",
        digest: "sha256:placeholder", // computed from file content at build time
      },
    ],
  };

  const skillsDir = join(wkDir, "agent-skills");
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(join(skillsDir, "index.json"), JSON.stringify(skills, null, 2) + "\n");
  console.log(`✓  .well-known/agent-skills/index.json`);
}

// ── Main ───────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("Scanning docs/ for package entries …\n");

  const packages = collectPackages(DOCS);

  if (packages.length === 0) {
    console.log("No packages found. Nothing to do.");
    return;
  }

  console.log(`Found ${packages.length} package(s)\n`);

  console.log("── JSON indexes ──");
  buildJsonIndexes(packages);

  console.log("\n── Package detail pages ──");
  buildPackagePages(packages);

  console.log("\n── SQLite database ──");
  await buildDatabase(packages);

  console.log("\n── Sitemap ──");
  buildSitemap(packages);

  console.log("\n── Well-known endpoints ──");
  buildWellKnown(packages);

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

  console.log(
    `\n⚠  DB NOT pushed to R2 yet. Run: bun run scripts/push-db.ts  (or  op run --env-file=.env -- bun run scripts/push-db.ts)`,
  );
}

await main();
