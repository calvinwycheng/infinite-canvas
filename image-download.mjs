import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Pin the checked DNS address to the connection; validate every redirect separately.
export async function downloadImage(value, redirects = 0) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("图片地址必须是无凭据的 HTTP/HTTPS 公网地址");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicImageAddress(address))) throw new Error("不允许下载本机或私网图片地址");
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET",
      headers: { accept: "image/*" },
      lookup: (_host, options, callback) => options.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
    }, (response) => {
      response.on("error", reject);
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.destroy();
        if (!location || redirects >= 3) return reject(new Error("图片地址重定向过多或缺少目标地址"));
        resolve(downloadImage(new URL(location, url).href, redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.destroy();
        return reject(new Error(`图片服务器返回 HTTP ${response.statusCode}`));
      }
      const type = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!type.startsWith("image/")) { response.destroy(); return reject(new Error("图片地址未返回图片内容")); }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 50 * 1024 * 1024) { req.destroy(new Error("图片超过 50 MB 下载上限")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ body: Buffer.concat(chunks), type }));
    });
    const timer = setTimeout(() => req.destroy(new Error("图片下载超时")), 60000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end();
  });
}

export function isPublicImageAddress(address) {
  if (address.includes(":")) return /^[23]/i.test(address) && !/^2001:(?:db8|0):/i.test(address);
  const [a, b] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19)));
}
