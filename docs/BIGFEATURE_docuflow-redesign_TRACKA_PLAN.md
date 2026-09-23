# DocuFlow Redesign — Track A File-Level Build Plan

> Generated 2026-09-23. Source spec: `docs/WORKSHOP_docuflow-redesign.md` §0/§0.1/§5/§6 (present in the shared
> checkout `pooilgroup-web/docs/`, **not yet synced into this worktree** — see §0 Preflight below).
> Scope: **Track A only** (menu/settings/filters/DocumentType/upload-form/design repaint). Track B (Google Drive +
> full signature workflow + LINE OA) is explicitly out of scope for this plan.

---

## §0. Preflight — read this before spinning up any build-wave agent

**0.1 — Worktree is far behind `origin/setup`.**
`git rev-list --left-right --count HEAD...origin/setup` from this worktree returns `152  1530` — i.e. `origin/setup`
has **1,530 commits** this worktree doesn't have, while this worktree carries 152 commits `origin/setup` lacks
(it was branched from an old point, not from current `setup`). Corroborating evidence: the workshop spec file
`docs/WORKSHOP_docuflow-redesign.md` exists in the shared checkout but **404s inside this worktree** — it was
added to `setup`/`main` after this worktree's branch point. **Do not start Wave 1 until this worktree is rebased
or recreated from current `origin/setup`.** All file:line references in this plan were read from the worktree's
*current* (stale) state — re-verify line numbers after the sync, they will likely have drifted.

**0.2 — No direct file-level conflict found, but two recent commits touched shared infra that DocuFlow depends on:**
`git log origin/setup -15 --oneline -- "app/(admin)/docuflow" "app/api/docuflow" "lib/docuflow" "components/docuflow"`
returned (newest first):
```
46ef4710 feat(auth): program_admin เข้าทุกฟังก์ชันของโปรแกรมที่ติ๊กให้ (เว้นการเชื่อมต่อ)
6d303b73 feat(metadata): ชื่อแท็บเบราว์เซอร์แยกตามโปรแกรม (เลิกขึ้น "Pooilgroup ERP" เหมือนกันหมด)
3ed43829 feat(access): program-admin = แอดมินจริงใน 6 โปรแกรม (Phase 2 · grant-scoped)
3ffa11b1 feat(chairops): full UI redesign to match CEO mockup — 5 surfaces (#7)
5ef20e62 fix(docuflow): UAT critical findings — role gates · rate limit · perf
71605048 feat(docuflow): polish — 8 defer items shipped + integration check
90acab61 feat(docuflow): advanced capabilities — sharing · AI search · risk · signature · renewal
a1d294da feat(docuflow): bootstrap module — schema · CRUD · expiry · vehicles · renew
259df51f feat(auth): per-user module access (CashHub / FuelOS / DocuFlow)
...
```
`6d303b73` (per-program browser tab titles) confirmed touching `app/(admin)/docuflow/layout.tsx` (verified via
`git log -- app/(admin)/docuflow/layout.tsx`). None of the 10 Track A items' target files (documents/browse pages,
upload-form, docuflow.css, signature.ts, df-mobile-nav/df-top-banner, canonical-docs.ts, workflow/page.tsx) show up
in recent commit history — **no active concurrent-session conflict on the specific files this plan edits**, only
the shared `layout.tsx` picked up an unrelated metadata change that Wave 1 / Item 8+10 agents must not clobber.

**0.3 — Role-guard naming gap.** The workshop spec (§6, Consensus #4) says the settings hub should reuse a gate
called `userIsModuleAdmin`. **No such function exists in this codebase.** Every existing DocuFlow admin-only page
(`documents/upload/page.tsx:26`, upload API routes) uses `requireAdminTier` / `isAdminTier` from
`lib/auth/role-guards.ts`. The `recruit/settings` pattern being copied actually uses its own module-specific
`requireRecruitAdmin` (`lib/recruit/role-guard.ts`) — DocuFlow has no equivalent module-scoped wrapper, only the
org-wide `requireAdminTier`. **Recommendation: use `requireAdminTier` for the settings hub, matching every other
admin-gated DocuFlow page already in the codebase.** Do not invent a new `docuflow/role-guard.ts` unless the CEO
wants module-scoped admin (distinct from org-wide admin) — that would be new scope beyond what §6 asked for.

---

## §1. Item-by-item plan

### Item 1 — `docuflow/settings` hub + sub-routes

**Files to create:**
- `app/(admin)/docuflow/settings/page.tsx` — hub shell, pattern-copied from `app/(admin)/recruit/settings/page.tsx`
  (read in full: stat row + `SettingsCard` grid + `Row` list, gated by `requireRecruitAdmin`).
  **Gap:** recruit/settings styles with raw Tailwind utility classes (`bg-green-50`, `border-purple-200`, etc.) —
  DocuFlow's existing pages style via inline `style={{}}` referencing `var(--df-*)` + the `Df*` primitives in
  `components/docuflow/df-ui.tsx` (`DfCard`, `DfButton`, `DfPageHeader`, `DfSection`, `DfPill`). **Do not literally
  copy recruit's Tailwind classnames** — rebuild the same hub+cards structure using `DfCard`/`DfSection`/`DfPill`
  so it inherits the Item 5 repaint automatically instead of hardcoding a second, inconsistent palette.
  Gate: `requireAdminTier` (see §0.3).
- `app/(admin)/docuflow/settings/document-types/page.tsx` — CRUD list for the new `DocumentType` entity (Item 3).
  **Depends on Item 3's migration landing first** (see waves).
- `app/(admin)/docuflow/settings/notifications/page.tsx` — **gap, needs a decision, not a silent move.** The only
  existing "notification settings" UI is `app/(admin)/docuflow/notifications/page.tsx:339-392` (ช่องทางแจ้งเตือน
  toggle list) and `:395-431` (เตือนล่วงหน้า list) — both are **100% hardcoded, non-functional** (`on: true/false`
  literals, no `onClick`, no persistence; same shape as the "142 ครั้ง" problem Item 6 targets, just not a number).
  Moving this UI verbatim into the new settings route doesn't create real config, it just relocates fake UI into a
  page literally named "settings." Recommend following `recruit/settings`'s own precedent (`page.tsx:126-136`,
  which labels unbuilt channels `status="คิวพร้อม (Phase 2)"` instead of a toggle) — render the channel list with
  `Row` components locked/labeled "อยู่ในแผน Track B" rather than interactive-looking toggles that do nothing.
