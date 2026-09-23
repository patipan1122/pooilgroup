# DocuFlow Redesign — Track B File-Level Build Plan

> Generated 2026-09-23. Source spec: `docs/WORKSHOP_docuflow-redesign.md` §0.1 (Signature Flow Addendum) + §5/§6
> (locked spec), cross-checked against `docs/BIGFEATURE_docuflow-redesign_TRACKA_PLAN.md` (style/conventions —
> Track A already shipped, commit `1a7aae21`, present as HEAD of this worktree).
> Scope: **Track B only** — Google Drive integration + the full e-signature workflow (saved signature, full-document
> preview-before-sign, LINE-login-gated signing). **LINE OA notifications are explicitly out of scope** (CEO
> deferred, §0 row 2 of the workshop doc) — nothing here pushes messages, only the pre-existing LINE *Login* flow
> is reused for authenticating signers.

---

## §0. Preflight

**0.1 — Worktree sync status: healthy.** `git rev-list --left-right --count HEAD...origin/setup` → `1  0` — this
worktree is exactly `origin/setup` + the one local Track A commit (`1a7aae21`, not yet pushed). The staleness
problem Track A's plan flagged (1,530 commits behind) has been resolved; no rebase needed before starting Track B.

**0.2 — Concurrent-session check (re-run for Track B, per instructions):**
```
git log origin/setup -15 --oneline -- "app/(admin)/docuflow" "app/api/docuflow" "lib/docuflow" \
  "components/docuflow" "app/sign" "lib/chairops/storage"
```
Returned (newest first): `dd123874` (rentspace parallel batch), `5c42da69`/`0500719d`/`4b404ec3` (rentspace e-sign —
a **different, token-based external-signer flow** at `app/sign/rentspace/[token]/`, unrelated code path, no shared
files), `79a93142` (recruit ↔ Google Drive — **reuses `lib/chairops/storage/drive.ts` the same way this plan
does**, see §0.4 below), `1727f5af` (chairops money bugs, unrelated), `46ef4710`/`3ed43829` (program-admin access,
already the convention Track A's shipped code uses), `6d303b73` (per-program tab titles), `2fbb0921` (rentspace
review), `923510ec` (rentspace bootstrap), `392c2d63`/`cccc5255`/`452b1bd2`/`e0a23249` (ledger/chairops, unrelated).
**No active concurrent edit on any DocuFlow file, `app/sign/[placementId]/`, or `lib/chairops/storage/drive.ts`.**
The one file this plan shares with recent history is `lib/chairops/storage/drive.ts` (via `79a93142`, Recruit's
Drive integration) — see §0.4, this is informative, not a conflict.

