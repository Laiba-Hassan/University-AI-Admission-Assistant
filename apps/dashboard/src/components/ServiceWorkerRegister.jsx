"use client";

import { useEffect } from "react";

/** Offline app-shell caching is a production concern only -- in dev, Next regenerates JS chunk hashes on every
 * rebuild, so a cached "/" shell quickly points at chunks that no longer exist and normal reloads start
 * serving a blank/broken page (only a hard refresh, which bypasses the service worker, recovers). Registering
 * only in production avoids that; unregistering + clearing caches in dev heals anyone who already has it. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    } else {
      void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
      if ("caches" in window) void caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
  }, []);
  return null;
}
