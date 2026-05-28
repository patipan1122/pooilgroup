# ⛽ FUELOS_PLAN.md — Sprint 6 Working Doc

> **Owner:** PM (pm-fuelos agent)
> **Spec source:** `ดีเทลv1/FUELOS.md` (1,266 lines)
> **State at kickoff:** 2026-05-11 — FuelOS = ⬜ ยังไม่เริ่ม (placeholder page only)
> **Sprint goal:** ขายส่งน้ำมันใช้ได้จริงภายในสาขา — เซลล์ใช้แทน LINE-only workflow

---

## 0. Team (virtual — Claude subagents in `.claude/agents/`)

| Role | Agent file | Responsibility |
|------|-----------|----------------|
| Senior PM (PMO) | `pm-fuelos.md` | Plan / break tickets / status |
| Tech Lead | `tech-lead-fuelos.md` | Schema + API design + review |
| Backend Engineer | `backend-eng.md` | Prisma + API routes + migrations |
| Frontend Engineer | `frontend-eng.md` | Pages + components |
| QA / Polish | `qa-polish.md` | Pre-merge gate (typecheck + RULES + UX) |
| Lean Process | `lean-process.md` | Flow audits — fewer clicks, less duplicate entry |

Map to ORG_FULL.md positions: T3 PMO, T3 Tech Lead — FuelOS, T4 Sr FE/BE Engineer, T4 QA Lead, T3 Lean Process Engineer.

---

## 1. Sprint 6 — Sub-sprint sequence

```
6.0  Schema foundation       ← THIS PR (all tables + migration + RLS, no UI yet)
6.1  Price Engine            ← depot price entry, zone margin admin, "publish today's price"
6.2  CRM Multi-Entity        ← contacts → entities → locations + credit fields
6.3  Sales Workspace         ← Priority List + Quote/Win-Loss + per-customer Margin Analytics
6.4  LINE Bot (Reply API)    ← price reply + Response Time tracking
```

Sprint 7 (later, separate plan): Driver PWA, Dispatch Board, Flash Sale, TRCloud sync.

---

## 2. Sub-sprint 6.0 — Schema foundation (current ticket)

**Decision:** ship all FuelOS Sprint 6 tables together so 6.1–6.4 can implement features without re-migrating each time.

### Tables to add (16 models)

| # | Model | Spec ref | Notes |
|---|-------|----------|-------|
| 1 | `DepotPrice` | §2.4, §12 | หัวหน้ากรอกราคาคลังเช้า; UNIQUE(org, date, depot, product) |
| 2 | `ZoneMargin` | §2.4, §12 | base + min margin per zone × product |
| 3 | `Contact` | §14.1, §14.6 | คนที่คุยด้วย; group credit limit |
| 4 | `CustomerEntity` | §14.1, §14.6 | นิติบุคคล/บุคคล + credit per entity + payment terms |
| 5 | `DeliveryLocation` | §14.1, §14.6 | จุดส่ง + GPS + max truck size + delivery window |
| 6 | `CustomerQuote` | §3.3, §12 | เสนอราคา + status (won/lost/pending) + competitor on loss |
| 7 | `PriceAlertLog` | §12 | บันทึกว่าแจ้งราคาให้ใครแล้ววันนี้ |
| 8 | `LineResponseLog` | §6, §12 | วัด Response Time เซลล์ในกลุ่ม |
| 9 | `FuelOrder` | §12 | ออเดอร์จริง + generated columns สำหรับ margin/profit |
| 10 | `Truck` | §12 | ทะเบียน + capacity + home_depot |
| 11 | `DriverProfile` | §12 | เสริม User role=driver: FCM token, current truck |
| 12 | `DriverLocation` | §12 | GPS track per order |
| 13 | `Payment` | §12 | ชำระเงิน (transfer/cash/cheque) |
| 14 | `FlashSale` | §11, §12 | broadcast offer |
| 15 | `CreditDocument` | §14.2 | link credit doc → DocuFlow `Document` |
| 16 | `ChequeTracking` | §14.4 | เช็ค + due date + bounce flag |

(Deferred to Sprint 6.4+: `CreditScoreHistory`, `ChurnSignal` — AI features, not Sprint 6.0 critical path.)

### Reuse decisions

- **`Vehicle` model (already in DocuFlow scope)** → reused as `Truck`'s document anchor; do not duplicate
- **`User` with `role=driver`** → `DriverProfile` is a 1-1 satellite that adds FCM token + current truck assignment, not a separate identity
- **`Document` (DocuFlow)** → `CreditDocument` is a join table (entity ↔ document), not a copy

### Acceptance for 6.0