- `app/api/docuflow/document-types/route.ts` (GET list / POST create) and
  `app/api/docuflow/document-types/[id]/route.ts` (PATCH / DELETE) — new, admin-tier gated, org-scoped.

**Files to edit:**
- `app/(admin)/docuflow/settings/page.tsx` (new file above) links out to:
  - `/branches/new` (existing, working, generic branch-creation page — **do not duplicate it**, just add a
    `SettingsCard` linking there)
  - `/users/page.tsx` equivalent route `/users` (existing org-wide user/admin management — confirmed via repo
    search; **no DocuFlow-specific admin-creation page exists or should exist**)
  - Company creation: **confirmed nothing exists anywhere in the repo** (`grep` for company-creation UI returned
    no real hits). §6 "Won't" list explicitly excludes building this in Track A. The settings hub should either
    omit a company-creation card entirely, or show a disabled card with a one-line "ยังไม่มีในระบบ" note — do not
    build new company-creation UI here, it's cross-module scope per the locked spec.
- `app/(admin)/docuflow/browse/page.tsx:241-262` — the dead `<Link href="/docuflow/settings">` (ตั้งค่าประเภทเอกสาร
  tile) becomes live once the hub exists. **This file is being converted to a redirect stub by Item 2** — so this
  dead-link fix is inherited automatically once Item 2 lands; no separate edit needed here.

**Contended files:** none new-file-only except the `browse/page.tsx` link, which Item 2 already owns.

**Migration needed:** the `document-types` sub-route needs Item 3's schema. No new migration of its own.

---

### Item 2 — Merge `/docuflow/browse` + `/docuflow/documents` into one page

**Reality check (both files read in full):**
- `documents/page.tsx` is already the "real" page: server-rendered, calls `loadDocuments()`/`loadDocumentsSharedToBranch()`
  with live Prisma filters (level/tag/status/search/branchId/companyId/businessType), uses `DocumentFilters`
  (`components/docuflow/document-filters.tsx`) which is a working client component that writes to the URL via
  `router.replace` — this is the pattern Item 2 asks to extend to "the 3 decorative tabs."
- `browse/page.tsx` has: (a) a category-tile grid (§A, real — tiles link to
  `/docuflow/documents?tag=${category}`, this part already works), (b) a company/branch tree via `TreeBrowser`
  (§B, real — reads `buildDocumentTree()`), (c) a **decorative** right-hand "รายละเอียดประเภท" detail panel with a
  hardcoded sample-doc array (`browse/page.tsx:431-436`, labeled "ตัวอย่างเอกสารในหมวดนี้" so not deceptive, but
  dead weight), and (d) the actual "3 decorative tabs": the `df-seg` view-toggle at `browse/page.tsx:104-108`
  (`ตามประเภท` / `ตามบริษัท` / `รายการ`) — only `ตามประเภท` (`df-on` class, hardcoded) does anything; the other two
  buttons have no `onClick` at all.

