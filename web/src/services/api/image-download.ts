/** Remote image bytes must be read through the same origin, including signed CDN URLs. */
export async function fetchImageBlob(url: string): Promise<Blob> {
    const remote = new URL(url, window.location.href);
    const proxy = ["http:", "https:"].includes(remote.protocol) && remote.origin !== window.location.origin;
    const response = proxy
        ? await fetch("/api/image-download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: remote.href }) })
        : await fetch(url);
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message || `图片读取失败（HTTP ${response.status}）`);
    }
    return response.blob();
}
