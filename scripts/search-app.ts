/**
 * search-app.ts – Homepage search with SQLite-powered autocomplete.
 *
 * Bundled with `bun build`, loaded from docs/index.html.
 * Uses sql.js-httpvfs to query package names on-demand.
 *
 * Autocomplete behaviour:
 *   • Any non-empty input → dropdown appears immediately
 *   • DB still loading    → "Loading SQLite package index..." spinner
 *   • DB ready, < 3 chars → "Enter more than 3 characters to search"
 *   • DB ready, ≥ 3 chars → query results (or "No results" if empty)
 *   • After initial load  → inline spinner inside input while re-querying
 */

import { createDbWorker, type WorkerHttpvfs } from "sql.js-httpvfs";

// ── Types ──────────────────────────────────────────────────────────

interface QueryResult {
  columns: string[];
  values: unknown[][];
}

// ── DOM refs ───────────────────────────────────────────────────────

const form = document.querySelector<HTMLFormElement>("#search-form")!;
const input = form.querySelector<HTMLInputElement>('input[type="search"]')!;
const registrySelect = document.querySelector<HTMLSelectElement>("#registry-select")!;
const resultsEl = document.querySelector<HTMLDivElement>("#results")!;
const autocompleteEl = document.querySelector<HTMLDivElement>("#autocomplete-list")!;
const inputSpinnerEl = document.querySelector<HTMLDivElement>("#input-spinner")!;

const wasmUrl = new URL("/dist/sql-wasm.wasm?v=5", window.location.origin).toString();

/** Pre-fetch the WASM binary in the main thread so the worker can load it from a
 *  blob URL (instant, no duplicate network request). */
