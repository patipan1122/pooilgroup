// Shared pdfjs worker configuration for react-pdf consumers.
// ────────────────────────────────────────────────────────────────────
// Both the admin signature placement editor and the signer interface
// render PDFs via react-pdf, which internally drives pdfjs-dist. The
// worker URL must be configured exactly once on the client. Centralising
// this avoids version drift (pdfjs-dist v5+ ships .mjs workers — pinned
// here to match `pdfjs-dist` in package.json).
//
// 2026-09-30 — was loading from the unpkg CDN, which the site's CSP
// `script-src` never allowlisted (only 'self' + LINE domains — see
// lib/supabase/proxy.ts). The browser silently blocked the worker
// script on every load, so react-pdf's <Document> always fell through
// to its default "Failed to load PDF file." error (CEO click-report,
// signature placement page unusable). Same *class* of bug as the
// earlier CSP connect-src blocks on chairops (af580ba0/5fc682b3): a
// hard CSP directive silently killing a feature that works fine
// outside the browser (curl proved the R2/CORS transport was healthy).
// Fixed by vendoring the worker file into public/pdfjs/ instead of
// widening the CSP to trust an external CDN — same-origin means no
// CSP change needed at all, and no dependency on unpkg's uptime/
// reachability. Re-copy this file from
// node_modules/pdfjs-dist/build/pdf.worker.min.mjs whenever
// PDFJS_VERSION below is bumped.
// ────────────────────────────────────────────────────────────────────

"use client";

/** Pinned to match the installed pdfjs-dist version. Bump together
 *  with public/pdfjs/pdf.worker.min.mjs (copy it fresh from
 *  node_modules/pdfjs-dist/build/pdf.worker.min.mjs on every bump). */
export const PDFJS_VERSION = "5.4.296";

/** Same-origin static copy of the worker — see header comment for why
 *  this isn't the unpkg CDN anymore. */
export const PDFJS_WORKER_URL = "/pdfjs/pdf.worker.min.mjs";

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
