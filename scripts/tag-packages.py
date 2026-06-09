#!/usr/bin/env python3
"""
tag-packages.py — Add top-level tags to all package JSON files.

Reads every package JSON under docs/, assigns tags based on a curated
mapping of package names → tag list, and writes the files back.

Run:
  python3 scripts/tag-packages.py
  bun run build:content   (to regenerate indexes)
"""

import json
import os
from collections import defaultdict

DOCS_DIR = os.path.join(os.path.dirname(__file__), "..", "docs")

# ── Tag mapping ────────────────────────────────────────────────────
# Package name → list of tags. Registry prefix (npm:, packagist:) is used
# when the same short name exists in both registries.

PACKAGE_TAGS: dict[str, list[str]] = {
    # ── npm packages ───────────────────────────────────────────────
    # Web frameworks
    "express": ["framework", "http-server"],
    "fastify": ["micro-framework", "http-server"],
    "hono": ["micro-framework", "http-server"],
    "koa": ["micro-framework", "http-server"],
    "h3": ["micro-framework", "http-server"],
    "@hapi/hapi": ["framework", "http-server"],
    "@nestjs/core": ["framework", "http-server"],
    "@tinyhttp/app": ["micro-framework", "http-server"],
    "actionhero": ["framework", "http-server", "real-time"],
    "derby": ["framework", "real-time"],
    "feathers": ["framework", "real-time"],
    "loopback": ["framework", "http-server"],
    "micro": ["micro-framework", "http-server"],
    "moleculer": ["framework", "microservices"],
    "next": ["framework", "react", "build-tool"],
    "nodal": ["framework", "http-server"],
    "polka": ["micro-framework", "http-server"],
    "restana": ["micro-framework", "http-server"],
    "restify": ["http-server", "api-server"],
    "sails": ["framework", "http-server"],
    "seneca": ["framework", "microservices"],
    "thinkjs": ["framework", "http-server"],
    "total.js": ["framework", "http-server"],
    "elysia": ["micro-framework", "http-server"],
    "hyper-express": ["micro-framework", "http-server"],
    "itty-router": ["micro-framework", "http-server"],
    "uwebsockets.js": ["http-server", "real-time"],
    "@adonisjs/core": ["framework", "http-server"],
    "nitropack": ["micro-framework", "http-server", "build-tool"],
    "connect": ["http-server"],
    "body-parser": ["http-server"],
    "cookie": ["http-server"],
    "path-to-regexp": ["http-server", "utility"],
    "qs": ["http-server", "utility"],
    "mime": ["http-server", "utility"],
    "mime-types": ["http-server", "utility"],

    # HTTP clients
    "axios": ["http-client"],
    "node-fetch": ["http-client"],
    "https-proxy-agent": ["http-client"],
    "form-data": ["http-client"],
    "undici-types": ["http-client"],

    # WebSockets / real-time
    "ws": ["real-time"],
    "eventemitter3": ["events"],
    "events": ["events"],

    # Utilities
    "lodash": ["utility"],
    "async": ["async", "utility"],
    "bluebird": ["async", "promise"],
    "chalk": ["cli", "utility"],
    "picocolors": ["cli", "utility"],
    "ora": ["cli"],
    "ms": ["utility"],
    "debug": ["dev-tool", "utility"],
    "deepmerge": ["utility"],
    "dotenv": ["utility", "deployment"],
    "cross-spawn": ["process"],
    "execa": ["process"],
    "open": ["utility"],
    "signal-exit": ["process"],
    "which": ["process"],
    "slash": ["utility"],
    "pify": ["async"],
    "uuid": ["utility"],
    "nanoid": ["utility"],
    "semver": ["utility"],
    "lru-cache": ["cache"],
    "json5": ["parser", "utility"],
    "jsonfile": ["file-system", "utility"],
    "yaml": ["parser"],
    "js-yaml": ["parser"],
    "inherits": ["polyfill", "utility"],
    "object-assign": ["polyfill"],
    "prop-types": ["type-system", "react"],
    "kind-of": ["utility"],
    "brace-expansion": ["utility"],
    "ansi-regex": ["string", "cli"],
    "strip-ansi": ["string", "cli"],
    "wrap-ansi": ["string", "cli"],
    "string-width": ["string", "cli"],
    "emoji-regex": ["string", "cli"],
    "is-fullwidth-code-point": ["string", "cli"],
    "escape-string-regexp": ["string", "utility"],
    "is-number": ["utility"],
    "has-flag": ["cli", "utility"],
    "is-stream": ["utility"],
    "isarray": ["polyfill", "utility"],
    "safe-buffer": ["polyfill", "utility"],
    "iconv-lite": ["utility"],
    "through2": ["stream"],
    "get-stream": ["stream"],
    "readable-stream": ["stream"],
    "string_decoder": ["stream"],
    "buffer": ["polyfill", "stream"],

    # CLI
    "commander": ["cli"],
    "yargs": ["cli"],
    "yargs-parser": ["cli"],
    "arg": ["cli"],
    "argparse": ["cli"],
    "minimist": ["cli"],
    "camelcase": ["cli", "utility"],
    "find-up": ["file-system", "cli"],
    "locate-path": ["file-system", "cli"],
    "p-locate": ["async", "cli"],
    "path-exists": ["file-system", "cli"],
    "resolve-from": ["utility"],
    "resolve": ["build-tool", "utility"],

    # Build / Bundler
    "webpack": ["build-tool"],
    "rollup": ["build-tool"],
    "browserslist": ["build-tool"],
    "core-js": ["polyfill", "build-tool"],
    "source-map": ["build-tool", "utility"],
    "source-map-support": ["dev-tool", "build-tool"],
    "ts-node": ["type-system", "build-tool"],
    "tslib": ["type-system", "utility"],
    "typescript": ["type-system", "build-tool"],
    "rimraf": ["file-system", "cli"],

    # Parsers
    "acorn": ["parser"],
    "acorn-walk": ["parser"],
    "@babel/core": ["parser", "build-tool"],
    "@babel/parser": ["parser"],
    "@babel/preset-env": ["build-tool"],
    "@babel/runtime": ["build-tool", "polyfill"],
    "@babel/types": ["parser", "type-system"],
    "js-tokens": ["parser", "utility"],

    # Linters / Formatters
    "eslint": ["linter", "build-tool"],
    "@typescript-eslint/eslint-plugin": ["linter", "type-system"],
    "@typescript-eslint/parser": ["linter", "parser", "type-system"],
    "eslint-plugin-import": ["linter"],
    "eslint-plugin-react": ["linter", "react"],
    "prettier": ["formatter", "build-tool"],

    # React ecosystem
    "react": ["react", "framework"],
    "react-dom": ["react"],
    "react-is": ["react", "utility"],

    # Date
    "moment": ["date"],
    "dayjs": ["date", "utility"],
    "date-fns": ["date", "utility"],

    # Template
    "ejs": ["template"],

    # Validation
    "ajv": ["validation"],

    # Filesystem
    "fs-extra": ["file-system", "utility"],
    "graceful-fs": ["file-system", "utility"],
    "mkdirp": ["file-system", "cli"],
    "fast-glob": ["glob", "file-system"],
    "glob": ["glob", "file-system"],
    "globby": ["glob", "file-system"],
    "glob-parent": ["glob", "utility"],
    "micromatch": ["glob", "utility"],
    "minimatch": ["glob", "utility"],
    "picomatch": ["glob", "utility"],

    # JSON / data
    "diff": ["utility"],
    "jsonwebtoken": ["security", "auth"],

    # Type system
    "@types/node": ["type-system"],
    "type-fest": ["type-system", "utility"],
    "@mateffy/sandkasten": ["utility", "dev-tool"],

    # Misc npm
    "prettier": ["formatter", "build-tool"],

    # ── Packagist packages ─────────────────────────────────────────
    # Laravel Framework (illuminate/*)
    "illuminate/auth": ["auth", "framework"],
    "illuminate/bus": ["queue", "framework"],
    "illuminate/cache": ["cache", "framework"],
    "illuminate/collections": ["utility", "framework"],
    "illuminate/console": ["cli", "framework"],
    "illuminate/container": ["utility", "framework"],
    "illuminate/contracts": ["utility", "framework"],
    "illuminate/database": ["database", "framework"],
    "illuminate/events": ["events", "framework"],
    "illuminate/filesystem": ["file-system", "framework"],
    "illuminate/hashing": ["security", "framework"],
    "illuminate/http": ["http-server", "framework"],
    "illuminate/mail": ["mail", "framework"],
    "illuminate/pagination": ["database", "framework"],
    "illuminate/queue": ["queue", "framework"],
    "illuminate/routing": ["http-server", "framework"],
    "illuminate/session": ["http-server", "framework"],
    "illuminate/support": ["utility", "framework"],
    "illuminate/validation": ["validation", "framework"],
    "illuminate/view": ["template", "framework"],

    # Laravel first-party apps & services
    "laravel/breeze": ["scaffolding", "auth"],
    "laravel/cashier": ["payment"],
    "laravel/dusk": ["testing"],
    "laravel/echo": ["real-time"],
    "laravel/envoy": ["deployment", "cli"],
    "laravel/fortify": ["auth"],
    "laravel/framework": ["framework"],
    "laravel/horizon": ["queue", "monitoring"],
    "laravel/jetstream": ["scaffolding", "auth"],
    "laravel/octane": ["deployment", "http-server"],
    "laravel/passport": ["auth"],
    "laravel/pint": ["cli", "formatter"],
    "laravel/prompts": ["cli"],
    "laravel/pulse": ["monitoring"],
    "laravel/reverb": ["real-time"],
    "laravel/sail": ["deployment"],
    "laravel/sanctum": ["auth"],
    "laravel/scout": ["search"],
    "laravel/serializable-closure": ["utility"],
    "laravel/slack-notification-channel": ["mail"],
    "laravel/socialite": ["auth"],
    "laravel/telescope": ["dev-tool", "monitoring"],
    "laravel/tinker": ["repl", "cli"],
    "laravel/ui": ["scaffolding"],
    "laravel/valet": ["deployment"],

    # Spatie packages
    "spatie/laravel-activitylog": ["monitoring", "audit"],
    "spatie/laravel-analytics": ["monitoring", "analytics"],
    "spatie/laravel-backup": ["deployment", "file-system"],
    "spatie/laravel-csp": ["security"],
    "spatie/laravel-data": ["validation", "type-system"],
    "spatie/laravel-failed-job-monitor": ["queue", "monitoring"],
    "spatie/laravel-health": ["monitoring"],
    "spatie/laravel-html": ["template", "utility"],
    "spatie/laravel-ignition": ["dev-tool"],
    "spatie/laravel-markdown": ["template"],
    "spatie/laravel-medialibrary": ["media", "file-system"],
    "spatie/laravel-model-info": ["dev-tool", "database"],
    "spatie/laravel-model-states": ["database", "type-system"],
    "spatie/laravel-multitenancy": ["database", "deployment"],
    "spatie/laravel-package-tools": ["dev-tool"],
    "spatie/laravel-pdf": ["media"],
    "spatie/laravel-permission": ["auth"],
    "spatie/laravel-query-builder": ["database"],
    "spatie/laravel-queueable-action": ["queue"],
    "spatie/laravel-ray": ["dev-tool"],
    "spatie/laravel-responsecache": ["cache"],
    "spatie/laravel-settings": ["utility"],
    "spatie/laravel-site-search": ["search"],
    "spatie/laravel-sitemap": ["seo"],
    "spatie/laravel-sluggable": ["utility"],
    "spatie/laravel-tags": ["utility"],
    "spatie/laravel-translatable": ["localization"],
    "spatie/laravel-typescript-transformer": ["type-system", "build-tool"],
    "spatie/laravel-uptime-monitor": ["monitoring"],
    "spatie/browsershot": ["media"],
    "spatie/simple-excel": ["file-system", "utility"],

    # Other Packagist
    "barryvdh/laravel-debugbar": ["dev-tool"],
    "barryvdh/laravel-ide-helper": ["dev-tool"],
    "beyondcode/laravel-dump-server": ["dev-tool"],
    "beyondcode/laravel-query-detector": ["dev-tool", "database"],
    "beyondcode/laravel-websockets": ["real-time"],
    "fakerphp/faker": ["testing"],
    "filament/filament": ["framework", "scaffolding"],
    "fruitcake/laravel-cors": ["security"],
    "inertiajs/inertia-laravel": ["framework", "react"],
    "intervention/image": ["media"],
    "intervention/image-laravel": ["media"],
    "larastan/larastan": ["dev-tool", "type-system"],
    "league/commonmark": ["parser", "template"],
    "league/flysystem": ["file-system"],
    "league/glide": ["media"],
    "livewire/livewire": ["framework", "micro-framework"],
    "maatwebsite/excel": ["file-system", "utility"],
    "nesbot/carbon": ["date"],
    "nunomaduro/collision": ["dev-tool", "cli"],
    "ramsey/uuid": ["utility"],
    "sentry/sentry-laravel": ["monitoring"],
    "tightenco/jigsaw": ["build-tool", "scaffolding"],
    "tightenco/ziggy": ["http-server", "utility"],
    "tymon/jwt-auth": ["auth", "security"],
}