let wasmBlobUrlPromise: Promise<string> | null = null;
async function getWasmBlobUrl(): Promise<string> {
  if (wasmBlobUrlPromise) return wasmBlobUrlPromise;

  wasmBlobUrlPromise = (async () => {
    console.log("[search-db] preloading wasm binary…");
    const res = await fetch(wasmUrl, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`WASM preload failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    const blob = new Blob([buf], { type: "application/wasm" });
    const url = URL.createObjectURL(blob);
    console.log("[search-db] wasm blob url ready");
    return url;
  })();

  return wasmBlobUrlPromise;
}

// Start preloading WASM immediately so it's ready before the user types.
void getWasmBlobUrl();

// ── Hardcoded HTTP-VFS config (no external config.json) ─────────
const DB_CONFIG = {
  from: "inline" as const,
  config: {
    serverMode: "full" as const,
    requestChunkSize: 8192,
    url: "https://static.handbuch.cloud/full.sqlite3",
  },
};

// ── Race-condition guard + DB readiness ─────────────────────────

let searchSeq = 0;
/** True once the DB worker has fully initialised and the first query can run. */
let dbReady = false;

/** Optional artificial delay for UX testing: ?delay=2000 (ms) */
const delayMs = new URLSearchParams(window.location.search).get("delay");
async function maybeDelay(): Promise<void> {
  if (!delayMs) return;
  await new Promise((r) => setTimeout(r, parseInt(delayMs, 10)));
}

// ── Helpers ───────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function packageUrl(name: string, registry: string): string {
  return `/${encodeURIComponent(registry)}/${encodeURIComponent(name)}`;
}

function restoreDefault(): void {
  resultsEl.innerHTML = `
    <h2 class="font-semibold">Search for up-to-date documentation sources for a given open-source package.</h2>
    <p>The URLs are manually curated for accuracy, quality and relevance. You can also contribute to the library by submitting new URLs or reporting broken links by opening a GitHub PR.</p>
    <h2 class="font-semibold mt-10">Static analysis of source code suggests relevant documentation based on your code.</h2>
    <p>By analyzing your source code, we can suggest relevant documentation that matches the libraries and frameworks you are using. This allows you to quickly find the information you need without having to manually search for it.</p>
  `;
}

function showError(message: string): void {
  resultsEl.innerHTML = `
    <div class="border border-red-200 bg-white p-6">
      <div class="flex items-start gap-3">
        <svg class="w-5 h-5 text-red-500 mt-0.5 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
        </svg>
        <div><p class="font-semibold text-gray-800">${escapeHtml(message)}</p></div>
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
    console.log("[search-db] init start");

    const workerUrl = new URL("/dist/sqlite.worker.js?v=5", window.location.origin).toString();

    console.log("[search-db] creating worker …");
    const wasmBlobUrl = await getWasmBlobUrl();
    let worker: WorkerHttpvfs;
    try {
      worker = await createDbWorker([DB_CONFIG], workerUrl, wasmBlobUrl);
    } catch (err) {
      console.error("[search-db] createDbWorker failed:", err);
      throw err;
    }
    console.log("[search-db] worker ready");

    const db = worker.db as unknown as { exec(sql: string, params?: unknown): Promise<QueryResult[]> };

    try {
      const ping = await db.exec("SELECT 1");
      console.log("[search-db] smoke-test ok:", ping);
    } catch (err) {
      console.error("[search-db] smoke-test FAILED — DB may be corrupt or gzip-mangled:", err);
      throw err;
    }

    dbReady = true;
    return {
      exec(sql: string, params?: Record<string, unknown> | unknown[]) {
        return db.exec(sql, params);
      },
    };
  })();

  dbPromise.catch((err) => {
    console.error("[search-db] DB initialisation failed — resetting promise:", err);
    dbPromise = null;
  });

  return dbPromise;
}

/** Query up to 5 package names using simple infix (instr) search. */
async function queryAutocomplete(pattern: string, registry: string): Promise<string[]> {
  await maybeDelay();
  const db = await getDb();

  const result = await db.exec(
    `SELECT name
     FROM packages
     WHERE registry = $registry
       AND instr(lower(name), lower($pattern)) > 0
     ORDER BY
       CASE
         WHEN lower(name) = lower($pattern) THEN 0
         WHEN instr(lower(name), lower($pattern)) = 1 THEN 1
         ELSE 2
       END ASC,
       length(name) ASC
     LIMIT 5`,
    { $registry: registry, $pattern: pattern },
  );

  const rows = result?.[0]?.values ?? [];
  return rows.map((r: unknown[]) => r[0] as string);
}

/** Check if an exact package exists. */
async function exactMatch(name: string, registry: string): Promise<boolean> {
  await maybeDelay();
  const db = await getDb();
  const result = await db.exec(
    "SELECT 1 FROM packages WHERE name = $name AND registry = $registry LIMIT 1",
    { $name: name, $registry: registry },
  );
  const rows = result?.[0]?.values ?? [];
  return rows.length > 0;
}

// ── Autocomplete UI ───────────────────────────────────────────────

let activeIndex = -1;
let autocompleteItems: string[] = [];
let autocompleteVisible = false;

/** Show a loading state in the dropdown. */
function showDropdownLoading(): void {
  autocompleteItems = [];
  activeIndex = -1;
  autocompleteVisible = true;
  autocompleteEl.innerHTML = `
    <div class="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400">
      <svg class="animate-spin text-zinc-400 shrink-0" style="width:12px;height:12px" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <span>Loading SQLite package index...</span>
    </div>
  `;
  autocompleteEl.classList.remove("hidden");
  autocompleteEl.setAttribute("aria-expanded", "true");
  input.removeAttribute("aria-activedescendant");
}

/** Show the "need more chars" message. */
function showMinChars(): void {
  autocompleteItems = [];
  activeIndex = -1;
  autocompleteVisible = true;
  autocompleteEl.innerHTML = `<div class="px-3 py-2 text-sm text-zinc-400">Enter more than 3 characters to search</div>`;
  autocompleteEl.classList.remove("hidden");
  autocompleteEl.setAttribute("aria-expanded", "true");
  input.removeAttribute("aria-activedescendant");
}

/** Show the "no results" message. */
function showNoResults(query: string): void {
  autocompleteItems = [];
  activeIndex = -1;
  autocompleteVisible = true;
  autocompleteEl.innerHTML = `<div class="px-3 py-2 text-sm text-zinc-400">No results for "${escapeHtml(query)}"</div>`;
  autocompleteEl.classList.remove("hidden");
  autocompleteEl.setAttribute("aria-expanded", "true");
  input.removeAttribute("aria-activedescendant");
}

/** Show/hide the inline spinner inside the input. */
function setInputSpinner(visible: boolean): void {
  inputSpinnerEl.classList.toggle("hidden", !visible);
}

function hideAutocomplete(): void {
  autocompleteEl.classList.add("hidden");
  autocompleteEl.setAttribute("aria-expanded", "false");
  activeIndex = -1;
  autocompleteItems = [];
  autocompleteVisible = false;
  input.removeAttribute("aria-activedescendant");
}

function showAutocomplete(items: string[]): void {
  autocompleteItems = items;
  activeIndex = -1;

  if (items.length === 0) {
    hideAutocomplete();
    return;
  }

  autocompleteEl.innerHTML = items
    .map(
      (name, i) =>
        `<button
          type="button"
          role="option"
          id="ac-option-${i}"
          data-index="${i}"
          class="block w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none autocomplete-item"
          tabindex="-1"
          aria-selected="false"
        >${escapeHtml(name)}</button>`,
    )
    .join("");

  autocompleteEl.classList.remove("hidden");
  autocompleteEl.setAttribute("aria-expanded", "true");
  autocompleteVisible = true;
}

function highlightItem(index: number): void {
  const buttons = autocompleteEl.querySelectorAll<HTMLButtonElement>(".autocomplete-item");
  buttons.forEach((btn, i) => {
    const isActive = i === index;
    btn.classList.toggle("bg-zinc-100", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
    if (isActive) {
      btn.focus();
      input.setAttribute("aria-activedescendant", btn.id);
    }
  });
  activeIndex = index;
}

function navigateToPackage(name: string, registry: string): void {
  window.location.href = packageUrl(name, registry);
}

function selectSuggestion(index: number): void {
  if (index < 0 || index >= autocompleteItems.length) return;
  const selected = autocompleteItems[index];
  input.value = selected;
  hideAutocomplete();
  navigateToPackage(selected, registrySelect.value);
}

function focusInput(): void {
  input.focus();
  input.removeAttribute("aria-activedescendant");
  activeIndex = -1;
  const buttons = autocompleteEl.querySelectorAll<HTMLButtonElement>(".autocomplete-item");
  buttons.forEach((btn) => {
    btn.classList.remove("bg-zinc-100");
    btn.setAttribute("aria-selected", "false");
  });
}

function moveDown(): void {
  if (!autocompleteVisible || autocompleteItems.length === 0) return;
  if (activeIndex === -1) {
    highlightItem(0);
  } else if (activeIndex === autocompleteItems.length - 1) {
    focusInput();
  } else {
    highlightItem(activeIndex + 1);
  }
}

function moveUp(): void {
  if (!autocompleteVisible || autocompleteItems.length === 0) return;
  if (activeIndex === -1) {
    highlightItem(autocompleteItems.length - 1);
  } else if (activeIndex === 0) {
    focusInput();
  } else {
    highlightItem(activeIndex - 1);
  }
}

// ── Autocomplete search ───────────────────────────────────────────

async function doAutocomplete(query: string, registry: string): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) {
    hideAutocomplete();
    setInputSpinner(false);
    return;
  }

  const seq = ++searchSeq;

  // If DB isn't ready yet, show loading in the dropdown and wait.
  if (!dbReady) {
    showDropdownLoading();
    try {
      await getDb();
      if (seq !== searchSeq) return;
    } catch {
      if (seq !== searchSeq) return;
      hideAutocomplete();
      return;
    }
  }

  // At this point DB is ready (either was already or just became).
  // Re-read the CURRENT input value because the user may have kept typing.
  const currentQuery = input.value.trim();
  if (!currentQuery) {
    hideAutocomplete();
    return;
  }
  if (currentQuery.length < 3) {
    showMinChars();
    return;
  }
  if (document.activeElement !== input) {
    hideAutocomplete();
    return;
  }

  // Actually query.
  setInputSpinner(true);
  try {
    const suggestions = await queryAutocomplete(currentQuery, registry);
    if (seq !== searchSeq) return;

    const latestQuery = input.value.trim();
    if (latestQuery.length < 3) {
      showMinChars();
      return;
    }

    if (suggestions.length > 0) {
      showAutocomplete(suggestions);
    } else {
      showNoResults(latestQuery);
    }
  } catch (err) {
    console.error("[search-db] autocomplete error:", err);
    if (seq !== searchSeq) return;
    showNoResults(input.value.trim());
  } finally {
    if (seq === searchSeq) setInputSpinner(false);
  }
}

