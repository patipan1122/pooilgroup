# RECRUIT_OMNICHAT_PLAN.md — รวมแชท LINE OA + Facebook Page เข้า /recruit/messages

> **สร้าง:** 2026-05-23 · ตามคำถาม CEO: "คนสมัครทักมาใน line oa แล้วมาโผล่ในนี้เลย · หรือทักมาใน facebook แล้วโผล่ในนี้ · multi-account"
>
> **สถานะ:** SCAFFOLDING (ขึ้น prod แล้ว) · production-ready: ~3-5 วันงานเพิ่มเติม

---

## 🎯 Goal

หน้า `/recruit/messages` เป็น **inbox รวม** ทุกช่องทาง:
1. INAPP (ใน Pooil app เอง)
2. EMAIL (Resend — รอ wire ใน Phase 2)
3. LINE OA (ผู้สมัครทักไปที่ LINE Official Account ของบริษัท)
4. Facebook Page (ผู้สมัครทักหน้า Facebook Page ของบริษัท)

แต่ละ thread แสดง **channel badge** บอกที่มา · HR ตอบกลับใน /recruit/messages → ส่งกลับไป channel เดิม

**Multi-account:** 1 องค์กรเชื่อม LINE OA หลายบัญชี + FB Page หลายเพจได้ (เช่น Pooil ราชบุรี LINE + Pooil นครราชสีมา LINE + Pooil HR FB + JPSync HR FB)

---

## 🏗 Architecture

```
                            ┌─────────────────────────────────┐
                            │     /recruit/messages           │
                            │  (รวม thread ทุก channel)       │
                            └────────────────┬────────────────┘
                                             │
                  ┌──────────────────────────┴──────────────────────────┐
                  │              recruit_messages table                  │
                  │  channel = INAPP | EMAIL | LINE | FACEBOOK           │
                  │  direction = IN | OUT                                │
                  │  channelInstanceId → recruit_inbox_channels.id       │
                  └──────────┬─────────────────────────┬─────────────────┘
                             │                         │
            ┌────────────────┴──────────┐    ┌─────────┴──────────────────┐
            │ Inbound (webhook)         │    │ Outbound (admin reply)     │
            │  - LINE → /api/webhooks/  │    │  - INAPP: write to DB      │
            │    recruit/line/[id]      │    │  - LINE: POST to /v2/bot/  │
            │  - FB → /api/webhooks/    │    │    message/push w/ token   │
            │    recruit/facebook/[id]  │    │  - FB: POST to /v18.0/me/  │
            │  - verify signature       │    │    messages w/ token       │
            │  - match userId→applicant │    │  - encrypt token at rest   │
            │  - persist message        │    │                            │
            └───────────────────────────┘    └────────────────────────────┘
```

---

## 📊 Schema

