import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import path from "node:path";

const root = "/usr/share/infinite-canvas";
const dataDir = process.env.DATA_DIR || "/data";
// Only the deployment operator may grant access to a local upstream.
const originOverrides = JSON.parse(process.env.IMAGE_PROXY_ORIGIN_OVERRIDES || "{}");
const imageTimeout = Number(process.env.IMAGE_PROXY_TIMEOUT_MS || 1800000);
await mkdir(dataDir, { recursive: true });
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
const keyPath = (key) => path.join(dataDir, `${Buffer.from(key, "utf8").toString("base64url")}.json`);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/health") return json(res, { ok: true });
    if (["/api/image-edit", "/api/image-generation"].includes(url.pathname) && req.method === "POST") return proxyImage(req, res, url.pathname === "/api/image-edit" ? "edits" : "generations");
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
async function proxyImage(req, res, operation) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  res.setHeader("x-image-proxy-request-id", requestId);
  const baseUrl = String(req.headers["x-upstream-base-url"] || "").trim().replace(/\/+$/, "");
  let target;
  try {
    target = new URL(`${baseUrl.toLowerCase().endsWith("/v1") ? baseUrl : `${baseUrl}/v1`}/images/${operation}`);
    if (!(await isConfiguredBaseUrl(baseUrl))) throw new Error("The model endpoint is not configured in this app");
    const override = originOverrides[target.origin];
    if (override) {
      const origin = new URL(override);
      if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) throw new Error("Invalid image proxy origin override");
      target = new URL(`${target.pathname}${target.search}`, origin.origin);
    } else {
      await assertPublicTarget(target);
    }
  } catch (error) {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : "Invalid API endpoint" } }));
  }
  try {
    const body = await readBody(req, 200 * 1024 * 1024);
    console.log(JSON.stringify({ event: "image-request", requestId, operation, upstream: target.origin, bytes: body.length }));
    const upstream = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, {
      method: "POST",
      headers: { "content-type": req.headers["content-type"] || "application/octet-stream", "content-length": body.length, authorization: req.headers.authorization || "" },
    }, (response) => {
      const status = response.statusCode || 502;
      const upstreamRequestId = String(response.headers["x-request-id"] || response.headers["cf-ray"] || "").slice(0, 200);
      console.log(JSON.stringify({ event: "image-upstream", requestId, operation, upstream: target.origin, status, elapsedMs: Date.now() - startedAt, upstreamRequestId }));
      res.setHeader("x-image-proxy-source", "upstream");
      response.on("error", () => res.destroy());
      // Keep structured validation/auth errors intact. Gateway pages contain no useful model error.
      if (status >= 500 && !String(response.headers["content-type"] || "").includes("application/json")) {
        response.resume();
        res.writeHead(status, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: {
          message: `模型服务 ${target.host} 返回 HTTP ${status}。请求已到达上游，但上游网关未正常返回结果；请稍后手动重试或联系渠道服务方。诊断编号：${requestId}${upstreamRequestId ? `；上游编号：${upstreamRequestId}` : ""}`,
          source: "upstream", requestId, upstreamRequestId,
        } }));
      }
      res.writeHead(response.statusCode || 502, { "content-type": response.headers["content-type"] || "application/json" });
      response.pipe(res);
    });
    // Avoid fetch's shorter response-header timeout for slow image models.
    const timer = setTimeout(() => upstream.destroy(new Error("Image upstream timed out")), imageTimeout);
    upstream.on("error", (error) => {
      console.error(JSON.stringify({ event: "image-transport-error", requestId, operation, upstream: target.origin, elapsedMs: Date.now() - startedAt, code: error.code || "", timeout: error.message === "Image upstream timed out" }));
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      res.setHeader("x-image-proxy-source", "transport");
      res.writeHead(error.message === "Image upstream timed out" ? 504 : 502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `画布服务连接模型上游失败：${error.message}。诊断编号：${requestId}`, source: "transport", requestId } }));
    });
    res.on("close", () => { clearTimeout(timer); upstream.destroy(); });
    upstream.end(body);
  } catch (error) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : "Image edit proxy failed" } }));
  }
}
async function assertPublicTarget(target) {
  if (!["http:", "https:"].includes(target.protocol) || !target.hostname) throw new Error("The model endpoint must use HTTP or HTTPS");
  const addresses = isIP(target.hostname) ? [{ address: target.hostname }] : await lookup(target.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error("Private and local model endpoints cannot be proxied");
}
function isPublicAddress(address) {
  if (address.includes(":")) return /^[23]/i.test(address);
  const [a, b] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
}
async function isConfiguredBaseUrl(candidate) {
  const normalized = (value) => { try { const url = new URL(value); return `${url.origin}${url.pathname.replace(/\/+$/, "")}`.toLowerCase(); } catch { return ""; } };
  const expected = normalized(candidate);
  if (!expected) return false;
  for (const file of await readdir(dataDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const record = JSON.parse(await readFile(path.join(dataDir, file), "utf8"));
      const state = JSON.parse(record.value || "{}");
      const channels = state.state?.config?.channels || [];
      if (channels.some((channel) => normalized(channel.baseUrl) === expected)) return true;
    } catch { }
  }
  return false;
}
function readBody(req, limit = 20 * 1024 * 1024) { return new Promise((resolve, reject) => { const chunks = []; let bytes = 0; req.on("data", (chunk) => { bytes += chunk.length; if (bytes > limit) { reject(new Error("Request body is too large")); req.destroy(); return; } chunks.push(chunk); }); req.on("end", () => resolve(Buffer.concat(chunks))); req.on("error", reject); }); }
