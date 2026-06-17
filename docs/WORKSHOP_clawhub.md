# WORKSHOP — ClawHub (brand: JOLLY PLAY)

> Locked spec for the ClawHub module foundation. Other agents build UI / LINE / admin on top.
> Status: FOUNDATION shipped (Prisma models + core libs + module/channel registration + migration).
> Last updated: 2026-06-17

## Goal

A B2C LINE membership program for guaranteed claw machines ("ตู้คีบการันตี") placed at 7-Elevens.
A customer scans a LINE QR on the machine → registers as a member → if a machine malfunctions
(stops before dispensing the 250฿ product) they request a "refund" by uploading a photo of the
machine screen AND typing the baht amount inserted. An AI reads the screen to cross-check, then the
engine credits POINTS. Points redeem ONLY for dolls. 1 POINT = 10 BAHT. Points expire in 30 days.

## Locked CEO decisions

1. **Brand** = JOLLY PLAY. Module slug = `clawhub`, base path `/clawhub`.
2. **New LINE everything, CLAWHUB_* namespaced** (RULE J) — ClawHub has its OWN LINE OA + LIFF +
   Login channel. Never shares a channel/secret with another module.
3. **1 POINT = 10 BAHT** (locked conversion).
4. **Customer enters the amount + AI cross-check** — the customer types the baht inserted; AI reads
   the screen ("Add up:" / "Credit" in coins) and we compare. Not AI-only, not human-only.
5. **First refund auto-approves if clear; 2nd+ → admin review.** Photo unreadable → ask re-photo.
6. **Points redeem for dolls only** (no cash-out).
7. **Points expire 30 days** after earning (FIFO lots — soonest-to-expire spent first).
8. **Max refund 250฿/claim** for auto-approval; over the cap → admin review.
9. **Reuse the inbox pattern for chat** — ClawHub has its own `clawhub_conversations` /
   `clawhub_messages` tables modeled on the existing inbox, with a FAQ fast-path before AI.

## Machine screen (vision target)

Real machine = blue LCD showing: `Credit`, `Time`, `Coin` ("1 Coin / 1 Play"), `Price:` (e.g. 35),
`Add up:` (e.g. 0 = amount accumulated this play). `vision.ts` extracts Credit / Price / Add up /
coin-per-play + a 0..1 confidence + raw text (for audit). NOT an "X/25" style screen.

## Refund engine rules (locked, implemented in `lib/clawhub/refund-engine.ts`)

`aiReadBaht = addUp*10 ?? credit*10 ?? null` (coins → baht).
1. confidence < floor (0.55) → **NEEDS_REPHOTO** ("รูปไม่ชัด ถ่ายใหม่...").
2. claimedBaht ≤ 0 → NEEDS_REPHOTO (invalid).
3. claimedBaht > 250 → **PENDING_REVIEW** ("ยอดเกินเพดานคืนอัตโนมัติ...").
4. |aiReadBaht − claimedBaht| > max(20, claimedBaht×0.5) → PENDING_REVIEW (typed vs screen mismatch).
5. member.refundCount ≥ 1 → PENDING_REVIEW ("คุณขอคืนบ่อยเกินไป...").
6. else → **AUTO_APPROVED**, points = floor(baht / 10).

## Integration map

**Reuses (no edits to those modules):**
- `lib/ledger/ai-parse.ts` Gemini pattern (model `gemini-3.1-flash-lite`, GoogleGenAI, inlineData).
- `lib/ai/cost-cap.ts` — `checkAiBudget` / `recordAiUsage` (moduleName "clawhub").
- `lib/r2/upload.ts` — `putObject` / `getUploadUrl` / `deleteObject` (R2 client).
- `lib/recruit/channel-crypto.ts` — `verifyLineSignature` (HMAC-SHA256 base64, constant-time).
- `lib/auth/session.ts` + `lib/auth/module-access.ts` + `lib/auth/role-guards.ts` — admin gate.
- LINE Messaging API outbound pattern from `lib/chairops/line/messaging.ts`.

**Additive edits (2 files):**
- `lib/modules.ts` — `"clawhub"` added to `ModuleSlug`; `MODULES.clawhub` entry (nav: dashboard /
  refunds / members / dolls / redemptions / inbox / reports / settings). Imports lucide `Gift`.
- `lib/line/channels.ts` — `"clawhub"` added to `LineModule` + all per-module switches
  (`lineModuleFromPath` "/liff/clawhub", `liffIdForModule`, `loginSecretForModule`,
  `loginChannelIdForModule` via shared logic). Ledger/default branches untouched.

