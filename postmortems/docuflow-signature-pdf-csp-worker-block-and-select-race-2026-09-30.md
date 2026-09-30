# DocuFlow signature PDF viewer: CSP-blocked worker script + quick-create `<select>` race condition

**Summary.** Two independent, unrelated bugs found and fixed in the same session while working a CEO Pinpoint click-report batch. (1) `/docuflow/documents/[id]/signatures` showed react-pdf's generic "Failed to load PDF file." for every document — the pdfjs worker script was loaded from the unpkg CDN, which the site's CSP `script-src` never allowlisted, so the browser silently blocked it on every page load. (2) While building a new "quick-create" dialog (DocumentGroup) that mirrors an existing, already-shipped one (DocumentType, from a 2026-09-25 postmortem that reported it as fully verified working), found that BOTH the new and the existing dialog fail to visually auto-select the newly created row in their `<select>` — a genuine race condition between an imperative `react-hook-form` `setValue()` call and React's async commit of the new `<option>` element, confirmed via repeated live runs, not flakiness.

## Symptom

**Bug 1:** CEO reported (Pinpoint click-report, live production page): opening `/docuflow/documents/1f128525-cc07-405a-b568-210cd1714c00/signatures` shows "Failed to load PDF file." in the PDF viewer area — no placements could be positioned, feature fully unusable for that document (and, once root-caused, for every document — this wasn't document-specific).

**Bug 2 (found during item 2's build, not reported by the CEO):** After clicking "+ สร้างใหม่" next to a taxonomy dropdown (DocumentType or, now, DocumentGroup) in the upload form, filling the dialog, and submitting: a success toast appears and the API genuinely creates the row (confirmed via direct DB query and via `GET` on the list endpoint), but the dropdown itself stays showing "— ไม่ระบุ —" instead of the new row — even though the new `<option>` element does exist in the DOM (confirmed via `sel.options`/`allOptionValues`). Waiting longer (tested up to 5s) never self-corrects it.

## Root cause

**Bug 1 — CSP `script-src` blocking the pdfjs worker.** `lib/docuflow/pdfjs-config.ts` set `pdfjs.GlobalWorkerOptions.workerSrc` to `https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs`. The site's global CSP (`lib/supabase/proxy.ts`) is:
```
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.line-scdn.net https://*.line.me
```
`unpkg.com` is not in that list, and there is no separate `worker-src` directive (CSP falls back to `script-src` for both `Worker` construction and the dynamic `<script>`/module fetch pdf.js uses to load its worker). The browser blocked it deterministically, every time, for every user — this was never a per-document or per-network-condition issue.

Initial hypothesis (before live-testing) was R2 bucket CORS `ExposeHeaders` missing `Content-Length`/`Accept-Ranges` — ruled out by a direct `curl` against a freshly generated presigned GET URL with `Origin: https://pooilgroup.com`: `200 OK`, `Content-Type: application/pdf`, `Content-Length: 162916`, `Accept-Ranges: bytes`, valid single-page PDF body. `curl` doesn't enforce CSP, so it couldn't have caught this class of bug — the transport layer was always healthy, which is why the R2/CORS-header hypothesis felt plausible from code-reading alone but was wrong.

**Bug 2 — imperative `setValue()` racing React's async commit.** Both `handleQuickCreateDocType` and (the new) `handleQuickCreateGroup` in `components/docuflow/upload-form.tsx` follow this shape:
```ts
setLocalDocumentTypes((prev) => [...prev, created]);  // schedules a React re-render
setValue("documentTypeId", created.id);                 // react-hook-form
```
The `<select>` is registered via `{...register("documentTypeId")}` with no `value` prop — i.e. it's an **uncontrolled** input from React's perspective. `react-hook-form`'s `setValue()` for an uncontrolled field writes directly to the DOM element via its stored ref (`element.value = ...`), **synchronously, immediately**, independent of React's render cycle. `setLocalDocumentTypes(...)` only *schedules* a state update; React doesn't commit the new `<option>` to the actual DOM until after the current synchronous call stack finishes. So at the instant `setValue()` runs, the target `<option>` doesn't exist in the DOM yet — assigning a native `<select>.value` to a string with no matching `<option>` is a silent no-op (the browser leaves `selectedIndex` wherever it was). Once that one-shot imperative write has failed, nothing re-triggers it — later re-renders add the `<option>` to the DOM, but `setValue()` is never called again, so the dropdown stays wrong indefinitely.

## Why it slipped through

**Bug 1:** No static-analysis signature — CSP is a runtime browser policy, invisible to `tsc`/`eslint`/`next build`, and invisible to `curl` (which doesn't execute JS or enforce page-level security policies). Only a real browser (or reading the CSP config and cross-referencing it against every external resource URL in the codebase) reveals it.

**Bug 2:** The 2026-09-25 postmortem for the DocumentType quick-create dialog (`postmortems/docuflow-quickcreate-nested-form-and-uuid-validation-2026-09-25.md`) explicitly claims this exact interaction was validated: *"the upload form's own 'ประเภทเอกสาร' `<select>` immediately showed the new type auto-selected."* Re-testing it now (3 fresh headless runs) reproduced the failure 3/3 — the original validation pass was very likely a first-run timing fluke (e.g. a slower initial paint on a cold page happened to let React's commit land before the DOM read), not a real pass. This is a caution about single-run "it worked" live-test claims for anything timing-sensitive: a repeated-run check (3x, not 1x) would have caught it at the time.

## Fix

**Bug 1 (`lib/docuflow/pdfjs-config.ts`, `public/pdfjs/pdf.worker.min.mjs`):** Vendored the worker script as a same-origin static file (`public/pdfjs/pdf.worker.min.mjs`, copied from `node_modules/pdfjs-dist/build/pdf.worker.min.mjs`) instead of widening the CSP to trust `unpkg.com`. `PDFJS_WORKER_URL` now points at `/pdfjs/pdf.worker.min.mjs`. Chosen over relaxing CSP because: (a) no CSP change needed at all — `'self'` already covers it, keeping the CSP narrow; (b) no dependency on unpkg's uptime or reachability (relevant for users on restrictive corporate/ISP networks); (c) it's the same fix shape already used elsewhere in this codebase for CSP-blocked external resources. Added `scripts/check-pdfjs-worker.mjs` (wired into `npm run build`, warn-only, mirrors the style of `check-schema-applied.mjs`) so a future `pdfjs-dist` version bump without re-copying the vendored worker file is caught at build time instead of silently reintroducing this exact bug class.

Also added a proper `error` render prop (Thai message + a "ลองโหลดใหม่" retry button that force-remounts `<Document>` via a `key` bump) to all three react-pdf consumers in DocuFlow — `components/docuflow/signature-placement-editor.tsx`, `components/docuflow/signer-interface.tsx`, `components/docuflow/signer-document-preview.tsx` — replacing react-pdf's bare default fallback string (`"Failed to load PDF file."`, in English, with no next step) everywhere it's used, not just on the page the CEO happened to report. `signer-interface.tsx` and `signer-document-preview.tsx` are the actual external-signer-facing pages (`/sign/[placementId]` flow) — this CSP bug was silently blocking real counterparty signing too, not just the admin placement editor, for as long as the CSP has been this strict.

**Bug 2 (`components/docuflow/upload-form.tsx`):** Wrapped the local-state update in `flushSync` (from `react-dom`) before calling `setValue`, forcing React to commit the new `<option>` to the DOM synchronously before the imperative write runs:
```ts
flushSync(() => {
  setLocalDocumentGroups((prev) => [...prev, data.documentGroup]);
});
setValue("documentGroupId", data.documentGroup.id);
```
Applied identically to both `handleQuickCreateDocType` and the new `handleQuickCreateGroup`. `flushSync` was chosen over a `setTimeout`/`requestAnimationFrame` deferral because it's deterministic (guaranteed ordering, not scheduling-dependent) and is React's own documented mechanism for exactly this "force a synchronous DOM commit before an imperative follow-up" situation.

## Validation

All against a local dev server in an isolated worktree (`origin/setup` base), running on port `3100` specifically because that's the port already present in the R2 bucket's CORS `AllowedOrigins` allowlist (`scripts/r2-cors.mjs`) — an arbitrary custom port (tried `3111` first) reproduces an unrelated CORS-blocked-fetch error against R2 that doesn't occur in production, which would have been a false signal.

**Bug 1:**
- Live headless run against the exact broken document (`1f128525-cc07-405a-b568-210cd1714c00`, logged in as the sanctioned test admin): before the fix, console showed the CSP violation verbatim (`"Creating a worker from 'blob:...' violates the following Content Security Policy directive: \"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.line-scdn.net https://*.line.me\"..."` plus `"Setting up fake worker failed"` and `"PDF load error"`), and the page showed the failure text with 0 `<canvas>` elements rendered.
- After the fix: zero console errors, zero CSP violations, one `<canvas>` element rendered with real dimensions (720×1018), and the page text no longer contains the failure string. Confirmed via screenshot — the actual payment-advice PDF content renders.
- This before/after pair (reproduced then fixed, same doc, same script) is the strongest form of proof available short of a production redeploy.

**Bug 2:**
- Before the fix: 3 fresh headless runs of the DocumentType quick-create (the already-shipped flow) each showed `select.value === ""` after creation — 3/3 failures, not flaky.
- After the fix: 3 fresh headless runs each showed the correct id selected and correct visible text — 3/3 passes.
- The new DocumentGroup quick-create: before the fix, 1 run failed (`select` stayed on the placeholder even after 5s of polling, though the new `<option>` was confirmed present in the DOM); after the fix, 3 fresh runs each passed.
- All test-created rows (5 `document_groups`, 8 `document_types`, all named with a `TEST-` prefix) were soft-deleted via the app's own authenticated `DELETE` endpoints (`/api/docuflow/document-groups/:id`, `/api/docuflow/document-types/:id`) after validation — confirmed 0 active `TEST-%` rows remain in either table via a direct read-only query.

## Action items / follow-ups

- `scripts/check-pdfjs-worker.mjs` now guards the specific version-drift class of Bug 1's fix going stale — no further action needed there.
- Bug 2's fix (`flushSync`) is applied to both existing call sites of this pattern in `upload-form.tsx`. If a third quick-create dialog of this shape (uncontrolled `<select>` + `setValue` immediately after a sibling `setState`) is added later, apply the same `flushSync` wrap — this is a real, reusable bug class in this codebase (imperative `react-hook-form` writes racing React's uncontrolled-field DOM commits), not specific to DocuFlow.
- Worth a light process note for future live-test validation write-ups generally: a single successful run of a timing-sensitive interaction is not strong evidence: run it 3× before writing "confirmed working" in a postmortem or briefing.
