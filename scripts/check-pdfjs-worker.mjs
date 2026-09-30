#!/usr/bin/env node
/**
 * Guardrail · vendored pdfjs worker ↔ installed pdfjs-dist version drift.
 * Added 2026-09-30 after the DocuFlow signature-placement PDF viewer bug
 * (CEO click-report): `lib/docuflow/pdfjs-config.ts` used to point at the
 * unpkg CDN for the pdf.js worker script, which the site's CSP `script-src`
 * never allowlisted — the browser silently blocked it on every load, and
 * react-pdf fell back to its generic "Failed to load PDF file." error with
 * no indication CSP was the cause. Fixed by vendoring the worker into
 * `public/pdfjs/pdf.worker.min.mjs` (same-origin, no CSP change needed).
 *
 * That fix only holds as long as the vendored file stays in sync with the
 * installed `pdfjs-dist` version — a future `pnpm up pdfjs-dist` without a
 * matching re-copy would silently reintroduce the exact same class of bug
 * (worker script mismatch → parse/version errors that are just as opaque
 * to a non-technical user as the CSP block was). This script catches that
 * drift at build time.
 *
 * WARN-only, never blocks a build — same reasoning as check-schema-applied.mjs:
 * a guard that can false-positive-block an unrelated deploy causes more harm
 * than the bug class it prevents. This one can only ever be a true positive
 * (the versions either match or they don't), but kept warn-only for safety
 * since a stale worker isn't as catastrophic as the whole-program-down class
 * that check-schema-applied.mjs guards against.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CONFIG_PATH = join(ROOT, "lib/docuflow/pdfjs-config.ts");
const WORKER_PATH = join(ROOT, "public/pdfjs/pdf.worker.min.mjs");
const PKG_PATH = join(ROOT, "node_modules/pdfjs-dist/package.json");

function warn(msg) {
  console.warn(`⚠️  [check-pdfjs-worker] ${msg}`);
}

try {
  if (!existsSync(CONFIG_PATH) || !existsSync(PKG_PATH)) {
    // pdfjs not in use / not installed — nothing to check.
    process.exit(0);
  }

  const configSrc = readFileSync(CONFIG_PATH, "utf8");
  const pinnedMatch = configSrc.match(/PDFJS_VERSION\s*=\s*"([^"]+)"/);
  const pinned = pinnedMatch?.[1];

  const installed = JSON.parse(readFileSync(PKG_PATH, "utf8")).version;

  if (!pinned) {
    warn(`could not find PDFJS_VERSION in ${CONFIG_PATH} — skipping check.`);
    process.exit(0);
  }

  if (pinned !== installed) {
    warn(
      `PDFJS_VERSION ("${pinned}") in lib/docuflow/pdfjs-config.ts does not match ` +
        `installed pdfjs-dist ("${installed}"). Update PDFJS_VERSION AND re-copy ` +
        `node_modules/pdfjs-dist/build/pdf.worker.min.mjs → public/pdfjs/pdf.worker.min.mjs, ` +
        `or the signature PDF viewer will silently break again (worker/pdf.js version mismatch).`,
    );
  }

  if (!existsSync(WORKER_PATH)) {
    warn(
      `${WORKER_PATH} is missing. Copy it from node_modules/pdfjs-dist/build/pdf.worker.min.mjs — ` +
        `without it, the DocuFlow signature PDF viewer fails to load with no clear error.`,
    );
  }
} catch (err) {
  // Never let this guard itself break a build.
  warn(`check skipped due to an internal error: ${err?.message ?? err}`);
}

process.exit(0);