**Files to edit:**
- `app/(admin)/docuflow/documents/page.tsx` — becomes the **canonical merged page**. Add:
  1. A `?view=` query param (same `router.replace` pattern as `DocumentFilters`) driving 3 real views:
     `category` (renders the existing tile grid from browse, now real since tiles already link into real filters),
     `tree` (renders `TreeBrowser`, unchanged), `list` (today's filter-chip + `DocumentCard` grid — unchanged).
     This is what makes the 3 tabs "do real Prisma queries" — each tab is a genuinely different rendering of the
     same already-live data, not a dead button.
  2. Fold the "ใกล้หมดอายุ" entry point in as the existing `EXPIRY_CHIPS` (already present, `documents/page.tsx:41-46`)
     — no new code, just make sure the chip row is visible by default instead of requiring a separate
     `/docuflow/expiry` visit. `/docuflow/expiry` can stay alive as a deeper calendar-style dashboard (it has a
     month calendar widget `expiry/page.tsx:466-552` that a flat filter chip can't replicate) but is no longer a
     *primary* discovery path — home page's stat cards / section 02 keep linking there (Item 9).
  3. Add a prominent "ถาม AI" button in the page header actions, linking to `/docuflow/search` (unchanged
     internally — AI search is a different interaction paradigm, hero+chat, not a filter; collapsing it into a
     button rather than deleting it matches the spec wording "ยุบ...เข้าเป็น filter chip **+ ปุ่ม**").
- `app/(admin)/docuflow/browse/page.tsx` — **rewrite to a redirect stub**, same pattern already used at
  `documents/upload/template/page.tsx:9-11` (`redirect("/docuflow/documents/upload")`). New body:
  `redirect("/docuflow/documents" + (search ? "?" + search : ""))` — preserve `?tag=` query so existing links
  from other pages (e.g. home page stat card, see Item 9) keep working without their own edits.
- `app/(admin)/docuflow/page.tsx:340` — home page "เอกสารทั้งหมด" `DfStatCard` currently `href="/docuflow/browse"`.
  Since browse becomes a redirect this technically still works, but update it to point directly at
  `/docuflow/documents` to avoid an unnecessary redirect hop (small, bundle into this same edit pass — this is
  the Item 9 "≤1 tap" concern: a redirect hop doesn't cost an extra tap, so this is a nice-to-have not a
  correctness fix).

**Reused unchanged:** `components/docuflow/document-filters.tsx`, `components/docuflow/tree-browser.tsx`,
`components/docuflow/document-card.tsx` — all already real, no edits needed.

**Contended files:** `documents/page.tsx` and `browse/page.tsx` are edited **only** by Item 2 in Wave 1. Item 5
(repaint) touches `documents/page.tsx` again later (Wave 3, colors only) — sequenced after, not concurrent.

**Migration needed:** none.

---

### Item 3 — New `DocumentType` DB entity (hybrid with `canonical-docs.ts`)

**Reality check:** `Document.documentType` (`prisma/schema.prisma:975`) is **already a free-text nullable String**
column (`@@index([orgId, documentType])` at line 999), and **both** upload API routes
(`app/api/docuflow/upload/route.ts:70,167` and `app/api/docuflow/upload-proxy/route.ts:69,188`) already accept and
persist a `documentType: string` field end-to-end — it's just never sent by the current `upload-form.tsx` (no such
field exists in its `FormSchema`). This confirms the Integration Map's instruction: add `documentTypeId` as a
**new, additive, nullable FK** — the old string field is already wired and must not be touched.

**`lib/docuflow/canonical-docs.ts`** (read in full, 901 lines) is the seed source: `CanonicalDocSpec` has
`name / frequency / regulator / dangerLevel / category / description`, keyed per `BusinessTypeKey` (14 business
types incl. FuelOS `transport`/`gas_fleet`). This shape maps directly onto the new table.

**Prisma schema addition** (`prisma/schema.prisma`, insert near `Document`/`DocumentOwnership` at line ~1007):
```prisma
model DocumentType {
  id           String   @id @default(uuid()) @db.Uuid
  orgId        String   @map("org_id") @db.Uuid
  name         String
  category     String?  @map("category")        // license | permanent | form | personnel — from canonical-docs.ts DocCategory
  businessType String?  @map("business_type")    // optional link to a BusinessTypeKey; null = applies org-wide
  frequency    String?                            // ทุกปี / ทุก 2 ปี / ... (DocFrequency label, display-only)
  dangerLevel  String?  @map("danger_level")      // critical | high | medium | low
  regulator    String?
  description  String?
  canonicalKey String?  @map("canonical_key")     // traceability back to a canonical-docs.ts spec.name, nullable
  isActive     Boolean  @default(true) @map("is_active")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  org       Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  documents Document[]

  @@unique([orgId, name])
  @@index([orgId, isActive])
  @@map("document_types")
  @@schema("public")
}
```
And on `model Document` (additive only, next to line 975):
```prisma
  documentTypeId String?       @map("document_type_id") @db.Uuid
  documentTypeRef DocumentType? @relation(fields: [documentTypeId], references: [id], onDelete: SetNull)
```
plus `@@index([orgId, documentTypeId])`.

**Migration file:** new `supabase/migrations/<timestamp>_docuflow_document_types.sql`. Per the SA hard line in
the spec's Integration Map (RLS gap incident 2026-09-22, 43 tables), **the RLS policy MUST ship in the same
migration file as the `CREATE TABLE`** — do not defer it. Follow the exact pattern already used in
`supabase/migrations/20260508000002_docuflow_foundation.sql:189-276` (service-role-all policy + org-isolation
policy per table, `ENABLE ROW LEVEL SECURITY` right after each `CREATE TABLE`). Concretely: `CREATE TABLE
document_types (...)`, `ALTER TABLE document_types ENABLE ROW LEVEL SECURITY;`, `CREATE POLICY
"document_types_service_role_all" ...`, `CREATE POLICY "document_types_org_isolation" ...`, then the
`ALTER TABLE documents ADD COLUMN document_type_id uuid REFERENCES document_types(id) ON DELETE SET NULL;` +
its index, in the same file.

**Files to create:**
- `lib/docuflow/document-types.ts` — hybrid data-access helper: `listDocumentTypes(orgId)` reads the new table;
  `seedDocumentTypesForBizType(orgId, bizType)` (or a lazy fallback inside the loader) falls back to
  `getCanonicalDocsForBizType()` when the org has zero rows for that business type — **no auto-fuzzy-merge**, per
  the locked decision (§4.2) this is read-time fallback only, not a write-time backfill. A separate, explicit
  "import from canonical list" action (admin-triggered button in the settings/document-types page, one row at a
  time or "import all for X business type") is the only path that writes rows — never automatic.
- Extend `lib/docuflow/data.ts`'s `loadDocuments()` to accept an optional `documentTypeId` filter param (small,
  additive — mirrors the existing `businessType`/`tag`/`level` params already there).

**Contended files:** `prisma/schema.prisma` is edited **only** here. No other Track A item touches the schema.

**Migration needed:** yes — see above. **This is the one hard dependency gating Waves 2+.**

---

### Item 4 — Upload form: explicit fields, expiry, auto-fill, multi-file