**New tables (6, all `public` schema):** see Data model.

## Data model summary (`prisma/schema.prisma`, all `@@schema("public")`, snake_case `@@map`)

Soft references only: `orgId` / `machineId` / `branchId` / `productId` are plain `@db.Uuid` + denorm
snapshots — NO Prisma relations to Organization / CfMachine / CfProduct. Relations exist only among
Clawhub* models.

- **ClawhubMember** (`clawhub_members`) — member identity + cached `pointsBalance` + `refundCount` +
  PDPA `consentAt`/`retentionUntil`/`blockedAt`. `memberCode` = `CH-YYYY-NNNN`.
  `@@unique([orgId, externalLineId])`.
- **ClawhubPointEntry** (`clawhub_point_entries`) — append-only ledger + FIFO lots
  (`remainingPoints`, `expiresAt`, `expiredAt`). `kind`: EARN_REFUND | REDEEM | EXPIRE | ADJUST.
- **ClawhubRefundRequest** (`clawhub_refund_requests`) — `claimedBaht` + AI fields
  (`aiReadBaht`/`aiAddUp`/`aiPrice`/`aiCredit`/`aiRawText`/`aiConfidence`) + `screenshotR2Key` +
  `screenshotSha256`. `status`: AUTO_APPROVED | PENDING_REVIEW | APPROVED | REJECTED.
  `@@unique([memberId, screenshotSha256])` dedup.
- **ClawhubRedemption** (`clawhub_redemptions`) — `pointsSpent` + `pickupCode` + product snapshot.
  `status`: PENDING | FULFILLED | CANCELLED.
- **ClawhubConversation** (`clawhub_conversations`) — LINE chat thread, `botEnabled`, `unreadCount`,
  `status`: OPEN | SNOOZED | CLOSED. `@@unique([orgId, lineUserId])`.
- **ClawhubMessage** (`clawhub_messages`) — `direction` IN|OUT, `kind` TEXT|IMAGE|STICKER|SYSTEM,
  `externalId` for idempotency. `@@unique([conversationId, externalId])`, FK Cascade to conversation.

## Fraud / PDPA / legal notes

- **Fraud controls:** screenshot SHA-256 dedup (`@@unique([memberId, screenshotSha256])` — same photo
  can't be reused); first-refund-only auto-approval (2nd+ → human); typed-vs-screen cross-check;
  250฿ auto cap; `refundCount`/`firstRefundAt`/`lastRefundAt` track velocity; `blockedAt` to ban abusers.
  AI `rawText` + confidence stored on every request for audit.
- **PDPA:** `consentAt` recorded at registration (`setConsent`); `retentionUntil` for data-retention
  windows (mirrors PlaylandMember). Only LINE-provided profile (display name, picture, userId) +
  phone (optional) are stored. The FAQ states explicitly this is **not gambling** — guaranteed claw
  + customer-care points, redeemable for real goods only.
- **Legal framing:** points are loyalty credit (goods-only, no cash equivalence) to stay clear of
  gambling/e-money classification. Support phone: 084-198-1623.

## Env (CLAWHUB_* — RULE J namespaced)

| Env | Purpose |
|---|---|
| `NEXT_PUBLIC_CLAWHUB_LIFF_ID` | LIFF id for `/liff/clawhub` (falls back to `NEXT_PUBLIC_LIFF_ID`). |
| `CLAWHUB_LINE_CHANNEL_SECRET` | Messaging API webhook signature verification. |
| `CLAWHUB_LINE_CHANNEL_ACCESS_TOKEN` | Messaging API reply/push/getProfile/getContent. |
| `CLAWHUB_LINE_LOGIN_CHANNEL_SECRET` | LINE Login verify (falls back to `CHAIROPS_LINE_LOGIN_CHANNEL_SECRET`). |
| `CLAWHUB_MAX_REFUND_BAHT` | Auto-approve ceiling (default 250). |
| `CLAWHUB_POINT_EXPIRE_DAYS` | Points TTL (default 30). |
| `CLAWHUB_VISION_CONFIDENCE_FLOOR` | Min AI confidence before re-photo (default 0.55). |
| `GEMINI_API_KEY` | (shared) AI vision — already configured for other modules. |

## Migration

`prisma/migrations/20260617051820_clawhub_init/migration.sql` — additive, idempotent (enum
duplicate_object guards + `IF NOT EXISTS` tables/indexes + FK guards). CEO applies manually
(`npx prisma db execute --file prisma/migrations/20260617051820_clawhub_init/migration.sql`) or via
`prisma migrate deploy`. No existing object is altered.
