# Sentry Setup — Pooilgroup ERP

> ติดตั้ง error tracking สำหรับ production
> Added: 2026-05-20

## ทำไมต้องมี

ก่อนหน้านี้ Pool ไม่มี error tracking — ถ้า bug หลุดไป production จะรู้ก็ต่อเมื่อมีคนโทรมาด่า
Sentry จะจับ error อัตโนมัติ + ส่ง alert + เห็น stack trace ได้

## ขั้นตอน CEO ต้องทำ (manual · ครั้งเดียว)

### 1. Sentry account (เสร็จแล้ว 2026-05-20)
- ใช้ org `auditmekub` (สมัครไว้ตอน AuditMe setup ก่อนหน้า · share billing)
- สมาชิก: `patipan1122`

### 2. Project (เสร็จแล้ว 2026-05-20)
- Project slug: **`javascript-nextjs-uc`** (Sentry auto-generated · ยังไม่ได้ rename)
- Team: `pooilgroup-web`
- Platform: Next.js
- DSN: copy จาก Settings → Projects → `javascript-nextjs-uc` → Client Keys (DSN)

### 3. สร้าง Auth Token (1 นาที — สำหรับ source-map upload)
- Settings → Account → Auth Tokens → Create New Token
- Scope ติ๊ก: `project:read`, `project:releases`
- ก็อปปี้ token

### 4. ใส่ env vars (Vercel)
- ไปที่ https://vercel.com/team_aUiG9JmSKt24y6P8o5Og2v63/pooilgroup
- Settings → Environment Variables → Add ทีละตัว (ทุกตัวใส่ใน Production + Preview):

```
SENTRY_DSN              = <DSN ที่ได้จากขั้น 2>
NEXT_PUBLIC_SENTRY_DSN  = <DSN ตัวเดียวกัน>
SENTRY_ORG              = auditmekub
SENTRY_PROJECT          = javascript-nextjs-uc
SENTRY_AUTH_TOKEN       = <token ชื่อ "pooilgroup" ที่สร้าง 5:19 UTC>
```

### 5. ใส่ใน `.env.local` (สำหรับ dev เครื่องตัวเอง)
- Copy 5 ตัวข้างบนใส่ `.env.local`
- ตัว AUTH_TOKEN dev ไม่ต้องใส่ก็ได้ (source-map upload ใช้แค่ build บน CI)

### 6. Install + Deploy
`npm install` + `npm run build` รันเรียบร้อยแล้วโดย Claude เมื่อ 2026-05-20 — build ผ่าน ✅
CEO ต้องทำเองแค่:
```bash
git push                        # push commit ที่มีอยู่แล้ว · Vercel จะ deploy อัตโนมัติ
```
**ก่อน push อย่าลืมใส่ env vars ใน Vercel (ขั้น 4) ไม่งั้น Sentry จะถูก disabled (ไม่ crash · แค่ไม่ส่ง error)**

## ทดสอบหลัง deploy

1. เปิด https://pooilgroup.vercel.app/api/some-non-existing-route → 404
2. กลับไป sentry.io → ควรเห็น event เกิดขึ้น
3. ถ้าไม่เห็น → ตรวจ `SENTRY_DSN` ใน Vercel ว่าใส่ถูกไหม

## Config files ที่ผมสร้างไว้ให้แล้ว

| File | หน้าที่ |
|------|---------|
| `instrumentation.ts` | Server + Edge runtime init (Next 15+ convention) |
| `instrumentation-client.ts` | Browser-side init |
| `next.config.ts` (modified) | Wrap with `withSentryConfig` for source-map upload |
| `.env.example` (updated) | เพิ่ม 5 env vars สำหรับ Sentry |
| `package.json` (updated) | เพิ่ม dep `@sentry/nextjs ^10.53.1` (v10 = ตัวที่ support Next 16) |

## Sample rate ที่ตั้งไว้

- `tracesSampleRate: 0.1` = เก็บ performance 10% (พอเห็น trend · ไม่กิน quota)
- `replaysOnErrorSampleRate: 1.0` = บันทึก session replay เฉพาะตอนเกิด error 100%
- `enabled: Boolean(SENTRY_DSN)` = ถ้าไม่มี DSN ก็ skip Sentry ทั้งหมด (กัน crash ใน dev)

## ค่าใช้จ่ายโดยประมาณ

- Free tier: 5,000 errors + 10,000 spans / เดือน
- ถ้าทะลุ Free → Team plan $26/เดือน ได้ 50k errors + 100k spans
- คาดว่า Pool ตอนนี้ใช้ ~500-2,000 errors/เดือน · อยู่ใน Free แน่นอน

## Rollback ถ้าไม่ต้องการ

```bash
# ลบ config files
rm instrumentation.ts instrumentation-client.ts
# revert next.config.ts (เอา withSentryConfig ออก)
git checkout next.config.ts
# uninstall
npm uninstall @sentry/nextjs
# ลบ env vars ใน Vercel
```
