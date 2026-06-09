/**
 * search-app.ts – Browser entry point for WASM SQLite-powered search.
 *
 * Bundled with `bun build`, loaded from docs/test.html.
 * Uses sql.js-httpvfs to query the full.sqlite database on-demand
 * via HTTP Range requests (only the pages needed for each query
 * are fetched from the server).
 *
 * Features:
 *   - Search on every keystroke (no debounce)
 *   - Autocomplete dropdown with matching package names
 *   - Race-condition free: later searches always win
 *   - Keyboard navigation in autocomplete list
 */

import { createDbWorker, type WorkerHttpvfs } from "sql.js-httpvfs";

// ── Types ──────────────────────────────────────────────────────────

interface QueryResult {
  columns: string[];
  values: unknown[][];
}

interface ResultDoc {
  url: string;
  title: string;
  description: string | null;
  kind: string | null;
  tags: string[];
}

interface ResultData {
  name: string;
  registry: string;
  updatedAt: string;
  readme: string | null;
  docs: ResultDoc[];
}

// ── DOM refs ───────────────────────────────────────────────────────

const form = document.querySelector<HTMLFormElement>("#search-form")!;
const input = form.querySelector<HTMLInputElement>('input[type="search"]')!;
const registrySelect = document.querySelector<HTMLSelectElement>("#registry-select")!;
const resultsEl = document.querySelector<HTMLDivElement>("#results")!;
const autocompleteEl = document.querySelector<HTMLDivElement>("#autocomplete-list")!;

// ── Race-condition guard ──────────────────────────────────────────

let searchSeq = 0; // incremented before each new search

// ── Helpers ───────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function kindBadge(kind: string | null): string {
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
}

function renderTag(tag: string): string {
  return `<span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-zinc-100 border border-zinc-200 text-zinc-600">${escapeHtml(tag)}</span>`;
}

