// Shared pdfjs worker configuration for react-pdf consumers.
// ────────────────────────────────────────────────────────────────────
// Both the admin signature placement editor and the signer interface
// render PDFs via react-pdf, which internally drives pdfjs-dist. The
// worker URL must be configured exactly once on the client. Centralising
// this avoids version drift (pdfjs-dist v5+ ships .mjs workers — pinned
// here to match `pdfjs-dist` in package.json).
// ────────────────────────────────────────────────────────────────────

"use client";

/** Pinned to match the installed pdfjs-dist version. Bump together. */
export const PDFJS_VERSION = "5.4.296";

/** CDN URL for the pdfjs worker. Must be reachable from the browser. */
export const PDFJS_WORKER_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

// Module-level cached promise — guarantees the dynamic import + worker
// assignment runs at most once per page lifecycle, even if multiple
// components race to call configurePdfJs() during mount.
let configurePromise: Promise<void> | null = null;

/**
 * Idempotent worker setup. Safe to call from useEffect — no-ops on the
 * server, runs once on the client. Subsequent calls return the cached
 * promise so the worker URL is only assigned a single time.
 */
export function configurePdfJs(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (configurePromise) return configurePromise;
  configurePromise = (async () => {
    const { pdfjs } = await import("react-pdf");
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  })();
  return configurePromise;
}
