/**
 * search-app.ts – Homepage search with SQLite-powered autocomplete.
 *
 * Bundled with `bun build`, loaded from docs/index.html.
 * Uses sql.js-httpvfs to query package names on-demand.
 *
 * Features:
 *   - Autocomplete as you type (~5 suggestions from SQLite)
 *   - Arrow-key navigation in dropdown with ARIA support
 *   - Enter redirects to the static detail page on exact match
 *   - Click on suggestion fills input and triggers navigation
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

// ── Race-condition guard ──────────────────────────────────────────

let searchSeq = 0;

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
    <h2 class="font-semibold">
      Search for up-to-date documentation sources for a given
      open-source package.
    </h2>
    <p>
      The URLs are manually curated for accuracy, quality and
      relevance. You can also contribute to the library by
      submitting new URLs or reporting broken links by opening
      a GitHub PR.
    </p>
    <h2 class="font-semibold mt-10">
      Static analysis of source code suggests relevant
      documentation based on your code.
    </h2>
    <p>
      By analyzing your source code, we can suggest relevant
      documentation that matches the libraries and frameworks
      you are using. This allows you to quickly find the
      information you need without having to manually search
      for it.
    </p>
  `;
}

function showError(message: string): void {
  resultsEl.innerHTML = `
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

interface DbHandle {
  exec(sql: string, params?: Record<string, unknown> | unknown[]): Promise<QueryResult[]>;
}

let dbPromise: Promise<DbHandle> | null = null;

async function getDb(): Promise<DbHandle> {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const workerUrl = new URL(
      "/dist/sqlite.worker.js?v=2",
      window.location.origin,
    ).toString();
    const wasmUrl = new URL(
      "/dist/sql-wasm.wasm?v=2",
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

/** Query up to 5 package names matching the pattern for the given registry.
 *  Ranking (best first):
 *    0 = exact match (case-insensitive)
 *    1 = starts with pattern + word separator (- / . _)
 *    2 = starts with pattern (any continuation)
 *    3 = contains pattern preceded by word separator or @
 *    4 = contains pattern anywhere
 *  Within each rank, shorter names come first.
 */
async function queryAutocomplete(
  pattern: string,
  registry: string,
): Promise<string[]> {
  const db = await getDb();

  const result = await db.exec(
    `SELECT name
     FROM packages
     WHERE registry = $registry
       AND instr(lower(name), lower($pattern)) > 0
     ORDER BY
       CASE
         WHEN lower(name) = lower($pattern) THEN 0
         WHEN instr(lower(name), lower($pattern) || '-') = 1
           OR instr(lower(name), lower($pattern) || '/') = 1
           OR instr(lower(name), lower($pattern) || '.') = 1
           OR instr(lower(name), lower($pattern) || '_') = 1
           THEN 1
         WHEN instr(lower(name), lower($pattern)) = 1 THEN 2
         WHEN instr(lower(name), '-' || lower($pattern)) > 0
           OR instr(lower(name), '/' || lower($pattern)) > 0
           OR instr(lower(name), '.' || lower($pattern)) > 0
           OR instr(lower(name), '_' || lower($pattern)) > 0
           OR instr(lower(name), '@' || lower($pattern)) > 0
           THEN 3
         ELSE 4
       END ASC,
       length(name) ASC
     LIMIT 5`,
    { $registry: registry, $pattern: pattern },
  );

  const rows = result?.[0]?.values ?? [];
  return rows.map((r: unknown[]) => r[0] as string);
}

/** Check if an exact package exists. */
async function exactMatch(
  name: string,
  registry: string,
): Promise<boolean> {
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

/** Navigate to the static detail page for a package. */
function navigateToPackage(name: string, registry: string): void {
  window.location.href = packageUrl(name, registry);
}

/** Select a suggestion: fill input, hide dropdown, navigate. */
function selectSuggestion(index: number): void {
  if (index < 0 || index >= autocompleteItems.length) return;
  const selected = autocompleteItems[index];
  input.value = selected;
  hideAutocomplete();
  navigateToPackage(selected, registrySelect.value);
}

// ── Autocomplete search ───────────────────────────────────────────

async function doAutocomplete(query: string, registry: string): Promise<void> {
  if (!query.trim()) {
    hideAutocomplete();
    return;
  }

  const seq = ++searchSeq;

  try {
    const suggestions = await queryAutocomplete(query.trim(), registry);

    if (seq !== searchSeq) return;

    if (suggestions.length > 0 && document.activeElement === input) {
      showAutocomplete(suggestions);
    } else {
      hideAutocomplete();
    }
  } catch {
    if (seq !== searchSeq) return;
    hideAutocomplete();
  }
}

// ── Keyboard helpers ──────────────────────────────────────────────

/** Return focus to the input and clear any dropdown highlight. */
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

/** Move highlight down; wraps from last item back to input. */
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

/** Move highlight up; from first item returns to input. */
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

// ── Event handlers ────────────────────────────────────────────────

// Input typing — only trigger autocomplete
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

// Form submit — exact match check, redirect or nothing
form.addEventListener("submit", async (e: Event) => {
  e.preventDefault();

  const query = input.value.trim();
  const registry = registrySelect.value;
  if (!query) return;

  // If autocomplete is active and an item is highlighted, navigate there
  if (autocompleteVisible && activeIndex >= 0) {
    selectSuggestion(activeIndex);
    return;
  }

  // Otherwise check for exact match in DB
  try {
    const found = await exactMatch(query, registry);
    if (found) {
      navigateToPackage(query, registry);
    }
    // No match → do nothing (no error state, no redirect)
  } catch (err) {
    console.error("Exact match check error:", err);
    showError("Could not check database. Please try again.");
  }
});

// Input keydown — arrow navigation when dropdown is open
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
    // If no active selection, let form submit handle it (exact match)
  } else if (e.key === "Escape") {
    hideAutocomplete();
    focusInput();
  }
});

// Suggestion-button keydown (delegated on autocomplete container)
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
    // Ctrl+A / Cmd+A from a suggestion → focus input & select all
    e.preventDefault();
    focusInput();
    input.select();
  }
});

// Global: Ctrl+A / Cmd+A when any non-input inside the form is focused
form.addEventListener("keydown", (e: KeyboardEvent) => {
  if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
    if (document.activeElement !== input && document.activeElement !== registrySelect) {
      e.preventDefault();
      focusInput();
      input.select();
    }
  }
});

// Click-to-select on autocomplete items (delegated)
autocompleteEl.addEventListener("click", (e: MouseEvent) => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>(".autocomplete-item");
  if (!target) return;

  const index = parseInt(target.dataset.index ?? "", 10);
  if (index >= 0 && index < autocompleteItems.length) {
    selectSuggestion(index);
  }
});

// Hide autocomplete when clicking outside
document.addEventListener("click", (e: MouseEvent) => {
  if (!form.contains(e.target as Node)) {
    hideAutocomplete();
  }
});

// Registry change — if there's a query, refresh autocomplete
registrySelect.addEventListener("change", () => {
  const query = input.value.trim();
  if (query) {
    void doAutocomplete(query, registrySelect.value);
  }
});

// ── Init ───────────────────────────────────────────────────────────

input.focus();
