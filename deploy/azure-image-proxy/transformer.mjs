import http from "node:http";
import https from "node:https";

const endpoint = new URL(process.env.AZURE_OPENAI_ENDPOINT);
const token = process.env.AZURE_OPENAI_TOKEN;
const maxBodyBytes = 50 * 1024 * 1024;

if (!token) {
  throw new Error("AZURE_OPENAI_TOKEN is required");
}

const server = http.createServer((req, res) => {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const chunks = [];
  let receivedBytes = 0;

  console.log(`[${requestId}] start ${req.method} ${req.url} content-type=${req.headers["content-type"] || ""}`);

  req.on("data", (chunk) => {
    receivedBytes += chunk.length;
    if (receivedBytes > maxBodyBytes) {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Request body exceeds 50 MB" } }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", async () => {
    if (receivedBytes > maxBodyBytes) return;
    let body = Buffer.concat(chunks);
    let contentType = req.headers["content-type"] || "";

    if (body.length && contentType.includes("application/json")) {
      try {
        const payload = JSON.parse(body.toString("utf8"));
        delete payload.response_format;
        body = Buffer.from(JSON.stringify(payload));
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid JSON request body" } }));
        return;
      }
    } else if (body.length && contentType.includes("multipart/form-data")) {
      try {
        const form = await new Response(body, { headers: { "content-type": contentType } }).formData();
        form.delete("response_format");
        const encoded = new Response(form);
        contentType = encoded.headers.get("content-type");
        body = Buffer.from(await encoded.arrayBuffer());
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid multipart request body" } }));
        return;
      }
    }

    const headers = { ...req.headers };
    delete headers.host;
    delete headers.authorization;
    delete headers["content-length"];
    delete headers["transfer-encoding"];
    delete headers.connection;
    headers["content-type"] = contentType;
    headers.authorization = `Bearer ${token}`;
    headers.host = endpoint.host;
    headers["content-length"] = String(body.length);

    const upstream = https.request({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      method: req.method,
      path: req.url,
      headers,
    }, (upstreamResponse) => {
      console.log(`[${requestId}] upstream status=${upstreamResponse.statusCode} headers-after-ms=${Date.now() - startedAt}`);
      const responseHeaders = { ...upstreamResponse.headers };
      delete responseHeaders["access-control-allow-origin"];
      delete responseHeaders["access-control-allow-methods"];
      delete responseHeaders["access-control-allow-headers"];
      delete responseHeaders["access-control-allow-credentials"];
      responseHeaders["x-image-proxy-request-id"] = requestId;
      res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
      upstreamResponse.pipe(res);
      upstreamResponse.on("end", () => {
        console.log(`[${requestId}] complete status=${upstreamResponse.statusCode} total-ms=${Date.now() - startedAt}`);
      });
    });

    upstream.on("error", (error) => {
      console.error(`[${requestId}] upstream-error after-ms=${Date.now() - startedAt} ${error.message}`);
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: error.message } }));
    });

    res.on("close", () => {
      if (!res.writableEnded) {
        console.warn(`[${requestId}] client-disconnected after-ms=${Date.now() - startedAt}`);
        upstream.destroy();
      }
    });

    upstream.end(body);
  });
});

server.requestTimeout = 30 * 60 * 1000;
server.headersTimeout = 31 * 60 * 1000;

server.listen(3001, "0.0.0.0", () => {
  console.log("Azure request transformer listening on port 3001");
});
