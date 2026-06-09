/**
 * library-app.ts – Browser entry point for the /library package listing page.
 *
 * Bundled with `bun build`, loaded from docs/library/index.html.
 * Uses sql.js-httpvfs to query the full.sqlite database and renders
 * a filterable list of all packages.
 */

import { createDbWorker, type WorkerHttpvfs } from "sql.js-httpvfs";

// ── Types ──────────────────────────────────────────────────────────

interface QueryResult {
  columns: string[];
  values: unknown[][];
}

interface PackageRow {
  name: string;
  registry: string;
  updatedAt: string;
  tags: string[];
}

// ── DOM refs ───────────────────────────────────────────────────────

const listEl = document.querySelector<HTMLDivElement>("#package-list")!;
const countEl = document.querySelector<HTMLSpanElement>("#package-count")!;
const searchInput = document.querySelector<HTMLInputElement>("#filter-search")!;
const registrySelect = document.querySelector<HTMLSelectElement>("#filter-registry")!;
const categorySelect = document.querySelector<HTMLSelectElement>("#filter-category")!;
const loadingEl = document.querySelector<HTMLDivElement>("#library-loading")!;
const filtersEl = document.querySelector<HTMLDivElement>("#library-filters")!;

// ── Helpers ───────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderTag(tag: string): string {
  return `<span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-zinc-100 border border-zinc-200 text-zinc-600">${escapeHtml(tag)}</span>`;
}

function packageUrl(pkg: PackageRow): string {
  // Scoped packages need no extra encoding in path
  return `/${escapeHtml(pkg.registry)}/${escapeHtml(pkg.name)}`;
}

function renderPackageCard(pkg: PackageRow): string {
  const updated = new Date(pkg.updatedAt).toLocaleDateString();
  return `
    <a href="${packageUrl(pkg)}" class="group block border border-zinc-200 bg-white p-5 hover:border-zinc-400 transition-colors">
      <div class="flex items-start justify-between gap-4 mb-2">
        <h3 class="text-base font-semibold text-gray-800 group-hover:underline">${escapeHtml(pkg.name)}</h3>
        <span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-zinc-800 text-white">${escapeHtml(pkg.registry)}</span>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500 mb-3">
        <span>updated ${updated}</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        ${pkg.tags.map(renderTag).join("")}
      </div>
    </a>
  `;
}

function showLoading(): void {
  loadingEl.classList.remove("hidden");
  listEl.innerHTML = "";
  filtersEl.classList.add("opacity-50", "pointer-events-none");
}

function hideLoading(): void {
  loadingEl.classList.add("hidden");
  filtersEl.classList.remove("opacity-50", "pointer-events-none");
}

function showError(message: string): void {
  hideLoading();
  listEl.innerHTML = `
    <div class="border border-red-200 bg-white p-6">
      <div class="flex items-start gap-3">
        <svg class="w-5 h-5 text-red-500 mt-0.5 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
        </svg>
        <div>
          <p class="font-semibold text-gray-800">${escapeHtml(message)}</p>
        </div>
      </div>
    </div>
  `;
}

// ── SQLite query ──────────────────────────────────────────────────

/** Adapter that wraps Comlink-proxied LazyHttpDatabase.exec(). */
interface DbHandle {
  exec(sql: string, params?: Record<string, unknown> | unknown[]): Promise<QueryResult[]>;
}

let dbPromise: Promise<DbHandle> | null = null;

async function getDb(): Promise<DbHandle> {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const workerUrl = new URL(
      "/dist/sqlite.worker.js?v=3",
      window.location.origin,
    ).toString();
    const wasmUrl = new URL(
      "/dist/sql-wasm.wasm?v=3",
      window.location.origin,
    ).toString();

    const worker: WorkerHttpvfs = await createDbWorker(
      [
        {
          from: "jsonconfig",
          configUrl: "/db/config.json",
        },
      ],
      workerUrl,
      wasmUrl,
    );

    const db = worker.db as unknown as {
      exec(sql: string, params?: unknown): Promise<QueryResult[]>;
    };

    return {
      exec(sql: string, params?: Record<string, unknown> | unknown[]) {
        return db.exec(sql, params);
      },
    };
  })();

  return dbPromise;
}

let allPackages: PackageRow[] = [];
let allTags: string[] = [];

async function loadPackages(): Promise<void> {
  showLoading();

  try {
    const db = await getDb();

    // Load all packages with their tags
    const result = await db.exec(
      `SELECT
         p.name,
         p.registry,
         p.updated_at,
         GROUP_CONCAT(t.name, ',') AS tags
       FROM packages p
       LEFT JOIN package_tags pt ON pt.package_id = p.id
       LEFT JOIN tags t ON t.id = pt.tag_id
       GROUP BY p.id
       ORDER BY p.name`
    );

    const rows = result?.[0]?.values ?? [];
    allPackages = rows.map((row: unknown[]) => ({
      name: row[0] as string,
      registry: row[1] as string,
      updatedAt: row[2] as string,
      tags: row[3] ? (row[3] as string).split(",").filter(Boolean) : [],
    }));

    // Collect unique tags for the category filter
    const tagSet = new Set<string>();
    for (const pkg of allPackages) {
      for (const t of pkg.tags) tagSet.add(t);
    }
    allTags = Array.from(tagSet).sort((a, b) => a.localeCompare(b));

    // Populate category dropdown
    const currentCategory = categorySelect.value;
    categorySelect.innerHTML = '<option value="">All categories</option>' +
      allTags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
    categorySelect.value = currentCategory;

    renderPackages(allPackages);
    hideLoading();
  } catch (err) {
    console.error("Library load error:", err);
    showError("Could not load package library. Check your connection and try again.");
  }
}

function renderPackages(packages: PackageRow[]): void {
  countEl.textContent = `${packages.length} package${packages.length === 1 ? "" : "s"}`;

  if (packages.length === 0) {
    listEl.innerHTML = `
      <div class="border border-zinc-200 bg-white p-6 text-center">
        <p class="text-zinc-500">No packages match your filters.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = `<div class="space-y-3">${packages.map(renderPackageCard).join("")}</div>`;
}

function applyFilters(): void {
  const search = searchInput.value.trim().toLowerCase();
  const registry = registrySelect.value;
  const category = categorySelect.value;

  const filtered = allPackages.filter(pkg => {
    if (search && !pkg.name.toLowerCase().includes(search)) return false;
    if (registry && pkg.registry !== registry) return false;
    if (category && !pkg.tags.includes(category)) return false;
    return true;
  });

  renderPackages(filtered);
}

// ── Event handlers ────────────────────────────────────────────────

searchInput.addEventListener("input", applyFilters);
registrySelect.addEventListener("change", applyFilters);
categorySelect.addEventListener("change", applyFilters);

// ── Init ───────────────────────────────────────────────────────────

loadPackages();
