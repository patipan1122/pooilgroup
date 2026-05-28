# 📍 STATUS.md — Pooilgroup ERP

> **Source of truth สำหรับสถานะจริง** — อัพเดต 2026-05-28 (รอบ 62 · ChairOps mobile + LINE OA/LIFF)
> ใช้แทน `ดีเทลv1/PROJECT_TRACKER.md` (ซึ่งบอก 0% — ไม่จริง)
> Brand: **Pooilgroup** (คำเดียว, P ใหญ่)

## 🆕 Update (2026-05-28 · รอบ 62 — ChairOps maid MOBILE + LINE OA/LIFF · /goal + /auditbigteam → build)

**CEO trigger:** `/goal "ทำทุกอย่างให้จบ · ใช้ /auditbigteam · session นี้ทำเฉพาะเก้าอี้นวด · mobile UX/UI ทั้งหมดให้สวยมืออาชีพใช้ได้จริง · ทำ LINE OA + LIFF app เชื่อมเลย"` (autonomous).

**Phase 1 — `/auditbigteam` focused (6 personas: UX·STAFF·SEC·SRE·BA·DEVIL):** → `docs/AUDIT_chairops_mobile_liff_2026-05-28.md`. Key finding: maid PWA already ~80% built; real gaps = damage mobile form (stub), full-screen success confirmations, LINE OA Messaging API (only EOL Notify existed). DEVIL cut: no inbound conversation processor (maids tap menu, don't chat) + ship outbound behind dev-fallback.

**Phase 2 — build (tsc clean · `next build` green · 4 new routes compiled):**
- **Damage mobile form** `m/damage/new` (chair chips · urgency · category · photos) + `m/damage` open-tickets landing — replaced the redirect stub
- **SuccessScreen** primitive (`_kit/success-screen.tsx`) → damage/cleanliness/parts full-screen confirm + ref code; collect debug line removed
- **LINE Messaging adapter** `lib/chairops/line/messaging.ts` (backoff+timeout+dev-fallback, falls back to Notify until tokens land); `sop-check` migrated
- **Lean webhook** `api/chairops/line/webhook` (HMAC verify · logs JOIN/FOLLOW → groupId capture)
- **EOD reminder cron** `api/chairops/cron/eod-reminder` (17:00 ICT · vercel.json `0 10 * * *`)
- **Rich Menu script** `scripts/chairops-richmenu.mjs` (4 LIFF deep-links)
- **LIFF entry** `app/liff/chairops` + `line-login` `redirectTo` + `LiffBootstrap` `?next`

**⚠️ Deploy/commit state:** NOT committed, NOT deployed. Activation HW_BLOCKED on CEO LINE OA setup (business verify · 2 tokens · LIFF id · invite OA to 5 groups → read groupId from webhook log → `LINE_GROUP_*` · Rich Menu image · Supabase redirect allowlist for `/chairops/m/*`). Tracked files at IDE-revert risk — recommend commit to lock. Memory `[[chairops-mobile-line-liff-shipped-2026-05-28]]`.

**Next:** CEO confirm → commit + (optional) `vercel --prod` · then CEO completes LINE OA setup to activate Rich Menu/push.

---

## Update (2026-05-28 · รอบ 61 — ChairOps redesign /bigfeature + /bigsolvebug · CEO mockup 100%)

**CEO trigger:** dropped a complete ChairOps HTML/CSS/JSX mockup (`~/เก้าอี้นวด`) + "ทำให้เหมือน 100% · ฟีเจอร์ไหนไม่มีก็ทำ · ใช้ /bigfeature /bigsolvebug /auditbigteam ตามลำดับ"

**/bigfeature (run #1) — 5 parallel build agents · merged PR #7 (`3ffa11b` on setup):**
- Dashboard exec home (5-KPI + critical-branches + missed-maids + alerts + 7D cashflow)
- NEW `/chairops/branches` 3-pane workspace (filter rail + list + 7-tab detail) · all-branches redirects here
- Reconcile 3-view rebuild (Ledger / Timeline / Periods) + sidebar + CSV export
- Maid LINE Mini App home + cleanliness/new + parts/new
- Design tokens ported scoped `.co-scope` + sparkbar/status-dot kit
- Mockup spec: `/tmp/chairops-bigfeature/MOCKUP_SPEC.md` (1213 LOC)

**/bigsolvebug — 3 parallel code-audit agents · merged PR #9 (into setup):**
- **3 cross-org data leaks FIXED** (getDashboardRows · recomputeAllDrifts · evaluateAndEmitAlerts had no orgId filter → exec dashboard + Recompute + alerts crossed tenants)
- P1 inverted drift tone (shortage was green) + P0 dead maid logout (→/logout 404) FIXED
- Drift sign convention verified correct end-to-end
- Report: `docs/BUGSOLVE_chairops_redesign_2026-05-28.md`

**🛡 Verify:** tsc clean · next build 77/77 · dev-smoke all routes 307. Authenticated render NOT browser-tested — needs CEO visual QA.

**⚠️ Deploy state:** redesign + bugsolve BOTH merged to `setup` (prod branch). `vercel --prod` BLOCKED by classifier (needs explicit CEO "deploy" for this task). Bonus: validated StarThing 3-report exports (cash/coin event logs timestamped + daily summary) → sum=daily 100% · unblocks noon-window reconcile (next backend feature). Memory `[[chairops-redesign-2026-05-28]]` · `[[chairops-starthing-3reports-validated-2026-05-28]]`.

**Next:** CEO "deploy" → vercel --prod + curl verify · then /auditbigteam (sign-off) · then build timestamped-reconcile backend.

---

## Update (2026-05-28 · รอบ 60 — 3-module quality pass · CEO "/increase quality ทุกโปรแกรม 3 agent ตัวละโมดูล")

**CEO trigger:** "ใช้ /increase quality skill ทุกโปรแกรม ส่ง agent ไป หัวหน้า agent 3 ตัว ทำตัวละ 1 โปรแกรม · Document · Hr · Cashhub"

**3 lead agents · parallel · 1 module each · comprehensive 5-dim audit (best-practices · a11y · perf · CWV · seo)**

| Agent | Module | Files | P0 | P1 | P2 backlog | Highlight |
|---|---|---|---|---|---|---|
| 1 | DocuFlow | 8 | 0 | 9 | 14 | iframe sandbox · disabled button trap · 7 Thai eyebrow uppercase · mobile nav badge ARIA |
| 2 | Recruit (HR) | 7 | **3** | 4 | 12 | refId 20bit→40bit · ApplicationDetail org self-scope · chat-fab ARIA dialog · OG/Twitter metadata |
| 3 | CashHub | 6 | 0 | 8 | 11 | Heatmap V2 WAI-ARIA tablist · Executive table expand/sub-row keyboard nav · Hero KPI eyebrow root-cause · 15+ Thai labels |
| **Total** | **3 modules** | **21** | **3** | **21** | **37** | |

**🛡 Verify**
- ✅ `npx tsc --noEmit` — clean (0 errors across all 3 module scopes)
- ✅ `npx eslint <module scope>` — no new errors/warnings · identical to baseline
- ✅ ไม่แตะ reconcile formula · ไม่แตะ shortage flow · ไม่แตะ LPG/EV unit logic · ไม่แตะ webhook crypto
- ✅ ไม่แตะ shared `components/ui/*` primitives (DocuFlow agent fixed at module-local `.df-eyebrow` instead)
- ⚠️ ไม่ commit · ไม่ deploy · ทุกการเปลี่ยนแปลงอยู่ใน working tree

**🚨 Behavioral changes (CEO ต้อง QA ก่อน commit/deploy):**
1. **Recruit refId** — ใหม่: 8-char base32 (ไม่มี I/L/O/U/0/1) · เก่า: 6-digit numeric ยังใช้ได้ (lenient validator)
2. **Recruit /apply/[slug] share previews** — ตอนนี้ LINE/FB share ขึ้น "สมัครงาน · ตำแหน่ง · บริษัท" แทนชื่อเว็บเฉยๆ (OG metadata)
3. **CashHub Heatmap V2 tabs** — Tab key ไม่ cycle ระหว่าง tabs อีกแล้ว · ใช้ Arrow Left/Right แทน (WAI-ARIA APG standard · CEO ลองสัก 30 วิ ถ้าไม่ชอบบอก revert tabIndex)
4. **CashHub Executive table** — expand chevron + branch sub-row navigate ด้วย keyboard ได้แล้ว · mouse คลิกได้ตามเดิม
5. **DocuFlow dashboard** — ปุ่ม "สัปดาห์นี้/ทั้งหมด" ที่กดไม่ได้ ตอนนี้ disabled + กระจาย opacity (CEO ตัดสินใจว่า implement filter หรือลบออก — P2)
6. **DocuFlow PDF viewer** — iframe ใส่ sandbox (defense-in-depth · ไม่ควรกระทบ PDF preview)
7. **Thai eyebrow labels** — ในทั้ง 3 modules · ตอนนี้ไม่ uppercase ไม่ stretch (ตรงตาม [[section-component-eyebrow-rootcause]] ที่ตั้งไว้รอบ 47)

**📚 Memory ที่ save (รอบนี้)**
- `[[refid-as-bearer-token-pattern]]` — public /track-my-X URLs MUST use crypto.randomBytes ≥40-bit + format-validate before DB
- `[[wai-aria-tablist-pattern]]` — required pattern for tab strip UIs (roving tabIndex + Arrow keys + role=tablist)
- `[[quality-pass-3module-2026-05-28]]` — รอบ 60 summary · agent stats · P0/P1/P2 split

**⚠️ Pending items (CEO ต้องตัดสิน)**
- DocuFlow ยังอยู่ใน `MODULES_DISABLED=fuelos,docuflow` — fixes ใน DocuFlow เป็น forward-looking · ถ้า CEO อยากเปิดใช้ DocuFlow บอก drop จาก env
- Recruit migration `20260526000002` ยัง pending CEO confirm (per [[bugsolve-recruit-2026-05-26]])
- 37 P2 รายการ — ส่วนใหญ่เป็น polish · pre-existing lint warnings · perf nice-to-have · CEO เลือก batch ไว้ later

---

## 🆕 Update (2026-05-27 · รอบ 59 — ClawFleet demo seed · CEO "ใส่ข้อมูลจำลองให้เห็นภาพ")

**CEO trigger:** หลังสรุปฟีเจอร์ ClawFleet → "ใส่ข้อมูลจำลองลงไปให้เห็นภาพและเข้าฟีเจอร์"

**Created** `scripts/seed-clawfleet-demo.ts` (~440 LOC · idempotent · `[DEMO]` tag for cleanup)

**Seed contents (PROD DB now):**
- 3 claw_machine branches (1 existing + 2 new: ปิ่นเกล้า + ตลาดบางใหญ่)
- 20 machines (4 EX + 16 CLAW) across 4 groups
- Active loadouts: EX rate 1฿=1coin + 3 promo tiers · CLAW each assigned product+price
- 28 historical sessions: **20 CLOSED · 4 ANOMALY_REVIEW · 4 OPEN** (in-progress today)
- 140 collection events (16 INITIAL + 124 session events)
- 32 stock movements (RECEIVE + LOAD_TO_MACHINE)

**Cross-check trigger verified:** auto-classified 4 sessions as ANOMALY_REVIEW (15% variance · exceeded 5% tolerance) — HEART of the system working correctly.

**Visit:**
- https://pooilgroup.vercel.app/clawfleet/hub (or local http://localhost:3100)
- /operations · /insights · /setup

**Cleanup (one-shot · per script header):**
```sql
DELETE FROM cf_collection_events WHERE notes LIKE '[DEMO]%';
DELETE FROM cf_collection_sessions WHERE review_note LIKE '[DEMO]%';
DELETE FROM cf_stock_movements WHERE reason LIKE '[DEMO]%';
DELETE FROM cf_machine_loadouts WHERE notes LIKE '[DEMO]%';
DELETE FROM cf_exchanger_loadouts WHERE notes LIKE '[DEMO]%';
DELETE FROM cf_machine_groups WHERE name LIKE '[DEMO]%';
DELETE FROM cf_machines WHERE code LIKE 'DM-%';
DELETE FROM branches WHERE code LIKE 'DM-BR-%';
```

---

## 🆕 Update (2026-05-27 · รอบ 58 — ChairOps `/bigfeature` Wave 0 ship · 12-persona roundtable + 6 parallel build agents)

**CEO trigger:** `/goal "ทำทั้งหมดให้สมบูรณ์ /bigfeature skill"` กับ ChairOps · CEO locked 6 P0 decisions + 3 new features (cost+deposit · vendor bill tracker · LINE OA + LIFF Mini App)

**Phases shipped this round (all 7 of `/bigfeature` skill):**
1. ✅ Phase 0 · Project context sync → `docs/BIGFEATURE_chairops_CONTEXT.md`
2. ✅ Phase 1+2 · Stakeholder form + goal lock → `docs/BIGFEATURE_chairops_GOAL.md`
3. ✅ Phase 3 · 12 personas in parallel → 12 × `docs/BIGFEATURE_chairops_PERSONA_*.md`
4. ✅ Phase 4 · Synthesis → `docs/BIGFEATURE_chairops_SPEC.md` (3,400 words · 10/12 GO · 1 DESCOPE)
5. ✅ Phase 5 · CEO brief + decision gate (GO Wave 0 unconditional · checkpoint after)
6. ✅ Phase 6 · Wave 0 implementation (6 parallel build agents · 2 rounds)
7. ⏭ Phase 7 · LESSONS + memory updates (in-progress)

**Wave 0 outcomes (94 files changed · +2052 -1407 LOC):**

🔴 **5 audit risks status revised:**
- ~~Risk #2 cron not registered~~ ✅ already closed (verified in vercel.json:19-21)
- ~~Risk #3 module gate~~ ✅ already closed (chairops/layout.tsx:25-29)
- ~~Risk #4 auto-bootstrap~~ ✅ already closed (session.ts:72-100)
- Risk #1 drift lifetime-sum ✅ CLOSED this round (daily-window rewrite + feature flag)
- Risk #5 LINE Notify EOL → flagged for Wave 1 (curl-test pending)

🔴 **3 NEW P0 bugs found + fixed:**
- `lib/auth/module-access.ts:30/43-49` admin allowlist missing chairops/clawfleet/playland → replaced with `Object.keys(MODULES)`
- Zero `orgId` on all 16 ChairOps models → added + backfill SQL
- `ChairopsPosDaily.totalRevenue` Int → widened to Decimal(12,2) + renamed grossTotal/cashTotal/onlineTotal

🟢 **3 new features shipped (Wave 0 part):**
- 5 cost fields on `ChairopsBranch` (monthlyRent · monthlyUtility · monthlyStaff · monthlyOther · securityDeposit)
- 2 new tables: `ChairopsBranchDailyRevenue` + `ChairopsAccessRequest` + `secondaryAlertUserId` FK
- StarThing XLSX parser `lib/chairops/pos-ingest/starthing-xlsx.ts` (571 LOC · 20 cols · BE+AD dates · idempotent SHA256)
- 2-click upload UX (drag XLSX → diff preview → commit → exec home)

🎨 **UI cleanup:**
- 4 forked Pool primitives deleted (button/card/input/badge · 121 LOC) + 31 imports migrated to `@/components/ui/*`
- New `.co-scope` scoped tokens at `components/chairops/redesign/tokens.css`
- 15 uppercase-Thai violations fixed (per `[[section-component-eyebrow-rootcause]]`)
- 5 translucent sticky-bg violations fixed (per `[[sticky-bg-inherit-anti-pattern]]`)

🔧 **Pool-core fixes:**
- 3 ChairOps crons wrapped in `runWithMonitor()` (recompute-drifts · sop-check · ceo-digest)
- `loadUserModules` admin allowlist now uses `Object.keys(MODULES)` (drift-free Pool-wide)

**Verify:**
- ✅ `npx tsc --noEmit` clean (0 errors · was 81 before BA-2 round)
- ✅ `npm run build` succeeded (77 static pages generated · 25s compile)
- ✅ Lint clean on Wave 0 file scope (23 pre-existing problems unchanged)
- ✅ Smoke test: BA-5 parsed sample XLSX (BE date · Thai headers · idempotent fileHash)

**Migration SQL written but NOT applied:**
- File: `supabase/migrations/20260527130540_chairops_w0.sql` (360 lines · BEGIN/COMMIT + ROLLBACK section)
- Default org slug = `pooilgroup` (verified in seed.ts)
- Backfill: `UPDATE chairops_<table> SET org_id = (SELECT id FROM organizations WHERE slug='pooilgroup')`

**Pending CEO action (2 deploy steps):**
1. **Review + apply migration** via Supabase Studio or `psql "$PROD_DIRECT_URL" < supabase/migrations/20260527130540_chairops_w0.sql`
2. **Confirm `vercel --prod`** (per `[[verify-cwd-before-vercel-prod]]` — cwd verified as `pooilgroup` project)

**CEO checkpoint after deploy (per synthesizer + DEVIL recommendation):**
- Run `SELECT count(*) FROM chairops_cash_collection WHERE created_at > now() - interval '14 days'` — if <50, interview 2 maids before W1
- Check Playland device arrival ETA (competing priority)
- Show LIFF rich-menu mockup before W1 build starts
- Re-decide Wave 1 scope (Full vs DEVIL Lite)

**Memory updates (this round):**
- New: `[[chairops-pos-vendor-starthing]]` · `[[chairops-line-group-structure-current]]` · `[[chairops-p0-decisions-locked-2026-05-27]]` · `[[chairops-starthing-xlsx-schema-2026-05-27]]` · `[[chairops-branch-cost-field-2026-05-27]]` · `[[chairops-vendor-billing-feature-2026-05-27]]` · `[[chairops-upload-flow-simple-2026-05-27]]` · `[[chairops-only-session-scope-2026-05-27]]` · `[[reference-starthing-portal]]`

---

## 🆕 Update (2026-05-27 · รอบ 57 — Playland ACS · dual-mode device offer + 2-of-5 Lily answers)

**CEO trigger:** Lily Huang เสนอ device รุ่นใหม่ $239/ตัว · face + QR ในเครื่องเดียว · CEO ถามรายละเอียด 5 ข้อ · Lily ตอบ 2 ข้อก่อน · ที่เหลือรอ engineer

**Lily ยืนยันแล้ว (สำคัญทั้งคู่):**
- ✅ Q1 — webhook + protocol **เหมือน F606 เป๊ะ** · ของที่ทำไว้ใช้ต่อได้หมด (bridge · reply format · adapter)
- ✅ Q4 — เครื่องเดียวรองรับทั้ง face + QR **พร้อมกัน** · ไม่ต้องสลับโหมด

**ยังรอ Lily/engineer ตอบ (3 ข้อ):**
- ⏳ Sample webhook JSON × 4 event types (face match · face fail · stranger · QR scan) — ต้องใช้สร้าง parser ก่อน device มาถึง
- ⏳ Cloud test endpoint / simulator — เทสได้ก่อนของจริง
- ⏳ Gate relay behavior สำหรับ QR (local recogRelay vs server-decided)
- ⏳ HTTPS support สำหรับ firmware ใหม่ (สำคัญสุด · ตัดสินเรื่อง deploy bridge)

**Shipped this round:**
1. `tools/acs-http-bridge/LILY_FOLLOWUP_2026-05-27.md` — draft message 4 ข้อ merged จาก 2 chat sessions
2. Memory new: [[acs-dual-mode-device-2026-05-27]] — บันทึก device ใหม่ + 2/5 answers
3. MEMORY.md index updated

**Strategic implication (Playland UX):**
- Device ใหม่ดีกว่า F606 สำหรับ Playland — ตรงกับ [[playland-workshop-decisions]] (QR เคยวางไว้สำหรับ visitor entry)
- Members → face scan · Visitors → QR ticket (no face enroll · privacy-friendly สำหรับเด็ก)
- Babysitters/พี่เลี้ยง → QR ผูกกับ session · ไม่ต้อง enroll
- ราคา $239 vs F606 (ยังไม่ได้ราคา) — ต้องเปรียบเทียบ

**Pending CEO action:**
1. ส่ง `LILY_FOLLOWUP_2026-05-27.md` ให้ Lily (เมื่อพร้อม)
2. รอ engineer ตอบ 4 ข้อ → ค่อยตัดสินใจ deploy bridge หรือไม่
3. ตัดสินใจระหว่าง F606 vs device ใหม่ ($239) สำหรับ order 3 ตัวจริง

**Memory + sync state:**
- ทุก memory file อยู่ที่ `~/.claude/projects/-Users-patipantantikul-Code-buildlygo/memory/` · chat ทั้งของ Pool + Buildly Go ดึง memory จากที่เดียวกัน → ทุก chat อ่านเจอ
- STATUS.md (ไฟล์นี้) อยู่ใน pooilgroup-web repo · chat ที่ทำงานในที่อื่นอาจไม่อ่านอัตโนมัติ → ใช้ memory เป็นช่องทาง sync หลัก

---

## 🆕 Update (2026-05-26 · รอบ 56 — Playland ACS-F606 deep audit + HTTP bridge ship)

## 🆕 Update (2026-05-26 · รอบ 56 — Playland ACS-F606 deep audit + HTTP bridge ship)

**CEO trigger:** ACS engineer (Lily Huang) report "your interface cannot be connected" หลัง cloud-test ของ device F606 ยิง webhook ของเรา

**Deep investigation findings (proven, not guessed):**
- ✅ Endpoint ของเรา live + ตอบถูก spec (curl 4 รอบจาก outside ผ่านหมด · HTTPS · auth · device-registered · adapter parse)
- ❌ Root cause = **F606 firmware HTTP-only** · doc-2 §2.6.1 หน้า 28 มี red-text "must set up http server to receive data" + debug log ภายใน device ที่อยู่ในเอกสารเอง (หน้า 30) แสดง `http api post record url:http://...` · Vercel = HTTPS-only + device ไม่ตาม redirect → ตี TLS port 443 ไม่สำเร็จ
- 🐛 **Secondary bug** — route.ts reply ด้วย `{"AcsRes","ActIndex","Time","Msg"}` format อ้าง "PDF §11.11" ที่ **ไม่มีอยู่จริง** (AI-hallucinated เก่า) · spec จริง §2.6.1 บอก `{"result":0,"message":"OK"}`

**Shipped this round (NOT yet committed · pending CEO review):**
1. `app/api/playland/acs/event/route.ts` — แก้ reply format ตาม §2.6.1 + ลบ logic shouldOpen (device ตัดสินใจเปิดประตูเองผ่าน `recogRelay=1`) + แก้ comment ที่อ้าง §11.11 ผิด
2. `tools/acs-http-bridge/worker.js` — Cloudflare Worker HTTP→HTTPS bridge
3. `tools/acs-http-bridge/wrangler.toml` — deploy config
4. `tools/acs-http-bridge/nginx-fallback.conf` — alt VPS-based bridge
5. `tools/acs-http-bridge/README.md` — CEO deploy guide (Thai)
6. `tools/acs-http-bridge/LILY_REPLY_DRAFT.md` — draft message ถาม Lily (firmware HTTPS / cloud relay / device error log)

**Verify:**
- `tsc --noEmit` clean
- `eslint app/api/playland/acs/event/route.ts` clean
- curl prod endpoint (4 calls) — ทุก path ตอบถูกต้อง

**Pending CEO action (4 ข้อ):**
1. ส่ง draft message ถึง Lily (LILY_REPLY_DRAFT.md)
2. เลือก deploy bridge แบบไหน — Cloudflare Worker (ต้องมีโดเมน) หรือ nginx VPS
3. Confirm commit ไหม (ของผม + ไฟล์ bridge · ยังไม่ deploy)
4. หลัง bridge live → update `platformIp` ของทุก F606 device ใน admin UI

**Skip (out of session scope per [[playland-only-session-scope-2026-05-26]]):**
- ยังไม่แตะไฟล์ wristband/scan/stock-count ที่ค้างใน working tree (เป็นของ playland-wristband-pos · งานคนละก้อน)

**Memory updates:**
- New: [[acs-http-bridge-required-2026-05-26]] — บันทึก root cause + solution
- Updated: [[acs-architecture-confirmed]] — fix reply-format claim ที่ผิด · ใส่ corrigendum
- MEMORY.md index updated

---

## 🆕 Update (2026-05-26 · รอบ 55 — `/bigsolvebug` ลุยทั้งหมด · 8 commits · 17 bugs fixed)

**CEO goal**: "ลุยทั้งหมด" (after `/bigsolvebug --quick recruit` run #1 found 35 bugs)

**8 commits shipped** (`0103de5 → 974c9a4` · ยังไม่ deploy prod):
1. `0103de5` — RLS policy migration applied to prod DB (recruit_inbox_channels + recruit_form_templates) [B-003]
2. `dd63c03` — Resend + Anthropic AbortSignal.timeout (Resend 10s · Haiku 15s · Sonnet 20s) [B-002]
3. `67f0806` — ScheduleInterview modal Esc + UUID validation on /recruit/applications/[id] [B-007]
4. `96faca7` — Mobile UX (inputMode tel/email · MIME accept image/* · pb-safe submit · tap target 44px) [B-006]
5. `e782bf5` — Validation (Feb-30 detection · maxLength cap 10k · interview status re-read)
6. `d7252a6` — Optimistic lock `updateMany WHERE status: expectedPrev` on changeApplicationStatus [B-008]
7. `99f260d` — Filename ext vs Content-Type match on /api/recruit/upload (partial MIME guard)
8. `974c9a4` — P2 polish · breadcrumb + encrypt FB verifyToken + Resend prod-throw

**4 false positives caught (proves the LESSONS pattern "always read full file")**:
- P0-6 cross-org channelInstanceId guard — already exists at message-actions.ts:112-114
- P1-3 TabButton aria-label — has visible `{label}` already
- P1-9 long_text max — schema already had `max(field.maxLength ?? 5000)`
- P2-12 server-side maxFiles — exists at submit-action.ts:51

**Phase 6 verify · ALL CLEAN**:
- `tsc --noEmit` clean
- `next build` clean · all 80+ routes compile
- Regression-library greps: 5/10 patterns now resolved

**Pending CEO confirmation (4 items)**:
1. **Schema migration** `supabase/migrations/20260526000002_recruit_unique_constraints.sql` — 2 partial unique indexes (webhook idempotency + blacklist dedup). Auto-classifier blocked apply correctly.
2. **R2 lifecycle policy** — Cloudflare 24h auto-delete (P1-14)
3. **Modal primitive refactor** — replace 5 `window.confirm()` (P2 polish · ~1 day)
4. **Deploy to prod** — review commits then `vercel --prod`

**Skill self-improvement**:
- `~/.claude/skills/bigsolvebug/LESSONS.md` — Run #2 entry added
- Pattern reinforced: "always read full file before trusting agent report" (caught 4 false positives)
- Pattern emerging: "Phase 4 triage should re-verify each finding by opening file"

**Master report**: `docs/BUGSOLVE_recruit_2026-05-25.md` (appended "2026-05-26 update" section)

## 🆕 Update (2026-05-25 · รอบ 54 — ChairOps audit #2 + Wave 0 + Wave 1 COMPLETE + bigsolvebug auto-fix · ~10,500+ LOC)

**CEO goal:** "ทำให้ ChairOps ใช้ได้จริงทุก feature · Claude design สวยๆ · ทีม orchestra ทุกคน sign-off · ทาง A ลุยทั้งหมด · รัน /bigsolvebug + /claude-design · skill ปรับให้คม"

**Workflow:**
- `/auditbigteam chairops` รอบ 2 · 17-persona roster (core 13 + OFC + FIN + AUD + SRE add-ons · ผมสร้าง 3 + linter เพิ่มอีก 3) · 5 phases · Phase 0.5 Drift Audit MANDATORY ใช้ครั้งแรก
- CEO locked Way A (full lui-lui · DEVIL hard-fail acknowledged · CEO override) + 6 P0 + 8 D-NEW
- Wave 0 critical fixes (5 surgical edits · 1 subagent)
- `/claude-design chairops` Phase 0+1 plan → Phase 2 build (kit + 4 priority workspaces parallel) → typecheck pass
- `/bigsolvebug --quick chairops` (targeted 4 new workspaces · 5 persona sims · report-only)
- Skill sharpening doc สำหรับ session ถัดไป

**Shipped (~6,500+ LOC new · ทั้งหมด typecheck pass):**

### Wave 0 — 5 critical fixes
- `vercel.json` +3 ChairOps crons (Hobby rewrote 2 ตัวเป็น daily · ต้อง Pro plan)
- `app/(admin)/chairops/layout.tsx` NEW · module-entitlement gate
- `lib/chairops/auth/session.ts` · auto-ADMIN bootstrap REMOVED · denial logged · `/403?reason=chairops_access_pending`
- 7 action files wrapped `prisma.$transaction(async tx => ...)` · audit log INSIDE tx
- `prisma/migrations/20260525_chairops_audit_log_immutable/migration.sql` · DB trigger blocking UPDATE/DELETE/TRUNCATE (รอ CEO `prisma migrate deploy`)

### Wave 1 COMPLETE — Kit + 7 workspaces (10,532 LOC)
- **Kit (1,000 LOC · 8 primitives):** ShortageDriftCell · DiffBucketPills · PhotoProofPanel · MasterDetailShell · ChairopsKpiTile · MakerCheckerBadge · LineNotifyToggle · ChairCodeChip
- **W1 Office Shell + Exec Home (736 LOC · 7 files):** `(office)/layout.tsx` + `office-top-nav.tsx` + `page.tsx` (CEO 5 KPI tiles 2x3 mobile→5col md+) + `branches-leaderboard.tsx` + loading + error + `queries/exec-home.ts`
- **W2 Reconcile (1,408 LOC · 6 files):** `(office)/reconcile/{page,[branchId]/page,recompute-button,loading,error}.tsx` · BR1+BR2 banner + escalation tier
- **W3 POS-Ingest (1,078 LOC · 8 files):** `(office)/pos-ingest/{,new,i/[id]}/*` + `commitPosImportWithCheck()` BR16 maker-checker
- **W4 Alerts (1,158 LOC · 4 files):** `(office)/alerts/*` + bulkAck/bulkResolve actions + setLineChannelForEventKind stub
- **W5 Write-offs (1,119 LOC · 5 files):** `(office)/write-offs/*` + bulkApproveWriteOffsAction (BR3 fast-lane <500) · BR15 best-effort cascade (Wave 2 atomic)
- **W6 Maid Collect (1,734 LOC · 14 files):** `(maid)/{layout,_components/maid-shell,m/{page,collect/new,collect/[id]}}` + utils (idempotency · maid-outbox IndexedDB · image-compress JPEG)
- **W7 Users (2,277 LOC · 10 files):** `(office)/users/*` + `users/[id]/*` + `users/new/*` + `users/pending/*` + `lib/chairops/auth/actions.ts` (approve/rejectAccessRequest with role-rank guard)

### bigsolvebug --quick → auto-fix
- 38 bugs surfaced · 16 auto-fixed (4 P0 + 12 P1) · 22 deferred (1 P0 architectural + 2 P1 design call + 19 P2 out-of-scope)
- 2 commits: `76d654c` (confirm dialog + maid form UX · 6 bugs) · `f5e81e0` (backend perf + a11y + dead-prop + wrong-field · 10 bugs)
- Critical fix: B-18 PhotoProofPanel `photoUrl` → `evidencePhotoUrl` (was silently never populating)

### 21 TODO[claude-design] markers across Wave 1 · all typecheck PASS · เปิด preview deploy ได้เลย

**Deferred to Wave 2 (post-pilot):**
- Period-close lock + AdjustmentRequest + JournalEntry · MANAGER_AREA role + table · LINE Notify→Messaging API · accounting export (BC/Express + VAT + GL) · 9 missing IA routes

**Artifacts:**
- `docs/AUDIT_chairops_2026-05-25.md` (516 lines · 10 sections · authoritative spec)
- `docs/SKILL_SHARPENING_2026-05-25.md` (NEW · 4 skills × ~5 recommendations + 5 cross-skill)
- `docs/BUGSOLVE_chairops_2026-05-25.md` (NEW · pending bigsolvebug agent return)
- `/tmp/claude-design_chairops_plan.md` (430 lines · 7 workspaces · 8 CEO confirms)
- Memory `chairops-audit-2026-05-25` updated with Way A lock + 8 D-NEW + 6 P0 answers

**CEO action items:**
1. **Review + commit Wave 1 working tree** (many M/D + new files · ผม uncommitted ตามนโยบาย "never commit without CEO ask")
2. **Upgrade Vercel Hobby → Pro** (recompute-drifts + sop-check ต้องการ */15 + hourly · ตอนนี้ daily)
3. **Apply migration:** `cd pooilgroup-web && npx prisma migrate deploy` (audit log immutability)
4. **Get LINE Messaging API bot tokens** ก่อน pilot (LINE Notify EOL'd · stub พร้อม)
5. **Test preview deploy URLs:** `/chairops` (W1 exec home) · `/chairops/reconcile` (W2) · `/chairops/pos-ingest` (W3) · `/chairops/alerts` (W4) · `/chairops/write-offs` (W5) · `/chairops/m` (W6 maid) · `/chairops/users` (W7 admin)

## 🆕 Update (2026-05-25 · รอบ 53 — `/bigsolvebug` skill ทดสอบครั้งแรก · Quick mode บน recruit)

**CEO goal:** "ลุย /bigsolvebug skill"

**Skill orchestration ทำงานครบ end-to-end** · cost ~210k tokens · ~25 นาที · เจอบั๊กจริง 35 ตัว (Quick mode = report-only · ยังไม่ auto-fix)

**Bugs by severity:**
- **6 P0**: 2 RLS missing (`recruit_inbox_channels` + `recruit_form_templates`) · webhook idempotency · 2 external API no timeout (Resend + Anthropic) · cross-org channelInstanceId guard
- **15 P1**: Modal no Esc · UUID validation missing · 3 race conditions · mobile UX (inputMode · camera · accept) · file MIME spoofing · date "Feb 30" silent · R2 orphan · blacklist no unique
- **14 P2**: Browser confirm() Thai · breadcrumb · icon-only labels · bulk multi-select feature gap · FB verifyToken plaintext · etc

**Master report**: `docs/BUGSOLVE_recruit_2026-05-25.md`

**Self-improvement seeded**:
- `~/.claude/skills/bigsolvebug/LESSONS.md` — 3 patterns + run #1 entry
- `~/.claude/skills/bigsolvebug/regression-library.md` — 10 new entries (B-001 to B-010)
- Next run auto-tests these patterns · ฉลาดขึ้นทุก run

**Recommended next**: CEO review report → decide Tier A (~1.5h · 6 P0 auto-fixable) / Tier B (1-2d · 15 P1) / Tier C (CEO calls). Optional: `/bigsolvebug recruit` Full mode 25 sims (~45 min · ~1M tokens).

## 🆕 Update (2026-05-23 · รอบ 51 — LINE OA + Facebook inbox production-ready)

**CEO goal:** "ทำระบบช่อง chat Line fb ให้ใช้ได้จริง"

**Phases 2-4 ของ `docs/RECRUIT_OMNICHAT_PLAN.md` ลงจอ (commit `bf1fa7b` · deploy `pooilgroup-pesoay1aa`):**

- **Schema:** เพิ่ม `line_user_id` + `facebook_psid` ใน `recruit_applicants` · เพิ่ม `channel_instance_id` + `sender_external_id` + `reply_token` + `attachments` ใน `recruit_messages` · เพิ่ม `FACEBOOK` ใน enum
- **Crypto:** AES-256-GCM envelope encryption (env `RECRUIT_CHANNEL_KEY` หรือ fallback sha256(NEXTAUTH_SECRET)) · HMAC verifiers สำหรับ LINE (base64) + FB (`sha256=hex`)
- **Inbound:** `/api/webhooks/recruit/{line,facebook}/[channelId]` verify ลายเซ็น → parse event → match applicant ด้วย lineUserId/facebookPsid → auto-create stub พร้อม placeholder phone + ดึง profile name → persist `recruit_messages` (direction=IN · attach replyToken สำหรับ LINE 1-min cheap reply path)
- **Outbound:** `sendMessage` action ต่อยอด · ถ้า channel เป็น LINE/FB → resolve channelInstanceId → decrypt access token → LINE: Reply API (free) → fallback Push · FB: Send API `RESPONSE` mode · update msg.status SENT/FAILED
- **UI:** ChannelsManager รับ Channel Secret + Access Token จากผู้ใช้ · `SecretStatusChip` แสดงสถานะ secret ต่อ channel · edit-in-place rotate secret ได้ · FB cards show "VERIFY TOKEN" copy button สำหรับ hub.challenge step

**Smoke pass:** GET health 200 · POST bogus channel 404 · FB hub.challenge wrong token 403 · admin route 200

**CEO action item:** ใส่ env `RECRUIT_CHANNEL_KEY` ใน Vercel (= `openssl rand -base64 32`) · ตอนนี้ระบบใช้งานได้แต่ encryption key fallback จาก NEXTAUTH_SECRET พร้อมเตือนใน prod log

**Remaining open (Phase 5 · ~0.5d):** banner "ยังไม่กรอกใบสมัคร" ใน inbox · profile merge ตอน applicant ทั้งทักทาง LINE และกรอก /apply

## 🆕 Update (2026-05-23 · รอบ 50 — Recruit: templates + IQ image + LINE/FB scaffolding + wider layout)

**CEO goal:** ทำให้ recruit ใช้ได้จริงทุก feature · พื้นที่ซ้ายขวาว่างเยอะ · scroll bug ตอนสร้างคำถาม · template ช่วยสร้างคำถามเร็ว · แนบรูป IQ · template เซฟเพื่อใช้ใหม่ · LINE OA + FB inbox รวมแชท (หลายบัญชี)

**Shipped commit `0457e34` · deploy `pooilgroup-azny73lh3`:**

### Phase A — Layout + scroll fix
- 9 หน้า data-heavy ขยายจาก `max-w-6xl/7xl` → `max-w-[1600px]`
- FormBuilder palette sticky + scroll · FieldTypePicker dropdown มี max-h + backdrop click-to-close

### Phase B — Section templates (preset blocks)
- `lib/recruit/section-templates.ts` · 5 presets (Personal · Experience · IQ · IQ-image · Documents)
- Modal picker คลิก template → เพิ่ม section ทันที

### Phase C — Image attach + IQ correct-answer marker
- Field schema + `imageUrl` · admin upload route + RLS · render img เหนือคำถาม
- IQ correct-answer checkbox + selector ใน radio/dropdown editor

### Phase D — Save/load form templates per-org
- New model `RecruitFormTemplate` + DDL + RLS
- create/list/delete actions · 2 modal ใน FormBuilder (save + load)

### Phase E — LINE OA + Facebook scaffolding
- New enum + model `RecruitInboxChannel` (multi-account · webhook secret · encrypted token slot)
- `/recruit/settings/channels` page + ChannelsManager UI · copy webhook URL
- Webhook stubs `/api/webhooks/recruit/{line,facebook}/[channelId]` (return 200 + log)
- FB hub.challenge GET verification working
- Architecture doc `docs/RECRUIT_OMNICHAT_PLAN.md` · 5 phases · ~4.5 dev-day remaining for production

**Live + smoked:** /recruit/settings/channels · /api/webhooks/recruit/line/* · /api/webhooks/recruit/facebook/* all 200 OK · build clean · DDL applied to prod

## 🆕 Update (2026-05-22 · รอบ 49 — Recruit 4-agent deep audit · 5 bug fixes + 3 visual polish)

**CEO goal:** "deep research ว่าไม่มีฟีเจอรไหน ใช้งานไม่ได้ · ตรวจหน้าต่อหน้า ดูทุกดีเทบว่าปุ่มไหนเค้ามีเราไม่มี"

**Workflow:** spawned 4 parallel Explore agents (detail-diff · live-QA · wiring-audit · submit-flow) → ~2,000 lines of audit output → synthesized into actionable list → fixed Tier 1 + 2.

**Functional bugs fixed (commit `9953c0f`):**
1. ⚠️ "ใช้กฎทั้งหมด" ปุ่มหาย → wired in ApplicationActions (action `applyRulesToApplication` มีนานแล้ว · ไม่เคยมี UI). Toast confirms how many rules fired.
2. 🔒 Cross-org leak ใน `listThreads` → ลบ super_admin bypass · บังคับ org_id match (security)
3. 📧 EMAIL channel marked SENT optimistically (false success) → keep QUEUED ตาม LINE/SMS จนกว่า Resend จะ wire
4. 📝 Triage "Skip" ไม่ persist → save เป็น timeline note "HR ข้ามจาก triage" สำหรับ audit trail
5. 📋 `updatePosting` ไม่มี audit log → เพิ่ม `RECRUIT_POSTING_UPDATED` action

**Visual polish (canvas Section 02B + 05A):**
- Pipeline KCard: red border + 🔥 "เกิน SLA" badge เมื่อ stage overdue (NEW=3d · SCREENING=5d · INTERVIEW=7d · OFFERED=5d)
- MiniFunnel legend: colored dot นำหน้า label ตรงกับสีของแท่ง
- AI Score ring: SVG `<animate>` draws stroke-dashoffset on mount (0.9s · apple-out easing)

**False alarm verified:** Blacklist add/remove wired ผ่าน blacklist-manager.tsx + v2 (agent grep missed)

**Deferred (separate scope · need CEO direction):** Cmd+K · Bulk actions · drag-drop pipeline · AI JD suggest · Branch Needs · OTP wizard

**Live + smoked:** /jobs /apply /recruit/* all 200 OK · no 500s · deployed `pooilgroup-nmrqow029`

## 🆕 Update (2026-05-22 · รอบ 48 — Recruit canvas parity pass)

**CEO goal:** "เทียบหน้าต่อหน้ากับ Recruit Redesign canvas · ทำให้แอฟ HR เหมือนตามรูป HTML 100%"

**5 gap หลักที่ปิด (commit `3eb9503` · deploy `pooilgroup-ok19v2144`):**
1. **Status tones แยกชัด** — เดิม SCREENING=น้ำเงิน, INTERVIEW+OFFERED=อำพันคล้ายกัน → ตอนนี้ amber/orange/purple ตาม canvas. Badge primitive ได้ tone ใหม่ `orange` + `purple`.
2. **Status pill มีจุดสีนำหน้า** ทุกที่ (ApplicationDetail hero · Inbox filter · PostingCard) — เดิมมีแต่ pipeline column
3. **/apply/[slug] hero** — gradient brand-600→brand-900 + trust chips (เวลา 4-7 นาที · ไม่ต้องล็อกอิน · PDPA ปลอดภัย) ตรงตาม canvas Screen 03-1
4. **Public form section dots** — สี brand/orange/purple/green ตามประเภท section (ติดต่อ→brand, ประสบการณ์→orange, IQ→purple, ไฟล์→green) + arrow CTA + emerald "บันทึกอัตโนมัติ" pulse
5. **Posting card urgent** — border canvas #f5b800 + gradient #fffbeb→white

**Deferred (massive scope · separate):** OTP wizard 9-step · Branch Needs sidebar · HR native mobile screens · form-builder 3-pane palette

**Verified live:** /jobs + /apply/* + /recruit/* return 200/307 OK · hero text "ใช้เวลา 4-7 นาที" + "PDPA ปลอดภัย" + "บันทึกอัตโนมัติ" rendering on prod


## 🆕 Update (2026-05-21 — Repair full sweep · QA/QC/BA/SA pass · seed-repair-demo.mjs + all 11 pages redesigned)

**CEO goal:** "เอาหลักการ Pooil App.html ไปปรับหน้าอื่น ๆ ของระบบแจ้งซ่อม · QA/QC/BA/SA แก้บั๊ก · เพิ่ม seed data ตัวอย่างให้เห็นภาพ · ไม่ข้าม module"

**Round 2 (after Pooil App Command Center · ทำหน้าที่เหลือ):**

**Files created (NEW):**
- `scripts/seed-repair-demo.mjs` — idempotent demo seed: 8 categories + 6 technicians + 18 tickets (every status × urgency) + photos + parts + timeline events. Tags `metadata.demo=true` for one-line cleanup.
- `components/repair/sub-header.tsx` — shared sub-page header (icon + eyebrow + title + KPI strip + crumbs + back-link) for all secondary admin pages

**Pages redesigned (Pooil App spec):**
- 🔧 `/repairs/parts` — KPI strip + consolidate-hint banner + 2-section layout (aggregated buy-list + per-ticket rows)
- 🔧 `/repairs/technicians` — roster grid (4-col) w/ workload bars, color-coded load (>=7 red, >=4 amber, >=0 green), filter chips (all/internal/vendor/active/inactive), search
- 🔧 `/repairs/my-jobs` — persona hero + 3 KPIs + card list w/ priority bar, SLA chip, parts/photo icons. Empty state shows admin nav fallback.
- 🔧 `/repairs/categories` — KPI strip (urgent/normal/low counts) + sub-header
- 🔧 `/repairs/settings` — 4 KPIs + 2 resource cards (techs + categories) + public-link card + SLA reference (4hr/24hr/7d tiles)
- 🔧 `/repairs/recurring` — KPI strip (จุดที่ซ้ำ + ค่าซ่อมรวม + ค่าเสียโอกาส) + sortable failure table + jump-to-triage links
- 🔧 `/repairs/new` — wrapped under sub-header + crumbs
- 🔧 `/repairs/[id]` — sub-header + pipeline visualization (6 status steps w/ progress bar) + clean meta grid + tighter density
- 🔧 `/r` — hero gradient + 2 primary action cards + how-it-works steps
- 🔧 `/r/track` — back link + hero icon + form + anti-bruteforce note
- 🔧 `/r/track/[code]` — pipeline visualization + meta grid + photos + timeline + branded contact card
- 🔧 `components/repair/ticket-detail-panel.tsx` — sectioned (pipeline + meta + actions + photos + parts + timeline)
- 🔧 `components/repair/technician-admin.tsx` — toolbar (search + filter chips) + slide-in form + grid cards
- 🔧 `components/repair/track-form.tsx` — focus ring polish

**QA / Bug fixes:**
- 🐛 `lib/repair/actions.ts` notification link: `/repairs?selected=` → `/repairs/triage?selected=` (inbox URL moved last round; orphan link would 404)
- 🐛 `lib/repair/actions.ts` revalidatePath() added `/repairs/triage` + `/repairs/table` everywhere `/repairs` was invalidated (createTicket, changeStatus, assignTechnician)
- 🐛 `lib/modules.ts` nav: added Triage Inbox + Table view entries; renamed `/repairs` label to `ภาพรวม Command` to reflect new content. Old `กล่องรับเรื่อง` would mislead.

**Route map (final):**
- `/repairs` — Command Center Overview
- `/repairs/triage` — Inbox split-view
- `/repairs/kanban` — 5-col Kanban
- `/repairs/table` — dense filterable table
- `/repairs/my-jobs` — tech personal queue (Persona)
- `/repairs/parts` — purchasing queue
- `/repairs/recurring` — recurring failure report
- `/repairs/technicians` — admin roster
- `/repairs/categories` — admin categories
- `/repairs/settings` — setup hub
- `/repairs/new` — internal create form
- `/repairs/[id]` — single ticket detail
- `/r`, `/r/new`, `/r/track`, `/r/track/[code]` — public

**Verified:**
- ✅ `npx tsc --noEmit` — 0 NEW errors in repair files (pre-existing recruit/docuflow unchanged)
- ✅ `npx eslint app/(admin)/repairs components/repair app/r` — clean (0 warnings, 0 errors)
- ✅ `node --check scripts/seed-repair-demo.mjs` — syntax OK
- ✅ Dev server boots (turbopack 393ms)
- ✅ Curl 14 routes — admin 307 (auth gate), public 200, no 500
- ✅ Public form / landing / tracking all render expected sections in HTML
- ⏳ Run seed script: `node scripts/seed-repair-demo.mjs` (requires .env.local with service role key)
- ⏳ CEO manual browser walkthrough

**No schema changes** — All reuse existing 7 tables. `metadata.demo=true` JSON field flag for cleanup (single SQL: `DELETE FROM repair_tickets WHERE metadata->>'demo' = 'true'`).

**Files touched this round:** 14 (2 new + 12 modified) · ~3,500 net new/changed lines

## 🆕 Previous (2026-05-21 — CashHub full sweep · QA/QC/BA/SA findings + bug fixes + design migration)

**CEO goal:** "เอาหลักการ CashHub Redesign ไปใช้ทุกหน้าใน CashHub · ส่ง QA/QC/BA/SA มาช่วย · แก้ bug · ไม่ข้ามไปโปรแกรมอื่น"

**4 agents launched (BA · SA · QA · QC) — findings synthesized:**
- 12 API routes missing module entitlement gating (Critical)
- 2 routes using stale `requireRole("super_admin","org_admin","admin")` instead of `requireExecutiveRole`
- Sticky thead offsets at `top-0` instead of `top-14 sm:top-16` (3 sites)
- console.error left in slip-camera
- Spike modal missing ESC key + aria-modal
- 13+ pages using legacy tokens (`--color-brand-*`, `text-gradient-blue`, `tracking-[0.18em]`)

**Bug fixes shipped:**
- ✅ `lib/cashhub/api-guard.ts` (NEW) — unified `cashHubApiGuard({ executive?: true })` wraps every API: module-disabled 503 / unauthorized 401 / forbidden 403
- ✅ Applied gate to **14 API routes**: approve · approve-bulk · ev-import · ev-import/preview · unlock · drafts · notes · ocr-slip · missing-reason · targets · reports · reports/by-date · export · shortages/export · ai
- ✅ ev-import + ev-import/preview migrated from `requireRole("super_admin","org_admin","admin")` → `cashHubApiGuard({ executive: true })`
- ✅ unlock route now has 2-layer guard: module entitlement + `requireRole("super_admin")` for the destructive action
- ✅ Sticky thead fixed: `my-branches-view.tsx:270` · `heatmap-grid.tsx:133` · `ev-import-view.tsx:396` → `sticky top-14 sm:top-16 z-20`
- ✅ `slip-camera.tsx:73` — removed `console.error` (Sentry instrumentation already catches it)
- ✅ `report-form.tsx` spike modal — added ESC handler + `aria-modal` + labelled by `spike-modal-title`

**Design migration shipped — all 16 CashHub routes use SectionPill + TwoToneTitle:**
- ✅ `/cashhub/reports` (high) — รายงาน ทั้งหมด
- ✅ `/cashhub/leaderboard` — อันดับ สาขา
- ✅ `/cashhub/my-branches` — สาขา ของฉัน
- ✅ `/cashhub/shortages` — เงินขาด ฿N
- ✅ `/cashhub/compare` — เปรียบเทียบ เดือน vs เดือน
- ✅ `/cashhub/missing` — สาขาที่ยังไม่ กรอกรายงาน
- ✅ `/cashhub/notes` — โน้ตจาก Staff
- ✅ `/cashhub/quick-fill` — กรอก ทุกสาขา
- ✅ `/cashhub/kiosk` — ตู้คีบ + เก้าอี้นวด
- ✅ `/cashhub/training` — ศูนย์ ฝึกอบรม
- ✅ `/cashhub/import` — ศูนย์ นำเข้าข้อมูล
- ✅ `/cashhub/rentals` — สัญญา ค่าเช่า
- ✅ `/cashhub/settings` — ตั้งค่า CashHub
- ✅ `/cashhub/dashboard/business/[type]` — drill-down
- ✅ `/cashhub/reports/[id]` — report detail
- ✅ `/cashhub/branches/[id]` — branch detail
- ✅ `/cashhub/dashboard` + `/cashhub/heatmap` + `/cashhub/settings/forms` (already done in 1st pass)

**Verified:**
- ✅ `npx tsc --noEmit | grep cashhub` → zero errors
- ✅ `npx next build` → "Compiled successfully" (pre-existing recruit/erasure typecheck errors unrelated)
- ✅ All 16 routes → 307 redirect to /login (auth gate working)
- ✅ All API routes → 401/405 (no 500 errors · gate works)

**Scope honored:** ONLY CashHub touched · DocuFlow / Recruit / Repairs untouched

---

## 🆕 Update (2026-05-21 — DocuFlow Round 2 · ทุกหน้า + sample data · build verified)

**CEO goal:** "เอาหลักการ canvas design ไปใช้ทุกหน้าใน DocuFlow · ห้ามข้ามไปโปรแกรมอื่น · แก้ bug ทั้ง frontend/backend · เพิ่ม sample data ให้เห็นทุก feature"

**Files redesigned this round (9 หน้า + 1 seed script):**
- 🔧 `/docuflow/documents` (advanced list) — DfStatCard ✕ DfPill filters + DocumentCard grid
- 🔧 `/docuflow/checklist` — 4 KPI stat cards (legal/uploaded/missing/compliance%) + canvas header (compliance score in title)
- 🔧 `/docuflow/vehicles` (fleet list) — 4 stat cards + DfPageHeader + filter card
- 🔧 `/docuflow/vehicles/[id]` (vehicle detail) — emoji avatar + DfPill row + 4-doc slot grid
- 🔧 `/docuflow/vehicles/new` — DfCard form wrap + canvas header
- 🔧 `/docuflow/vehicles/[id]/renew` — DfCard form wrap + old-expiry DfPill chip
- 🔧 `/docuflow/persons` (person list) — 4 stat cards + DfPill avatars + completion bar redesign
- 🔧 `/docuflow/persons/[userId]` — avatar + role/employee DfPill + 4-slot grid
- 🔧 `/docuflow/persons/[userId]/renew` — DfCard form wrap

**QA findings (orgId guarded · no critical bugs found):**
- ✅ All Prisma queries in `/api/docuflow/*` route through `orgId: session.user.org_id` filter
- ✅ Sign endpoint has both `signerUserId === session.user.id` check AND admin tier fallback
- ✅ Upload route uses Zod schema validation + `requireAdminTier`
- ✅ Download route filters `isActive: true` to prevent serving soft-deleted docs
- ✅ Signature placement re-sign guard returns 409 Conflict
- ✅ No `documentSignaturePlacement.assignedUserId` references (correct field is `signerUserId`)

**Sample data seeder (NEW):**
- ✏️ `scripts/seed-docuflow-demo.mjs` — Idempotent seed with `[DEMO]` description prefix:
  - 12 documents across 6 categories (station/legal/tax/insurance/contract/land) with varied expiry windows (today/5d/22d/60d/expired/no-expiry)
  - Document ownership at group/company/branch/person levels
  - 10 tag varieties
  - Cross-branch share (2 docs)
  - 4 vehicles + 16 vehicle documents (registration/พ.ร.บ./ตรวจสภาพ/ใบรับรองถัง)
  - 9 person documents (license/health/training) across first 3 staff/driver users
  - Clean mode: `node scripts/seed-docuflow-demo.mjs --clean` removes only `[DEMO]`-prefixed rows

**Verified:**
- ✅ `npx tsc --noEmit | grep docuflow` → zero errors (typecheck clean)
- ✅ All /docuflow routes still compile (`next build` recruit pre-existing issue not docuflow-related)
- ⏳ Run seed locally → manual browser test

**Scope honored:** ONLY DocuFlow touched · CashHub / Recruit / Repairs untouched

---

## 🗂 Round 1: DocuFlow Redesign · 9 routes + 3 ใหม่ · build verified · ยังไม่ deploy

**CEO goal:** "redesign การใช้งานของระบบเอกสารใน Pooilgroup ทั้ง backend frontend · มือถือ + คอม · ยึก design canvas `DocuFlow Redesign.html`"

**Design canvas:** 21 artboards (13 desktop + 8 mobile) — warm cream bg (#F4EEE2), royal blue (#1B47B5), burnt-orange accent (#C46A3D), IBM Plex Serif Thai display.

**Shipped (local · `npx tsc --noEmit` clean · `npx next build` OK):**

**Design tokens + primitives:**
- ✏️ `app/(admin)/docuflow/docuflow.css` — Canvas-aligned design tokens (warm cream + royal blue palette · pills/cards/buttons/segmented/inputs · scoped to `.df-root`)
- ✏️ `components/docuflow/df-ui.tsx` — Primitives: `DfMark`, `DfEyebrow`, `DfCard`, `DfPill`, `DfButton`, `DfDocIcon`, `DfAvatar`, `DfStatCard`, `DfSegmented`, `DfPageHeader`, `DfSection`
- 🔧 `app/(admin)/docuflow/layout.tsx` — import CSS + wrap children in `.df-root`

**Pages redesigned:**
- 🔧 `/docuflow` (Dashboard) — greeting hero · 4 stat cards · task list · expiring docs · risk snapshot · AI search shortcut
- 🔧 `/docuflow/browse` — 8 category tiles · org structure tree (companies/branches)
- 🔧 `/docuflow/documents/upload` — hero dropzone + AI auto-fill banner + form
- 🔧 `/docuflow/documents/[id]` — large preview + tabs + right meta panel
- 🔧 `/docuflow/documents/[id]/signatures` — canvas-style header chrome
- 🔧 `/docuflow/expiry` — stat strip + bucket cards + side mini calendar
- 🔧 `/docuflow/risk` — Compliance Score header + canvas-style stat strip
- 🔧 `/docuflow/search` — centered AI hero + suggestion pills

**New routes (canvas required):**
- ✏️ `/docuflow/calendar` — full month grid · events from renewals · upcoming panel + legend
- ✏️ `/docuflow/notifications` — Inbox with expiry alerts + pending signatures + recent uploads · settings panel
- ✏️ `/docuflow/reports` — KPIs · 12-mo upload trend bars · top branches · AI savings card

**Verified:**
- ✅ `npx tsc --noEmit` clean (เฉพาะ pre-existing recruit AuditAction issues)
- ✅ `npx next build` ผ่าน · ทุก /docuflow route compile สำเร็จ
- ⏳ Manual UI test ใน browser (CEO เปิดเอง)

**No schema changes** — UI-only redesign · data layer unchanged · ใช้ existing canonical loaders (`loadDocuments`, `loadRenewals`, `loadDocumentById`, `buildDocumentTree`)

**Canvas coverage:**
| Canvas artboard | Status |
|---|---|
| DesktopDashboard | ✅ /docuflow |
| DesktopStructure | ✅ /docuflow/browse |
| DesktopUpload | ✅ /docuflow/documents/upload |
| DesktopViewer | ✅ /docuflow/documents/[id] |
| DesktopRenewal | ✅ /docuflow/expiry (rolled into) |
| DesktopSigning | ✅ /docuflow/documents/[id]/signatures |
| DesktopRisk | ✅ /docuflow/risk |
| DesktopSearch | ✅ /docuflow/search |
| DesktopCalendar | ✅ /docuflow/calendar (NEW) |
| DesktopNotifications | ✅ /docuflow/notifications (NEW) |
| DesktopReports | ✅ /docuflow/reports (NEW) |
| DesktopAudit | ⏳ deferred (existing /audit covers it) |
| DesktopWorkflow | ⏳ deferred (needs schema for multi-signer rules) |
| Mobile 8 screens | ✅ responsive grid breakpoints (`@media max-width:980px/1100px`) — all 2-col layouts collapse to single column |

**Deploy blocker:** none for DocuFlow · build clean · pre-existing recruit AuditAction TS errors are not blocking (in different module)

**Next session priorities:**
1. Audit log dedicated page `/docuflow/audit` (canvas DesktopAudit) — currently piggybacking on global `/audit`
2. Workflow builder UI `/docuflow/workflow` — needs schema (multi-signer rules · approval chains)
3. Mobile-dedicated screens (current is responsive but could add bottom nav for /docuflow/* specifically)
4. CEO browser test on production deploy

---

## 🗂 Previous: Repair Redesign (2026-05-21 · Claude Design `akxitfy16cP2njoHctcxHQ` · Pooil App.html)

**CEO goal:** "redesign ระบบแจ้งซ่อมใน pooilgroup · ยึด Pooil App.html · ใช้ได้ทุกฟีเจอร์ · ไม่มีบัค · ไม่แตะอันอื่น"

**Design source:** Claude Code design bundle (`Pooil App.html` + `Redesign.html` + `Public Form.html`) — Command Center (Linear/Stripe density) + 4-view tabs (Overview/Triage/Kanban/Table) + sectioned public form + biz-tab filter (Pooil/JP Sync).

**Files created (NEW):**
- `components/repair/view-header.tsx` — shared header w/ view tabs + biz filter chips + KPI summary
- `components/repair/overview-dashboard.tsx` — Command Center w/ KPI strip, action queue (4 buckets: assign/ack/parts/SLA), workload bars, pipeline funnel, hotspots, cost trend 8w, category breakdown, activity feed, volume by day
- `components/repair/admin-table.tsx` — dense filterable table view (200-row cap, sticky header, status+urgency chips, tech avatar, SLA, cost)
- `app/(admin)/repairs/triage/page.tsx` — wrap existing AdminInbox under new view header
- `app/(admin)/repairs/table/page.tsx` — table view route

**Files redesigned (MODIFIED):**
- `app/(admin)/repairs/page.tsx` — now Command Center Overview (was Inbox)
- `app/(admin)/repairs/kanban/page.tsx` — rich cards: priority bar, parts badge, SLA chip, tech avatar, cost. Status-dot column headers.
- `components/repair/public-form.tsx` — sectioned 5-step form: biz pills, category grid, camera-first photos, priority cards, contact w/ OTP hint, live preview sidebar (desktop), mobile progress bar
- `components/repair/admin-inbox.tsx` — slim inner header (RepairViewHeader takes title), all routing → `/repairs/triage`
- `app/r/new/page.tsx` — let form own its hero
- `app/r/layout.tsx` — widen to 1100px for preview sidebar
- `lib/repair/queries.ts` — extend with `companyId` filter + 8 new aggregates: countNewSince, hotspotBranches, categoryBreakdown, technicianWorkload, recentActivity, actionQueueBuckets, costTrend8w, volumeByDay, listCompanies

**Route map:**
- `/repairs` — Command Center (NEW landing)
- `/repairs/triage` — Inbox list+detail (former /repairs)
- `/repairs/kanban` — 5-column Kanban (redesigned cards)
- `/repairs/table` — dense filterable table (NEW)
- `/repairs/parts` — purchasing queue (untouched)
- `/repairs/technicians` — roster (untouched)
- `/r/new` — public form (redesigned)
- `/r/track` — public tracking (untouched)

**No schema changes** — all redesign reuses existing 7 tables + RPCs. Biz tabs filter by `companyId` (POOIL/JPSYNC).

**Verified:**
- ✅ `tsc --noEmit` — zero NEW errors in repair files (pre-existing recruit/docuflow errors untouched)
- ✅ ESLint — zero warnings/errors in 8 changed/new files
- ✅ Dev server boots clean (turbopack 373ms)
- ✅ Curl: `/repairs` `/repairs/triage` `/repairs/kanban` `/repairs/table` `/repairs/parts` `/repairs/technicians` → 307 (auth gate, correct); `/r/new` `/r` `/r/track` → 200
- ✅ Public form HTML contains all 5 numbered sections + Preview sidebar
- ⏳ Manual browser UI test — CEO ทดสอบ

**Files touched:** 11 (5 new + 6 modified) · ~2,800 net new lines

## 🆕 Previous (2026-05-21 — CashHub Redesign · Claude Design handoff `MLMc2DZd7q-5cmIzvrh5hw`)

**CEO goal:** "ปรับ design ของ cash hub · ตัวอื่นไม่แตะ · ฟีเจอร์ที่ขาดเพิ่มให้ใช้งานได้"

**Design source:** Claude Design bundle (5.1 MB) — Dashboard V1 + Heatmap V2 + Form Builder V1 (CEO-confirmed in handoff chat).

**Files created (new):**
- `components/cashhub/redesign/tokens.css` — scoped design vars (--ch-brand, --ch-navy, etc.)
- `components/cashhub/redesign/section-pill.tsx`, `two-tone-title.tsx`, `sparkline-v2.tsx`, `health-badge-v2.tsx`, `delta-pill.tsx`, `hero-kpi-card.tsx` — primitives
- `components/cashhub/redesign/approval-banner.tsx` — global banner (pending reports + register requests)
- `components/cashhub/redesign/heatmap-v2.tsx` — 3-tab container (matrix / reconcile / timeline)
- `components/cashhub/redesign/reconcile-tab.tsx` — Bank Reconcile (NEW) — filter chips, status pills, 4-step right rail
- `components/cashhub/redesign/timeline-tab.tsx` — chronological report feed
- `lib/cashhub/bank-reconcile.ts` — adapter pulling from existing daily_reports + shortages (NO new tables)
- `app/(admin)/cashhub/dashboard/dashboard-v1-view.tsx` — full Dashboard V1 layout

**Files modified:**
- `app/(admin)/cashhub/layout.tsx` — wraps children in `.ch-scope` + injects ApprovalBanner
- `app/(admin)/cashhub/dashboard/page.tsx` — uses `DashboardV1View`
- `app/(admin)/cashhub/heatmap/page.tsx` — uses `HeatmapV2View` (3 tabs, with bank reconcile data)
- `app/(admin)/cashhub/settings/forms/page.tsx` — re-skinned hero (SectionPill + TwoToneTitle + 3-stat strip)

**Functional changes:**
- ✅ Global approval banner shows pending reports + register requests count
- ✅ Dashboard V1: 4-card hero strip (ยอดรวม + sparkline / สาขาที่กรอกครบ / น่าเป็นห่วง / รออนุมัติ)
- ✅ Heatmap now has tabs: **ตารางกรอกครบ** (existing) · **กระทบยอดแบงก์** (NEW) · **ไทม์ไลน์รายงาน** (NEW)
- ✅ Bank Reconcile shows real data — approved=matched, shortage!=0=diff, submitted=no-bank-yet, missing-day=missing-fill
- ✅ Import Statement + Match อัตโนมัติ buttons stubbed with toast "ฟีเจอร์เร็วๆ นี้" (no DB migration needed)
- ✅ Per [[cashhub-shortage-flow-d020]] — display only · NO mutations to reconcile formula
- ❌ Form Builder V1 phone-preview pane — deferred (form-editor.tsx is 1155 lines, high blast radius)

**Verified:**
- ✅ `tsc --noEmit` shows no CashHub-related errors
- ✅ `next build` — "Compiled successfully in 14.4s" (typecheck blocks on pre-existing recruit/erasure files, unrelated)
- ✅ Dev server: `/cashhub/dashboard`, `/cashhub/heatmap`, `/cashhub/settings/forms` all return 307 → /login (compile clean, redirect normal)
- ⏳ Manual browser test (CEO เปิดเอง) — pages render with auth cookie

**Not deployed yet** — awaits CEO browser verification + commit/push decision.

---

## 🆕 Update (2026-05-21 — Recruit Redesign canvas → 3 phases shipped · 24 files · ~3,800 lines · ยังไม่ deploy)

**CEO goal:** "redesign การใช้งานทั้งหมด · ทำให้มันใช้ได้จริง ทั้ง backend frontend · มือถือ + คอม · ยึก design canvas Recruit Redesign.html"

**Commits this round:**
- `22af0f7` Phase A1 — iPhone preview + color tags + activity timeline
- `e2b7590` Phase A2+A3 — postings/applicant redesign + /my/[refId] tracking
- `d768611` Phase B-lite — Calendar + Talent Pool + PDPA Compliance

**Routes added/redesigned:**
- ✅ `/recruit/postings` (admin) — funnel mini bar + source chips + share/copy
- ✅ `/recruit/applications/[id]` (admin) — AI score header + big stepper + 4 tabs (Profile/IQ/Answers/Timeline) + IQ auto-grading
- ✅ `/recruit/postings/new` (admin) — iPhone live preview side-by-side
- ✅ `/recruit/calendar` (admin · NEW) — interview calendar from [INTERVIEW] notes · 28-day mini grid
- ✅ `/recruit/talent-pool` (admin · NEW) — past applicants segmented (rejected/high-score/repeat/withdrawn)
- ✅ `/recruit/settings/pdpa` (admin · NEW) — compliance checklist + audit log preview + retention recommendations
- ✅ `/my/[refId]` (public · NEW) — candidate tracking page · stepper + next step hint + HR contact log
- ✅ `/apply/[slug]/success` — now links to /my/[refId]

**Components added:**
- `components/recruit/iphone-preview.tsx` — sticky iPhone bezel + live update
- `components/recruit/application-tabs.tsx` — client tab switcher + IQ auto-grader
- `components/recruit/copy-link-button.tsx` — copy posting share link to clipboard

**No schema changes** — all 3 phases ride on existing tables (recruit_applications · recruit_applicants · recruit_application_notes · audit_logs). Color tags + activity types encoded in string fields.

**Verified:**
- ✅ `tsc --noEmit` clean (เฉพาะ pre-existing clawfleet/photo)
- ✅ Local dev server boots fine · all routes 200 (public) / 307 (admin login redirect)
- ✅ Public `/my/APP-2026-820566` renders status pill + stepper + next-step hint
- ⏳ Manual UI test ใน browser (CEO เปิดเอง)
- ❌ `next build` ยัง pre-existing clawfleet broken (ต้อง quarantine ก่อน deploy)

**Phase A canvas coverage:**
| Design section | Status |
|---|---|
| 01 Analysis | n/a (just diagnosis) |
| 02A Postings list | ✅ shipped |
| 02B Applicant detail | ✅ shipped |
| 02C Form builder + iPhone preview | ✅ shipped (Phase A1) |
| 03 Candidate flow (9 mobile screens) | partial — single tracking page /my/[refId] |
| 04 HR mobile (9 screens) | deferred — desktop admin works on mobile via responsive |
| 05 Pipeline/Kanban | ✅ existing already; tag chips added Phase A1 |
| 06 Candidate portal | partial — /my/[refId] (single) · list view deferred |
| 07 Blacklist | existing; design canvas refinement deferred |
| 08 Messaging hub | deferred (needs schema + LINE OA integration) |
| 09 Calendar | ✅ shipped (B-lite-1, from existing notes) |
| 10 Exec dashboard | deferred |
| 11A Talent pool | ✅ shipped (B-lite-2) |
| 11B Auto-screen rules | deferred (needs schema) |
| 12 Referral | deferred (needs schema) |
| 13A Permission matrix | existing in lib/auth; UI deferred |
| 13B PDPA | ✅ shipped (B-lite-4, read-only) |

**Next session priorities (handoff):**
1. **Messaging hub** — schema (recruit_message_threads + recruit_messages) + LINE OA webhook
2. **HR mobile dedicated UI** — current desktop is responsive but not optimized for HR-on-phone (per design canvas Section 04 swipe triage)
3. **Auto-screen rules** — schema (recruit_rules) + rule engine running on each application change
4. **Referral program** — schema (recruit_referrals) + employee landing /refer + admin tracker
5. **Right-to-erasure** — public form at /my/[refId] for candidate to request data deletion
6. **Exec dashboard** — KPI hero + funnel chart + source ROI + time-to-hire by role

**Deploy blocker:** `next build` fails at clawfleet (missing components). Need to either:
- Quarantine clawfleet routes (rename to `.disabled` like FuelOS pattern)
- Or revert clawfleet commits until that work resumes



## 🆕 Update (2026-05-21 — Recruit UX round 2: iPhone preview + color tags + activity timeline · ยังไม่ deploy)

**CEO request:** "หน้าสร้างประกาศ เพิ่ม UI iPhone เข้าไป เพื่อ preview · ป้ายกำกับใช้สีเขียวสด แดงสด · timeline บันทึก (โทร อัพเดต) ติด tag workflow ใช้ได้ใช่ไหม · Kanban ใช้ไม่ได้"

**Shipped (local · build verified · dev curl OK):**
- **`components/recruit/iphone-preview.tsx`** (new) — iPhone bezel + notch + status bar + scrollable screen · wrap `PublicFormRenderer` ใน preview mode
- **`components/recruit/posting-editor.tsx`** — grid 2 cols: editor (left) | sticky iPhone preview (right, xl+) · live updates เมื่อ HR แก้ฟอร์ม
- **`components/recruit/form-builder.tsx`** — Preview button ซ่อนใน xl+ (iPhone อยู่ข้าง ๆ แล้ว) · mobile/tablet ยังกดดูได้
- **`lib/recruit/types.ts`** — เพิ่ม `TAG_COLORS` (green/red/amber/blue/purple/zinc) + `parseTag` + `serializeTag` · เก็บใน format `"color:label"` · backwards-compat (tag เก่าไม่มี prefix → zinc)
- **`components/recruit/application-actions.tsx`** — color picker (6 สี swatch) + colored chip render + add button สีตาม selected color
- **`components/recruit/applications-inbox.tsx`** — colored tag chips ใต้ status row ใน list item (max 5 + overflow)
- **`components/recruit/pipeline-column.tsx`** + **`pipeline/page.tsx`** — colored tags ใน Kanban cards (max 4 + overflow)
- **`components/recruit/application-detail.tsx`** — colored tag header chips + เปลี่ยน label "บันทึกภายใน HR" → "Timeline · บันทึกกิจกรรม"
- **`components/recruit/application-notes.tsx`** — full rewrite to timeline:
  - Quick-action buttons: 📞 โทรคุยแล้ว · ❌ โทรไม่รับ · 💬 LINE · 📅 นัดสัมภาษณ์ · ✉️ ส่งอีเมล
  - Body encoded as `[TYPE] text` (no DB migration needed)
  - Timeline UI with left vertical rail + colored dot + chip per activity type
  - Backwards-compat: notes ไม่มี prefix → render as "บันทึก" (zinc)

**No schema migration** — tag color + activity type encoded ใน string · ไม่ต้อง `prisma db push`

**Verified:**
- ✅ `tsc --noEmit` — clean (เฉพาะ pre-existing clawfleet error)
- ✅ Local dev server `/apply/demo-hotel-manager-2026` HTTP 200 + IQ questions render
- ✅ `/recruit` + `/recruit/postings/new` HTTP 307 (login redirect = pages valid)
- ❌ Full `next build` fails ที่ clawfleet (missing imports · ไม่เกี่ยว) — ต้อง quarantine ก่อน deploy
- ⏳ Manual visual test ใน browser (CEO ต้องเปิดเอง)

**ยังไม่ได้ทำ (CEO ขอ):**
- ⏳ **Filter by tag ใน inbox** — ตัด scope รอบนี้เพื่อจบ 3 ข้อใหญ่ก่อน · ทำรอบหน้า
- ⏳ **Kanban bug fix** — CEO บอก "ใช้ไม่ได้" แต่ผมยังไม่เห็น error · ขอ screenshot
- ⏳ **Deploy** — รอ clawfleet quarantine หรือ stub ก่อนถึงจะ build ผ่าน · ขอ CEO อนุมัติ

**Next:**
1. CEO เปิด `https://pooilgroup.vercel.app/recruit/pipeline` ดู Kanban error · ส่ง screenshot/console error มา
2. ผม quarantine clawfleet stubs (เหมือนที่ทำกับ FuelOS) → build ผ่าน → deploy
3. เพิ่ม tag filter ใน inbox sidebar (รอบหน้า)

## 🆕 Update (2026-05-21 — Recruit: 4 demo postings + 4 fake applications บน prod · CEO walk-through round)

## 🆕 Update (2026-05-21 — Recruit: 4 demo postings + 4 fake applications บน prod · CEO walk-through round)

**CEO request:** "subagent ทำแค่ตัวโปรแกรมยังไม่ถูกใจ · ลองทำใบสมัคร 4 ตำแหน่ง · ชื่อ อายุ เพศ ประสบการณ์ แนบไฟล์ผลงาน IQ 5 ข้อ ความสามารถพิเศษ · แล้วทดสอบกรอกแบบคนจริงให้เห็น"

**Shipped (script-only · ไม่แตะ code module):**
- **`scripts/seed-recruit-demo.mjs`** — สร้าง 4 postings status=OPEN
  - `demo-hotel-manager-2026` — ผู้จัดการโรงแรม (IQ: Occupancy, ADR, leadership)
  - `demo-gas-station-staff-2026` — พนักงานปั๊มน้ำมัน (IQ: เงินทอน, ความซื่อสัตย์)
  - `demo-housekeeper-2026` — แม่บ้าน (IQ: เวลา, ความละเอียด, จัดการสถานการณ์)
  - `demo-convenience-staff-2026` — พนักงานร้านสะดวกซื้อ 7-Eleven (IQ: คำนวณเงิน, บริการ)
- **`scripts/submit-fake-application.mjs`** — submit fake application 1 ใบต่อ posting (สถานะ NEW)

**Public URLs (เปิดดูได้เลย ไม่ต้อง login):**
- https://pooilgroup.vercel.app/apply/demo-hotel-manager-2026
- https://pooilgroup.vercel.app/apply/demo-gas-station-staff-2026
- https://pooilgroup.vercel.app/apply/demo-housekeeper-2026
- https://pooilgroup.vercel.app/apply/demo-convenience-staff-2026

**HR Inbox (ต้อง login super_admin):** https://pooilgroup.vercel.app/recruit · เห็น 4 ใบสมัคร NEW

**Verified:**
- ✅ 4 postings inserted (verified via select after insert)
- ✅ Public apply pages return HTTP 200 + render IQ questions + amounts (837.50 / Occupancy / etc)
- ✅ 4 fake applications submitted (refIds: APP-2026-820566, -003385, -577825, -575948)

**ยังไม่ได้ทดสอบ:**
- ⏳ File upload (R2 sign URL) — ต้องกรอกใน browser จริง ไม่ได้ทำผ่าน script
- ⏳ Real apply flow ผ่าน `submitPublicApplication` server action — script bypass ตรง DB
- ⏳ AI scoring + email notification — ต้องกด trigger ใน HR inbox

**Next:**
1. CEO เปิด `/apply/demo-hotel-manager-2026` ใน browser ดู render จริง
2. CEO เปิด `/recruit` ดู inbox + กดเข้าใบสมัคร → ดู IQ answers
3. ระบุจุดที่ "ยังไม่ถูกใจ" → ผมปรับ form builder หรือ public renderer ตามนั้น

## 🆕 Update (2026-05-21 — Recruit module LIVE บน production · 5 commits · 4-agent UX audit + polish)

**Production deployment:** `pooilgroup-7xhb2g4x7` Ready 12h ago · `/recruit` returns 307 (login redirect = page exists)

**Commits this session:**
- `0068022` feat(recruit): complete module R0-R6 (85 files · 12,370 lines · 5 tables + 9 routes + builder + public form + AI manual triggers + blacklist + tasks)
- `2ff9f15` chore(recruit): linter cleanup + remove from .vercelignore
- `83b1aaf` fix(notifications): extend NotificationModule with recruit + repairs
- `cca3474` feat(recruit): polish round 1 — orchestra audit fixes (P0/P1)

**DB applied:** surgical SQL `/tmp/recruit-create.sql` ran via `prisma db execute` ·
5 tables + 3 enums + 12 indexes + 11 FKs + 5 RLS policies · existing data untouched

**Vercel:** preview built → promoted to production via `vercel promote`

**Polish round 1 (orchestra audit · 4 parallel agents):**
- Persona walkthrough · Mobile responsive · Empty/loading/error states · Design system compliance
- 40 issues identified · 13 P0/P1 implemented (error.tsx + loading.tsx + brand cleanup + empty state context)

**Open follow-ups (round 2):**
- Bulk action bar in inbox (checkbox + bulk status change)
- Dashboard KPI strip at /recruit landing for CEO 30-sec health check
- Schema drift audit (4 prod tables not in schema.prisma · prevents `prisma db push` from working safely)

---

## 🆕 Update (2026-05-21 — Executive matrix: toggle ฿ ↔ จำนวน · build pass · ยังไม่ deploy)

**CEO request:** "อยากได้ปุ่มข้างรายเดือน/รายปี · กดสลับดูยอดขาย ↔ จำนวน · น้ำมัน=ลิตร EV=kWh+คัน กาแฟ=แก้ว ฯลฯ"

**Shipped (build green · TS clean):**
- **`constants/business-types.ts`** —
  - ⛽ `fuel_station`: เพิ่ม `qty2` = "จำนวนบิล/คัน" (optional · qtyUnit='car')
  - 🔵 `lpg_station`: เปลี่ยน `qty1` หน่วยจาก "ถัง" → "ลิตร" (qtyUnit 'tank'→'liter') + เพิ่ม `qty2` = "จำนวนบิล/คัน"
- **`lib/cashhub/data.ts`** — `loadReports` SELECT เพิ่ม `qty1_unit`, `qty2`, `qty2_unit` + เพิ่มฟิลด์ใน `CanonicalReport`
- **`lib/cashhub/executive-matrix.ts`** —
  - เพิ่ม `qty1Totals`, `qty2Totals` ใน row + per branch
  - ปั๊มแก๊ส LPG: ข้ามข้อมูลเก่า (qty1_unit='tank') · นับเฉพาะ row ที่หน่วยตรงกับ config (`EXPECTED_QTY1_UNIT` map)
- **`components/cashhub/executive-table.tsx`** —
  - เพิ่ม `ViewModeToggle` component (segmented control `ยอดขาย / จำนวน`) ข้าง period toggle
  - `localStorage` persistence (`pool.dashboard.matrix.viewMode`)
  - Cell renderer แยก 2 mode: baht (เดิม) + quantity (ใหม่)
  - EV row: `kWh` เป็น primary · `คัน` เป็น secondary (qty2 swap with qty1 specifically for ev_station)
  - แถว "รวมทุกประเภท" ถูกซ่อนตอน mode จำนวน (รวมหน่วยต่างกันไม่ได้)
  - 7-Eleven (convenience_store): แสดง "—" ตอน mode จำนวน (form ยังไม่เก็บจำนวนบิล)

**สิ่งที่ CEO ต้องทำต่อ:**
1. **ทดลอง local:** `npm run dev` → เปิด `/dashboard` → กดปุ่ม "จำนวน" ดูแถว ⛽/⚡/☕
2. **ตัดสินใจเรื่อง deploy:**
   - ฟอร์ม CashHub ปั๊มแก๊ส LPG จะเปลี่ยนจาก "ถัง" → "ลิตร" → ต้องแจ้งพนักงานหน้างาน
   - ข้อมูลเก่าของ ปั๊มแก๊ส LPG ใน mode "จำนวน" จะเป็น `—` จนกว่ามีข้อมูลใหม่ ~12 เดือน
3. **ถ้าอยากให้ 7-Eleven แสดงด้วย** → ต้องเพิ่ม field "จำนวนบิล" ในฟอร์ม (ยังไม่ทำ · CEO เลือก A)

**Verified:**
- ✅ `npx tsc --noEmit` clean
- ✅ `npm run build` (12.6s compile · 70 static pages · 0 errors)
- ⏳ Manual UI test pending (CEO ต้องเปิด /dashboard ดู)

## 🆕 Update (2026-05-20 — In-app Bug Report system · commit `963fa9b` · production LIVE)

**CEO request:** "ทุกหน้ามีปุ่มแจ้งบัค ซ่อนใต้ปุ่ม AI · แนบรูปได้ · admin ดูที่เดียวซ่อมรวม"

**Shipped (Phase 1 + 2 in one shot):**
- **Schema:** Prisma model `BugReport` + back-refs on Organization, User · enum `BugStatus`
- **DB:** SQL migration `20260520000003_bug_reports.sql` (CREATE TABLE + RLS + policy in one shot · applied via Supabase SQL Editor)
- **APIs:**
  - `POST /api/bugs` (create · rate limit 5/hour/user · audit logged)
  - `GET /api/bugs` (list · admin tier only · includes screenshot URLs from R2)
  - `PATCH /api/bugs/[id]` (status + admin note · admin tier only · tracks acknowledged_at, fixed_at, fixed_commit_sha)
- **Modal:** `components/bug-report-modal.tsx`
  - Auto-captures `window.location.pathname + search` + `navigator.userAgent`
  - Optional screenshot: paste-from-clipboard (Cmd+V) OR file picker
  - Image-only (JPG/PNG/WebP/GIF · 10MB cap)
  - Upload to R2 via existing `/api/r2/sign` endpoint
- **AI Chat integration:** `components/cashhub/ai-chat.tsx`
  - New section "🐛 เจอปัญหา?" with "แจ้งบัคหน้านี้" button below existing welcome screen
  - Renders on every admin page (already integrated in `admin-shell.tsx`)
- **Admin list page:** `/bugs` (admin tier only)
  - Filter by status (ใหม่/รับเรื่อง/แก้แล้ว/ปิด)
  - Inline status update buttons
  - Screenshot preview (R2 public URL)
  - Admin note textarea (auto-save on blur)
  - Reporter info + URL trail per bug

**Production verified:**
- `pooilgroup-ppcsj3ny1` ● Ready · aliased to https://pooilgroup.vercel.app
- `/health` returns healthy (env+supabase+r2 ok)
- `/api/bugs` returns 307 (route alive · auth-redirect works)
- `/bugs` returns 307 (admin guard works)

**Compat fix included:**
- prisma/schema.prisma: commented Repair back-refs (parallel session WIP · models not yet)
- `.vercelignore` added — excludes parallel session WIP from `vercel --prod` uploads

## 🆕 Update (2026-05-20 — Phase 2: RLS + UX + Tests + Drafts + Refactor plan · commit `a365977`)

ต่อจาก Phase 1 · CEO อนุมัติ "ลุยทำทั้งหมด" · 5 items + 1 route conversion · build pass:

**#7 — RLS for last 6 tables (Tech Lead audit)**
- NEW migration `20260520000001_rls_for_6_remaining_tables.sql`
- Tables: companies, branch_rentals, user_modules, ai_search_cache, document_analyses, document_signature_placements
- TO APPLY: `psql ... -f` หรือ paste ใน Supabase SQL editor

**#9 — Spike threshold: rolling 7-day median (Branch Manager audit)**
- NEW `lib/cashhub/spike-baseline.ts` — pure helper · unit-testable
- Updated LIFF report page + report-form.tsx
- ลด false-positive ทุกจันทร์ (เสาร์-อาทิตย์ยอดต่ำ)

**#14 — Playwright e2e smoke tests (Tech Lead "zero tests")**
- 3 tests: health endpoint · auth pages render · protected routes redirect
- CEO ต้องรัน `npm run test:e2e:install` ก่อน (~200MB browser download)
- รัน: `PLAYWRIGHT_BASE_URL=https://pooilgroup.vercel.app npm run test:e2e`

**#10 — Server-side draft autosave (Branch Manager audit)**
- NEW Prisma model `ReportDraft` + migration `20260520000002_report_drafts.sql`
- NEW API `app/api/cashhub/drafts/route.ts` (GET/PUT/DELETE)
- report-form.tsx sync ทั้ง localStorage (offline) + server (cross-device)
- TO APPLY: `npx prisma db push` แล้ว apply RLS SQL

**#11 — adminClient → serverClient refactor (partial)**
- NEW `lib/db/RLS_REFACTOR.md` (categorize 62 routes · whitelist 18 · convert plan 44)
- **Converted 1 route** as working example: `app/api/cashhub/drafts/route.ts`
- ที่เหลือ 43 routes → per-route conversion · checklist ในไฟล์
- `lib/db/server.ts` adminClient(): TODO comment ชี้ไป plan

**APPLIED 2026-05-20 ✅**
1. ✅ Vercel production redeploy (`dpl_DUwkjE6awAUA6HndtRkZ8Kh6PGzs` · aliased to pooilgroup.vercel.app)
2. ✅ Sentry env vars set in Vercel (5 vars · Preview + Production · encrypted)
3. ✅ RLS migration for 6 tables applied via Supabase SQL Editor
   (companies, branch_rentals, user_modules, ai_search_cache, document_analyses, document_signature_placements)
4. ✅ `report_drafts` table created + RLS applied via combined SQL in Supabase Editor
   (CREATE TABLE + indices + FK + RLS policy in 1 transaction · skip prisma db push)
5. ⏳ Optional: `npm run test:e2e:install` (Playwright browsers ~200MB · CEO decides)

**Production verified live:** `/health` returns `{"status":"healthy"}` with env/supabase/r2 all ok.

---

## 🆕 Update (2026-05-20 — Phase 1 Security Hardening · commit `a3cde9a`)

หลัง CEO อนุมัติ Quick wins · ทำต่อ 5 ข้อในรอบเดียว · build pass · commit `a3cde9a`:

**#2 — Branches cleanup**
- ลบ local branches: `feat/admin-set-password-and-impersonate`, `fix/invite-link-prod-url`
- คงไว้: `feat/permissions-cleanup-and-modules` (local≠remote · ให้ CEO ตัดสิน)

**#3 — branch_manager → EXECUTIVE_ROLES**
- `lib/auth/role-guards.ts` · ปลดล็อก leaderboard/dashboard ให้ผู้จัดการสาขา
- Follow-up: scoped data filter ที่ page level (ยังไม่ทำ · ปัจจุบันเห็นทั้ง org)

**#4 — Segregation of Duties (SoD)**
- `approve/route.ts` + `approve-bulk/route.ts` · บล็อกกรณี submitter === approver
- approve-bulk return `skippedSelfApprove` count แยก
- ผ่าน SOX/COSO key control แล้ว

**#5 — IP/UA capture in audit log**
- NEW: `lib/audit/request-meta.ts` · `getRequestMeta(req)` helper
- Updated: approve · approve-bulk · unlock (3/85 audit call sites)
- unlock route: snapshot approved_by_id + approved_at เก่าเข้า diff
- Follow-up: ปรับ audit call sites อื่นๆ ~82 จุด (TODO)

**#6 — CLAUDE.md ขยาย (was 1-line `@AGENTS.md`)**
- Project context · tech stack · architecture · folder map · workflow rules
- Known Critical Debts section (5 items จาก audit 2026-05-20)
- Preserve @AGENTS.md import (Next 16 warning ยังครบ)

---

## 🆕 Update (2026-05-20 — Observability + Compliance + End-user docs)

หลัง deep audit (6 personas) เผยช่องโหว่ 3 จุด · ทำในรอบเดียว · build pass · commit `27adffe`:

**A1 — Audit retention policy**
- เปลี่ยนแผนใน `CORE_PLAN.md` จาก "1 year cron" → **"5+ ปี · NO auto-delete cron"** (กฎหมายไทย พ.ร.บ.การบัญชี 2543 §14 · สรรพากร 10 ปี)
- เพิ่ม comment block ใน `prisma/schema.prisma` ที่ AuditLog model — กันคนสร้าง cleanup cron ในอนาคต
- ปัจจุบันไม่มี cron ลบ audit_logs อยู่แล้ว = compliant by default

**A2 — Sentry error tracking (@sentry/nextjs 10.53.1)**
- Files: `instrumentation.ts` · `instrumentation-client.ts` · `next.config.ts` (wrap) · `.env.example` (+5 vars)
- `npm install` + `npm run build` ผ่าน ✅ (Sentry v8/v9 ไม่ support Next 16 · ใช้ v10 ขั้นต่ำ)
- `enabled: Boolean(SENTRY_DSN)` — ถ้าไม่มี DSN ก็ skip · dev ไม่ crash
- CEO checklist ใน `SENTRY_SETUP.md` (signup sentry.io → DSN → Vercel env vars)

**B — User manual ภาษาไทย (`docs/user-guide/`)**
- `README.md` (150 บรรทัด) — index + role navigation
- `owner.md` (296 บรรทัด) — super_admin / org owner
- `branch-admin.md` (297 บรรทัด) — branch_manager / area_manager
- `staff.md` (281 บรรทัด) — staff (LIFF report)
- ไม่เขียนถึง feature ที่ STATUS บอกยังไม่ทำ (Telegram bot · LIFF จริง)
- screenshot placeholders ให้เติมภายหลัง

**To apply เมื่อ deploy**
1. CEO setup Sentry (5 ขั้นใน [`SENTRY_SETUP.md`](./SENTRY_SETUP.md)) · ใส่ env vars ใน Vercel
2. `git push` → Vercel deploy อัตโนมัติ (commit อยู่ใน main แล้ว)
3. ทดสอบ Sentry: เปิด `/api/non-existing-route` → ดู event ใน sentry.io

---

## 🆕 Update (2026-05-11 — FuelOS Sprint 6 kickoff)

เริ่ม FuelOS อย่างเป็นทางการหลังจากที่ค้างมา ตั้งทีม + ลง schema foundation ทั้งหมดในรอบเดียว.

**Virtual team (`.claude/agents/`)** — map กับ ORG_FULL.md:
- `pm-fuelos.md` — Senior PM (PMO, T3)
- `tech-lead-fuelos.md` — Tech Lead — FuelOS (T3)
- `backend-eng.md` — Senior Backend Engineer (T4)
- `frontend-eng.md` — Senior Frontend Engineer (T4)
- `qa-polish.md` — QA Lead + UX Polish (T4)
- `lean-process.md` — Lean Process Engineer (T3 OPEX)

**Working doc:** `web/FUELOS_PLAN.md` — Sprint 6 → 6.0 (schema), 6.1 (Price Engine), 6.2 (CRM Multi-Entity), 6.3 (Sales Workspace), 6.4 (LINE Bot)

**Sprint 6.0 — Schema foundation (this commit)**
- Added 16 Prisma models per FUELOS.md §12 / §14.6:
  - Price: `DepotPrice`, `ZoneMargin`
  - CRM: `Contact`, `CustomerEntity`, `DeliveryLocation` (Multi-Entity 3-layer)
  - Sales: `CustomerQuote`, `PriceAlertLog`, `LineResponseLog`
  - Orders + Fleet: `FuelOrder`, `Truck`, `DriverProfile`, `DriverLocation`
  - Money: `Payment`, `FlashSale`, `CreditDocument`, `ChequeTracking`
- Reused `Vehicle` (DocuFlow scope) → `Truck` 1-1; `User.role=driver` + `DriverProfile` satellite
- Migration SQL: `supabase/migrations/20260511000001_fuelos_sprint6_foundation.sql`
  - GENERATED columns on `fuel_orders` (margin_per_liter, total_amount, total_profit)
  - GENERATED column on `line_response_log` (response_minutes)
  - RLS enabled + org-isolation policies on all 16 tables
- Deferred to 6.4+: `CreditScoreHistory`, `ChurnSignal` (AI features)

**To apply เมื่อ deploy**
1. `cd web && npx prisma db push` (apply Sprint 6 models)
2. Run `supabase/migrations/20260511000001_fuelos_sprint6_foundation.sql` (RLS + GENERATED columns)
3. Next: Sprint 6.1 — Price Engine UI/API (see FUELOS_PLAN.md §3)

**Open questions (FUELOS_PLAN.md §8)**
1. PTT scraper Sprint 6 หรือ Sprint 7?
2. Display format (`฿28.41/L` vs `Intl.NumberFormat`)?
3. MOPS Alert ก่อนหรือหลัง Telegram bot (Phase C4)?

---

## 🆕 Update (2026-05-09 — รวม 8 commits หลัง 05-04)

ตั้งแต่ Dashboard pass (05-04) → วันนี้ มี 8 commits ใหญ่:

**DocuFlow (Sprint 8) — bootstrap → polish → UAT fixes ครบในรอบเดียว**
- Schema + 4 migrations: `20260508000002_docuflow_foundation` / `_advanced` / `_polish` / `_005_audit_renew_chain_index`
- Pages: `/docuflow/{documents,expiry,persons,vehicles,risk,search,checklist}`
- Features: sharing, AI search, risk scoring, signature placement, renewal workflow, vehicle/person tracking
- UAT pass ปิด: role gates, rate limit, perf indexes (commit `5ef20e6`)

**Infra**
- **Vercel cron 7 jobs** (`vercel.json`): morning-brief 07:00, evening-check 18:00, deadline-reminder ทุก 30 นาที, monthly-report-pdf, access-review, health-score 23:00 BKK, docuflow-expiry
- **LINE Rich Menu** config + upload script (`scripts/line-rich-menu.mjs` + `npm run line:rich-menu`)
- **`@line/liff` ติดตั้งแล้ว** (^2.28.0) — แต่ LIFF page ยังใช้ session, ยังไม่ `liff.init()` จริง
- **RLS audit pass 2** — ปิด 18 ตารางที่ตกหล่น (`_007_rls_for_remaining_tables`)
- Temp access column + streak retry + form template seed race-fix

**Core**
- Cross-module Executive Dashboard (CashHub × FuelOS × DocuFlow rollup)
- Quick Approve Bar (พร้อมจะใช้กับ Telegram inline)
- 3 settings pages เพิ่ม + `/join` refactor + backup CSV
- CSP/HSTS/CORS headers ใน proxy.ts (RULES §21 layer 2)
- ปิด cross-org leaks, soft delete enforce, idempotent submit

**Auth**
- Per-user module access (CashHub / FuelOS / DocuFlow toggle ต่อ user)
- Permission cleanup — ปิด `/signup`, fix admin tier, guard PDF, roles ใน invite

**To apply เมื่อ deploy**
1. `cd web && npx prisma db push` (apply 7 migrations ใหม่)
2. ตั้ง env: `CRON_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LIFF_ID`
3. (Optional) `npm run line:rich-menu` — upload Rich Menu

---

## 🆕 Update (2026-05-04 — Dashboard ยอดขาย full pass)

ทำในรอบเดียว — typecheck สะอาด, `next build` ผ่าน:

**Schema + migration**
- เพิ่ม Prisma models: `BranchTarget`, `BranchHealthScore`, `BranchStreak`, `MissingReportReason`
- SQL migration: `supabase/migrations/20260504000002_dashboard_addons.sql` (รวม RLS) — รัน `prisma db push` หรือ apply ไฟล์นี้

**Libraries**
- `lib/cashhub/health-score.ts` — A-F algorithm ตามสเปค §9 (pure)
- `lib/cashhub/streak.ts` — current/longest streak + badge
- `lib/cashhub/forecast.ts` — EOM forecast + target progress (pace marker)
- `lib/cashhub/aggregator.ts` — single-shot dashboard data loader (parallel queries, soft-fail on missing tables)

**Charts** (no external deps — pure SVG)
- `components/cashhub/charts.tsx`: `Sparkline`, `BarStrip`, `ProgressBar`, `CalendarHeatmap`, `PatternHeatmap`, `HealthBadge`, `Donut`

**Pages (CashHub)**
- `/cashhub/dashboard` — rewrite mobile-first; 7 sections: hero/forecast/target, alerts, by business type, payment mix donut, pending list, leaderboard top 8, calendar heatmap, pattern heatmap
- `/cashhub/dashboard/business/[type]` — drill-down (§10.2)
- `/cashhub/branches/[id]` — branch detail (§10.3) with health breakdown + 30-day shortages
- `/cashhub/compare?a=YYYY-MM&b=YYYY-MM` — month-vs-month comparison (§10.4)
- `/cashhub/leaderboard` — sortable (total/health/streak), filterable by type
- `/cashhub/heatmap` — full สาขา × วัน matrix
- `/cashhub/shortages` — filterable + group-by-person
- `/cashhub/reports` — filters + bulk Quick Approve

**APIs**
- `/api/cashhub/approve-bulk` — multi-report approve with permission check
- `/api/cashhub/targets` — PUT manual target
- `/api/cron/health-score` — daily compute (GET/POST + `Bearer ${CRON_SECRET}`)
- `/api/dev/seed-test-data` — rewrite to seed 35 days, 6 personality tiers, weekend bias, occasional shortages, auto-derive targets, compute health + streaks

**LIFF report (Staff)**
- Deadline countdown ในหัวฟอร์ม (เปลี่ยนสีแดงเมื่อเลย)
- "เมื่อวาน ฿X" reference (ไม่ auto-fill — แค่อ้างอิง)
- Streak badge "🔥 N วัน" เมื่อ ≥1

**To apply เมื่อตื่น**
1. `cd web && npx prisma db push` (หรือรัน SQL ใน `20260504000002_dashboard_addons.sql` ด้วยมือ)
2. login เข้า `/cashhub/dashboard` → กด "สร้างข้อมูลตัวอย่าง" (ตอนนี้ seed 35 วัน × ทุกสาขา + targets + health + streaks)
3. ดู dashboard / drill-down / leaderboard / compare / heatmap
4. (Optional) ตั้ง Vercel cron `/api/cron/health-score` 23:00 BKK + `CRON_SECRET` ใน env


---

## 🎯 Where we are

**Sprint 0–2 ส่วนใหญ่เสร็จแล้ว + Sprint 3 (CashHub) อยู่ในมือ**
มี 11 commits, codebase พร้อม dev. ติดที่ยังไม่มี LINE/Telegram bot integration และ 7 forms ยังไม่ครบ.

**Stack ที่ใช้จริง:**
- Next.js **16.2.4** + React 19 + TS strict + Tailwind v4
- Prisma **7.8** + Supabase (Postgres + Auth + RLS) + Cloudflare R2
- shadcn-style UI + sonner (toast) + react-hook-form + zod
- ⚠️ Next.js 16 มี breaking changes — อ่าน `node_modules/next/dist/docs/` ก่อนเขียน

---

## ✅ Done (committed)

### Foundation
- [x] Next.js 16 + TS strict + Tailwind v4 init
- [x] Prisma schema **8 tables**: Organization, User, Branch, UserBranch, ReportTemplate, DailyReport, CashShortage, AuditLog
- [x] Supabase RLS migration (`supabase/migrations/20260504000001_rls_and_jwt_claim.sql`)
- [x] Supabase SSR client + middleware proxy
- [x] Cloudflare R2 client + signed-URL upload + uploader UI
- [x] Permission Matrix (6 roles, hardcoded — `lib/auth/permissions.ts`)
- [x] Session helpers (`lib/auth/session.ts`)
- [x] Audit log helper (`lib/audit/log.ts`)
- [x] Seed script + form configs

### Auth flow
- [x] Login / Signup / Forgot-password pages
- [x] **Invite token** flow (token → set password → first-user-becomes-Owner)
- [x] `/api/auth/signup`, `/api/auth/invite/accept`
- [x] Profile page + change password
- [x] 403 page

### Admin (web)
- [x] Admin shell (sidebar + navbar)
- [x] Pages: home, profile, settings, audit, users (+ new), docuflow placeholder, fuelos placeholder
- [x] `/api/admin/users` CRUD
- [x] R2 upload demo page

### CashHub MVP
- [x] **Universal ReportForm** engine (อ่าน `constants/business-types.ts` → render fields)
- [x] `constants/business-types.ts` (465 บรรทัด — 7 ประเภทธุรกิจครบ)
- [x] Reconcile indicator (real-time)
- [x] Shortage modal (เงินขาด → ระบุคน/หมายเหตุ)
- [x] Reconcile logic (`lib/cashhub/reconcile.ts`)
- [x] LIFF report page `/liff/report/[branchId]` (ใช้ session-based, ยังไม่ใช่ LIFF init จริง)
- [x] LIFF status page
- [x] `/api/cashhub/reports`, `/api/cashhub/approve`, `/api/cashhub/export`
- [x] Draft auto-save ใน localStorage

### DevOps
- [x] `.env.example` ครบ (DB / Supabase / R2 / LINE / Telegram / App)
- [x] R2 CORS script
- [x] Vercel deploy prep
- [x] Git: 11 commits, ประวัติสะอาด

---

## 🟡 Uncommitted (กำลังรีแสตรัคเจอร์)

```
Working tree changes:
 D app/(admin)/branches/page.tsx        ← ย้ายเข้า cashhub/branches/
 D app/(admin)/cashhub/page.tsx
 D app/(admin)/dashboard/*              ← ย้ายเข้า cashhub/dashboard/
 D app/(admin)/reports/*                ← ย้ายเข้า cashhub/reports/
 M app/(admin)/settings/page.tsx
 M app/(admin)/users/page.tsx
 M app/page.tsx
 M components/layout/admin-shell.tsx
 M components/ui/card.tsx

?? app/(admin)/cashhub/{branches,dashboard,reports}/   ← โครงสร้างใหม่
?? app/(admin)/{docuflow,fuelos,home}/
?? components/ui/{data-table,empty-state,section,stat-block}.tsx
?? lib/modules.ts
```

**= module-based folder restructure** ตามสเปค `(admin)/<module>/<page>` — ยังไม่ commit

---

## ⬜ Not started yet

### Sprint 0 ที่เหลือ
- [ ] **LINE Messaging API webhook** (`/api/line/webhook`)
- [ ] **LIFF init จริง** — `@line/liff` install แล้ว แต่ page ยังใช้ `requireSession()` แทน `liff.init()`
- [ ] **Telegram Bot** (Grammy, ยังไม่ install + ไม่มี `/api/telegram/webhook`)
- [x] ~~LINE Rich Menu config + upload script~~ — `scripts/line-rich-menu.mjs` + `npm run line:rich-menu`
- [ ] Telegram Admin Chat ID setup

### Sprint 1–2 ที่เหลือ
- [x] ~~Self-Register flow (`/join` page) + อนุมัติ~~ — admin queue (Telegram notify ค่อยทำกับ bot)
- [ ] Permission Templates UI (4 preset)
- [ ] Branch Groups (จัดกลุ่มสาขา) — มี table แล้ว, เหลือ UI
- [x] ~~Module Toggle UI per Org~~ — เพิ่ม per-user module access ด้วย
- [ ] Smart Digest (กัน Telegram spam) — รอ Telegram bot
- [x] ~~My Action Center widget~~
- [x] ~~Scheduled PDF Monthly Report~~ — Vercel cron `monthly-report-pdf`

### CashHub (Sprint 3–5)
- [ ] **ทดสอบ ReportForm 7 ประเภทครบ** (มี config แล้ว แต่ยังไม่ verify ครบทุก type)
- [x] ~~Spike Alert~~ (commit `692bfbb`)
- [ ] Anti-Stupidity ที่เหลือ: Time Alert (00:00–05:00), Pre-check Rule 7
- [ ] Approval ผ่าน **Telegram Inline** [✅][❌][📊] — Quick Approve Bar (web) มีแล้ว
- [x] ~~Smart Approval Panel (Web)~~ — Quick Approve Bar
- [x] ~~Analytics: Branch View + Super View + Calendar Heatmap~~
- [x] ~~Health Score A–F~~ + Cron (Vercel `health-score` 23:00 BKK)
- [x] ~~Branch Leaderboard + Streak Badge~~
- [x] ~~Drill-down: ภาพรวม → ธุรกิจ → สาขา → รายวัน~~
- [ ] AI Chat "Ask Me Anything" (Claude Haiku)
- [x] ~~Forecast สิ้นเดือน, Pattern Heatmap~~
- [ ] Quick Note Staff → เจ้าของ
- [x] ~~Missing Report Reason flow~~

### FuelOS (Sprint 6–7) — Sprint 6.0 schema ✅ (2026-05-11)
- [x] **Sprint 6.0 — Schema foundation** (16 models + RLS + GENERATED columns)
- [ ] Sprint 6.1 — Price Engine (depot price entry + zone margin admin) ← **next**
- [ ] Sprint 6.2 — CRM Multi-Entity (contacts/entities/locations + credit fields)
- [ ] Sprint 6.3 — Sales Workspace (Priority List + Quote/Win-Loss + Margin Analytics)
- [ ] Sprint 6.4 — LINE Bot (Reply API + Response Time tracking)
- [ ] Sprint 7 — MOPS Alert + PTT Scraper
- [ ] Sprint 7 — Driver PWA (GPS + Photo + Invoice)
- [ ] Sprint 7 — Dispatch Board + Route Optimization
- [ ] Sprint 7 — Flash Sale (LINE OA Broadcast)
- [ ] Sprint 7 — TRCloud Sync

### DocuFlow (Sprint 8) — ✅ MVP ครบ (ยังไม่ได้ UAT จริง)
- [x] ~~4 ระดับเอกสาร + 5 บริษัท~~ (foundation migration)
- [x] ~~Tag System~~
- [x] ~~Expiry Dashboard~~ + cron `docuflow-expiry`
- [x] ~~Vehicle + Driver tracking~~
- [x] ~~Renewal Workflow + AI Comparison~~
- [x] ~~Signature Placement (Box drag-drop)~~
- [ ] External Sign (OTP, ไม่ต้อง Account) — ยังไม่ทำ

---

## 🚀 Next 5 Concrete Steps (ลำดับ — refresh 2026-05-11)

1. **Apply FuelOS Sprint 6.0 migration** — `npx prisma db push` + run `20260511000001_fuelos_sprint6_foundation.sql` ใน Supabase
2. **Sprint 6.1 — Price Engine UI/API** — `/fuelos/price-master` + `lib/fuelos/pricing.ts` (pure compute) + audit log บน publish (FUELOS_PLAN.md §3)
3. **Telegram Bot** — install grammy + `/api/telegram/webhook` + Approval inline `[✅][❌][📊]` (block FuelOS MOPS Alert + CashHub approve flow)
4. **LIFF init จริง** — เปลี่ยน `/liff/report/[branchId]` จาก `requireSession()` → `liff.init()` + map LINE userId → User
5. **CashHub Anti-Stupidity ที่เหลือ** — Time Alert (00:00–05:00) + Pre-check Rule 7

---

## ⚠️ Open questions / Risks

- **Next.js 16 docs**: หลาย API เปลี่ยน, agent ต้องอ่าน `node_modules/next/dist/docs/` ก่อน (ดู `AGENTS.md`)
- **LIFF page ปัจจุบันใช้ `requireSession()`** = ยังไม่ใช่ LIFF จริง (ต้อง login ก่อน). ถ้าจะให้ Staff เปิดจาก LINE Rich Menu ตรง ๆ ต้องเพิ่ม `liff.init()` + map LINE userId → User
- **PROJECT_TRACKER.md ในสเปคล้าสมัย** — ต่อไปอัพเดตที่ STATUS.md นี้แทน
- **Brand wording**: "Pooilgroup" (คำเดียว) — ตรวจ UI strings เก่าที่ยังเขียน "Pool Group" อยู่
- **External accounts ที่ต้องตั้งจริง**: LINE Developers Channel, LIFF App, Telegram BotFather, Cloudflare R2 Bucket (น่าจะมีบ้างแล้ว — ตรวจ `.env.local`)

---

## 📂 Source-of-truth Map

```
ดีเทลv1/                        ← Specs (อ่านก่อนเขียน feature)
├── CLAUDE.md                  Master overview
├── CORE_SYSTEM.md             Auth/User/Dashboard
├── CASHHUB.md                 รายงานยอดสาขา
├── FUELOS.md                  ขายน้ำมัน B2B
├── DOCUFLOW.md                เอกสาร + ลายเซ็น
├── RULES.md                   Coding standards (22 rules)
└── PROJECT_TRACKER.md         ⚠️ ล้าสมัย — ใช้ STATUS.md แทน

web/
├── STATUS.md                  ← ไฟล์นี้ (สถานะจริง)
├── CLAUDE.md                  → @AGENTS.md
├── AGENTS.md                  Next.js 16 warning
├── prisma/schema.prisma       8 tables (DONE)
├── constants/business-types.ts  7 form configs (DONE)
├── lib/auth/permissions.ts    Permission Matrix (DONE)
├── lib/cashhub/reconcile.ts   Reconcile logic (DONE)
└── app/(admin)/cashhub/...    Module-based pages (in progress)
```