- [ ] Prisma schema compiles (`npx prisma generate`)
- [ ] Migration applies cleanly to a fresh DB (`prisma db push` on dev branch)
- [ ] RLS policy enabled on every new table, with `org_id = jwt_org()` predicate
- [ ] No model adds `org_id` cascade-delete (safety: never auto-delete an org's data)
- [ ] STATUS.md updated to mark "Sprint 6.0 schema = ✅"

### Out of scope for 6.0

- Any UI (no `/fuelos/*` pages beyond the placeholder that already exists)
- Any API endpoint
- Seed data (will come with 6.1 Price Engine)
- TRCloud import (Sprint 7)

---

## 3. Sub-sprint 6.1 plan — Price Engine (next ticket)

**Goal:** ผู้บริหารกรอกราคาคลังตอนเช้า → เซลล์เห็นราคาวันนี้ทันที

### Pages
- `/fuelos/price-master` — admin only; list + create depot prices for today; "publish" button
- `/fuelos/zones` — admin only; CRUD zone margins

### APIs
- `GET /api/fuelos/depot-prices?date=` — list today's depot prices
- `POST /api/fuelos/depot-prices` — bulk create/upsert (PTT/Shell/Dao × B7/B10/91/95)
- `POST /api/fuelos/depot-prices/publish` — flip status to "published" + write AuditLog
- `GET /api/fuelos/zones` / `POST /api/fuelos/zones`

### Library
- `lib/fuelos/pricing.ts` — `computeCustomerPrice(depot, zone, salesMargin) → finalPrice` (FUELOS.md §2.4)
- Pure function, fully unit-testable, no DB

### Permission
- `fuelos.price_publish` — only super_admin / admin / area_manager
- `fuelos.price_view` — staff (sales) + branch_manager

### Acceptance for 6.1
- [ ] Admin can enter today's PTT/Shell/Dao price for B7 + valid_until=17:00 in under 60 seconds (3 clicks per row + 1 publish click — Lean target)
- [ ] After publish, sales role sees today's prices on `/fuelos/sales` (placeholder, fully wired in 6.3)
- [ ] AuditLog row written on publish
- [ ] Cannot publish twice for same (date, depot, product) — UPDATE not duplicate

---

## 4. Sub-sprint 6.2 plan — CRM Multi-Entity (skeleton)

Will detail when 6.1 lands. Key shape:
- `/fuelos/contacts` list
- `/fuelos/contacts/[id]` detail with entities + locations + credit + assigned sales
- Bulk import CSV (1,400 customers exist) — backend script + admin upload page

---

## 5. Sub-sprint 6.3 plan — Sales Workspace (skeleton)

- `/fuelos/sales` Priority List (FUELOS.md §5.1, §13.2)
- Quote modal with Win/Loss capture in one click (FUELOS.md §5.2 — Lean priority: don't make this two forms)
- Per-customer detail page reusing CRM card from 6.2

---

## 6. Sub-sprint 6.4 plan — LINE Bot (skeleton)

- `/api/line/webhook` (already partially built in DocuFlow path) extended with FuelOS reply handlers
- "ราคา" / "price" → reply with today's price for that LINE userId's mapped customer
- Response Time tracking via `line_response_log` insert on inbound + matching outbound

---

## 7. Decisions log (append-only)

| Date | Decision | Why | By |
|------|----------|-----|-----|
| 2026-05-11 | Ship all 16 Sprint 6 tables in one migration | Avoid 4× migration churn during 6.1–6.4 | User + PM |
| 2026-05-11 | Reuse `Vehicle` for trucks; `User.role=driver` + `DriverProfile` satellite | DocuFlow already proves `Vehicle` is reusable; avoid duplicate fleet table | Tech Lead |
| 2026-05-11 | Defer `CreditScoreHistory` + `ChurnSignal` to 6.4+ | AI features, not blocking core sales workflow | PM |
| 2026-05-11 | Use Claude subagents as virtual team (6 roles) instead of hiring | "100% Vibe Coding" per CLAUDE.md; map to ORG_FULL.md positions for clarity | User |

---

## 8. Open questions (need user input before 6.1)

1. **Margin ราคาคลัง — กรอกเองหรือ scrape PTT?** Spec §2.4 บอกหัวหน้ากรอกเอง, แต่ §0 stack mention "PTT Price Scraper". เริ่มที่กรอกเอง (Sprint 6.1) → scraper เป็น Sprint 7 add-on หรือเลย?
2. **Currency / locale**: ใช้ `Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' })` หรือ display แบบ `฿28.41/L` ตรงๆ ตามสเปค?
3. **MOPS Alert (FUELOS.md §2.3)**: Sprint 6 หรือ Sprint 7? เป็น cron + Telegram message — รอ Telegram bot (Phase C4 ใน CORE_PLAN.md) หรือไม่?

---

*FUELOS_PLAN.md v1.0 — Sprint 6 kickoff 2026-05-11*
*Update after every sub-sprint closes. STATUS.md is the cross-module roll-up; this file is FuelOS-specific.*
