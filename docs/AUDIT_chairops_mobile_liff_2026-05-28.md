# AUDIT · ChairOps Mobile Staff UX + LINE OA / LIFF Mini App

> `/auditbigteam` focused run · 2026-05-28 · 6 personas (UX · STAFF · SEC · SRE · BA · DEVIL)
> Scope = complete the maid MOBILE interface + wire LINE OA / LIFF. Build-driver for this session's ship.
> Builds on `docs/AUDIT_chairops_2026-05-25.md` + `docs/BIGFEATURE_chairops_SPEC.md` — does NOT re-derive.

---

## 1. Executive summary

The maid PWA at `app/(admin)/chairops/(maid)/m/*` is **~80% built and high quality** (home, collect, cleanliness, parts all real). The audit found the real work is **much smaller than "build a mobile interface"**:

- **One missing screen**: `m/damage/page.tsx` is an 8-line `redirect()` to the desktop form → needs a real mobile-first damage form.
- **Three systemic polish gaps** shared by all forms: no full-screen success confirmation (all end `toast + router.push`), no sticky safe-area submit bar (iOS keyboard covers submit), and an **offline-photo bug** that leaves submit permanently disabled.
- **One security hole**: maid write paths gate `requireExactRole("MAID")` but **not branch** → a maid can POST another branch's `branchId`.
- **LINE plumbing already exists to reuse**: Recruit's `channel-crypto.ts` (HMAC verify + AES-256-GCM) + `inbox-send.ts` (Messaging API Push/Reply) + the LIFF auth path (`app/liff/*` + `/api/auth/line-login`, which verifies the id_token against LINE).

**The single adoption-critical path** (DEVIL): maid opens LIFF → auto-logs in as MAID with no password → lands on the right screen. Everything else (inbound conversation webhook, outbound Push tested live) is secondary or blocked on the CEO completing LINE OA business verification.

## 2. Scope

**IN (BUILDABLE_NOW · testable without a live OA):**
1. `m/damage/new` mobile form + success screen (replace redirect stub)
2. Reusable `SuccessScreen` + `StickyCta` primitives → applied to all 4 forms
3. Offline-photo bug fix + hard double-submit lock + chair-picker grid (vs datalist typing)
4. SEC: `requireBranch()` + `ChairopsMaidAssignment` guard on every maid write action
5. LINE OA Messaging adapter (`lib/chairops/line/messaging.ts`) reusing Recruit pattern, **with dev-fallback** (no token → log, never throw)
6. Lean webhook receiver: verify HMAC → 200 fast → log `join`/`follow` (captures `groupId`) + dedupe `webhookEventId`. **No conversation processor.**
7. EOD reminder cron `/api/chairops/cron/eod-reminder` (17:00 ICT) wrapped in `runWithMonitor`
8. ChairOps LIFF entry: `?to=` deep-link router → `/chairops/m/*` + admin-only maid↔LINE binding action
9. Rich Menu = JSON spec + `scripts/` registration script (run once by CEO) — NOT a UI, NOT a cron