**0.3 — What Track A already shipped that Track B builds on:** `DocumentType` entity + settings hub at
`/docuflow/settings` (gate: `requireProgramAdminTier`, **not** `requireAdminTier` — the real convention, confirmed
by reading the shipped code, not the pre-build plan's guess), merged `/docuflow/documents` page, Thai-font fix in
`lib/docuflow/signature.ts` (IBM Plex Sans Thai via `@pdf-lib/fontkit` — **already live**, `embedSignatures()` is
reused completely unchanged by this plan), new 5-tab bottom nav. Track B adds to this shell; it does not redo it.

**0.4 — Recruit already reuses the ChairOps Drive connection (`79a93142`, 2026-07-25) — read before building.**
This is a *second* precedent beyond `lib/dc/drive-store.ts` (cited in the task brief) for "reuse `getDriveSession`,
create your own flat folder under root." Confirms the pattern is solid and repeatable — worth a 2-minute read of
`lib/recruit/*drive*` by the build agent for a second data point, but `lib/dc/drive-store.ts` remains the closer
template (both are "one flat namespaced folder," not ChairOps' own month/category tree).

**0.5 — Two findings that change what "reuse the existing X" actually requires building.** Both are flagged in
full in §4 (Risks/Open Questions) — summarized here because they change the item list below:
- **Google Drive:** the workshop's own Debate Highlights (§3) resolved this as an **opt-in, per-document "Export to
  Drive" button** (one-way, triggered by a person, not an org-wide automatic gate) — not the always-on mirror the
  task brief's phrasing implied. This plan builds the opt-in-button version; §4 Q1 asks for explicit confirmation.
- **LINE Login entry point:** `/auth/line-start` today is **only ever linked to from inside `/liff/*` pages**
  (opened via a LINE Rich Menu) or a ledger-specific claim page. The plain `/login` page is password-only and
  explicitly tells the user "LINE login is via the Rich Menu in the LINE app" — there is currently **no way to
  reach LINE login from an ordinary sign-link opened in a browser**. This is a small, scoped, buildable gap (Item
  13 below), not a blocker — but it means "reuse the existing flow" is not a zero-code reuse; flagging so it isn't
  silently assumed to already work.

---

## §1. Item-by-item plan

### Item 11 — Google Drive integration (opt-in export, reused connection)

**Reality check:**
- `ChairopsDriveConnection` (`prisma/schema.prisma:4214`, `@@schema("chairops")`, `@@unique([orgId])`) is keyed by
  `orgId` only — **one row per org**, already shared by ChairOps (native), DC (`lib/dc/drive-store.ts`), and now
  Recruit (`79a93142`). DocuFlow becomes the **4th consumer** by calling the exact same
  `getDriveSession(orgId)` / `ensureFolder()` exports from `lib/chairops/storage/drive.ts` — **no new OAuth
  connection, no new consent screen, nothing for the CEO to re-authorize.**
- `uploadBytes()` in `lib/chairops/storage/drive.ts:238-268` is **module-private** (not exported) — both existing
  reuse sites (`lib/dc/drive-store.ts`) worked around this by **copy-pasting the same ~30-line multipart-builder
  function a second time** rather than importing it. A third copy for DocuFlow would be the same code triplicated.
  **Ladder-thinking fix, in scope for this item:** change `async function uploadBytes` → `export async function
  uploadBytes` in `lib/chairops/storage/drive.ts` (one-word diff) and have DocuFlow's new helper `import { ...,
  uploadBytes } from "@/lib/chairops/storage/drive"` instead of duplicating it. This does not touch
  `dc/drive-store.ts`'s existing copy (out of scope to refactor that now) but stops the pattern from getting worse.
- **Which file gets exported?** A document can have an unsigned original (`Document.fileKey`) and, once every
  placement is signed, a separate final artifact (`DocumentSignaturePlacement.signedFileKey`, same value repeated
  across all completed placements on that document — confirmed by reading `embedSignatures()`, §per task brief).
  `Document` itself has no top-level "current signed key" column. Export should prefer the signed PDF when one
  exists: query `documentSignaturePlacement.findFirst({ where: { orgId, documentId, signedFileKey: { not: null } },
  select: { signedFileKey: true } })` (same fast-path query `embedSignatures()` itself already uses) — fall back to
  `document.fileKey` when null.
- **File-size risk-based call (task brief's explicit question):** `DOCUFLOW_MIME_WHITELIST`
  (`lib/docuflow/mime-validate.ts:11-23`) is PDF/JPEG/PNG/GIF/WebP/HEIC/HEIF/DOCX/DOC/ZIP — office-document types,
  not video/large-media. The Zod cap on the presigned-upload route is `500 * 1024 * 1024` (500 MB, a ceiling, not
  a typical size); the proxy route caps at 25 MB. Because export is **opt-in/on-demand** (not in the critical path
  of any upload), a failure here never touches R2 (the system of record) — worst case is a spinner that errors out.
  **Decision: do NOT build the resumable-upload fix in Track B.** Instead, add a cheap guard: the export route
  rejects (with a clear Thai message, not a silent failure) any file `fileSize > 100 * 1024 * 1024` (100 MB) —
  comfortably inside default Vercel serverless memory even accounting for the ~2× overhead of holding both the raw
  buffer and the multipart-wrapped body in memory at once. Flag the resumable-upload work as explicitly deferred;
  revisit only if real usage shows documents routinely exceed 100 MB (unlikely for licenses/contracts/forms).

**Prisma schema addition** (additive, nullable, on `Document` — no new table, so **no new RLS policy needed**,
the columns inherit the existing `documents` table policy):
```prisma
  driveFileId       String?   @map("drive_file_id")
  driveFileUrl      String?   @map("drive_file_url")
  driveExportedAt   DateTime? @map("drive_exported_at") @db.Timestamptz(6)
  driveExportedById String?   @map("drive_exported_by_id") @db.Uuid

  driveExportedBy   User?     @relation("DocumentDriveExporter", fields: [driveExportedById], references: [id], onDelete: SetNull)
```
On `User`, add the reciprocal relation next to the existing `uploadedDocuments Document[] @relation("DocumentUploader")` line:
```prisma
  driveExportedDocuments Document[] @relation("DocumentDriveExporter")
```

**Migration file:** `supabase/migrations/<ts>_docuflow_drive_tracking.sql` — plain `ALTER TABLE documents ADD
COLUMN IF NOT EXISTS ...` × 4, no RLS block needed (existing `documents` RLS already covers these columns).

**Files to create:**
- `lib/docuflow/drive-export.ts` — `exportDocumentToDrive({ orgId, documentId, userId })`: resolves the
  preferred R2 key (signed-if-exists else original, per above), downloads via `getObject()`
  (`lib/r2/upload.ts:12`, already generic/exported — no new R2 helper needed), calls `getDriveSession(orgId)`,
  `ensureFolder(accessToken, "DocuFlow-เอกสาร", rootFolderId)` (flat folder, mirrors `dc/drive-store.ts`'s
  `DC_IMAGE_FOLDER` pattern exactly — not ChairOps' own month/category nested tree, since DocuFlow docs aren't
  periodic), then the now-exported `uploadBytes()`. On success, writes the 4 new columns + `audit()`. Returns a
  typed result (`{ ok: true, driveUrl } | { ok: false, reason: "not_connected" | "too_large" | "upload_failed" }`)
  — **not** a silently-swallowed `null` like the background-mirror helpers, because this is a user-triggered action
  that needs to explain itself if it fails.
- `app/api/docuflow/[id]/drive-export/route.ts` — `POST`, `requireProgramAdminTier` (matches every other
  mutating DocuFlow action on the document-detail page — see §4 Q3 on why this item picks admin-tier over "any
  viewer" despite the workshop's "opt-in ต่อคน" wording), org-scoped, calls the helper above, returns the typed
  result as JSON with a Thai message per failure reason.

**Files to edit:**
- `lib/chairops/storage/drive.ts` — `uploadBytes` → exported (one-word change, see above).
- `app/(admin)/docuflow/documents/[id]/page.tsx` — add a Drive-export button to the existing `adminTier`-gated
  `DfCard` action block (right column, next to "ส่งให้เซ็น"/"ดาวน์โหลด", `:403-430`). Three states: not yet
  exported → "ส่งออกไป Google Drive"; exporting → spinner; already exported (`doc.driveFileId` set) → "เปิดใน
  Drive" link (`doc.driveFileUrl`) + a small re-export affordance (re-running is safe/idempotent — it just
  overwrites the tracked file-id with a fresh upload, matching "one-way export" semantics, not a two-way sync).
- `app/(admin)/docuflow/settings/page.tsx` — add one more `SettingsHubCard`-style tile (Section 02, same grid as
  the existing 6 tiles) showing Drive **connection status** (connected + root folder name, from
  `getDriveConnection(orgId)`, or "ยังไม่ได้เชื่อมต่อ — เชื่อมต่อได้จากหน้า ChairOps" since **no new "Connect
  Drive" UI is being built in DocuFlow** — the CEO's decision was reuse-only, so if the shared connection is ever
  missing/revoked, that's fixed at its origin (ChairOps), not duplicated here). Read-only card, no new admin action.

**Contended files:** none shared with Item 12/13/14 (different files entirely). `lib/chairops/storage/drive.ts` is
touched only by the one-line export change — low risk, but it's a shared file other modules import from, so this
edit **must ship with a full-repo `tsc` check** before merging (see waves).

**Migration needed:** yes, schema-only, gates the rest of this item.

---

### Item 12 — Signature registration ("ตั้งค่าลายเซ็นของฉัน")

**Reality check:** confirmed (per task brief and re-verified) — `User` has no signature field at all;
`DocumentSignaturePlacement.signedImageKey` is per-signing-event, not per-user. Nothing to reuse at the data layer;
this is genuinely new, small, additive state.

**Where does the page live?** **`/profile/signature`, not under `/docuflow/settings`.** Justification: DocuFlow's
settings hub is explicitly `requireProgramAdminTier`-gated (confirmed reading the shipped Track A code) — placing
a personal, every-user setting inside an admin-only hub would make it unreachable for the non-admin staff who are
exactly the people who need to sign documents. The codebase already has the right home for this: `app/(admin
)/profile/` is the existing personal-settings area (`requireSession()` only, no admin gate) — `profile/page.tsx`
already lists personal account settings (name/password via `ProfileForm`, linked-device sessions at
`/profile/sessions`, LINE/Telegram notification-channel status). A saved signature is the same *kind* of thing
(personal, tied to identity, not DocuFlow-specific — even though only DocuFlow consumes it today, RentSpace's
separate token-based e-sign flow could reuse it later without any DocuFlow coupling if this lives in `/profile`).

**Prisma schema addition** (additive, nullable, on `User` — no new table, no new RLS):
```prisma
  savedSignatureKey       String?   @map("saved_signature_key")
  savedSignatureUpdatedAt DateTime? @map("saved_signature_updated_at") @db.Timestamptz(6)
```
**Why not a separate table:** the CEO's described flow is singular — "ลายเซ็นของฉัน" (**my** signature, one), no
mention of multiple saved signatures, history, or per-document signature choice beyond the existing
draw-fresh-this-time escape hatch (handled in Item 14, not by multiplying stored signatures). Two nullable columns
on an already-RLS-protected table is strictly less new surface than a table + its own RLS policy for a 1:1
relationship `User` already models. If a real multi-signature need shows up later, that's an additive follow-up.

**Migration file:** `supabase/migrations/<ts>_docuflow_saved_signature.sql` — `ALTER TABLE users ADD COLUMN IF NOT
EXISTS ...` × 2, no RLS block (existing `users` RLS already covers it).

**Files to create:**
- `lib/docuflow/my-signature.ts` — `saveMySignature({ userId, orgId, pngBuffer })` (uploads to
  `signatures/profile/${orgId}/${userId}/${Date.now()}.png` via `putObject()`, updates the 2 `User` columns,
  **deletes the previous key** after a successful DB write — mirrors the rollback-on-failure discipline already
  used in `sign/route.ts:153-184`, just inverted: old-key cleanup on success, not new-key cleanup on failure);
  `getMySignatureUrl(userId)` (returns `savedSignatureKey ? getSignedDownloadUrl(key) : null` — reuses
  `lib/docuflow/r2.ts`'s existing generic download helper, no new R2 code); `clearMySignature(userId)`.
- `app/(admin)/profile/signature/page.tsx` — server component, `requireSession()` only (**no admin gate** — the
  task's explicit requirement), fetches current-saved-signature preview URL via the helper above, renders
  `<SignatureSettingsForm>`.
- `app/(admin)/profile/signature/signature-form.tsx` — client component. Reuses the exact same
  `react-signature-canvas` dynamic-import + fullscreen-pad pattern already proven twice in the codebase
  (`components/docuflow/signer-interface.tsx`'s `SignatureFullscreenPad`, `signature-placement-editor.tsx`) —
  **recommend extracting that pad into a small shared `components/docuflow/signature-pad.tsx`** (draw canvas +
  clear button + trim-to-PNG-dataURL, no submit-target logic) so Items 12 and 14 don't each hand-roll their own
  copy of the same ~70-line component; this is a nice-to-have simplification, not a hard blocker if time-boxed.
- `app/api/profile/signature/route.ts` — `GET` (has-saved-signature boolean + short-lived preview URL),
  `POST` (`{ imageDataUrl }`, same PNG-data-URL shape/validation as the existing sign endpoint's `BodySchema`),
  `DELETE`. All `requireSession()`-gated, operate on `session.user.id` only — no `userId` ever accepted from the
  request body (prevents one user setting another's signature).

**Files to edit:**
- `app/(admin)/profile/page.tsx` — add one more link card, same visual pattern as the existing "อุปกรณ์ที่เข้าใช้"
  → `/profile/sessions` card (`:35-53`): "ลายเซ็นของฉัน" → `/profile/signature`, with a small status line ("บันทึก
  ไว้แล้ว" / "ยังไม่ได้บันทึก").

**Contended files:** `app/(admin)/profile/page.tsx` is edited only by this item within Track B. No overlap with
Items 11/13/14.

**Migration needed:** yes, schema-only, gates Item 12's build-out **and** Item 14 (the sign flow needs to read
`savedSignatureKey` to offer the one-tap "use saved signature" option).

---

### Item 13 — LINE-login entry point for the sign link (the gap found in §0.5)

**Reality check:** `app/(auth)/login/login-form.tsx` is password-only: no `next`/redirect-target handling at all
(`router.push("/")` is hardcoded after successful login, `:79-80`), and its only mention of LINE is a disabled
sentence — "การ Login ทาง LIFF (LINE) ใช้ที่ Rich Menu บนแอป LINE" (`:161`) — i.e. today LINE login is reachable
**only** by opening a link inside the LINE app via a Rich Menu (`/liff/*` pages), which DocuFlow has none of and
isn't building one (that would require the LINE OA/Messaging-API work the CEO explicitly deferred). `/auth/line-
start` itself, however, has **no actual LIFF-SDK dependency** — it's a plain server route that redirects to
`access.line.me`'s standard OAuth consent page, which works in any mobile browser, not just LINE's in-app webview
(confirmed reading `app/auth/line-start/route.ts` in full — no `liff.init()` call anywhere in that file or its
callback). So the fix is purely "expose the button," not "build LIFF infrastructure."

**Files to edit:**
- `app/(auth)/login/login-form.tsx`:
  - Read `next` via `useSearchParams()` (client component already, `"use client"` at top).
  - After successful password login (`:79-80`), `router.push(next && next.startsWith("/") ? next : "/")` instead
    of the hardcoded `"/"` — same same-origin-only guard pattern already used server-side in
    `app/auth/line-start/route.ts`'s `safeRelPath()`.
  - Add a new "เข้าสู่ระบบด้วย LINE" link/button below the existing form, `href={`/auth/line-start?next=${
    encodeURIComponent(next ?? "/")}&module=default`}`. `module=default` intentionally reuses the existing
    shared/ChairOps LINE Login channel — per the workshop addendum ("ใช้ LINE Login เดิมได้ตรงๆ ไม่ต้องสร้างระบบ
    สิทธิ์ใหม่"), **no new LINE channel or `LineModule` entry is being added for DocuFlow.**
- `app/(auth)/login/page.tsx` — already an `async` server component; needs `searchParams: Promise<{ next?: string
  }>` threaded through as a prop to `<LoginForm next={...} />` (Next.js 15 App Router server components read
  `searchParams` server-side; the client form needs it passed as a prop rather than re-reading `useSearchParams()`
  redundantly — pick one, prefer the server-prop path since the page is already `async`).

**What is explicitly NOT being built here:** no new `/liff/docuflow` app, no Rich Menu, no push notification (all
correctly out of scope). No change to `ensurePoolMembership` or the maid self-registration logic in
`app/api/auth/line-login/route.ts` — DocuFlow signers resolve purely through the existing Pool-user matching
(`line_user_id` / `line_login_sub`), which already works for any staff member who has LINE-logged-in before.

**Genuine first-run friction, not a build item — flag for CEO/rollout communication (see §4 Q2):** a signer who
has *never* used LINE login anywhere in the system yet (no `line_user_id`/`line_login_sub` on their `users` row)
will hit the existing `needsLink: true` → `/auth/line-pending` path on first attempt — they see their verified
LINE id and must have an admin bind it via `/users/[id]` before they can sign. This is **pre-existing behavior**,
not something Track B changes, but it's worth the CEO knowing before rollout: LINE-signing "just works" instantly
only for staff who've already linked LINE (e.g. via ChairOps) at least once.

**Contended files:** `app/(auth)/login/login-form.tsx` and `page.tsx` are edited only by this item — but they are
**org-wide shared auth infrastructure**, used by every module, not DocuFlow-specific. This item's diff must be
purely additive (new optional `next`/LINE-button behavior; default behavior with no `next` param is byte-for-byte
unchanged) and should get its own `tsc` + a manual login smoke-test (password path, no `next`) before merging,
precisely because a mistake here is blast-radius-org-wide, not DocuFlow-scoped.

**Migration needed:** none.

---

### Item 14 — Preview-before-sign flow + saved-signature reuse

**Reality check (re-confirmed, matches task brief):** `signer-interface.tsx` renders only the single page containing
the placement (`ReactPdfPage pageNumber={placement.pageNumber}`, `:229-234`) and combines "draw" + "submit" in one
modal (`SignatureFullscreenPad`'s "ส่งลายเซ็น" button calls `handleSubmit` directly, `:398-407`) — no separate
"look, then confirm" step. `/sign/[placementId]/page.tsx` loads exactly one placement by id; it has no concept of
"show me every placement on this document," only "show me the one this link points at."

**Existing reusable pieces (do not rebuild):**
- `SignaturePlacementBox` (`components/docuflow/signature-placement-box.tsx`) already supports a `readOnly` prop
  and is used identically in both the admin editor and today's single-page signer view — the new full-document
  preview reuses it unchanged, just repeated once per page/placement instead of once total.
- The `ReactPdfDocument`/`ReactPdfPage` dynamic-import-with-`ssr:false` pattern is already proven twice
  (`signer-interface.tsx`, `signature-placement-editor.tsx`) — the admin editor (`signature-placement-editor.tsx`,
  970 lines) already does page-by-page navigation (`ChevronLeft`/`ChevronRight`) over a full multi-page PDF with
  overlaid boxes — this is the closest existing precedent for the new preview step's UI shape (read-only sibling
  of that navigation pattern, not its editable drag-and-drop logic).
- `embedSignatures()` (`lib/docuflow/signature.ts`) is **not touched at all** — it only ever reads whatever
  `signedImageKey` a placement row points at; every change below is about *what gets written there*, never about
  the embed step itself, per the explicit instruction.

**New component:**
- `components/docuflow/signer-document-preview.tsx` — client component. Props: `pdfUrl`, all placements on the
  document (not just the caller's), `currentPlacementId`. Renders every page (page-nav controls, mirroring the
  admin editor's pattern) with `SignaturePlacementBox` (readOnly) overlaid for every placement — the caller's own
  placement(s) visually emphasized (brand-colored border), other signers' placements shown dimmed/labeled with
  their role ("รอ: เจ้าของ", "รอ: พนักงาน") so the signer sees the whole document's signing plan, not just their
  own box — this directly satisfies the spec's "เห็นทุกตำแหน่งที่ลายเซ็นจะไปแปะ."

**Files to edit:**
- `app/sign/[placementId]/page.tsx`:
  - Fetch **all** placements for `placement.documentId` (not just the one), for the preview component.
  - Fetch the signer's saved-signature preview URL (`getMySignatureUrl(session.user.id)`, Item 12) and pass it
    down as a prop — `null` if none saved yet.
  - **Folds in Item 13's auth-redirect fix for this specific page:** replace `requireSession()` with a direct
    `getSession()` + manual `redirect(`/login?next=${encodeURIComponent(`/sign/${placementId}`)}`)` when absent —
    localizes the redirect-target behavior to this page instead of changing the shared `requireSession()` helper's
    signature (which is used by dozens of other pages; out of blast-radius scope for this plan). Bundled into this
    item, not Item 13, specifically because this file is already being rewritten here — avoids a second agent
    touching the same file in the same wave.
- `components/docuflow/signer-interface.tsx` — restructure into an explicit 2-step client flow (state machine:
  `"preview" | "confirm"`, replacing today's single-screen-plus-modal shape):
  1. **Step "preview"**: renders `<SignerDocumentPreview>` (new component above) + a single "ถัดไป → ยืนยันลาย
     เซ็น" button advancing to step 2. (If `placement.signedAt` is already set — i.e. this signer already signed —
     skip straight to the existing "ลงนามเรียบร้อย" done state, unchanged from today.)
  2. **Step "confirm"**: replaces today's `SignatureFullscreenPad`-only flow with a small decision surface:
     - **Has a saved signature** (`savedSignatureUrl` prop non-null): show the saved signature image + 3 actions —
       "ใช้ลายเซ็นนี้" (one-tap submit, new code path below), "วาดใหม่" (opens the existing fullscreen pad, submits
       normally), "ใช้ลายเซ็นอื่นสำหรับครั้งนี้" (same as "วาดใหม่" but explicitly does *not* overwrite the saved
       one — both map to the same draw pad, the distinction is copy/intent only, not different code).
     - **No saved signature yet**: opens the existing fullscreen pad as today, but before the final "ส่งลายเซ็น"
       submit, adds a checkbox "บันทึกลายเซ็นนี้ไว้ใช้ครั้งต่อไป" (default checked) — its value is sent as
       `saveAsDefault` in the submit body (below), satisfying the spec's "ถามว่าบันทึกไว้ใช้ครั้งต่อไปไหม" without
       a second round-trip.

**API changes:**
- `app/api/docuflow/[id]/signatures/[placementId]/sign/route.ts` — extend `BodySchema` from a single shape to a
  discriminated union:
  ```ts
  const BodySchema = z.union([
    z.object({ imageDataUrl: z.string()... , saveAsDefault: z.boolean().optional() }), // existing shape + 1 new optional field
    z.object({ useSavedSignature: z.literal(true) }),                                  // new: one-tap saved-signature path
  ]);
  ```
  - `useSavedSignature` path: loads `session.user`'s `savedSignatureKey` (404/400 if none saved — client shouldn't
    offer this button in that case, but the API must not trust that), **copies** those R2 bytes into this
    placement's own dedicated key (`signatures/${orgId}/${placementId}/${ts}.png`, same key shape as today) rather
    than pointing `signedImageKey` at the shared saved-signature key directly. **Why copy instead of point:** (1)
    keeps each placement's signed artifact immutable — if the user later changes their saved signature, previously
    signed documents must not retroactively appear to change; (2) zero changes needed to `embedSignatures()` or
    the placement schema, it still just reads `signedImageKey` as today; (3) preserves the existing per-signature
    audit/rollback discipline in this route (R2-then-DB-with-rollback, `:153-184`) unchanged.
  - `imageDataUrl` path with `saveAsDefault: true`: after the existing successful placement update, additionally
    calls `saveMySignature()` (Item 12's helper) in the same request. Best-effort — if the save-default write
    fails, still return success for the signing itself (the placement is the source of truth for "did they sign,"
    not the convenience save); log the failure server-side.

**Contended files:** `app/sign/[placementId]/page.tsx`, `signer-interface.tsx`, and the sign API route are edited
**only** by this item within Track B — no overlap with Items 11/12/13's files. Soft dependency on Item 13 (needs
`/login?next=` to actually work for the "not logged in" redirect to round-trip back to the sign page) and Item 12
(needs `savedSignatureKey` to exist on the Prisma client).

**Migration needed:** none new (consumes Item 12's).

---

## §2. Build waves

Two real gating constraints found: (a) Items 11 and 12's schema changes must land + `prisma generate` before any
code that reads the new columns (Item 11's build-out, Item 14's saved-signature offer) can typecheck; (b) Item 14
has a soft dependency on Item 13's `/login?next=` support actually existing, but not on Item 13's *files* being
mid-edit — Item 13 is small enough to fully land in Wave 1.

```
WAVE 1 — 3 parallel agents, no shared files, schema-only + one fully-independent UI item
├─ Agent A — Item 11, SCHEMA-ONLY (prisma/schema.prisma Document columns + migration SQL)
├─ Agent B — Item 12, SCHEMA-ONLY (prisma/schema.prisma User columns + migration SQL)
└─ Agent C — Item 13, full item (login-form.tsx `next` param + LINE button + page.tsx searchParams threading)

  ⚠️ CHECKPOINT 1 (mandatory): apply Agent A + B's migrations → `prisma generate` → full-repo `tsc`. Also smoke-
     test Agent C's login page manually (password login with no `next` param still lands on `/`) before Wave 2 —
     this file is shared org-wide infrastructure, a regression here is not DocuFlow-scoped.

WAVE 2 — 3 parallel agents, all depend on Checkpoint 1
├─ Agent D — Item 11 build-out (export `uploadBytes` from lib/chairops/storage/drive.ts, new
│                                lib/docuflow/drive-export.ts, drive-export API route, document-detail button,
│                                settings-hub status card) — depends on Agent A's Document columns
├─ Agent E — Item 12 build-out (lib/docuflow/my-signature.ts, /profile/signature page + form + API route,
│                                /profile/page.tsx link card) — depends on Agent B's User columns
└─ Agent F — Item 14, full item (signer-document-preview.tsx, signer-interface.tsx 2-step restructure,
                                  sign API route's saveAsDefault/useSavedSignature, /sign/[placementId]/page.tsx
                                  auth-redirect + all-placements fetch) — depends on Agent B's User columns
                                  (savedSignatureKey) and Agent C's Wave-1 login changes being live

  ⚠️ CHECKPOINT 2 (mandatory, final): full-repo `tsc` + `next build`. Manual mobile screenshot pass (per this
     org's standing screenshot-to-CEO convention) across, at minimum: document-detail page's new Drive-export
     button (all 3 states), settings hub's new Drive-status card, `/profile/signature` (empty + saved states),
     `/sign/[placementId]` preview step, confirm step with a saved signature, confirm step with no saved signature
     (draw + save-as-default checkbox), `/login` with the new LINE button, and the full round trip: `/login →
     LINE OAuth → back to the original sign link` (this specific round trip is the one genuinely new integration
     path in this whole plan — test it for real, not just each page in isolation).
```

**Minimum wave count: 2** (plus 2 mandatory checkpoints). Track B has fewer cross-cutting items than Track A
(nothing here touches design tokens or 15 files at once), so it parallelizes more cleanly — the only real
sequencing constraint is schema-before-consumers, same shape as Track A's Item 3 gate.

---

## §3. Summary of every new/changed file

**New files:**
- `lib/docuflow/drive-export.ts`, `app/api/docuflow/[id]/drive-export/route.ts`
- `lib/docuflow/my-signature.ts`, `app/(admin)/profile/signature/page.tsx`,
  `app/(admin)/profile/signature/signature-form.tsx`, `app/api/profile/signature/route.ts`
- `components/docuflow/signer-document-preview.tsx`
- `components/docuflow/signature-pad.tsx` (optional extraction, nice-to-have, see Item 12)
- `supabase/migrations/<ts>_docuflow_drive_tracking.sql`, `supabase/migrations/<ts>_docuflow_saved_signature.sql`

**Edited files:**
- `prisma/schema.prisma` (Item 11: `Document` + `User` Drive-export relation; Item 12: `User` saved-signature
  columns) — both items touch this file; land Wave 1, no runtime contention since both are pure additions in
  different parts of the same models.
- `lib/chairops/storage/drive.ts` (Item 11 — export `uploadBytes`, one-word change)
- `app/(admin)/docuflow/documents/[id]/page.tsx` (Item 11 — export button)
- `app/(admin)/docuflow/settings/page.tsx` (Item 11 — Drive status card)
- `app/(admin)/profile/page.tsx` (Item 12 — signature link card)
- `app/(auth)/login/login-form.tsx`, `app/(auth)/login/page.tsx` (Item 13)
- `app/sign/[placementId]/page.tsx`, `components/docuflow/signer-interface.tsx`,
  `app/api/docuflow/[id]/signatures/[placementId]/sign/route.ts` (Item 14)

**Explicitly NOT touched:** `lib/docuflow/signature.ts` (`embedSignatures()` — reused as-is, per instruction),
`lib/dc/drive-store.ts` (its own `uploadBytes` copy left as-is, out of scope to refactor), any LINE
Messaging-API/OA code, `lib/line/channels.ts` (no new `LineModule` entry — `module=default` reused as-is).

---

## §4. Risks / Open Questions for CEO

**Q1 — Google Drive: opt-in export button (this plan) vs. always-on auto-mirror (implied by the task brief's
phrasing "mirror after a successful R2 upload... hook into the upload flow").** These are genuinely different
designs, and I did not pick silently — I followed the workshop's own locked resolution (§3 Debate Highlights:
"ปุ่ม 'Export ไป Drive' แบบเลือกไฟล์ (one-way, opt-in ต่อคน ไม่ใช่ access-gate ขององค์กร)"), which also happens to
be the technically simpler path: DocuFlow's presigned-upload route (used for files >25 MB) never actually receives
the file bytes server-side — the browser PUTs straight to R2 — so an automatic upload-time mirror would need an
*additional* client round-trip after the R2 PUT succeeds anyway, at which point it's architecturally identical to
"call an export endpoint," just with worse UX (silently happens vs. a visible, cancelable action). **Flagging for
explicit confirmation because the task brief and the locked spec describe two different mechanisms** and I want
the CEO's sign-off on which one ships, not an assumption either way.

**Q2 — First-time LINE-login friction for signers (§Item 13).** A staff member who has never linked LINE to their
Pooilgroup account before (no ChairOps/other-module LINE usage) will hit the existing "ask an admin to bind my
LINE id" wall on their very first sign attempt. This is pre-existing system behavior, not a new bug, but worth
knowing before announcing "sign documents via LINE" broadly — the CEO may want a one-time heads-up to staff, or to
pre-check which staff already have `line_user_id`/`line_login_sub` set.

**Q3 — Drive-export button permission level.** The workshop's "opt-in ต่อคน" phrasing is about the *mechanism*
(an explicit per-action choice vs. an org-wide always-on gate), not necessarily about *who* may trigger it. This
plan gates the export button at `requireProgramAdminTier`, matching every other mutating action on the same
document-detail page (sign-request, delete). If the CEO's intent was closer to "any staff member who can view a
document can also choose to export their own copy to the shared Drive," that's a one-line gate change
(`isProgramAdminTier` → `isExecutiveRole`, matching the page's own view-gate) — flagging so it's a deliberate
choice, not a default nobody looked at.

**Q4 — Re-export overwrite semantics.** If a document is exported to Drive, then later re-signed (a new
`signedFileKey` is produced) or replaced, the plan's default is "re-export overwrites the tracked Drive file-id
with a fresh upload" (not "keep both copies in Drive" or "auto re-export on every change"). This matches "one-way
export snapshot," not "two-way sync" — confirm this matches intent, since a signed-then-re-signed document
scenario isn't explicitly covered in the CEO's original brief.

---

## §5. Domain/architecture notes carried over from the workshop (not re-litigated, just indexed)

- RLS discipline (Track A's hard-won lesson from the 2026-09-22 43-table incident) **does not apply to any new
  table in this plan** — there are no new tables, only additive nullable columns on already-RLS-protected
  `documents` and `users`. Verify this remains true if any build agent decides mid-build that a table is needed
  after all (e.g. if Q1 above comes back "auto-mirror + full audit history of every mirror event" — that shape
  *would* need its own table + RLS, unlike the opt-in-snapshot shape this plan assumes).
- Env-var namespacing convention (from the workshop's own Integration Map, re: `RECRUIT_CHANNEL_KEY` reuse
  incident): **not triggered by this plan** — no new LINE channel, no new encryption key, no new env var of any
  kind. Both Drive and signature-registration reuse fully-existing infrastructure.