```prisma
enum RecruitInboxChannelType {
  LINE
  FACEBOOK
}

model RecruitInboxChannel {
  id              String  @id @default(uuid())
  orgId           String                        // multi-tenant
  type            RecruitInboxChannelType
  displayName     String                        // "Pooil HR LINE"
  externalId      String?                       // LINE Channel ID / FB Page ID
  accessTokenEnc  String?                       // encrypted (envelope key)
  webhookSecret   String?                       // 32-byte hex, signature verify
  status          String  @default("setup")     // setup | active | error | disabled
  lastEventAt     DateTime?                     // for debugging
  metadata        Json?                         // page URL, etc.
  createdById     String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

`recruit_messages` already has `channel = INAPP | EMAIL | LINE | SMS` — เพิ่ม `channelInstanceId` (FK to RecruitInboxChannel) เมื่อ wire จริง.

---

## 🔌 Per-channel Setup Flow

### LINE OA (1 OA / 1 channel)

1. Admin เข้า `/recruit/settings/channels` → "เพิ่ม channel" → เลือก LINE
2. ระบบ generate `webhookSecret` (32-byte hex)
3. Admin คัดลอก webhook URL: `https://pooilgroup.vercel.app/api/webhooks/recruit/line/{channelId}`
4. ใน [LINE Developers Console](https://developers.line.biz/console/):
   - สร้าง Channel (Messaging API) · ถ้ายังไม่มี
   - Webhook URL → พาสต์
   - Channel Secret → กลับมาวางใน admin form (เก็บ encrypted)
   - Channel Access Token (long-lived) → กลับมาวางใน admin form
   - Enable "Use webhook" + ปิด "Auto-reply messages" / "Greeting messages"
5. Verify เสร็จ → `status = active` · พร้อมรับ event

### Facebook Page (1 Page / 1 channel)

1. Admin เข้า `/recruit/settings/channels` → "เพิ่ม channel" → เลือก Facebook
2. ระบบ generate `webhookSecret`
3. Admin คัดลอก webhook URL: `.../api/webhooks/recruit/facebook/{channelId}`
4. ใน [Facebook for Developers](https://developers.facebook.com/):
   - สร้าง App (Business) · เพิ่ม "Messenger" product
   - Webhook URL + Verify Token (= webhookSecret) → FB ส่ง GET hub.challenge มา · route handler ตอบกลับ
   - Subscribe events: `messages`, `messaging_postbacks`
   - Page Access Token (ผูกเพจ) → กลับมาวางใน admin form
5. ครั้งแรก FB อาจให้ go through App Review ถ้าจะใช้กับ public users (Production tier)

---

## 🔐 Security

| Concern | Mitigation |
|---|---|
| Cross-tenant leak | RLS บังคับ `org_id = current_org_id` · listChannels filter by session orgId |
| Token theft | `access_token_enc` encrypted ด้วย envelope key จาก env (`RECRUIT_CHANNEL_KEY`) · ไม่ log ในไหน |
| Webhook spoofing | Verify HMAC signature ก่อน persist · `X-Line-Signature` / `X-Hub-Signature-256` |
| Replay attack | Track event ID per channel (LINE = `events[].timestamp`, FB = `entry[].id`) · idempotent insert |
| Token expiry | Long-lived LINE tokens permanent · FB Page tokens 60 days → automated refresh job |

---

## 🚧 Build phases

### Phase 1 — Connect UI ✅ DONE (2026-05-23)
- DB schema + DDL applied to prod
- `/recruit/settings/channels` page
- ChannelsManager UI (add / list / toggle / delete + webhook URL copy)
- Webhook stub routes return 200 + log

### Phase 2 — LINE inbound (~1.5 day)
- HMAC verify against `webhookSecret`
- Parse `events[].source.userId` + `events[].message`
- Match LINE userId → recruit_applicant.lineId
- Auto-create RecruitApplicant if first contact (status=NEW, no posting yet)
- Persist message (direction=IN, channel=LINE)
- Set `lastEventAt`

### Phase 3 — FB inbound (~1.5 day)
- Hub challenge verification on GET (already stubbed)
- HMAC SHA256 verify on POST
- Parse `entry[].messaging[]`
- Match FB PSID → recruit_applicant.facebookPsid (new field)
- Auto-create + persist same as LINE

### Phase 4 — Outbound reply (~1 day)
- `sendMessage` action: if channel is LINE/FB, decrypt token + POST to provider API
- Handle delivery errors (token expired, user blocked, rate limit)
- Update message.status = SENT / FAILED accordingly

### Phase 5 — Apply linkage (~0.5 day)
- When applicant first messages: show banner in /recruit/messages "ผู้สมัครยังไม่กรอกใบสมัคร · ส่งลิงค์ /apply"
- One-click button to send the org's main posting link via the same channel

**Total ~4.5 dev-days** for full production.

---

## 📦 New env vars needed (Phase 2)

```bash
# Envelope key for encrypting accessTokenEnc at rest
RECRUIT_CHANNEL_KEY=<base64 32-byte random>
```

---

## ⚠️ Known limitations / decisions

1. **Public webhook URLs are not secret** — anyone can POST to them. Only HMAC verification prevents spoofing. Worth dropping rate-limit per channelId.
2. **LINE userId is opaque per-channel** — same person who has both LINE OAs of the org will appear as 2 different users. We don't merge across channels.
3. **FB messaging requires App Review** for Production tier — must explain to Meta that this is a recruitment chatbot · or operate in Development tier (only Page admins can DM).
4. **One Pool DB · two domains** — Pooil + Buildly Go share `recruit_*` schema · this OK because RLS enforces org isolation.
5. **No SLA on channel-side delivery** — LINE/FB may rate-limit. Phase 4 outbound queue with retry needed for reliability.

---

## 🔗 Related memory

- [[recruit-canvas-parity-2026-05-22]] · [[recruit-deep-audit-2026-05-22]] · [[recruit-module-pooil-2026-05-20]]
- Bug #5 in deep-audit fixed false-SENT for EMAIL — same pattern applies to LINE/FB until real delivery
