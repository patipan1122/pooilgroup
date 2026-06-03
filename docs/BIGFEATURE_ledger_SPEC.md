# BIGFEATURE · LedgerLine (`ledger`) — Build Contract

> Deterministic build spec (replaces persona-theatre per LESSONS: scope locked + fresh memory dossier → go straight to surface-split build agents).
> Repo: pooilgroup-web · branch `claude/ledger-module` · 2026-06-02
> Full scope/timeline: `docs/PLAN_ledger_module.md` · memory [[jplink-uses-trcloud-2026-06-02]] [[thai-receipt-ocr-research]]
> Goal of THIS build round = **M0 foundation + M1 spine** (capture→AI→Recheck→human-confirm→store→list), shipped compile-clean. Later rounds layer M2-M3 (budgets/dashboard/TRCloud-export/Gmail/SlipOK/vouchers/Q&A/AI-insights).

## Golden rules (non-negotiable)
- **NEVER auto-post** — every AI-read expense is `status=draft` until a human (accountant) confirms.
- Multi-tenant: `org_id` + `company_id` + `branch_id` on every table · RLS `org_id = current_org_id()` · reuse existing **Organization→Company→Branch** Prisma models (read `prisma/schema.prisma`; do NOT recreate company/branch).
- Reuse, don't reinvent: AI OCR + budget guard (CashHub), LINE omnichannel (Inbox/Recruit), R2 (`lib/r2/client.ts`), auth/RLS, module registry.
- tsc `--noEmit` must pass per surface; parent runs `next build`. No prod deploy (branch only).
- Defer-pending-secret (stub + TODO note, do NOT block build): LINE OA channel secret, Google OAuth/Drive, TRCloud write-API, SlipOK key.

## Data model (new tables — all `@@schema("public")`, snake_case `@@map`, RLS on)
- **ledger_category**: id, org_id, company_id, name, kind('expense'), color, trcloud_acc_code?, sort, active · unique(org_id,company_id,name)
- **ledger_expense** (core): id, org_id, company_id, branch_id?, doc_code, status('draft'|'confirmed'|'locked'|'void'), source('line'|'web'|'email'), vendor?, vendor_tax_id?, doc_date?, subtotal, vat, wht, total, category_id?, payment_method?, original_url?, thumb_url?, sha256?, ocr_model?, ocr_confidence(jsonb)?, slip_ref?, needs_review(bool), note?, created_by, confirmed_by?, created_at, updated_at, confirmed_at?, export_batch_id? · unique(org_id,company_id,doc_code) · index(org_id,company_id,branch_id,status) · index(sha256) for dedup
- **ledger_expense_item**: id, expense_id(FK cascade), description, qty, unit_price, amount, vat_rate?
- **ledger_budget**: id, org_id, company_id, branch_id?, category_id, period('YYYY-MM' or monthly recurring flag), amount, alert_pct(default 90) · unique(org_id,company_id,branch_id,category_id,period)
- **ledger_line_channel**: id, org_id, company_id, line_channel_id, webhook_secret_enc?, access_token_enc?, group_id?, active · (stub secrets)
- **ledger_export_batch**: id, org_id, company_id, period, format, status, rows, exported_at?, created_by
- audit: REUSE existing audit() helper (find it; e.g. lib/audit). Do not make a new audit table if one exists.
- RPC `ledger_next_doc_code(p_org uuid, p_company uuid)` → `EXP-YYYYMM-NNNN` (pattern of `repair_next_ticket_code`).

## Surface partition (no file overlap between agents)
**A · SCHEMA (must finish first):** `prisma/schema.prisma` (+models above, relations to Organization/Company/Branch) · `supabase/migrations/20260602xxxxxx_ledger_module_init.sql` (tables+RLS+RPC+indexes) · `lib/modules.ts` (add slug `ledger` + nav: หน้าหลัก/รายจ่าย/งบประมาณ/Dashboard/ตั้งค่า · roles staff/accountant/admin) · `lib/ai/cost-cap.ts` (add `gemini-3.1-flash-lite` input/output pricing) · run `npx prisma generate` · `npx prisma validate`.

**B · BACKEND+API:** `lib/ledger/{types.ts,queries.ts,actions.ts,ai-parse.ts,recheck.ts,storage.ts,slipok.ts(stub),trcloud-export.ts(stub)}` · `app/api/ledger/{ocr,expenses,r2/presign}/route.ts` · `app/api/webhooks/ledger/line/[channelId]/route.ts` (mirror `app/api/webhooks/inbox/line/[channelId]/route.ts` + reuse `lib/recruit/channel-crypto` + `rehostLineImage`; receive image → R2 → create draft expense via ai-parse). ai-parse MUST reuse the CashHub pattern (read `app/api/cashhub/ocr-slip/route.ts` + `lib/ai/cost-cap.ts`) with gemini-3.1-flash-lite + structured JSON {vendor,vendor_tax_id,doc_date,subtotal,vat,total,items[],payment_method,suggested_category,per-field confidence}. recheck.ts = validators (taxid 13-digit, subtotal+vat-discount=total tolerance<1, vat≈7% sanity, sum(items)=subtotal). storage.ts = R2 upload + sha256 dedup + thumbnail (Drive deferred). queries scoped org+company+branch, wrap getSession-style lookups in React cache.

**C · WEB ADMIN UI:** `app/(admin)/ledger/{layout.tsx(assertModuleEnabled+company/branch picker),page.tsx,dashboard/page.tsx,expenses/page.tsx(+_components multi-pane: list left + image+edit-form right + bulk-confirm),budgets/page.tsx,settings/page.tsx}` · `components/ledger/{_kit/(StatusBadge,AmountInput,ConfidenceTag),ExpenseReviewPane.tsx,ReceiptThumb.tsx}`. Mobile-responsive. Reuse Pool design primitives (read an existing module e.g. chairops/cashhub for token/components). Sticky thead `top-14 sm:top-16 z-20`.

**D · MOBILE/LIFF + LINE UX:** `app/liff/ledger/{page.tsx (capture+confirm card)}` · `components/ledger/LineConfirmCard.tsx` (LINE flex message builder: "บันทึกแล้ว/ยืนยัน" with fields + edit). Reuse LIFF pattern from hotelbook/chairops liff.

## Acceptance criteria (M0+M1)
1. `ledger` appears in module nav (gated by role + entitlement).
2. Migration creates ledger_* + RLS + RPC; `prisma validate` clean.
3. Web: upload a receipt image → ai-parse returns structured fields + confidence → shown in multi-pane review → accountant edits → **confirm** → row saved `status=confirmed` (never auto). Recheck flags math mismatch.
4. LINE webhook route exists + verifies signature + (with stub secret) ingests an image → R2 → creates draft expense.
5. Dedup: same image (sha256) doesn't double-create.
6. `npx tsc --noEmit` clean · `next build` clean.
7. company เจพีซิ้งค์ กรุ๊ป + a couple branches + the proposed expense categories seeded (seed script or migration insert).
8. Defer-pending-secret items clearly marked with TODO + a `docs/LEDGER_SETUP.md` listing what CEO must provide.
