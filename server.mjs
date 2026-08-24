import { createServer } from "node:http";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import path from "node:path";

const root = "/usr/share/infinite-canvas";
const dataDir = process.env.DATA_DIR || "/data";
await mkdir(dataDir, { recursive: true });
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
const keyPath = (key) => path.join(dataDir, `${Buffer.from(key, "utf8").toString("base64url")}.json`);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/health") return json(res, { ok: true });
    if (url.pathname.startsWith("/api/state/")) {
      const key = decodeURIComponent(url.pathname.slice("/api/state/".length));
      const file = keyPath(key);
      if (req.method === "GET") { try { return json(res, JSON.parse(await readFile(file, "utf8"))); } catch { res.writeHead(404); return res.end(); } }
      if (req.method === "PUT") { const body = await readBody(req); await writeFile(file, body, "utf8"); return json(res, { ok: true }); }
      if (req.method === "DELETE") { await unlink(file).catch(() => {}); res.writeHead(204); return res.end(); }
    }
    const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = path.resolve(root, `.${requested}`);
    if (!file.startsWith(root) || !existsSync(file)) return serve(path.join(root, "index.html"), res);
    return serve(file, res);
  } catch { res.writeHead(500); res.end("internal error"); }
});
server.listen(3000, "0.0.0.0");
function json(res, value) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(value)); }
function serve(file, res) { res.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream" }); createReadStream(file).pipe(res); }
function readBody(req) { return new Promise((resolve, reject) => { const chunks = []; req.on("data", (chunk) => chunks.push(chunk)); req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8"))); req.on("error", reject); }); }