# ── Apply tags ─────────────────────────────────────────────────────
def main():
    stats = defaultdict(lambda: {"updated": 0, "skipped": 0, "errors": 0})

    for root, dirs, files in os.walk(DOCS_DIR):
        dirs[:] = [d for d in dirs if d not in (
            "node_modules", ".git", "index", "tags", "db", ".well-known", "dist",
        )]
        for fname in files:
            if not fname.endswith(".json") or fname == "schema.json":
                continue

            path = os.path.join(root, fname)
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
            except (json.JSONDecodeError, OSError) as e:
                print(f"✗  Failed to read {path}: {e}")
                continue

            if not isinstance(data, dict) or "name" not in data or "registry" not in data:
                continue

            name = data["name"]
            registry = data["registry"]
            key = f"{registry}/{name}"

            # Look up tags
            tags = PACKAGE_TAGS.get(name, [])
            if not tags:
                stats[key]["skipped"] += 1
                print(f"  ~  {name:50s}  (no tags mapped)")
                continue

            # Check if already present
            existing = data.get("tags", [])
            if existing == tags:
                stats[key]["skipped"] += 1
                continue

            data["tags"] = tags
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2, ensure_ascii=False)
                fh.write("\n")

            stats[key]["updated"] += 1
            print(f"  ✓  {name:50s}  {tags}")

    # Summary
    updated = sum(1 for v in stats.values() if v["updated"] > 0)
    skipped = sum(1 for v in stats.values() if v["skipped"] > 0)
    print(f"\nDone — {updated} packages tagged, {skipped} packages without tags")

if __name__ == "__main__":
    main()
