import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { downloadImage, isPublicImageAddress } from "./image-download.mjs";

test("reject private, loopback, metadata and mapped IPv6 destinations", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "192.168.0.138", "172.16.0.1", "169.254.169.254", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1"]) {
    assert.equal(isPublicImageAddress(address), false, address);
  }
  for (const url of ["http://127.0.0.1/x", "http://[::1]/x", "http://2130706433/x", "http://0x7f000001/x", "file:///etc/passwd", "https://user:password@example.com/a.png"]) {
    await assert.rejects(downloadImage(url));
  }
});

test("download public image bytes unchanged", async () => {
  const result = await downloadImage("https://raw.githubusercontent.com/calvinwycheng/infinite-canvas/main/assets/metaso.jpg");
  assert.equal(result.type, "image/jpeg");
  assert.deepEqual(result.body, await readFile(new URL("./assets/metaso.jpg", import.meta.url)));
});

test("reject non-image responses and upstream 404", async () => {
  await assert.rejects(downloadImage("https://raw.githubusercontent.com/calvinwycheng/infinite-canvas/main/VERSION"), /图片内容/);
  await assert.rejects(downloadImage("https://raw.githubusercontent.com/calvinwycheng/infinite-canvas/main/missing-image-diagnostic.png"), /HTTP 404/);
});
