/**
 * library-app.ts – Browser entry point for the /library package listing page.
 *
 * Bundled with `bun build`, loaded from docs/library/index.html.
 * Uses sql.js-httpvfs to query the full.sqlite database with paginated
 * DB queries — only loads 50 packages at a time via LIMIT/OFFSET.
 * Infinite scroll auto-loads more; a fallback button covers older browsers.
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

// ── Config ────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

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

function showInitialLoading(): void {
  loadingEl.classList.remove("hidden");
  listEl.innerHTML = "";
  filtersEl.classList.add("opacity-50", "pointer-events-none");
}

function hideInitialLoading(): void {
  loadingEl.classList.add("hidden");
  filtersEl.classList.remove("opacity-50", "pointer-events-none");
}

function showError(message: string): void {
  hideInitialLoading();
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

// ── SQLite ────────────────────────────────────────────────────────

interface DbHandle {
  exec(sql: string, params?: Record<string, unknown> | unknown[]): Promise<QueryResult[]>;
}

let dbPromise: Promise<DbHandle> | null = null;

async function getDb(): Promise<DbHandle> {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const workerUrl = new URL("/dist/sqlite.worker.js?v=5", window.location.origin).toString();
    const wasmUrl = new URL("/dist/sql-wasm.wasm?v=5", window.location.origin).toString();

    const worker: WorkerHttpvfs = await createDbWorker(
      [{ from: "jsonconfig", configUrl: "/db/config.json" }],
      workerUrl,
      wasmUrl,
    );

    const db = worker.db as unknown as { exec(sql: string, params?: unknown): Promise<QueryResult[]> };
    return {
      exec(sql: string, params?: Record<string, unknown> | unknown[]) {
        return db.exec(sql, params);
      },
    };
  })();

  dbPromise.catch((err) => {
    console.error("[library-db] init failed:", err);
    dbPromise = null;
  });

  return dbPromise;
}

// ── Query helpers ─────────────────────────────────────────────────

interface FilterState {
  search: string;
  registry: string;
  category: string;
}

/** Fetch one page of packages matching the current filters. */
async function fetchPage(filters: FilterState, offset: number): Promise<PackageRow[]> {
  const db = await getDb();

  const { search, registry, category } = filters;
  const hasSearch = search.length > 0;
  const hasRegistry = registry.length > 0;
  const hasCategory = category.length > 0;

  let result: QueryResult[];

  if (hasSearch) {
    // FTS5 path — trigram index handles substring matching
    result = await db.exec(
      `SELECT p.name, p.registry, p.updated_at, GROUP_CONCAT(t.name, ',') AS tags
       FROM packages_fts f
       JOIN packages p ON p.id = f.rowid
       LEFT JOIN package_tags pt ON pt.package_id = p.id
       LEFT JOIN tags t ON t.id = pt.tag_id
       WHERE f.name MATCH $search
         AND ($registry = '' OR p.registry = $registry)
         AND ($category = '' OR EXISTS (
           SELECT 1 FROM package_tags pt2
           JOIN tags t2 ON t2.id = pt2.tag_id
           WHERE pt2.package_id = p.id AND t2.name = $category
         ))
       GROUP BY p.id
       ORDER BY rank, p.name
       LIMIT $limit OFFSET $offset`,
      { $search: search, $registry: registry, $category: category, $limit: PAGE_SIZE, $offset: offset },
    );
  } else {
    // Regular path — no FTS5 needed
    result = await db.exec(
      `SELECT p.name, p.registry, p.updated_at, GROUP_CONCAT(t.name, ',') AS tags
       FROM packages p
       LEFT JOIN package_tags pt ON pt.package_id = p.id
       LEFT JOIN tags t ON t.id = pt.tag_id
       WHERE ($registry = '' OR p.registry = $registry)
         AND ($category = '' OR EXISTS (
           SELECT 1 FROM package_tags pt2
           JOIN tags t2 ON t2.id = pt2.tag_id
           WHERE pt2.package_id = p.id AND t2.name = $category
         ))
       GROUP BY p.id
       ORDER BY p.name
       LIMIT $limit OFFSET $offset`,
      { $registry: registry, $category: category, $limit: PAGE_SIZE, $offset: offset },
    );
  }

  const rows = result?.[0]?.values ?? [];
  return rows.map((row: unknown[]) => ({
    name: row[0] as string,
    registry: row[1] as string,
    updatedAt: row[2] as string,
    tags: row[3] ? (row[3] as string).split(",").filter(Boolean) : [],
  }));
}

/** Get the total count for the current filters (for the counter display). */
async function fetchCount(filters: FilterState): Promise<number> {
  const db = await getDb();
  const { search, registry, category } = filters;

  let result: QueryResult[];

  if (search.length > 0) {
    result = await db.exec(
      `SELECT COUNT(DISTINCT p.id)
       FROM packages_fts f
       JOIN packages p ON p.id = f.rowid
       WHERE f.name MATCH $search
         AND ($registry = '' OR p.registry = $registry)
         AND ($category = '' OR EXISTS (
           SELECT 1 FROM package_tags pt2
           JOIN tags t2 ON t2.id = pt2.tag_id
           WHERE pt2.package_id = p.id AND t2.name = $category
         ))`,
      { $search: search, $registry: registry, $category: category },
    );
  } else {
    result = await db.exec(
      `SELECT COUNT(*)
       FROM packages p
       WHERE ($registry = '' OR p.registry = $registry)
         AND ($category = '' OR EXISTS (
           SELECT 1 FROM package_tags pt2
           JOIN tags t2 ON t2.id = pt2.tag_id
           WHERE pt2.package_id = p.id AND t2.name = $category
         ))`,
      { $registry: registry, $category: category },
    );
  }

  return (result?.[0]?.values?.[0]?.[0] as number) ?? 0;
}

