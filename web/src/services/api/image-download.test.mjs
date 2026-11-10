import test from "node:test";
import assert from "node:assert/strict";
import { fetchImageBlob } from "./image-download.ts";

test("remote signed URLs use same origin without forwarding credentials", async (t) => {
  globalThis.window = { location: { href: "http://localhost:3000/canvas/1", origin: "http://localhost:3000" } };
  t.after(() => delete globalThis.window);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (...args) => { calls.push(args); return new Response(new Blob(["image"], { type: "image/png" })); });
  const url = "https://cdn.example.com/result.png?signature=a%2Fb&expires=123";
  assert.equal(await (await fetchImageBlob(url)).text(), "image");
  assert.equal(calls[0][0], "/api/image-download");
  assert.deepEqual(JSON.parse(calls[0][1].body), { url });
  assert.deepEqual(calls[0][1].headers, { "Content-Type": "application/json" });
  for (const local of ["data:image/png;base64,YQ==", "blob:http://localhost:3000/123", "/local.png"]) {
    await fetchImageBlob(local);
    assert.deepEqual(calls.at(-1), [local]);
  }
});

test("download failure retains server diagnostic instead of reporting CORS", async (t) => {
  globalThis.window = { location: { href: "http://localhost:3000", origin: "http://localhost:3000" } };
  t.after(() => delete globalThis.window);
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({error:{message:"图片读取失败：图片服务器返回 HTTP 403"}}), {status:502}));
  await assert.rejects(fetchImageBlob("https://cdn.example.com/x.png"), /图片读取失败.*403/);
});
