var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// node_modules/sql.js-httpvfs/dist/index.js
var require_dist = __commonJS((exports, module) => {
  (function(e, t) {
    if (typeof exports == "object" && typeof module == "object")
      module.exports = t();
    else if (typeof define == "function" && define.amd)
      define([], t);
    else {
      var n = t();
      for (var r in n)
        (typeof exports == "object" ? exports : e)[r] = n[r];
    }
  })(exports, function() {
    return (() => {
      var e = { 870: (e2, t2, n2) => {
        n2.r(t2), n2.d(t2, { createEndpoint: () => o, expose: () => l, proxy: () => v, proxyMarker: () => r, releaseProxy: () => a, transfer: () => y, transferHandlers: () => c, windowEndpoint: () => g, wrap: () => f });
        const r = Symbol("Comlink.proxy"), o = Symbol("Comlink.endpoint"), a = Symbol("Comlink.releaseProxy"), i = Symbol("Comlink.thrown"), s = (e3) => typeof e3 == "object" && e3 !== null || typeof e3 == "function", c = new Map([["proxy", { canHandle: (e3) => s(e3) && e3[r], serialize(e3) {
          const { port1: t3, port2: n3 } = new MessageChannel;
          return l(e3, t3), [n3, [n3]];
        }, deserialize: (e3) => (e3.start(), f(e3)) }], ["throw", { canHandle: (e3) => s(e3) && (i in e3), serialize({ value: e3 }) {
          let t3;
          return t3 = e3 instanceof Error ? { isError: true, value: { message: e3.message, name: e3.name, stack: e3.stack } } : { isError: false, value: e3 }, [t3, []];
        }, deserialize(e3) {
          if (e3.isError)
            throw Object.assign(new Error(e3.value.message), e3.value);
          throw e3.value;
        } }]]);
        function l(e3, t3 = self) {
          t3.addEventListener("message", function n3(r2) {
            if (!r2 || !r2.data)
              return;
            const { id: o2, type: a2, path: s2 } = Object.assign({ path: [] }, r2.data), c2 = (r2.data.argumentList || []).map(w);
            let f2;
            try {
              const t4 = s2.slice(0, -1).reduce((e4, t5) => e4[t5], e3), n4 = s2.reduce((e4, t5) => e4[t5], e3);
              switch (a2) {
                case 0:
                  f2 = n4;
                  break;
                case 1:
                  t4[s2.slice(-1)[0]] = w(r2.data.value), f2 = true;
                  break;
                case 2:
                  f2 = n4.apply(t4, c2);
                  break;
                case 3:
                  f2 = v(new n4(...c2));
                  break;
                case 4:
                  {
                    const { port1: t5, port2: n5 } = new MessageChannel;
                    l(e3, n5), f2 = y(t5, [t5]);
                  }
                  break;
                case 5:
                  f2 = undefined;
              }
            } catch (e4) {
              f2 = { value: e4, [i]: 0 };
            }
            Promise.resolve(f2).catch((e4) => ({ value: e4, [i]: 0 })).then((e4) => {
              const [r3, i2] = b(e4);
              t3.postMessage(Object.assign(Object.assign({}, r3), { id: o2 }), i2), a2 === 5 && (t3.removeEventListener("message", n3), u(t3));
            });
          }), t3.start && t3.start();
        }
        function u(e3) {
          (function(e4) {
            return e4.constructor.name === "MessagePort";
          })(e3) && e3.close();
        }
        function f(e3, t3) {
          return d(e3, [], t3);
        }
        function p(e3) {
          if (e3)
            throw new Error("Proxy has been released and is not useable");
        }
        function d(e3, t3 = [], n3 = function() {}) {
          let r2 = false;
          const i2 = new Proxy(n3, { get(n4, o2) {
            if (p(r2), o2 === a)
              return () => E(e3, { type: 5, path: t3.map((e4) => e4.toString()) }).then(() => {
                u(e3), r2 = true;
              });
            if (o2 === "then") {
              if (t3.length === 0)
                return { then: () => i2 };
              const n5 = E(e3, { type: 0, path: t3.map((e4) => e4.toString()) }).then(w);
              return n5.then.bind(n5);
            }
            return d(e3, [...t3, o2]);
          }, set(n4, o2, a2) {
            p(r2);
            const [i3, s2] = b(a2);
            return E(e3, { type: 1, path: [...t3, o2].map((e4) => e4.toString()), value: i3 }, s2).then(w);
          }, apply(n4, a2, i3) {
            p(r2);
            const s2 = t3[t3.length - 1];
            if (s2 === o)
              return E(e3, { type: 4 }).then(w);
            if (s2 === "bind")
              return d(e3, t3.slice(0, -1));
            const [c2, l2] = m(i3);
            return E(e3, { type: 2, path: t3.map((e4) => e4.toString()), argumentList: c2 }, l2).then(w);
          }, construct(n4, o2) {
            p(r2);
            const [a2, i3] = m(o2);
            return E(e3, { type: 3, path: t3.map((e4) => e4.toString()), argumentList: a2 }, i3).then(w);
          } });
          return i2;
        }
        function m(e3) {
          const t3 = e3.map(b);
          return [t3.map((e4) => e4[0]), (n3 = t3.map((e4) => e4[1]), Array.prototype.concat.apply([], n3))];
          var n3;
        }
        const h = new WeakMap;
        function y(e3, t3) {
          return h.set(e3, t3), e3;
        }
        function v(e3) {
          return Object.assign(e3, { [r]: true });
        }
        function g(e3, t3 = self, n3 = "*") {
          return { postMessage: (t4, r2) => e3.postMessage(t4, n3, r2), addEventListener: t3.addEventListener.bind(t3), removeEventListener: t3.removeEventListener.bind(t3) };
        }
        function b(e3) {
          for (const [t3, n3] of c)
            if (n3.canHandle(e3)) {
              const [r2, o2] = n3.serialize(e3);
              return [{ type: 3, name: t3, value: r2 }, o2];
            }
          return [{ type: 0, value: e3 }, h.get(e3) || []];
        }
        function w(e3) {
          switch (e3.type) {
            case 3:
              return c.get(e3.name).deserialize(e3.value);
            case 0:
              return e3.value;
          }
        }
        function E(e3, t3, n3) {
          return new Promise((r2) => {
            const o2 = new Array(4).fill(0).map(() => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16)).join("-");
            e3.addEventListener("message", function t4(n4) {
              n4.data && n4.data.id && n4.data.id === o2 && (e3.removeEventListener("message", t4), r2(n4.data));
            }), e3.start && e3.start(), e3.postMessage(Object.assign({ id: o2 }, t3), n3);
          });
        }
      }, 162: function(e2, t2, n2) {
        var r = this && this.__createBinding || (Object.create ? function(e3, t3, n3, r2) {
          r2 === undefined && (r2 = n3), Object.defineProperty(e3, r2, { enumerable: true, get: function() {
            return t3[n3];
          } });
        } : function(e3, t3, n3, r2) {
          r2 === undefined && (r2 = n3), e3[r2] = t3[n3];
        }), o = this && this.__setModuleDefault || (Object.create ? function(e3, t3) {
          Object.defineProperty(e3, "default", { enumerable: true, value: t3 });
        } : function(e3, t3) {
          e3.default = t3;
        }), a = this && this.__importStar || function(e3) {
          if (e3 && e3.__esModule)
            return e3;
          var t3 = {};
          if (e3 != null)
            for (var n3 in e3)
              n3 !== "default" && Object.prototype.hasOwnProperty.call(e3, n3) && r(t3, e3, n3);
          return o(t3, e3), t3;
        };
        Object.defineProperty(t2, "__esModule", { value: true }), t2.createDbWorker = undefined;
        const i = a(n2(870));
        async function s(e3) {
          if (e3.data && e3.data.action === "eval") {
            const t3 = new Int32Array(e3.data.notify, 0, 2), n3 = new Uint8Array(e3.data.notify, 8);
            let r2;
            try {
              r2 = { ok: await u(e3.data.request) };
            } catch (t4) {
              console.error("worker request error", e3.data.request, t4), r2 = { err: String(t4) };
            }
            const o2 = new TextEncoder().encode(JSON.stringify(r2));
            n3.set(o2, 0), t3[1] = o2.length, Atomics.notify(t3, 0);
          }
        }
        function c(e3) {
          if (e3.tagName === "BODY")
            return "body";
          const t3 = [];
          for (;e3.parentElement && e3.tagName !== "BODY"; ) {
            if (e3.id) {
              t3.unshift("#" + e3.id);
              break;
            }
            {
              let n3 = 1, r2 = e3;
              for (;r2.previousElementSibling; )
                r2 = r2.previousElementSibling, n3++;
              t3.unshift(e3.tagName.toLowerCase() + ":nth-child(" + n3 + ")");
            }
            e3 = e3.parentElement;
          }
          return t3.join(" > ");
        }
        function l(e3) {
          return Object.keys(e3);
        }
        async function u(e3) {
          if (console.log("dom vtable request", e3), e3.type === "select")
            return [...document.querySelectorAll(e3.selector)].map((t3) => {
              const n3 = {};
              for (const r2 of e3.columns)
                r2 === "selector" ? n3.selector = c(t3) : r2 === "parent" ? t3.parentElement && (n3.parent = t3.parentElement ? c(t3.parentElement) : null) : r2 === "idx" || (n3[r2] = t3[r2]);
              return n3;
            });
          if (e3.type === "insert") {
            if (!e3.value.parent)
              throw Error('"parent" column must be set when inserting');
            const t3 = document.querySelectorAll(e3.value.parent);
            if (t3.length === 0)
              throw Error(`Parent element ${e3.value.parent} could not be found`);
            if (t3.length > 1)
              throw Error(`Parent element ${e3.value.parent} ambiguous (${t3.length} results)`);
            const n3 = t3[0];
            if (!e3.value.tagName)
              throw Error("tagName must be set for inserting");
            const r2 = document.createElement(e3.value.tagName);
            for (const t4 of l(e3.value))
              if (e3.value[t4] !== null) {
                if (t4 === "tagName" || t4 === "parent")
                  continue;
                if (t4 === "idx" || t4 === "selector")
                  throw Error(`${t4} can't be set`);
                r2[t4] = e3.value[t4];
              }
            return n3.appendChild(r2), null;
          }
          if (e3.type === "update") {
            const t3 = document.querySelector(e3.value.selector);
            if (!t3)
              throw Error(`Element ${e3.value.selector} not found!`);
            const n3 = [];
            for (const r2 of l(e3.value)) {
              const o2 = e3.value[r2];
              if (r2 !== "parent") {
                if (r2 !== "idx" && r2 !== "selector" && o2 !== t3[r2]) {
                  if (console.log("SETTING ", r2, t3[r2], "->", o2), r2 === "tagName")
                    throw Error("can't change tagName");
                  n3.push(r2);
                }
              } else if (o2 !== c(t3.parentElement)) {
                const e4 = document.querySelectorAll(o2);
                if (e4.length !== 1)
                  throw Error(`Invalid target parent: found ${e4.length} matches`);
                e4[0].appendChild(t3);
              }
            }
            for (const r2 of n3)
              t3[r2] = e3.value[r2];
            return null;
          }
          throw Error(`unknown request ${e3.type}`);
        }
        i.transferHandlers.set("WORKERSQLPROXIES", { canHandle: (e3) => false, serialize(e3) {
          throw Error("no");
        }, deserialize: (e3) => (e3.start(), i.wrap(e3)) }), t2.createDbWorker = async function(e3, t3, n3, r2 = 1 / 0) {
          const o2 = new Worker(t3), a2 = i.wrap(o2), c2 = await a2.SplitFileHttpDatabase(n3, e3, undefined, r2);
          return o2.addEventListener("message", s), { db: c2, worker: a2, configs: e3 };
        };
      }, 432: function(e2, t2, n2) {
        var r = this && this.__createBinding || (Object.create ? function(e3, t3, n3, r2) {
          r2 === undefined && (r2 = n3), Object.defineProperty(e3, r2, { enumerable: true, get: function() {
            return t3[n3];
          } });
        } : function(e3, t3, n3, r2) {
          r2 === undefined && (r2 = n3), e3[r2] = t3[n3];
        }), o = this && this.__exportStar || function(e3, t3) {
          for (var n3 in e3)
            n3 === "default" || Object.prototype.hasOwnProperty.call(t3, n3) || r(t3, e3, n3);
        };
        Object.defineProperty(t2, "__esModule", { value: true }), o(n2(162), t2);
      } }, t = {};
      function n(r) {
        var o = t[r];
        if (o !== undefined)
          return o.exports;
        var a = t[r] = { exports: {} };
        return e[r].call(a.exports, a, a.exports, n), a.exports;
      }
      return n.d = (e2, t2) => {
        for (var r in t2)
          n.o(t2, r) && !n.o(e2, r) && Object.defineProperty(e2, r, { enumerable: true, get: t2[r] });
      }, n.o = (e2, t2) => Object.prototype.hasOwnProperty.call(e2, t2), n.r = (e2) => {
        typeof Symbol != "undefined" && Symbol.toStringTag && Object.defineProperty(e2, Symbol.toStringTag, { value: "Module" }), Object.defineProperty(e2, "__esModule", { value: true });
      }, n(432);
    })();
  });
});

