# LedgerLine — LINE Experience Gap Analysis vs Bainy (2026-06-03)

> Deep-research deliverable. Goal: make the LedgerLine LINE flow "ใช้งานได้จริง"
> like Bainy (bainy.unyhub.org/manual). Sources: Bainy manual (fetched) +
> `[[bainy-competitor-reference-2026-06-02]]` + code audit of `app/api/webhooks/ledger/line/*`,
> `lib/ledger/qa.ts`, `components/ledger/LineConfirmCard*`, `app/liff/ledger/*`.
> NOT yet built — this is the plan to decide what to build.

## TL;DR
Our LINE side ships a solid **"photo → AI reads → accountant reviews in web"** loop +
keyword Q&A. Bainy is a full **expense-management-in-LINE** experience. Biggest gaps:
1. **Flex confirmation card is built but NOT wired** (webhook sends plain text) — quick win.
2. **No text → expense** ("กาแฟ 45" → draft) — Bainy's most-loved FREE feature.
3. **No Rich Menu**, **no slash commands** (only /help via keyword), **no LINE self-signup/invite onboarding**.

## Status table (11 LINE capabilities)

| # | Capability | Bainy | Us | Effort to close |
|---|---|---|---|---|
| 2 | Photo → OCR → draft | ✅ | ✅ HAVE (Gemini OCR, never auto-post) | — |
| 6 | Conversational Q&A | ✅ NLP | ✅ HAVE (keyword-only, no AI spend) | — |
| 8 | Works in LINE groups | ✅ +roles | 🟡 PARTIAL (Q&A gated to group; **image capture ungated/no role check**) | S (security) |
| 10 | LIFF mini-app | ✅ dashboard | 🟡 PARTIAL (capture screen only, no dashboard) | L (if added) |
| 3 | **Flex card reply** (จดสำเร็จ ✅ + ✏️แก้ไข) | ✅ | 🟡 **card BUILT but webhook uses plain text; postback not handled** | **S ⭐** |
| 1 | **Text → expense** ("กาแฟ 45", free) | ✅ | ❌ MISSING (text only routes to Q&A) | **M ⭐⭐** |
| 4 | **Rich Menu** (6 buttons) | ✅ | ❌ MISSING | **M ⭐** |
| 5 | Slash commands (/org /default /link /members /menu /guide) | ✅ | 🟡 PARTIAL (only /help via keyword) | M |
| 9 | Default payment method (/default) | ✅ | ❌ MISSING | M |
| 7 | LINE Login self-signup / invite-link | ✅ | 🟡 PARTIAL (LINE Login exists but needs prior Pool account; no invite-onboard) | M–L |
| 11 | Category auto-assign + inline correct + budget alerts pushed to LINE | ✅ | ❌ MISSING | L |

## Bainy reference (what "done" looks like)
- **Text entry FREE / unlimited** (no AI credit): "กาแฟ 45", "ค่าอาหารกลางวัน 120", "taxi 80", "เมื่อวาน เดินทาง 30" (relative dates, English). Remembers category per term.
- **Photo scan = credit**: JPG/PNG/HEIC/PDF, ≤10/upload, 5–15s. iPhone tip: turn off Live Photo.
- **Flex card reply**: "จดสำเร็จ ✅" + จำนวนเงิน / วันที่ / หมวดหมู่ / ✏️แก้ไข.
- **Rich Menu**: top = สรุปค่าใช้จ่าย · รายจ่าย(Dashboard) · หมวด/งบ ; bottom = คู่มือ · อัปเกรด · แจ้งปัญหา.
- **Commands**: /help (private, all), /org (private, owner — switch org), /default (owner/admin — default payment), /link (group, owner/admin — link group↔org), /members (group), /menu (group, all), /guide (group, all). Natural-language alt for /default.
- **Edit/delete only on web** (LINE = capture only) — we already follow this.
- **Onboarding**: add @OA → "สมัครใช้งาน" button → LINE Login → 2-min web onboarding (org name + type); OR 7-day invite link → LINE Login → auto-join org + fill profile.

## Recommended build order (proposed)

### Tier 1 — "feel like Bainy" (highest impact)
- **T1a. Wire the Flex confirmation card** (`LineConfirmCard` already built) into the webhook reply + handle `ledger:confirm` / `ledger:edit` postbacks. Signature "จดสำเร็จ ✅" card with ✏️แก้ไข. *Effort S.*
- **T1b. Text → expense** parser ("กาแฟ 45" / "ค่าอาหารกลางวัน 120" / "taxi 80" / relative dates) → create draft (free, no AI), reply with the same Flex card. Reuse `createDraftExpenseSystem`. *Effort M.*
- **T1c. Rich Menu** (one-click register from /ledger/settings, like ChairOps) — 6 buttons → LIFF/web links + the summary command. *Effort M.*

### Tier 2 — commands & friction
- **T2a. Slash commands** in webhook: /help (rich), /menu, /guide, /link (group↔org), /members. *Effort M.*
- **T2b. /default + default payment method** (column on `ledger_line_channel` or per-user) so text entry needs no method. *Effort M.*

### Tier 3 — onboarding & smart
- **T3a. Invite-link self-signup via LINE** (tap link → LINE Login → join org, no email-first). *Effort M–L.*
- **T3b. Category auto-assign + inline correct (postback) + budget alert push to LINE**. *Effort L.*

### Security fix (fold into Tier 1)
- **Group/role-gate image capture**: today a photo from ANY chat is processed; gate to the registered group + (later) member check, matching the Q&A gating. *Effort S.*

## Open questions for CEO
1. Priority: start Tier 1 (make it feel like Bainy) — agree?
2. Credit/■AI model: Bainy charges photo scans, text free. We have budget-guard; keep "text=free, photo=AI-budgeted"? (recommended — matches our cost-cap.)
3. Rich Menu buttons: copy Bainy's 6, or tailor (e.g. drop "อัปเกรด" since internal)?
4. Onboarding: do field staff have Pool accounts already, or need LINE-first self-signup (Tier 3a)?
