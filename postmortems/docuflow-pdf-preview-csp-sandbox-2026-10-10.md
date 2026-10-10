# DocuFlow document preview was unopenable for every uploaded file — CSP gap + a plugin-killing iframe sandbox

**Summary.** CEO reported "ไฟล์ที่อัปโหลดปัจจุบันยังเปิดดูไม่ได้เลย" (currently uploaded files can't be opened at all) and pinned a specific document ("FM FIN 01 V.3"). Two unrelated bugs compounded on the same `<iframe>` in `components/docuflow/viewer-tabs.tsx`: (1) the site-wide CSP's `frame-src` directive (`lib/supabase/proxy.ts`) never included the R2 signed-URL domain, so every browser silently blocked the preview frame with zero user-visible error — only a console-only CSP violation; (2) even after fixing that, the iframe's `sandbox="allow-same-origin allow-scripts"` attribute permanently disables browser plugins per the HTML spec (no sandbox token re-enables them), and Chrome's built-in PDF viewer is implemented as a plugin — so the frame rendered a broken-file icon instead of the document. Fixing only the first bug would NOT have fixed the reported symptom; both had to be found and fixed together. A third, pre-existing silent-swallow pattern (`getSignedDownloadUrl(...).catch(() => null)`) made the whole thing invisible — any future failure of this kind would look identical to today's (nothing, no explanation), so that was fixed too even though it wasn't the active cause this time.

## Symptom

CEO: documents open to the detail page but the Preview area is blank — no file content, no error message, no clue what's wrong.

## Investigation (not guessed)

1. Live read-only DB query (`prisma.document.findFirst({ where: { name: { contains: "FM FIN 01" } } })`) found the pinned document, `id=fcd80085-b384-45eb-93b2-37789e7d34e2`, `mimeType=application/pdf`, `fileKey=documents/{orgId}/{docId}/FM-FIN-01-V.3-_-2.pdf`.
2. Called the exact function the page calls, `getSignedDownloadUrl(fileKey)`, directly from a script — it did NOT throw. Confirmed the R2 object itself exists and is a valid, intact PDF via `HeadObjectCommand` + a real `fetch()` of the signed URL (200, correct `Content-Type: application/pdf`, correct `Content-Length`). This ruled out "missing/corrupt file" (a data problem) and ruled out candidate root cause (a) from the initial triage (silent signing failure) — signing was never actually failing for this document.
3. Checked the org's full mimeType distribution (`prisma.document.groupBy`): all 5 active documents org-wide are `application/pdf`. This ruled out candidate root cause (b) (non-previewable `.docx`/`.doc`/`.zip` mimeTypes) as the *live* cause — there were zero non-PDF/image documents in the database to trigger that path at all.
4. Since neither hypothesized cause explained the symptom, did a real headless-Chrome run (Playwright, logged in as the test admin, local worktree dev server) against the actual page and captured browser console errors: `Framing 'https://pooilgroup.{accountId}.r2.cloudflarestorage.com/' violates the following Content Security Policy directive: "frame-src 'self' https://liff.line.me https://*.line.me". The request has been blocked.` — the real root cause, a CSP gap, found only by reproducing in a real browser rather than trusting the backend-only checks.
5. After fixing the CSP (see Fix below), re-ran the same live check: CSP error gone, but the Preview area now showed a broken-file icon instead of a blank box. Isolated the iframe in a minimal standalone HTML page and tested 3 `sandbox` configurations in the **real installed Google Chrome** (not Playwright's bundled "Chrome for Testing", which ships without a PDF viewer at all and would have made this test meaningless — confirmed separately: navigating "Chrome for Testing" directly to the same PDF URL triggered a forced download instead of any viewer, a tooling artifact unrelated to the bug):
   - `sandbox="allow-same-origin allow-scripts"` → broken icon
   - `sandbox="allow-same-origin allow-scripts allow-popups"` → broken icon
   - no `sandbox` attribute at all → PDF rendered correctly, full toolbar, all pages
   This confirms the HTML spec behavior: the sandboxed-plugins browsing-context flag is set by the mere presence of `sandbox`, and no token un-sets it — so this iframe could never have shown a PDF in Chrome, sandboxed or not, regardless of which tokens were listed.

## Root cause

Two independent bugs on `components/docuflow/viewer-tabs.tsx`'s preview `<iframe>`:

1. **CSP gap** (`lib/supabase/proxy.ts`) — `connect-src` already trusted `https://*.r2.cloudflarestorage.com` (used for presigned upload/download fetches elsewhere), but `frame-src` was never given the same host, so the browser blocked the iframe navigation outright. Both headless and headed browsers enforce CSP identically — this was never a testing artifact, it affected every real user on every real browser.
2. **Plugin-disabling sandbox** — the iframe carried `sandbox="allow-same-origin allow-scripts"`, added as a defense-in-depth measure (per its own comment: deny top-level navigation/popups/form-posts from the framed content). Per the HTML Standard, setting `sandbox` at all — regardless of which tokens are listed — sets the "sandboxed plugins browsing context flag" with no way to clear it, and Chrome's native PDF viewer is a plugin (MimeHandlerView-based). The frame could load (once CSP allowed it) but could never render the PDF.

A third pattern made both bugs invisible rather than causing them: `page.tsx`'s `getSignedDownloadUrl(doc.fileKey).catch(() => null)` swallowed any failure into a bare `null`, and the download button only rendered `if (downloadUrl)` — so on any failure of this *kind* (not specifically this one), the user would see nothing and no error, ever.

## Why it slipped through

- CSP was tightened during the 2026-10-07 security audit (per project memory: pooilgroup-web site-wide security audit, 34 sub-agents, 17 findings). That pass added `frame-src` restrictions without auditing every existing iframe consumer across the app — DocuFlow's PDF preview was the only `<iframe>` pointed at an R2 URL and was missed.
- `tsc`/`eslint`/`next build` cannot catch either bug — both are runtime browser-policy violations invisible to static analysis. The `.catch(() => null)` pattern is syntactically valid TypeScript and type-checks cleanly; the CSP string and the `sandbox` attribute are both just string literals to the compiler.
- The sandbox bug specifically could not have been caught by a quick manual click-through in Playwright's default bundled browser ("Chrome for Testing"), because that browser lacks a PDF viewer entirely and would show the same "broken" result whether or not the real bug was fixed — a second, compounding trap for anyone trying to verify this with the most readily-available automation browser.

## Fix

1. `lib/supabase/proxy.ts` — added `https://*.r2.cloudflarestorage.com` to the `frame-src` CSP directive (same host pattern already present in `connect-src`).
2. `components/docuflow/viewer-tabs.tsx` — removed the `sandbox` attribute from the PDF preview iframe entirely (kept `referrerPolicy="no-referrer"`). Documented why this is safe: `downloadUrl` only ever points at an R2 object that passed upload-time magic-byte validation as `application/pdf` (`lib/docuflow/mime-validate.ts`) — never arbitrary attacker-controlled HTML — and this branch only renders when `isPdf` is already true.
3. `app/(admin)/docuflow/documents/[id]/page.tsx` — replaced the silent `.catch(() => null)` with a try/catch that captures the real error and surfaces it: a `DfPill tone="danger"` where the header download button used to just vanish, a disabled (not dead-link `href="#"`) button with a `title` in the right-column PDF action card, and a genuine error message in the Preview tab body distinguishing "signing actually failed" from "this file type has no inline viewer."
4. `components/docuflow/viewer-tabs.tsx` — for the latter case (non-PDF/image mimeTypes DocuFlow's upload whitelist allows but has no inline viewer for, e.g. `.docx`/`.doc`/`.zip`), added a working inline download link directly in the Preview tab instead of only pointing the user back up to a separate button. Not currently exercised by any live document (all 5 active org documents are PDFs) but closes the gap defensively since the CEO's report used the word "files" (plural) and this path was flagged as plausible in the initial triage.

## Validation

- `tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=10240`): 0 errors.
- `eslint` on all 3 changed files: 0 errors, 4 pre-existing unrelated warnings (confirmed identical against `origin/setup` via `git show origin/setup:<path> | eslint --stdin`).
- `next build` (`.next` removed first): clean, exit code 0, full route table generated including the DocuFlow routes.
- Real end-to-end click-through: isolated worktree dev server (`localhost:3177`), logged in as `claude-test@pooilgroup.test` (super_admin), navigated to the real pinned document's detail page (`/docuflow/documents/fcd80085-b384-45eb-93b2-37789e7d34e2`) using the **real installed Google Chrome** via Playwright's `channel: "chrome"` (not the bundled Chrome-for-Testing build, which lacks a PDF viewer and would give a false negative regardless of the fix). Before the fix: CSP violation logged to console, blank preview area. After the CSP fix alone: no CSP error, but a broken-file icon (sandbox bug still live). After both fixes: zero console errors, the PDF renders fully inline with Chrome's native PDF toolbar (page thumbnail, zoom, download, print) — screenshot captured and visually confirmed.
- Scope check: `prisma.document.groupBy({ by: ["mimeType"] })` confirmed all 5 active org documents are `application/pdf` — this bug was blocking 100% of real uploaded documents org-wide, not just the one CEO pinned.

## Action items / follow-ups

- Worth a repo-wide grep for any other `<iframe src={...r2...}>` or similar cross-origin embeds that might have been caught by the same 2026-10-07 CSP tightening — DocuFlow's preview was the only one found this pass but wasn't exhaustively searched beyond `grep -rl iframe app components`.
- If a future module ever needs to preview an R2-hosted *non-PDF, non-image* format inline (e.g. embedding Office documents via a third-party viewer iframe), revisit whether `sandbox` can be reintroduced for that specific case — this fix only proves PDFs need it dropped; other embed types may have different plugin requirements.