// scripts/search-app.ts
var import_sql = __toESM(require_dist(), 1);
var form = document.querySelector("#search-form");
var input = form.querySelector('input[type="search"]');
var registrySelect = document.querySelector("#registry-select");
var resultsEl = document.querySelector("#results");
var autocompleteEl = document.querySelector("#autocomplete-list");
var searchSeq = 0;
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function packageUrl(name, registry) {
  return `/${encodeURIComponent(registry)}/${encodeURIComponent(name)}`;
}
function restoreDefault() {
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
function showError(message) {
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
var dbPromise = null;
async function getDb() {
  if (dbPromise)
    return dbPromise;
  dbPromise = (async () => {
    const workerUrl = new URL("/dist/sqlite.worker.js", window.location.origin).toString();
    const wasmUrl = new URL("/dist/sql-wasm.wasm", window.location.origin).toString();
    const worker = await import_sql.createDbWorker([
      {
        from: "inline",
        config: {
          serverMode: "full",
          requestChunkSize: 4096,
          url: "/db/full.sqlite"
        }
      }
    ], workerUrl, wasmUrl);
    const db = worker.db;
    return {
      exec(sql, params) {
        return db.exec(sql, params);
      }
    };
  })();
  return dbPromise;
}
async function queryAutocomplete(pattern, registry) {
  const db = await getDb();
  const result = await db.exec(`SELECT name
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
     LIMIT 5`, { $registry: registry, $pattern: pattern });
  const rows = result?.[0]?.values ?? [];
  return rows.map((r) => r[0]);
}
async function exactMatch(name, registry) {
  const db = await getDb();
  const result = await db.exec("SELECT 1 FROM packages WHERE name = $name AND registry = $registry LIMIT 1", { $name: name, $registry: registry });
  const rows = result?.[0]?.values ?? [];
  return rows.length > 0;
}
var activeIndex = -1;
var autocompleteItems = [];
var autocompleteVisible = false;
function hideAutocomplete() {
  autocompleteEl.classList.add("hidden");
  autocompleteEl.setAttribute("aria-expanded", "false");
  activeIndex = -1;
  autocompleteItems = [];
  autocompleteVisible = false;
  input.removeAttribute("aria-activedescendant");
}
function showAutocomplete(items) {
  autocompleteItems = items;
  activeIndex = -1;
  if (items.length === 0) {
    hideAutocomplete();
    return;
  }
  autocompleteEl.innerHTML = items.map((name, i) => `<button
          type="button"
          role="option"
          id="ac-option-${i}"
          data-index="${i}"
          class="block w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none autocomplete-item"
          tabindex="-1"
          aria-selected="false"
        >${escapeHtml(name)}</button>`).join("");
  autocompleteEl.classList.remove("hidden");
  autocompleteEl.setAttribute("aria-expanded", "true");
  autocompleteVisible = true;
}
function highlightItem(index) {
  const buttons = autocompleteEl.querySelectorAll(".autocomplete-item");
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
function navigateToPackage(name, registry) {
  window.location.href = packageUrl(name, registry);
}
function selectSuggestion(index) {
  if (index < 0 || index >= autocompleteItems.length)
    return;
  const selected = autocompleteItems[index];
  input.value = selected;
  hideAutocomplete();
  navigateToPackage(selected, registrySelect.value);
}
async function doAutocomplete(query, registry) {
  if (!query.trim()) {
    hideAutocomplete();
    return;
  }
  const seq = ++searchSeq;
  try {
    const suggestions = await queryAutocomplete(query.trim(), registry);
    if (seq !== searchSeq)
      return;
    if (suggestions.length > 0 && document.activeElement === input) {
      showAutocomplete(suggestions);
    } else {
      hideAutocomplete();
    }
  } catch {
    if (seq !== searchSeq)
      return;
    hideAutocomplete();
  }
}
input.addEventListener("input", () => {
  const query = input.value.trim();
  const registry = registrySelect.value;
  if (!query) {
    hideAutocomplete();
    restoreDefault();
    ++searchSeq;
    return;
  }
  doAutocomplete(query, registry);
});
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = input.value.trim();
  const registry = registrySelect.value;
  if (!query)
    return;
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
input.addEventListener("keydown", (e) => {
  if (!autocompleteVisible) {
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    const next = activeIndex < autocompleteItems.length - 1 ? activeIndex + 1 : 0;
    highlightItem(next);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    const prev = activeIndex > 0 ? activeIndex - 1 : autocompleteItems.length - 1;
    highlightItem(prev);
  } else if (e.key === "Enter") {
    if (activeIndex >= 0 && activeIndex < autocompleteItems.length) {
      e.preventDefault();
      selectSuggestion(activeIndex);
    }
  } else if (e.key === "Escape") {
    hideAutocomplete();
    input.focus();
  }
});
autocompleteEl.addEventListener("click", (e) => {
  const target = e.target.closest(".autocomplete-item");
  if (!target)
    return;
  const index = parseInt(target.dataset.index ?? "", 10);
  if (index >= 0 && index < autocompleteItems.length) {
    selectSuggestion(index);
  }
});
document.addEventListener("click", (e) => {
  if (!form.contains(e.target)) {
    hideAutocomplete();
  }
});
registrySelect.addEventListener("change", () => {
  const query = input.value.trim();
  if (query) {
    doAutocomplete(query, registrySelect.value);
  }
});
