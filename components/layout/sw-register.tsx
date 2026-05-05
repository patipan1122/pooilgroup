"use client";

// Register the service worker on first load — enables offline shell.
// Skipped in dev to avoid stale-cache headaches.

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[sw] register failed", err);
    });
  }, []);
  return null;
}