**Reality check (`components/docuflow/upload-form.tsx`, 724 lines, read in full):**
- Company/branch data **is** already available as props (`companies`, `branches` from `upload/page.tsx:29-51`)
  but surfaced through a single fuzzy combobox ("เก็บไว้ที่ไหน", `upload-form.tsx:512-577`) that also mixes in
  group/business-type/person scopes — not "explicit company/branch fields" as the spec phrase implies. **Spec-vs-
  reality gap, flagged not silently resolved:** the existing scope-picker is strictly *more* capable (5 scope
  kinds, multi-select) than a classic 3-dropdown company→branch→type cascade, and it already round-trips through
  a working, tested API (`buildOwnerships()` → `OwnershipSchema` on both upload routes). **Recommendation:** keep
  the existing scope picker as-is (don't rebuild a simpler-but-less-capable UI) and only *add* the new, genuinely
  missing piece — a `documentTypeId` select — rather than replacing working code. If the CEO specifically wants a
  simplified 3-field cascade instead of the multi-scope picker, that's a UX regression trade-off that needs an
  explicit call-out, not a silent rebuild.
- **No `documentType` field exists in `FormSchema` at all** (`upload-form.tsx:38-44`) despite both API routes
  already accepting it (see Item 3) — pure oversight, straightforward to add.
- **Single-file only**: `const [file, setFile] = useState<File | null>(null)` (`:111`), `handleFileChange` (`:204`),
  file input has no `multiple` attribute (`:394-405`). Multi-file requires converting this to `File[]`.
- **No auto-fill of last-used values** anywhere in this component.
- `upload/page.tsx` **does not read `searchParams` at all**, despite `checklist/page.tsx:377` already linking to
  it with `?businessType=${r.bizType}` — that query param is silently dropped today. Dead functionality,
  worth fixing in the same pass since it's directly adjacent to the "auto-fill" ask.

**Files to edit:**
- `components/docuflow/upload-form.tsx`:
  - Add `documentTypeId: z.string().optional()` to `FormSchema`, render a new `<select>` (reuse the existing
    "ตั้งค่าขั้นสูง" collapsible pattern at `:593-679`, or promote it to a top-level required-ish field since the
    spec calls it out as "explicit" — recommend top-level, not buried in advanced).
  - `file: File | null` → `files: File[]`; dropzone `onDrop`/`onChange` append instead of replace; add a
    `multiple` attribute to the `<input type="file">` (`:394-405`).
  - Replace the single `onSubmit` upload call (`:325-358`) with a loop over `files`, each going through the
    existing `uploadViaProxy`/`uploadViaPresigned` (unchanged internals — spec explicitly says "loop the existing
    single-file endpoint," not a new batch API), tracking per-file `{status, documentId?, error?}` in a small
    state array, rendered as a list (this can reuse/replace the currently-decorative "คำลังอัปโหลด · 3 ไฟล์" demo
    block in `upload/page.tsx:95-245`, which is explicitly labeled `"ตัวอย่างคิวอัปโหลด — เริ่มอัปโหลดจริงจะเห็น
    ข้อมูลของคุณตรงนี้"` — a nice synergy: multi-file lands, that placeholder becomes the real thing).
  - Auto-fill last-used values: **use `localStorage`, not a new DB table.** Per the ladder-thinking check (does
    the browser already solve this? yes) — persist `{ lastDocumentTypeId, lastScopes }` keyed by
    `docuflow-upload-lastused:${orgId}` on successful submit, `useEffect` prefill on mount. No schema, no new
    infra, no cross-device sync needed for a same-person "remember what I picked last time" convenience feature.
- `app/(admin)/docuflow/documents/upload/page.tsx`:
  - Add `searchParams: Promise<{ businessType?: string }>` prop, thread `businessType` through as a default/prefill
    value passed into `UploadForm` (fixes the dead `checklist/page.tsx:377` link).
  - Fetch `listDocumentTypes(orgId)` (Item 3's helper) and pass as a new `documentTypes` prop to `UploadForm`.
  - The decorative "คำลังอัปโหลด" block (`:95-245`) gets replaced by the real per-file status list once
    `upload-form.tsx` supports multi-file (state needs lifting up, or keep it inside `UploadForm` and simplify
    `upload/page.tsx` to just render `<UploadForm />` — recommend the latter, less prop-drilling).
- `app/api/docuflow/upload/route.ts` and `app/api/docuflow/upload-proxy/route.ts`: add optional
  `documentTypeId: zUUID().optional()` to their Zod schemas, write it to `Document.documentTypeId` alongside the
  existing `documentType` string write — **additive, both fields persist independently.**

**Contended files:** `upload-form.tsx`, `upload/page.tsx`, both upload API routes — edited **only** by Item 4.

**Migration needed:** none new (consumes Item 3's migration). **Hard dependency on Item 3's schema landing +
`prisma generate` first** — `documentTypeId` won't exist on the Prisma client otherwise.

---

### Item 5 — Repaint `docuflow.css` tokens to CashHub/RentSpace family

**Reality check — this is the highest blast-radius item, bigger than "edit one CSS file."**
`docuflow.css` (`app/(admin)/docuflow/docuflow.css`, 448 lines, read in full) does define a real CSS-custom-
property system (`--df-bg`, `--df-brand`, `--df-ink`, etc., lines 33-81) that most pages correctly consume via
`var(--df-*)` in inline `style={{}}`. **But** a `grep` for `#[0-9A-Fa-f]{6}` across the module found **15 files
with hardcoded literal hex colors that bypass the token system entirely** and will NOT repaint just by editing
`docuflow.css`:

| File | Hardcoded hex found |
|---|---|
| `app/(admin)/docuflow/page.tsx:755` | `linear-gradient(180deg, #FAF6EE, #FFFFFF)` |
| `app/(admin)/docuflow/page.tsx:1062` | `linear-gradient(135deg, #0E1B2C 0%, #1B47B5 100%)` |
| `app/(admin)/docuflow/expiry/page.tsx:616` | `linear-gradient(135deg, #0E1B2C 0%, #1B47B5 100%)` |
| `app/(admin)/docuflow/workflow/page.tsx` | 8 distinct hex literals (gradient + tone colors) — **N.B. this file is also being gutted by Item 6**, sequence repaint after |
| `app/(admin)/docuflow/browse/page.tsx:53-60` | 8 per-category accent hexes (decorative category tags) — **being redirect-stubbed by Item 2**, low priority here |
| `components/docuflow/df-mobile-nav.tsx:60` | `background: "rgba(255, 251, 244, 0.94)"` (cream, hardcoded, not a `var()`) |
| `components/docuflow/df-ui.tsx:515-525` | `DF_CATEGORY_COLORS` map, 8 hex values — decorative category-distinguisher colors, judgment call below |
| `components/docuflow/viewer-tabs.tsx:133` | `background: "#E8E1D2"` (preview pane backdrop) |
| `components/docuflow/upload-form.tsx` | several zinc/brand literals mixed with Tailwind CSS-var fallbacks |
| `components/docuflow/signer-interface.tsx`, `renewal-history-section.tsx`, `approval-timeline.tsx` | scattered zinc/status hexes |

**Exact target palette** — pulled from `components/cashhub/redesign/tokens.css` (the only real precedent found;
no RentSpace-specific token file exists in `app/`/`components/` — **recommend the repaint agent spot-check a
rendered RentSpace page too before finalizing**, since this plan only verified CashHub's token source):
```css
--ch-brand: #1e3aff;      --ch-brand-700: #1830d4;   --ch-brand-50: #eef1ff;
--ch-navy: #0b1850;       --ch-bg: #ffffff;          --ch-bg-2: #f7f8fb;   --ch-bg-3: #f0f2f7;
--ch-border: #e6e9f1;     --ch-text: #0f172a;        --ch-text-2: #475569; --ch-text-3: #94a3b8;
--ch-ok: #16a34a; --ch-ok-soft: #dcfce7;   --ch-pending: #f5b800; --ch-pending-soft: #fef6cf;
--ch-danger: #dc2626; --ch-danger-soft: #fee2e2;
```

**Recommended `docuflow.css` token rewrite** (`:14-81`, keep every property name, change only values):
```
--df-bg: #FFFFFF (was #F4EEE2)              --df-bg-warm → #F7F8FB (was #EFE6D2)
--df-surface: #FFFFFF (unchanged)           --df-surface-soft: #F7F8FB (was #FAF6EE)
--df-ink: #0F172A (was #0E1B2C)             --df-ink-2: #475569 (was #1F2D44)
--df-muted: #64748B (was #6B7488)           --df-muted-2: #94A3B8 (was #9AA1B2)
--df-line: #E6E9F1 (was #E4DCCB)            --df-line-soft: #F0F2F7 (was #EFE7D6)
--df-brand: #1E3AFF (was #1B47B5)           --df-brand-deep: #1830D4 (was #0E2D7A)
--df-brand-soft: #EEF1FF (was #E6ECFA)
--df-success: #16A34A (was #1F7A4D)         --df-success-soft: #DCFCE7 (was #DCEFE2)
--df-danger: #DC2626 (was #B23A2F)          --df-danger-soft: #FEE2E2 (was #F6DDD7)
--df-warn: #B45309 (kept amber-700-ish, CashHub has no separate warn-text token — judgment call, flag for design sign-off)
--df-accent: #F5B800 (was #C46A3D — remaps DocuFlow's "urgent/pending" accent onto CashHub's --ch-pending; open question, see below)
```
Font: `.df-serif` (`:102-107`) → `font-family: var(--font-thai-display), sans-serif;` (Anuphan, already globally
loaded via `next/font/google` in `app/layout.tsx:16-21`, `variable: "--font-thai-display"`) — remove the
`"IBM Plex Serif Thai", "Noto Serif Thai", Georgia, serif` fallback chain entirely. **Confirmed: no TTF/OTF or
webfont for "IBM Plex Serif Thai" exists anywhere in the repo — it's currently falling back to system Georgia on
every browser**, so this isn't just an aesthetic swap, it fixes a font that was silently never loading.

**Open judgment calls for the repaint agent to flag back, not silently decide:**
1. `--df-accent` (terracotta → CashHub's amber "pending" color): DocuFlow uses accent for "รอเซ็น/ด่วน" badges —
   semantically close to "pending," so the remap fits, but verify against an actual rendered CashHub/RentSpace
   screen (not just the token file) before committing.
2. `DF_CATEGORY_COLORS` (`df-ui.tsx:515-525`) and the browse-page category tile hexes: these are *category-
   distinguishing* accent colors (tax=green, insurance=purple, etc.), not part of the cream-vs-blue brand debate.
   Recommend leaving them as a multi-hue accent set (just verify they still read fine against a white background
   instead of cream) rather than flattening everything to one blue — but this is a call the CEO/design reviewer
   should confirm, not something to assume.
3. The dark-navy sidebar override block (`docuflow.css:388-448`, `[data-module="docuflow"] > .flex-1 > aside`)
   currently gives DocuFlow's *desktop sidebar* a distinct dark-navy look from other modules. §6 "Won't" list
   excludes desktop-sidebar work this round ("ผู้ใช้จริง 100% ใช้มือถือ") — leave this block untouched.

**Contended files:** this item touches files from nearly every other item. **Must run as its own final wave**,
after all structural/functional edits land — see §2 Build Waves.

**Migration needed:** none.

---

### Item 6 — Remove fake "142 ครั้ง" + sweep for other hardcoded-stats-shown-as-real

**Reality check:** `app/(admin)/docuflow/workflow/page.tsx:47-69` — the `TEMPLATES` const, 4 entries, each with a
literal `used: <number>` (142, 38, 12, 891). Rendered at `:605-610` as `ใช้ {t.used}` with **zero label indicating
it's a mock** (unlike the browse-page sample-docs array or upload-page demo queue, both of which carry an
explicit "ตัวอย่าง..." disclaimer nearby). One entry (`อนุมัติสัญญาใหญ่ · 4 คน`) is also flagged `active: true` and
rendered as if it were the real, currently-in-use template — also fabricated.

**Sweep result (module-wide grep for the same pattern — `(used|count|total|views|score|times|ครั้ง)\s*:\s*[0-9]{2,4}`
across every `app/(admin)/docuflow` and `components/docuflow` file):** **`workflow/page.tsx` is the only hit.**
`audit/page.tsx` and `reports/page.tsx` both query real Prisma data (`take: 50` / `take: 200` are pagination
limits, not fake stats). No other instances found.

**Files to edit:**
- `app/(admin)/docuflow/workflow/page.tsx`:
  - Delete the `TEMPLATES` const (`:47-69`) and its rendering block (`:565-614`, the "เทมเพลต workflow" `DfCard`)
    entirely — there is no real "workflow template" entity in the schema to back a real version of this card, so
    removing it (rather than inventing a fake-fixing feature) is the correct Track-A-scope action. If the CEO
    wants real templates, that's new scope for Track B / a follow-up, not a Track A fix.
  - The adjacent "ตั้งค่า Workflow" card (`:433-563`) is **also** entirely static/non-functional (hardcoded "วงเงิน
    > ฿50,000", fake LINE/Email/SMS toggles) but wasn't specifically named in the spec's §3 debate highlight —
    flag it as the same bug class, recommend removing or clearly Phase-2-labeling it in the same pass since
    leaving it next to a freshly-cleaned page would look inconsistent, but this is a scope-boundary call, not a
    unilateral one.

**Contended files:** `workflow/page.tsx` is also touched by Item 5 (repaint, several hex literals in the same file)
— sequence Item 6's deletion **before** Item 5's repaint touches this file (repaint should never color code that's
about to be deleted).

**Migration needed:** none.

---

### Item 7 — Thai-font signature bug (`toLatin1Safe` strips Thai)

**Reality check (`lib/docuflow/signature.ts`, 359 lines, read in full):** `toLatin1Safe()` (`:76-78`) replaces
every non-Latin-1 codepoint with `"?"` before drawing text via `pdf-lib`'s `StandardFonts.Helvetica` (`:233`,
`embedFont(StandardFonts.Helvetica)`), because Helvetica (a PDF standard font) has no Thai glyphs and `pdf-lib`'s
WinAnsi encoder throws on unencodable codepoints. This affects the `'date'`, `'name'`, and `'text'` auto-fill
placement types (`drawTextInBox`, `:84-116`, called at `:277-299`) — exactly the CEO's addendum concern (§0.1):
auto-filled Thai name/date becomes "?".

**Confirmed blockers for the real fix:**
- **No TTF/OTF font file exists anywhere in the repo** (`find . -iname "*.ttf" -o -iname "*.otf"` — zero hits
  outside `node_modules`). The site's Thai fonts (Anuphan, IBM Plex Sans Thai) are loaded via
  `next/font/google` in `app/layout.tsx:16-29`, which bundles WOFF2 for the browser — **not directly reusable
  server-side for `pdf-lib`**, which needs raw TTF/OTF bytes. (Cross-reference: this session's own memory notes
  the same class of failure for `@react-pdf/renderer` — "woff2 fonts load with 0 errors but render a completely
  blank page — need real ttf/otf.")
- **`@pdf-lib/fontkit` is not a project dependency** (`grep fontkit package.json` — no hit). `pdf-lib` requires
  `pdfDoc.registerFontkit(fontkit)` before `embedFont()` can accept a non-standard (i.e. Thai-capable) font.

**Files to edit:**
- `lib/docuflow/signature.ts`:
  - Add `import fontkit from "@pdf-lib/fontkit"` and `pdfDoc.registerFontkit(fontkit)` right after
    `PDFDocument.load(pdfBytes)` (`:229`).
  - Replace `pdfDoc.embedFont(StandardFonts.Helvetica)` (`:233`) with embedding a bundled Thai TTF (e.g.
    `pdfDoc.embedFont(await fs.readFile(path.join(process.cwd(), "lib/docuflow/fonts/NotoSansThai-Regular.ttf")))`).
  - Remove or narrow `toLatin1Safe()` (`:76-78`) — a Thai-capable font doesn't need the strip; keep a much
    narrower sanitizer that only strips genuinely un-renderable control characters, not the Thai Unicode range.
- **New binary asset:** `lib/docuflow/fonts/NotoSansThai-Regular.ttf` (or similar Thai-Latin TTF, e.g. Noto Sans
  Thai or IBM Plex Sans Thai in real TTF form, sourced from Google Fonts' raw TTF distribution, not the WOFF2 the
  site already loads). **This needs an explicit source/license check before committing a binary font file** —
  flag for the build agent to confirm which font + license, don't just grab an arbitrary TTF.
- **`package.json`**: add `@pdf-lib/fontkit` dependency. **New npm package — per repo convention this needs an
  explicit approval step before installing, do not silently `npm install` inside the build-wave agent.**

**Contended files:** `signature.ts` is edited **only** by Item 7. No other Track A item touches it.

**Migration needed:** none (this is a code + asset + dependency fix, no schema change).

---

### Item 8 — Notification bell on mobile (ships together with Item 10)

**Reality check (`components/docuflow/df-top-banner.tsx`, 169 lines, read in full):** the bell (`<Link
href="/docuflow/notifications">`, `:145-155`) lives *inside* the same `.df-topbanner` container that's hidden
entirely below 768px (`:159-161`, `@media (max-width: 768px) { .df-topbanner { display: none !important; } }`).
Simply removing that media rule would also re-show the breadcrumb + `⌘K` search hint on mobile, which is not what
was asked (those are desktop-appropriate; mobile has the bottom nav for navigation). **The bell needs to be
extracted from the desktop-only container**, not have its parent's visibility rule deleted.

**Files to edit:**
- `components/docuflow/df-top-banner.tsx`: split the bell out into its own small element rendered *outside* (or
  as a CSS-mobile-only sibling of) the `.df-topbanner` div, with its own media query showing it only `<768px`
  (mirror-image of the existing rule) — e.g. a fixed-position bell button in the top-right corner on mobile, or
  folded into a lightweight mobile-only header bar. Needs a visual decision (fixed floating button vs. a thin
  mobile top-strip) — recommend fixed floating top-right button for lowest layout risk, consistent with how the
  primary upload button already floats in `df-mobile-nav.tsx:74-94`.
- `app/(admin)/docuflow/layout.tsx:31-37` — `renewBadge` currently computed for the bottom-nav "ต่ออายุ" tab's
  badge count. Once Item 10 removes that tab, this badge's destination moves — see Item 10 below, same file.

**Contended files:** `df-top-banner.tsx` and `layout.tsx` overlap with Item 10 (same files, coupled requirement —
spec explicitly says these two must ship together). Group into **one agent/wave**, not two.

**Migration needed:** none.

---

### Item 9 — Keep "ใกล้หมดอายุ" + Checklist reachable in ≤1 tap from home (gate unchanged)

**Reality check (`app/(admin)/docuflow/page.tsx`, 1117 lines, read in full):** both already live on the home page
today: Section 02 "เอกสารที่ต้องต่ออายุเร็ว ๆ นี้" (`:530-746`, with a "ดูทั้งหมด" button to `/docuflow/expiry`,
`:550`) and Section 04 "Checklist สาขา" (`:875-1007`, with a "ดู Checklist เต็ม" button to `/docuflow/checklist`,
`:995-1006`) — both **already 1-tap reachable from the home page**, no new construction needed.
`app/(admin)/docuflow/checklist/page.tsx:24,99` confirmed already gated by `requireExecutiveRole` (not
admin-tier) — matches the locked decision, nothing to change here either.

**This item is a verification checkpoint, not a build task**, with one small coupled edit:
- After Item 2 lands (browse → documents merge/redirect) and Item 10 lands (bottom nav no longer has a direct
  "ต่ออายุ" tab), **manually re-verify** that expiry is still ≤1 tap from wherever a mobile user lands — it is,
  via the home page's stat card (`page.tsx:342-349`, "ใกล้หมดอายุ" `DfStatCard`, `href="/docuflow/expiry"`) and
  Section 02's "ดูทั้งหมด" button, both unaffected by the bottom-nav change since home (`/docuflow`) is itself the
  first bottom-nav tab.
- Checklist stays equally reachable via Section 04, also unaffected.
- **Regression risk to watch, not to fix here:** if a future pass ever removes Section 02 or Section 04 from the
  home page (e.g. during the Item 5 repaint, if an agent "simplifies" the home page while recoloring it), that
  would silently violate this Track-A hard requirement. Flag explicitly in Item 5's wave brief: **do not remove
  or restructure Sections 01-04 on the home page, colors only.**

**Contended files:** none new. Piggybacks on Item 2's small home-page href edit (§Item 2) and needs a final
manual check after Item 5's wave.

**Migration needed:** none.

---

### Item 10 — New 5-item bottom nav: หน้าหลัก / เอกสาร / อัปโหลด / ปฏิทิน / ตั้งค่า

**Reality check (`components/docuflow/df-mobile-nav.tsx`, 163 lines, read in full):** current `ITEMS` array
(`:28-39`): `home→/docuflow`, `docs→/docuflow/browse`, `upload→/docuflow/documents/upload` (primary/floating),
`renew→/docuflow/expiry` (label "ต่ออายุ", carries `badgeRenew`), `me→/docuflow/notifications` (label "ฉัน", icon
`UserIcon`). **Note: today's last tab is labeled "ฉัน" (me), not "แจ้งเตือน"** as the workshop's Debate Highlights
(§3) implied when discussing which tab to cut — the actual code has a person-icon/"me"-labeled tab that happens to
route to the notifications page, an existing UX mismatch the workshop's canvas-reading apparently smoothed over.
Regardless, per Item 10's literal target list, this tab is being replaced.

`app/(admin)/docuflow/calendar/page.tsx` **already exists** as a real route — confirmed in the file listing, so
"ปฏิทิน" needs no new page, just a nav entry pointing at it.

**Files to edit:**
- `components/docuflow/df-mobile-nav.tsx`:
  - `ITEMS` array (`:28-39`): change `docs` href from `/docuflow/browse` to `/docuflow/documents` (matches Item 2's
    new canonical URL); replace the `renew` entry (`→/docuflow/expiry`) with `calendar→/docuflow/calendar`
    (label "ปฏิทิน", icon e.g. `Calendar` from `lucide-react`, already imported elsewhere in the module); replace
    the `me` entry (`→/docuflow/notifications`) with `settings→/docuflow/settings` (label "ตั้งค่า", icon
    `Settings`, needs Item 1's hub to exist — **this specific line has a hard dependency on Item 1**, sequence
    accordingly, see waves).
  - Decide where `badgeRenew` (currently on the "ต่ออายุ" tab, `:73,129-151`) moves to. Recommend attaching it to
    the new "ปฏิทิน" tab (calendar is the closest remaining destination semantically tied to expiry dates) rather
    than dropping the badge — it's a genuinely useful "N documents expiring soon" signal that shouldn't be lost
    silently just because the tab it lived on got renamed.
- `app/(admin)/docuflow/layout.tsx:31-42` — `renewBadge` computation stays (feeds the moved badge); update the
  inline comment describing which tab it decorates (currently says "mobile bottom-nav badge" generically, fine
  as-is, but the docstring at `:1-6` mentions the canvas mobile-screens pattern that no longer matches post-edit —
  update the file header comment to avoid misleading the next reader).

**Contended files:** `df-mobile-nav.tsx` shared with Item 8 (bell) — same file, same wave, same agent (already
noted under Item 8). `layout.tsx` shared with Item 8's badge-semantics note and with the unrelated `6d303b73`
metadata commit from §0.2 — re-diff against latest `origin/setup` before editing, don't blind-overwrite.

**Migration needed:** none. **Depends on Item 1's `/docuflow/settings` route existing** (else the new nav tab
404s) — sequence after Wave 2, not Wave 1.

---

## §2. Build waves

Wave grouping is driven by two real constraints found during research: (a) Item 3's Prisma schema change gates
everything that reads `documentTypeId` (Items 1's document-types sub-route, Item 4's upload form), and (b) Item 5's
repaint touches files from almost every other item, so it must run last, after everything else has stabilized.
Item 10's settings-tab link has a soft dependency on Item 1 existing.

```
WAVE 1 — 5 parallel agents, no shared files, no DB dependency between them
├─ Agent A — Item 2  (merge browse+documents) + Item 9's small home-page href tweak
├─ Agent B — Item 6  (delete fake workflow stat/templates)
├─ Agent C — Item 7  (Thai font fix — flag @pdf-lib/fontkit + font asset for approval, don't silently install)
├─ Agent D — Item 8 + Item 10  (bottom nav rewrite + mobile bell — same files, must ship together)
└─ Agent E — Item 3, SCHEMA-ONLY  (prisma/schema.prisma + migration SQL + lib/docuflow/document-types.ts +
                                    loadDocuments() documentTypeId param — NO UI edits in this wave)

  ⚠️ CHECKPOINT 1 (mandatory): apply Agent E's migration → `prisma generate` → full-repo `tsc` before Wave 2
     starts. This is a real gate, not a formality: Agent D's Item 10 edit references `/docuflow/settings`
     which doesn't exist until Wave 2 — that 404 is expected/acceptable mid-build but must be resolved by
     Wave 2's completion, and Agent E's new Prisma types must exist before Wave 2 agents write code against them.

WAVE 2 — 2 parallel agents, both depend on Wave 1's Checkpoint 1 (Item 3's schema)
├─ Agent F — Item 1  (settings hub shell + document-types CRUD + notifications sub-route, Phase-2-labeled) +
│                     small addendum: add a documentTypeId filter chip to documents/page.tsx (reuses
│                     DocumentFilters, ~15 lines — natural owner since this agent builds the DocumentType UI)
└─ Agent G — Item 4  (upload form: documentTypeId field, multi-file loop, localStorage auto-fill,
                       businessType searchParam wiring)

  ⚠️ CHECKPOINT 2: full-repo `tsc` + `next build` sanity check (no schema change this wave, but Item 1's new
     API routes + Item 4's upload-route edits both need a clean typecheck before the repaint wave touches
     their files).

WAVE 3 — 1 agent, sequential, LAST
└─ Agent H — Item 5  (design-token repaint: docuflow.css + the 15-file hardcoded-hex sweep listed in §Item 5).
                       Explicit constraint for this agent: DO NOT restructure page sections (Item 9's guard),
                       DO NOT touch files' logic/JSX structure, colors and the one font-family line only.

  ⚠️ FINAL CHECKPOINT: full-repo `tsc` + `next build` + manual mobile screenshot pass (per this org's standing
     screenshot-to-CEO convention) across at minimum: home, merged documents page (all 3 views), upload form
     (multi-file), settings hub, workflow page (post-cleanup), signature embed (Thai name/date rendering).
```

**Minimum wave count achieved: 3** (structural work in Wave 1 parallelized 5-wide since none of those 5 share a
file; Wave 2's 2 agents both strictly need Item 3's schema so can't be pulled into Wave 1; Item 5 cannot be
parallelized against anything else since it touches nearly every file every other item produced).

---

## §3. Summary of every new/changed file (quick index)

**New files:**
- `app/(admin)/docuflow/settings/page.tsx`, `settings/document-types/page.tsx`, `settings/notifications/page.tsx`
- `app/api/docuflow/document-types/route.ts`, `app/api/docuflow/document-types/[id]/route.ts`
- `lib/docuflow/document-types.ts`
- `lib/docuflow/fonts/NotoSansThai-Regular.ttf` (or equivalent, license TBD)
- `supabase/migrations/<timestamp>_docuflow_document_types.sql`

**Edited files:**
- `prisma/schema.prisma` (Item 3 only)
- `app/(admin)/docuflow/documents/page.tsx`, `browse/page.tsx` (Item 2; colors touched again in Item 5)
- `app/(admin)/docuflow/page.tsx` (Item 2 href tweak; colors in Item 5; structure frozen per Item 9)
- `app/(admin)/docuflow/workflow/page.tsx` (Item 6 deletion; colors in Item 5, sequenced after)
- `lib/docuflow/signature.ts` (Item 7 only)
- `components/docuflow/df-top-banner.tsx`, `df-mobile-nav.tsx` (Item 8+10 together; colors in Item 5)
- `app/(admin)/docuflow/layout.tsx` (Item 8+10 badge/comment edit — re-diff against origin/setup first, §0.2)
- `components/docuflow/upload-form.tsx`, `app/(admin)/docuflow/documents/upload/page.tsx`,
  `app/api/docuflow/upload/route.ts`, `app/api/docuflow/upload-proxy/route.ts` (Item 4)
- `lib/docuflow/data.ts` (Item 3's `documentTypeId` filter param)
- `app/(admin)/docuflow/docuflow.css` + ~13 more files with hardcoded hex (Item 5, full list in §Item 5)
- `package.json` (Item 7's new `@pdf-lib/fontkit` dependency — needs explicit approval before install)