// ── Event handlers ────────────────────────────────────────────────

input.addEventListener("input", () => {
  const query = input.value.trim();
  const registry = registrySelect.value;

  if (!query) {
    hideAutocomplete();
    restoreDefault();
    ++searchSeq;
    return;
  }

  void doAutocomplete(query, registry);
});

form.addEventListener("submit", async (e: Event) => {
  e.preventDefault();

  const query = input.value.trim();
  const registry = registrySelect.value;
  if (!query) return;

  if (autocompleteVisible && activeIndex >= 0) {
    selectSuggestion(activeIndex);
    return;
  }

  try {
    const found = await exactMatch(query, registry);
    if (found) {
      navigateToPackage(query, registry);
    }
  } catch (err) {
    console.error("Exact match check error:", err);
    showError("Could not check database. Please try again.");
  }
});

input.addEventListener("keydown", (e: KeyboardEvent) => {
  if (!autocompleteVisible) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveDown();
    }
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    moveDown();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    moveUp();
  } else if (e.key === "Enter") {
    if (activeIndex >= 0 && activeIndex < autocompleteItems.length) {
      e.preventDefault();
      selectSuggestion(activeIndex);
    }
  } else if (e.key === "Escape") {
    hideAutocomplete();
    focusInput();
  }
});

autocompleteEl.addEventListener("keydown", (e: KeyboardEvent) => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>(".autocomplete-item");
  if (!target) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    moveDown();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    moveUp();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const index = parseInt(target.dataset.index ?? "", 10);
    selectSuggestion(index);
  } else if (e.key === "Escape") {
    e.preventDefault();
    hideAutocomplete();
    focusInput();
  } else if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    focusInput();
    input.select();
  }
});

form.addEventListener("keydown", (e: KeyboardEvent) => {
  if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
    if (document.activeElement !== input && document.activeElement !== registrySelect) {
      e.preventDefault();
      focusInput();
      input.select();
    }
  }
});

autocompleteEl.addEventListener("click", (e: MouseEvent) => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>(".autocomplete-item");
  if (!target) return;

  const index = parseInt(target.dataset.index ?? "", 10);
  if (index >= 0 && index < autocompleteItems.length) {
    selectSuggestion(index);
  }
});

document.addEventListener("click", (e: MouseEvent) => {
  if (!form.contains(e.target as Node)) {
    hideAutocomplete();
  }
});

registrySelect.addEventListener("change", () => {
  const query = input.value.trim();
  if (query) {
    void doAutocomplete(query, registrySelect.value);
  }
});

// ── Init ───────────────────────────────────────────────────────────

input.focus();
