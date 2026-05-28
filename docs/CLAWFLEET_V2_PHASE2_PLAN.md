# ClawFleet v2 — Phase 2: Wire to real DB (mockup-faithful migration)

> CEO decision 2026-05-28 (รอบ 61): "Migrate ใหญ่ให้ตรง mockup 100%"
> Phase 1 (design port · mock data) done · this is the data-model pivot.
> Safe because ClawFleet has NO real production users yet (demo seed only).

## Mockup operational model vs current schema

| Concept | Mockup | Current schema | Action |
|---|---|---|---|
| Session scope | **1 staff = 1 branch** (all machines) | per-group (1 EX + N CLAW) | add `branch_id` to session · make `group_id` nullable |
| Coin meter | per machine · ×฿10 → expected cash | `cf_collection_events.coin_meter_before/after` ✅ | reuse |
| Prize meter (sensor) | counts dolls dispensed | `doll_meter_before/after` ✅ (already a sensor counter) | reuse · relabel in UI |
| Physical doll count | before/after + refill | `stock_before/after` + `refill_qty` ✅ | reuse |
| Cash check | per machine + branch rollup | only group EX-vs-CLAW cross-check | add branch/per-machine cash check (app layer) |
| Prize check | meter delta vs physical loss | partially in validation rules | add explicit prize-meter-vs-count check |
| Photos | 5 (coin meter · prize meter · prize before · prize after · cash) | 4 fields | add `photo_prize_meter_url` |
| Branch area/manager | area + manager name | `branches.province/region` + `manager_id`→User ✅ | reuse |
| Central deliveries | scheduled shipments to branch | none | NEW table `cf_deliveries` |
| Warehouse/in-machine stock | per branch per SKU | derivable from `cf_stock_movements` ✅ | compute |

## Migration `20260528000001_clawfleet_v2_branch_model` (ADDITIVE only)

1. `cf_collection_sessions`:
   - ADD `branch_id uuid NULL` (FK branches ON DELETE RESTRICT)
   - ALTER `group_id` → DROP NOT NULL (widen · group sessions still valid)
   - ADD `expected_cash_cents int`, `actual_cash_cents int`, `cash_variance_bps int`, `prize_meter_out int`, `prize_counted_out int`, `prize_variance int` (branch-level cross-check snapshot · nullable)
   - backfill `branch_id` from group's branch for existing rows
2. `cf_collection_events`: ADD `photo_prize_meter_url text NULL`
3. NEW `cf_deliveries`: id · org_id · branch_id · status(enum SCHEDULED/IN_TRANSIT/DELIVERED/CANCELLED) · from_location · eta · items_count · units_count · note · created_by_id · timestamps · indexes
4. Keep existing group cross-check trigger intact (group sessions still work) · branch cross-check done in app layer (`lib/clawfleet/v2-crosscheck.ts`)

## Execution sequence

- [x] P1 design port (mock) — done รอบ 61
- [ ] **S1** edit `prisma/schema.prisma` (3 models + 1 new + 1 enum) · `prisma format`
- [ ] **S2** write migration SQL · apply via psql · VERIFY columns exist (per [[wave-migration-written-not-applied-trap]]) · `prisma generate`
- [ ] **S3** `lib/clawfleet/v2-queries.ts` — server functions returning mockup shape from real DB (getHubData · listAnomalies · listOpsSessions · getInsights · getBranchStock · listDeliveries)
- [ ] **S4** convert 6 pages: server component fetches → passes to client island for interactivity (modal/tabs/filters)
- [ ] **S5** wire mutations: decision (approve/recheck/escalate) → `reviewSession` action · writes session.status + review_note
- [ ] **S6** re-seed demo in branch-shape (`scripts/seed-clawfleet-v2-demo.ts`)
- [ ] **S7** verify: tsc + lint + build + manual smoke
- [ ] **S8** STATUS + memory + CEO brief

## Risk notes

- Additive only · no DROP · safe for shared Supabase (cf_* prefix isolates from other modules)
- Existing group routes (`/clawfleet/{hub,operations,...}`) keep working on group model
- Branch cross-check in app layer (not trigger) to avoid breaking existing group trigger
- Photo retention cron already handles `cf_collection_events` · new photo col auto-covered
