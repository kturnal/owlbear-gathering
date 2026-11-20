// A tiny local server for trying the extension before it is hosted:
//
//   node serve.mjs
//
// It serves this folder at http://localhost:5173/owlbear-gathering/ — the same sub-path a GitHub
// Pages project site uses, so manifest.json works unchanged in both places — and sends the CORS
// header Owlbear needs to read the manifest. No dependencies.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const BASE = "/owlbear-gathering/";
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, "http://localhost");
  if (!pathname.startsWith(BASE)) {
    response.writeHead(302, { Location: BASE }).end();
    return;
  }
  const relative = decodeURIComponent(pathname.slice(BASE.length)) || "index.html";
  const file = normalize(join(ROOT, relative));
  if (!file.startsWith(ROOT) || relative.split(sep).some((part) => part.startsWith("."))) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(PORT, () => {
  console.log(`Gathering: http://localhost:${PORT}${BASE}`);
  console.log(`Manifest:  http://localhost:${PORT}${BASE}manifest.json`);
});