/** Load all unique tag names for the category dropdown. */
async function fetchAllTags(): Promise<string[]> {
  const db = await getDb();
  const result = await db.exec("SELECT name FROM tags ORDER BY name");
  const rows = result?.[0]?.values ?? [];
  return rows.map((r: unknown[]) => r[0] as string);
}

// ── Infinite scroll state ─────────────────────────────────────────

let currentFilters: FilterState = { search: "", registry: "", category: "" };
let currentOffset = 0;
let totalCount = 0;
let isLoading = false;
let hasMore = true;

// sentinel element watched by IntersectionObserver
let sentinelEl: HTMLDivElement | null = null;
let observer: IntersectionObserver | null = null;

function getFilters(): FilterState {
  return {
    search: searchInput.value.trim(),
    registry: registrySelect.value,
    category: categorySelect.value,
  };
}

function setLoadMoreVisible(visible: boolean): void {
  const btn = document.querySelector<HTMLButtonElement>("#load-more-btn");
  if (btn) btn.style.display = visible ? "block" : "none";
}

function appendPackages(packages: PackageRow[]): void {
  const html = packages.map(renderPackageCard).join("");
  const frag = document.createElement("div");
  frag.className = "space-y-3";
  frag.innerHTML = html;

  // Insert before the sentinel (if it exists), otherwise append
  if (sentinelEl && listEl.contains(sentinelEl)) {
    listEl.insertBefore(frag, sentinelEl);
  } else {
    listEl.appendChild(frag);
  }
}

async function loadMore(): Promise<void> {
  if (isLoading || !hasMore) return;
  isLoading = true;

  try {
    const packages = await fetchPage(currentFilters, currentOffset);
    appendPackages(packages);
    currentOffset += packages.length;
    hasMore = packages.length === PAGE_SIZE;
    setLoadMoreVisible(hasMore);

    if (!hasMore && sentinelEl) {
      observer?.unobserve(sentinelEl);
    }
  } catch (err) {
    console.error("[library-db] loadMore error:", err);
    setLoadMoreVisible(true); // keep button visible so user can retry
  } finally {
    isLoading = false;
  }
}

async function resetAndLoad(): Promise<void> {
  currentFilters = getFilters();
  currentOffset = 0;
  hasMore = true;
  isLoading = false;

  // Clear list but keep sentinel
  const cards = listEl.querySelectorAll<HTMLDivElement>(".space-y-3");
  cards.forEach((el) => el.remove());

  // Update count async
  fetchCount(currentFilters).then((n) => {
    totalCount = n;
    countEl.textContent = `${n} package${n === 1 ? "" : "s"}`;
  }).catch(() => {});

  await loadMore();
}

// ── Scroll sentinel + observer ────────────────────────────────────

function setupScrollObserver(): void {
  // Create sentinel div at the bottom of the list
  if (!sentinelEl) {
    sentinelEl = document.createElement("div");
    sentinelEl.id = "scroll-sentinel";
    sentinelEl.style.height = "1px";
    listEl.appendChild(sentinelEl);
  }

  if ("IntersectionObserver" in window) {
    observer?.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinelEl);
  }
  // Fallback: "Load more" button handles non-supporting browsers
}

// ── Init ───────────────────────────────────────────────────────────

async function init(): Promise<void> {
  showInitialLoading();

  try {
    // Populate category dropdown from DB
    const tags = await fetchAllTags();
    const currentCategory = categorySelect.value;
    categorySelect.innerHTML =
      '<option value="">All categories</option>' +
      tags.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
    categorySelect.value = currentCategory;

    hideInitialLoading();
    setupScrollObserver();
    await resetAndLoad();
  } catch (err) {
    console.error("[library-db] init error:", err);
    showError("Could not load package library. Check your connection and try again.");
  }
}

// ── Event handlers ────────────────────────────────────────────────

// Debounce filter changes so rapid typing doesn't spam the DB
let filterDebounce: ReturnType<typeof setTimeout> | null = null;

function onFilterChange(): void {
  if (filterDebounce) clearTimeout(filterDebounce);
  filterDebounce = setTimeout(() => void resetAndLoad(), 200);
}

searchInput.addEventListener("input", onFilterChange);
registrySelect.addEventListener("change", onFilterChange);
categorySelect.addEventListener("change", onFilterChange);

// Inject the fallback "Load more" button into the page
const loadMoreBtn = document.createElement("button");
loadMoreBtn.id = "load-more-btn";
loadMoreBtn.type = "button";
loadMoreBtn.className =
  "mt-6 w-full border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:border-zinc-500 hover:bg-zinc-50 transition-colors";
loadMoreBtn.textContent = "Load more";
loadMoreBtn.style.display = "none";
loadMoreBtn.addEventListener("click", () => void loadMore());
listEl.insertAdjacentElement("afterend", loadMoreBtn);

void init();
