import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            const response = await fetch(`/api/state/${encodeURIComponent(name)}`);
            if (response.ok) return (await response.json()).value || null;
            if (response.status !== 404) throw new Error("state api failed");
        } catch {
            // Fall back to browser storage when the app is opened as static files.
        }
        try {
            const value = (await localforage.getItem<string>(name)) || window.localStorage.getItem(name);
            if (value) void fetch(`/api/state/${encodeURIComponent(name)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) });
            return value;
        } catch {
            return window.localStorage.getItem(name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try {
            const response = await fetch(`/api/state/${encodeURIComponent(name)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) });
            if (response.ok) return;
        } catch {
            // Fall back to browser storage when the app is opened as static files.
        }
        try {
            await localforage.setItem(name, value);
        } catch {
            window.localStorage.setItem(name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            const response = await fetch(`/api/state/${encodeURIComponent(name)}`, { method: "DELETE" });
            if (response.ok || response.status === 404) return;
        } catch {
            // Fall back to browser storage when the app is opened as static files.
        }
        try {
            await localforage.removeItem(name);
        } catch {
            window.localStorage.removeItem(name);
        }
    },
};
