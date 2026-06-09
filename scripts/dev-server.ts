/**
 * dev-server.ts – Static file server with HTTP Range support for local testing.
 *
 * sql.js-httpvfs requires Accept-Ranges: bytes to fetch SQLite pages on demand.
 * Python's SimpleHTTPServer does NOT support this, so we use Bun's native HTTP server.
 *
 * Usage:  bun run scripts/dev-server.ts [port=8000]
 */

import { serve, type Server } from "bun";
import { existsSync, statSync, createReadStream } from "node:fs";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(scriptDir, "..", "docs");
const PORT = Number(process.argv[2]) || 8000;

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".css": "text/css",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".sqlite": "application/octet-stream",
};

function mimeType(path: string): string {
  return MIME[extname(path)] || "application/octet-stream";
}

function parseRange(rangeHeader: string, totalSize: number): { start: number; end: number } | null {
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : totalSize - 1;
  if (start > end || start >= totalSize) return null;
  return { start, end: Math.min(end, totalSize - 1) };
}

const server: Server = serve({
  port: PORT,
  fetch(req: Request): Response | Promise<Response> {
    const url = new URL(req.url);

    // Override DB config to always use the local file in dev.
    // Production config.json points at R2; here we redirect to the
    // local copy served by this same server (with proper Range support).
    if (url.pathname === "/db/config.json") {
      return new Response(
        JSON.stringify({ serverMode: "full", requestChunkSize: 4096, url: "/db/full.sqlite3" }),
        { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
      );
    }

    let filePath = join(ROOT, decodeURIComponent(url.pathname));

    // Directory → index.html
    if (!extname(filePath)) {
      filePath = join(filePath, "index.html");
    }

    if (!existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }

    const stats = statSync(filePath);
    const totalSize = stats.size;
    const rangeHeader = req.headers.get("range");
    const contentType = mimeType(filePath);

    if (rangeHeader) {
      const range = parseRange(rangeHeader, totalSize);
      if (!range) {
        return new Response("Range Not Satisfiable", { status: 416 });
      }

      const { start, end } = range;
      const length = end - start + 1;

      // Stream the requested byte range
      const stream = new ReadableStream({
        start(controller) {
          const fileStream = createReadStream(filePath, { start, end });
          fileStream.on("data", (chunk: Buffer) => controller.enqueue(chunk));
          fileStream.on("end", () => controller.close());
          fileStream.on("error", (err: Error) => controller.error(err));
        },
      });

      return new Response(stream, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(length),
          "Content-Range": `bytes ${start}-${end}/${totalSize}`,
          "Accept-Ranges": "bytes",
        },
      });
    }

    // Full-file response
    const file = Bun.file(filePath);
    return new Response(file, {
      headers: {
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
      },
    });
  },
});

console.log(`🚀  Dev server running at http://localhost:${PORT}/`);
console.log(`    Serving: ${ROOT}`);
console.log(`    Range requests: supported (required for sql.js-httpvfs)`);