**OUT / DEFER (HW_BLOCKED on CEO completing LINE OA setup):**
- Full inbound conversation webhook processor (maids don't chat with the bot — YAGNI)
- Live outbound Push verification (can't test until real Channel Access Token + business verification)
- Removing LINE Notify (keep as fallback behind the adapter until tokens arrive)
- Collect per-chair running-total list (mockup shows it, but it's a data-model change vs the counted/deposited reconcile model — **CEO scope decision**, not this session)

## 3. Damage mobile form — wireframe (UX persona)

```
┌─ MaidShell header (emerald) · ← แจ้งซ่อม ──┐
│ ┌─ Card · เก้าอี้ที่เสีย ────────────────┐ │ chair chips (min-h-11, 44pt)
│ │ [ CH-001 ][ CH-002 ][ CH-014 ] …       │ │ blue = machine identity
│ │ [— ไม่ระบุเครื่อง —]  (chairId optional)│ │
│ ├─ Card · ความเร่งด่วน ──────────────────┤ │ single-select pills
│ │ ( 🔴 ด่วน )( 🟡 ปานกลาง )( ⚪ เบา )     │ │ rose / amber / zinc ONLY
│ ├─ Card · ประเภท + อาการ ────────────────┤ │ category enum + textarea
│ │ [select 5 cats] [textarea rows=4 ≤500] │ │ min 5 chars
│ ├─ Card · รูปอาการ (0/3) ────────────────┤ │ presign→R2, compress client
│ │ [📷 ถ่ายรูป] [thumb][thumb][+]          │ │
│ └────────────────────────────────────────┘ │
│        scroll · pb-28                        │
├──────────────────────────────────────────┤
│ [ ส่งให้ช่าง ] sticky bottom safe-area      │ disabled until cat+อาการ valid
└──────────────────────────────────────────┘
Success: full-screen emerald CircleCheck + ticket RP-2569-NNNN + chair + urgency + thumb
         [ แจ้งอีกรายการ ] [ กลับหน้าหลัก ]
```

## 4. Rich Menu → routing table (BA)

| ปุ่ม | LIFF deep-link | route | action |
|---|---|---|---|
| 💰 เก็บเงิน | `liff.line.me/{id}?to=collect` | `/chairops/m/collect/new` | `createCashCollection` |
| 🧹 เช็คคลีน | `?to=cleanliness` | `/chairops/m/cleanliness/new` | `createCleanlinessReport` |
| 🔧 แจ้งซ่อม | `?to=damage` | `/chairops/m/damage/new` | `createDamageTicket` |
| 📦 เบิกของ | `?to=parts` | `/chairops/m/parts/new` | `requestPartFromMaid` |

Rich Menu uses **URI actions** (open LIFF URL directly) — no postback round-trip. LIFF bootstrap auto-logs in via verified id_token, then the `?to=` router forwards to the screen.

## 5. Hardware / external dependency matrix

| Item | Tag | Blocker |
|---|---|---|
| Damage form, UX polish, offline fix, branch guard, LIFF `?to=` router | 🟢 BUILDABLE_NOW | none |
| Messaging adapter, webhook, EOD cron, Rich Menu script | 🟢 BUILDABLE_NOW (dev-fallback) | activates when tokens present |
| Live Push delivery, groupId capture, Rich Menu live | 🔴 HW_BLOCKED | CEO: OA business verification + `LINE_CHANNEL_ACCESS_TOKEN`/`SECRET` + `NEXT_PUBLIC_LIFF_ID` + invite OA to 5 groups + Rich Menu image (2500×1686) + open webhook URL in console |
| Coin-box "cash proof" photo end-to-end | 🟡 MOCKABLE | full test needs a physical chair |
| Collect per-chair running total | ⏸ DEFER | data-model change · CEO scope decision |

## 6. Decisions locked (D-CO-M#)

- **D-CO-M1** — Build the maid mobile **damage form** to replace the redirect stub; old desktop damage form stays for office.
- **D-CO-M2** — Add reusable `SuccessScreen` + `StickyCta` to `_kit`; all 4 maid forms render a full-screen success state (not toast+push) and a sticky safe-area submit bar.
- **D-CO-M3** — Maid write actions MUST call `requireBranch(payload.branchId)` + verify `ChairopsMaidAssignment{userId,branchId,isActive,endedAt:null}` (not just `requireExactRole` / stale `primaryBranchId`).
- **D-CO-M4** — LINE outbound goes through ONE adapter `lib/chairops/line/messaging.ts` with dev-fallback; LINE Notify kept behind it until Messaging tokens land. No live-Push code path is left untested-and-unguarded.
- **D-CO-M5** — Webhook is **lean**: HMAC verify → 200 fast → log join/follow (capture groupId) → dedupe `webhookEventId`. No inbound conversation processor this session (YAGNI · DEVIL).
- **D-CO-M6** — Rich Menu = JSON spec + manual `scripts/` registration (CEO runs once). 5 role-channels map to 5 `LINE_GROUP_*` env IDs; per-branch routing deferred.
- **D-CO-M7** — maid↔LINE binding (`lineUserId` on ChairopsUser) is **admin-set only**; LIFF never writes the mapping (prevents identity claim).
- **D-CO-M8** — Collect per-chair running-total list **deferred** (data-model change) — flag to CEO.

## 7. Acceptance criteria (per screen)

- **Damage form**: select chair (or none) → urgency → category+อาการ(≥5) → ≥0 photos → sticky submit → full-screen success with `RP-####` → "แจ้งอีก"/"กลับหน้าหลัก". Cross-branch chair rejected server-side. Duplicate open ticket on same chair → soft-warn.
- **All 4 forms**: submit button sticky above keyboard; double-tap cannot double-submit; success state persists (no 4s toast disappearing); offline photo pick still enables submit or clearly blocks with reason.
- **LIFF entry**: open `/liff/chairops?to=damage` → auto-login → land on `/chairops/m/damage/new`; unbound LINE user → friendly "บัญชียังไม่เปิดใช้ ติดต่อออฟฟิศ" (not raw error).
- **Messaging adapter**: no token → returns `{ok:false}` + dev log, never throws; 429/5xx → backoff retry; 5s timeout.

## 8. Persona sign-off

| Persona | Status | Condition |
|---|---|---|
| UX | 🟡 CONDITIONAL | needs SuccessScreen + StickyCta primitives built first |
| STAFF | 🟡 CONDITIONAL | damage mobile form + offline-photo fix + persistent success |
| SEC | 🟡 CONDITIONAL | `requireBranch` guard on all maid writes + admin-only LINE binding |
| SRE | ✅ PASS | reuse cron infra + dev-fallback adapter; groupId capture sequence documented |
| BA | 🟡 CONDITIONAL | damage duplicate-guard + EOD rule + verify parts route |
| DEVIL | ⚠ OBJECTS-BUT-ACCEPTS | accepts build IF outbound/webhook ship with dev-fallback (not live-untested) + no conversation processor |

→ 0 BLOCKED. All conditions are addressed by the build plan §2.

## 9. Open questions / risks

- LINE OA business verification lead time (CEO, external) gates live activation — code ships ready behind dev-fallback.
- ChairopsUser ↔ Pool `users` LINE-binding resolution path needs confirming during build (SEC/BA P1).
- Mall basement signal → offline-first is real (consistent with `[[playland-offline-first-decision]]`); this session fixes the blocking photo bug, full offline outbox deferred until pilot shows need (DEVIL).