function renderDoc(doc: ResultDoc): string {
  return `
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
}

function setLoading(isLoading: boolean): void {
  if (isLoading) {
    resultsEl.innerHTML = `
      <div class="flex items-center gap-3 text-zinc-500 py-8">
        <svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span class="text-base">Looking up documentation…</span>
      </div>
    `;
  }
}

function showError(message: string, submessage = ""): void {
  resultsEl.innerHTML = `
    <div class="border border-red-200 bg-white p-6">
      <div class="flex items-start gap-3">
        <svg class="w-5 h-5 text-red-500 mt-0.5 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
        </svg>
        <div>
          <p class="font-semibold text-gray-800">${escapeHtml(message)}</p>
          ${submessage ? `<p class="mt-1 text-zinc-500">${escapeHtml(submessage)}</p>` : ""}
        </div>
      </div>
    </div>
  `;
}

function showNotFound(query: string, registry: string): void {
  resultsEl.innerHTML = `
    <div class="border border-zinc-200 bg-white p-6">
      <div class="flex items-start gap-3">
        <svg class="w-5 h-5 text-zinc-400 mt-0.5 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
        </svg>
        <div>
          <p class="font-semibold text-gray-800">No documentation found</p>
          <p class="mt-1 text-zinc-500">
            We don't have a curated entry for <code class="bg-zinc-100 px-1 py-0.5 text-xs border border-zinc-200">${escapeHtml(query)}</code> on ${escapeHtml(registry)} yet.
          </p>
          <p class="mt-3 text-zinc-500">
            <a href="https://github.com/mateffy/handbuch" target="_blank" class="underline hover:opacity-75">Open a PR on GitHub</a> to add it.
          </p>
        </div>
      </div>
    </div>
  `;
}

function renderResult(data: ResultData): void {
  const readmeLink = data.readme
    ? `<a href="${escapeHtml(data.readme)}" target="_blank" class="underline hover:opacity-75 text-zinc-500">README</a>`
    : "";

  const metaItems = [
    `<span class="text-zinc-500">${escapeHtml(data.registry.toUpperCase())}</span>`,
    readmeLink,
    `<span class="text-zinc-400">updated ${new Date(data.updatedAt).toLocaleDateString()}</span>`,
  ].filter(Boolean);

  resultsEl.innerHTML = `
    <div class="mb-8">
      <h2 class="text-2xl font-display font-bold text-gray-800 mb-1">${escapeHtml(data.name)}</h2>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        ${metaItems.join('<span class="text-zinc-300">·</span>')}
      </div>
    </div>
    <div class="space-y-3">
      ${data.docs.map(renderDoc).join("")}
    </div>
  `;
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
      "/dist/sqlite.worker.js",
      window.location.origin,
    ).toString();
    const wasmUrl = new URL(
      "/dist/sql-wasm.wasm",
      window.location.origin,
    ).toString();

    const worker: WorkerHttpvfs = await createDbWorker(
      [
        {
          from: "inline",
          config: {
            serverMode: "full" as const,
            requestChunkSize: 4096,
            url: "/db/full.sqlite",
          },
        },
      ],
      workerUrl,
      wasmUrl,
    );

    // The Comlink proxy types are incomplete — exec() works at runtime
    // so we bridge through a minimal typed wrapper.
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

async function queryAutocomplete(
  pattern: string,
  registry: string,
): Promise<string[]> {
  const db = await getDb();

  const result = await db.exec(
    "SELECT name FROM packages WHERE registry = $registry AND name LIKE $pattern ORDER BY name LIMIT 10",
    { $registry: registry, $pattern: `%${pattern}%` },
  );

  const rows = result?.[0]?.values ?? [];
  return rows.map((r: unknown[]) => r[0] as string);
}

async function searchPackage(
  name: string,
  registry: string,
): Promise<ResultData | null> {
  const db = await getDb();

  // Query the package
  const pkgResult = (await db.exec(
    "SELECT name, registry, updated_at, readme FROM packages WHERE name = $name AND registry = $registry",
    { $name: name, $registry: registry },
  ))?.[0];

  if (!pkgResult || pkgResult.values.length === 0) {
    return null;
  }

  const pRow = pkgResult.values[0];

  // Query the docs with their tags
  const docsResult = await db.exec(
    `SELECT d.id, d.url, d.title, d.description, d.kind, d.sort_order,
            GROUP_CONCAT(t.name, ',') AS tags
     FROM docs d
     LEFT JOIN doc_tags dt ON dt.doc_id = d.id
     LEFT JOIN tags t ON t.id = dt.tag_id
     WHERE d.package_id = (SELECT id FROM packages WHERE name = $name)
     GROUP BY d.id
     ORDER BY d.sort_order`,
    { $name: name },
  );

  const docs: ResultDoc[] = (docsResult?.[0]?.values ?? []).map(
    (row: unknown[]) => ({
      url: row[1] as string,
      title: row[2] as string,
      description: (row[3] as string) ?? null,
      kind: (row[4] as string) ?? null,
      tags: row[6]
        ? (row[6] as string).split(",").filter(Boolean)
        : [],
    }),
  );

  return {
    name: pRow[0] as string,
    registry: pRow[1] as string,
    updatedAt: pRow[2] as string,
    readme: (pRow[3] as string) ?? null,
    docs,
  };
}

// ── Autocomplete UI ───────────────────────────────────────────────

let activeIndex = -1;
let autocompleteItems: string[] = [];

function hideAutocomplete(): void {
  autocompleteEl.classList.add("hidden");
  activeIndex = -1;
  autocompleteItems = [];
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
        `<button type="button" data-index="${i}" class="block w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none autocomplete-item" tabindex="-1">${escapeHtml(name)}</button>`,
    )
    .join("");
  autocompleteEl.classList.remove("hidden");
}

function highlightAutocompleteItem(index: number): void {
  const buttons = autocompleteEl.querySelectorAll<HTMLButtonElement>(".autocomplete-item");
  buttons.forEach((btn, i) => {
    if (i === index) {
      btn.classList.add("bg-zinc-100");
      btn.focus();
    } else {
      btn.classList.remove("bg-zinc-100");
    }
  });
  activeIndex = index;
}

// ── Search (with race-condition guard) ────────────────────────────

async function doSearch(query: string, registry: string): Promise<void> {
  const seq = ++searchSeq;

  setLoading(true);
  hideAutocomplete();

  try {
    const result = await searchPackage(query, registry);

    // Discard if a newer search was started
    if (seq !== searchSeq) return;

    if (!result) {
      showNotFound(query, registry);
      return;
    }

    renderResult(result);
  } catch (err) {
    if (seq !== searchSeq) return;
    console.error("Search error:", err);
    showError(
      "Query error",
      err instanceof Error ? err.message : "Something went wrong querying the database.",
    );
  }
}

async function doAutocomplete(query: string, registry: string): Promise<void> {
  if (!query.trim()) {
    hideAutocomplete();
    return;
  }

  const seq = ++searchSeq;
  // small optimisation — don't show autocomplete while results are visible
  // unless the user is still typing

  try {
    const suggestions = await queryAutocomplete(query.trim(), registry);

    // Discard if a newer action has superseded this one
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

// ── Event handlers ────────────────────────────────────────────────

// Search on keystroke — no debounce, every keystroke triggers a search.
// We use the same searchSeq counter for both autocomplete and full search,
// so if a newer keystroke happens, older in-flight results are discarded.
input.addEventListener("input", () => {
  const query = input.value.trim();
  const registry = registrySelect.value;

  if (!query) {
    // Clear search — restore default content
    hideAutocomplete();
    restoreDefault();
    // Increment counter to cancel any in-flight searches
    ++searchSeq;
    return;
  }

  // Start autocomplete and full search in parallel.
  // Both increment searchSeq which guards against stale results.
  void doAutocomplete(query, registry);
  void doSearch(query, registry);
});

// Form submit — if autocomplete item is active, use that; otherwise search current query
form.addEventListener("submit", (e: Event) => {
  e.preventDefault();

  const query = input.value.trim();
  const registry = registrySelect.value;
  if (!query) return;

  hideAutocomplete();
  void doSearch(query, registry);
});

// Keyboard navigation for autocomplete
input.addEventListener("keydown", (e: KeyboardEvent) => {
  if (autocompleteEl.classList.contains("hidden")) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    const next = activeIndex < autocompleteItems.length - 1 ? activeIndex + 1 : 0;
    highlightAutocompleteItem(next);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    const prev = activeIndex > 0 ? activeIndex - 1 : autocompleteItems.length - 1;
    highlightAutocompleteItem(prev);
  } else if (e.key === "Enter") {
    if (activeIndex >= 0 && activeIndex < autocompleteItems.length) {
      e.preventDefault();
      const selected = autocompleteItems[activeIndex];
      input.value = selected;
      hideAutocomplete();
      void doSearch(selected, registrySelect.value);
    }
  } else if (e.key === "Escape") {
    hideAutocomplete();
  }
});

// Click-to-select on autocomplete items (delegated)
autocompleteEl.addEventListener("click", (e: MouseEvent) => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>(".autocomplete-item");
  if (!target) return;

  const index = parseInt(target.dataset.index ?? "", 10);
  if (index >= 0 && index < autocompleteItems.length) {
    const selected = autocompleteItems[index];
    input.value = selected;
    hideAutocomplete();
    void doSearch(selected, registrySelect.value);
  }
});

// Hide autocomplete when clicking outside
document.addEventListener("click", (e: MouseEvent) => {
  if (!form.contains(e.target as Node)) {
    hideAutocomplete();
  }
});

// Registry change — if there's a query, re-search
registrySelect.addEventListener("change", () => {
  const query = input.value.trim();
  if (query) {
    void doSearch(query, registrySelect.value);
  }
});
