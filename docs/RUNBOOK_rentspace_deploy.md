# RUNBOOK — RentSpace deploy (2026-06-13)

Build verified: `tsc` 0 errors · `next build` EXIT=0. Branch `claude/rentspace-2026-06-13` (off origin/setup). commit `9d8afb0`.

## Order matters — migration BEFORE deploy (per wave-migration-trap)

### 1. Apply migration to prod DB
```bash
cd /Users/patipantantikul/Code/pooilgroup/legacy/pooilgroup-web-rentspace
DIRECT_URL=$(grep '^DIRECT_URL=' ../pooilgroup-web/.env.local | cut -d= -f2- | tr -d '"')
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260613120000_rentspace_init.sql
```
Or paste the SQL into Supabase Dashboard → SQL Editor → Run.
- Creates 14 `rental_*` tables + 8 enums (additive, safe).
- Alters shared `user_modules` CHECK to add `'rentspace'` (drop+recreate).
- Inserts `org_modules` row enabling rentspace for Pooilgroup org.

Verify:
```bash
psql "$DIRECT_URL" -c "select count(*) from rental_project;"   # → 0 (table exists)
psql "$DIRECT_URL" -c "select module_name from org_modules where module_name='rentspace';"
```

### 2. Deploy (Vercel auto-deploy from setup)
```bash
git push origin claude/rentspace-2026-06-13:setup
```
Registers cron `/api/cron/rentspace-monthly-bills` (`0 1 1 * *`). Needs `CRON_SECRET` (already set).

### 3. First-run + import tenant data
1. Open `https://pooilgroup.vercel.app/rentspace` (admin) → if no project, go `/rentspace/settings` and save "โครงการทะเลทาวน์" (rates ค่าไฟ 7 / ค่าน้ำ 18, วันครบกำหนด, ค่าปรับ).
   - OR just go `/rentspace/import` — it auto-creates the project on first commit.
2. `/rentspace/import` → upload CSV **"ข้อมูลผู้เช่า"** (the tenant roster CEO has). Preview diff → ยืนยันนำเข้า. Creates units + tenants + active contracts.
3. ⚠️ Tenant CSV has no rent column → imported contracts have rent ฿0. Set base rent per unit at `/rentspace/units` (or edit each contract) BEFORE the 1st-of-month auto-bill. Real rents are in the "ภาพรวมหอพัก" CSV (ค่าเช่าหอพัก column): A1=80000, A2/1=12000, A2/2=14000, A2/4=12000, A2/5=14000, A2/10=20000, A3/1=40000, etc.
4. Position units on the map: `/rentspace` → "จัดผัง" (super_admin) → drag → บันทึกผัง. (Until then, auto-grid-by-building layout shows.)

## Rollback
- Code: revert the merge/commit on setup, redeploy.
- DB: tables are additive + isolated (no FK into other modules) — safe to leave. To remove: `DROP TABLE rental_* CASCADE;` + restore prior `user_modules` CHECK (remove 'rentspace').

## Remaining pipeline (deferred — needs live app)
- `/bigsolvebug rentspace` — runtime click-through (needs deploy + data live).
- `/claude-design` + `/leanux` polish — after CEO sees it in use.
(Static review pass already done: IDOR, payment race, discount clamp, e-sign, expiry sweep all fixed in commit 9d8afb0.)
