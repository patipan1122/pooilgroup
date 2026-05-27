# BIGFEATURE · ChairOps · Phase 1+2 Goal Lock

> **Created:** 2026-05-27 · Source: CEO P0 decisions + /goal command
> **Status:** All 10 stakeholder questions pre-filled from CEO's prior answers · /goal "ทำทั้งหมดให้สมบูรณ์" auto-approves Q10=Full ship

---

## Phase 1 · Stakeholder form (CEO-prefilled)

| # | Question | Answer |
|---|---|---|
| 1 | ชื่อฟีเจอร์ | **ChairOps — make it complete (full ship)** |
| 2 | คำอธิบายสั้นๆ | ระบบบริหารเก้าอี้นวด ~100 ตัว · 30 สาขา · เก็บเงินสด/ตรวจคลีน/แจ้งซ่อม/รายงานจากแม่บ้านผ่าน LINE OA + Mini App · POS reconcile กับ StarThing XLSX · บัญชี import เดือนแรกได้ |
| 3 | ใครใช้ | ✅ CEO/Owner · ❌ Area Manager (`[[chairops-p0-decisions-locked-2026-05-27]]` Q3) · ✅ Branch Manager (เก้าอี้นวดไม่มี — skip) · ✅ Staff (แม่บ้าน 30 คน · 1:1 maid-branch) · ❌ Driver · ❌ Customer (internal only) · ✅ Admin · ❌ Auditor external (internal audit only) |
| 4 | เป้าหมายธุรกิจ | (a) จบความปวดหัว 30 LINE groups · (b) ไม่ให้เงินขาดสะสม (BR2 zero-tolerance) · (c) บัญชี import เดือนแรก ≥ 95% rows · (d) CEO รู้กำไรสุทธิต่อสาขา/วัน |
| 5 | Success metric | (1) แม่บ้านใช้ LINE OA แทน group 100% ภายใน Wave 1 · (2) เงินขาดสะสม = 0 บาททุกสาขาทุกวัน · (3) บัญชี import เดือนเมษา 2026 > 95% no re-key · (4) Audit trail self-audited |
| 6 | Module ที่เกี่ยว | ✅ **ChairOps** (host) · ✅ Pool core (users · branches · companies · audit) · ❌ ห้ามแตะอื่นๆ (session scope `[[chairops-only-session-scope-2026-05-27]]`) **EXCEPTION:** `lib/auth/module-access.ts` line 30 fix (bug #6) |
| 7 | ใหม่ หรือ ต่อยอด | **ต่อยอด/แก้ของเดิม** — module live บน prod แล้ว (16 ตาราง + 27 routes) แต่ไม่สมบูรณ์ |
| 8 | Deadline | ไม่มี hard deadline · CEO estimate 3-4 อาทิตย์ (15-21 dev-day) |
| 9 | มีคนใช้จริงมาตอบ | **No** — CEO + AI personas mock-test only · Wave 1 pilot 1 branch จะมี real maid |
| 10 | Build mode | **Full ship** (auto-set by /goal) — spec + build + deploy + verify |

---

## Phase 2 · Goal Lock (1-page summary)

### Feature
**ChairOps Complete Build** — ship 4 waves to close audit findings + 3 new features added 2026-05-27

### Who uses
| Role | Count | Primary surface |
|---|---|---|
| CEO/org_admin | 1 | `/chairops` exec home · `/chairops/bills` · `/chairops/reports/leaderboard` |
| Office (rank: office in ChairopsUserRole · not Pool rank) | 1-2 | `/chairops/office` · `/chairops/pos-ingest` · `/chairops/write-offs` · `/chairops/bills/[id]` (approve AI extract) |
| Maid (rank: maid) | 30 | LINE OA → LIFF Mini App: `m/collect/new` · `m/cleanliness` · `m/damage/new` · `m/supply-request` |
| Tech (rank: tech) | 1-3 | `/chairops/damage` · `/chairops/parts` |

### Business goal
1. **Cash safety** — zero cumulative shortage · immediate alert any drift<0 per `[[chairops-no-cumulative-shortage]]`
2. **Comms cleanup** — replace 30 LINE groups (per `[[chairops-line-group-structure-current]]`) with 1 LINE OA + 1 dashboard
3. **Accounting unblock** — month-1 BC/Express import > 95% rows
4. **Profit visibility** — net profit per branch per day with editable cost fields

### Success metric
- W1 acceptance: 1 maid 1 branch · 5-day test · 0 LINE Notify usage by Day 5
- W2 acceptance: เมษา 2026 import > 95%
- W3 acceptance: audit page filters work · KPIs match brand tokens
- Pool-wide: bug #6 fixed (admin tier sees ChairOps/ClawFleet/Playland in `loadUserModules`)

### Touches modules
- **Host:** ChairOps (16 → 26-30 tables · 27 → 43+ routes)
- **Core:** Pool users · branches · audit (shared) · `module-access.ts` bug fix (line 30)
- **NOT:** other modules

### Mode
**Full ship — wave-by-wave** (CEO approval each wave per `[[chairops-p0-decisions-locked-2026-05-27]]` safety net)

---

## Project consistency requirements

### Must use
- Brand blue (same as Pool · NOT a new color)
- `_kit/` primitives in `components/chairops/` (after FE Phase 2 cleanup removes forked dups)
- Sticky thead `top-14 sm:top-16 z-20` solid bg
- React cache on `getSession` + ChairOps session helpers
- `assertModuleEnabled('chairops')` on every layout
- `canAssignRole`/`canManageUser` on user-mgmt endpoints
- `zUUID()` from `@/lib/zod-helpers`
- Diff-preview before commit on XLSX import
- Manual approval queue for AI extract (per `[[ceo-prefers-manual-ai-triggers]]`)

### Must gate
- Module entitlement: `chairops` slug
- Role rank: per ChairopsUserRole enum (admin > manager > office > maid > tech)
- Cross-org isolation: every query filters `orgId`

### Must audit
- Every destructive write → `ChairopsAuditLog` entry
- Cron runs → CronRun table (Wave 0 add if missing)
- AI extract calls → store raw input+output forever
- Period-close lifecycle → `PeriodReopenLog` immutable

### Must respect (memory rules)
| Memory | Constraint |
|---|---|
| `[[chairops-no-cumulative-shortage]]` | Drift < 0 → immediate alert · same-day trace |
| `[[chairops-maid-one-per-branch-collect-only]]` | Maid does NOT read meters · office reconciles |
| `[[chairops-maid-schedule-irregular]]` | No fixed window · cumulative-drift tracker |
| `[[chairops-reconcile-window-noon-to-noon]]` | **DEGRADE to daily-window** (XLSX no timestamp) |
| `[[chairops-line-group-structure-current]]` | LINE OA replaces 30 groups |
| `[[pool-csv-import-must-diff-before-write]]` | Show new/same/changed counts before write |
| `[[ceo-prefers-manual-ai-triggers]]` | Gmail AI parser = manual approval queue · NOT auto-commit |
| `[[ceo-prefers-multi-pane-workspace]]` | Office dashboard = Linear/Gmail-style split view |
| `[[verify-cwd-before-vercel-prod]]` | Always `pwd && cat .vercel/project.json` before deploy |

### Must NOT
- Bypass RLS via service-role on client
- Auto-grant admin via session bootstrap (`[[chairops-audit-2026-05-25]]` risk #4)
- Use `prisma db push --accept-data-loss`
- Re-introduce 30 LINE groups workflow
- Use LINE Notify for new alerts (EOL 2025-03 · use LINE OA)
- Build Customer-facing page (ChairOps is internal-only)
- Touch other modules (per session scope)

---

## Open questions for personas (Phase 3 should resolve)

1. **Drift engine current logic** — is it lifetime-sum or window-based today? Check `lib/chairops/reconcile/drift-engine.ts`
2. **Auto-bootstrap admin** — does `getSession` create a ChairopsUser with derived admin role today? Check `lib/chairops/auth/session.ts`
3. **LINE current usage** — what events trigger LINE Notify today? `lib/chairops/line/`
4. **`_kit/` forked primitives** — which to delete · which to merge upstream?
5. **Office dashboard layout** — does current `/chairops` exec home match the 30×4 status grid spec?
6. **Mobile PWA gap** — what flows already work · what's stub-only?
7. **PosImport ↔ PosDaily** — current relation · how does XLSX upload land today?

---

**END Phase 1+2 · Goal locked · ready for Phase 3 (12 personas parallel)**
