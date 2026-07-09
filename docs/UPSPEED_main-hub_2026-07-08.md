# UPSPEED · ระบบหลัก (login → home hub shell) · 2026-07-08

**ขอบเขต:** เปลือก/หน้าแรกหลัง login ของ Pooilgroup ERP — `app/(admin)/layout.tsx` (นาฟ/เมนู ครอบทุกโปรแกรม) + `app/(admin)/home/page.tsx` (dashboard หน้าแรก) + `app/(admin)/programs/page.tsx` + เส้นทาง `app/page.tsx` → `/home`.
**Stack:** Next 16 App Router (RSC) · Prisma multiSchema + Supabase (adminClient service-role สำหรับ core counts) · Vercel serverless. Data = small scale (~2 บริษัท, สาขาหลักสิบ, แถวหลักร้อย–พัน).
**ทีม:** 3 profile lens (query-db / perceived-nav / bundle-infra) × Explore + adversarial verify 13 skeptic · 16 agents · ~527k tok.

---

## §1 สรุป (ภาษา CEO)

หน้าหลัก "เขียนมาดีอยู่แล้ว" ในเรื่องฐานข้อมูล — query ทั้งหมดยิงพร้อมกัน (`Promise.all`), session ไม่ถามซ้ำ (cache), เมนู/บริษัทมี cache แล้ว. **จุดที่ทำให้ "รู้สึกช้า" ไม่ใช่ query ช้า แต่คือ "จอขาวค้าง" ตอนกดเข้าหน้า** เพราะหน้าหลัก 15 หน้ายังไม่มี "โครงหน้าเปล่า" (skeleton) ให้เห็นระหว่างโหลด — โมดูลย่อย (บัญชี/เก้าอี้/แคชฮับ) มีแล้ว แต่ "ตัวหลัก" ไม่มี. แก้ 5 จุด เน้นให้ทุกการกด "เห็นอะไรทันที <0.1 วิ" แทนจอขาว.

## §2 Baseline → After

| ตัวชี้วัด | ก่อน | หลัง |
|---|---|---|
| หน้า core ที่มี loading skeleton | 0 / 15 | **15 / 15** (group-root 1 ไฟล์ + home tailored 1 ไฟล์) |
| loadUserModules ต่อ 1 navigation | ยิงซ้ำ 2–3 รอบ | **1 รอบ** (React cache dedupe) |
| /home first paint | รอครบ 8 core query **+ 5 Prisma (OperationsSummary)** แล้วค่อยโผล่ | เปลือกโผล่หลัง 8 query · 5 Prisma stream ตามหลัง (Suspense) |
| logout | refresh หน้าเดิม (จอขาว 0.5–1.5 วิ) แล้วค่อยไป /login | ไป /login ทันที |

> ⚠️ ชัยชนะพวกนี้เป็น **"perceived speed" (client-nav)** — curl วัดไม่ได้. ต้อง **กดเองถึงจะรู้สึก**.

## §3 แก้แล้ว (felt · safe · shipped to working tree)

1. 🔴 **`app/(admin)/loading.tsx`** (ใหม่) — group-root skeleton catch-all → หน้า core 15 หน้าไม่ขาวค้างอีก (home/programs/users/audit/companies/profile/settings/branches/bugs/clawhub/costctrl/docuflow/hotelbook/pinpoint/repairs). ใช้ `PageSkeleton` เดิม. โมดูลย่อยที่มี loading เองยัง override ตามปกติ. **[S-001]**
2. 🔴 **`app/(admin)/home/loading.tsx`** (ใหม่) — skeleton เฉพาะ /home เลียนโครง dashboard (hero + chips + favorites grid + system stats) → เข้า hub ลื่นไม่กระตุก. **[S-001]**
3. 🟡 **`lib/auth/module-access.ts`** — ห่อ `loadUserModules` ด้วย React `cache()` → layout + /home + /programs เรียกทีเดียว ไม่ query `user_modules` ซ้ำ. เสี่ยง 0 (ไม่แตะ role/สิทธิ์/เงิน). **[S-017 ใหม่]**
4. 🟡 **`app/(admin)/home/page.tsx`** — ห่อ `OperationsSummary` ด้วย `<Suspense fallback={null}>` → เปลือกหน้า (hero/favorites/system) stream ก่อน, 5 Prisma count ตามมา. **[S-002]**
5. 🟡 **`components/layout/admin-shell.tsx`** — ลบ `router.refresh()` เกินตอน logout (session ถูกล้างทั้ง server+client แล้ว) → ไม่แฟลชจอขาวก่อนออก. **[S-018 ใหม่]**

**Typecheck:** `node_modules/.bin/tsc --noEmit` → ✅ ไม่มี error ในทั้ง 5 ไฟล์. **Build-before-deploy ยังไม่รัน** (รอ CEO สั่ง deploy).

## §4 Deferred — รอบ 2 "สุดขีด" (MED/L effort)

- **admin-shell.tsx = `'use client'` ทั้งไฟล์ 857 บรรทัด + 19 lucide icon** [S-007]: JS ก้อนใหญ่ hydrate ทุกหน้า. verify ให้ LOW/scale-only ตอนนี้ (JS cache หลังโหลดครั้งแรก) แต่เป็นหนี้สถาปัตย์ — แยก server shell + client island เป็นงานผ่าใหญ่ ควรทำแยกรอบ.

## §5 Scale-only (ยังไม่รู้สึก · declare · ทำเมื่อโตขึ้น)

- OperationsSummary รวม 3 `repairTicket.count()` เป็น groupBy เดียว — เสี่ยงเลขเพี้ยน, ได้ <200ms เท่านั้นตอนนี้.
- `register_requests` ยิง 2 ครั้ง (count + list) — รวมเป็นครั้งเดียวได้ แต่ ~200 แถวไม่รู้สึก.
- `force-dynamic` บน /home + /programs — ป้องกันได้ (นับสด), ISR ช่วยเฉพาะตอนคนเข้าพร้อมกันเยอะ. เงิน (pendingCashReports) cache 30s ใน layout อยู่แล้ว ไม่ค้าง stale.
- Prisma pool cold-start — DATABASE_URL อยู่ :6543 pooler ถูกแล้ว, ไม่เพิ่ม.

## §6 Dropped (verify ตีตก)

- ModuleTile prefetch — Next 16 default `prefetch={true}` อยู่แล้ว, เพิ่มเองไม่เปลี่ยนอะไร.

## §7 Regression pass (slow-pattern-library re-check)

- S-001 (no-loading-skeleton) → พบซ้ำที่ core hub → แก้แล้ว. ยังเป็น #1 felt win ทุกรอบ.
- S-002 / S-004 / S-007 / S-009 → ตรวจแล้ว: Suspense เพิ่ม (S-002), force-dynamic scale-only (S-004), use-client defer (S-007), pooler :6543 ผ่าน (S-009).
- ใหม่: **S-017** (layout+page เรียก loader ตัวเดียวกันแบบไม่ cache → query ซ้ำต่อ nav), **S-018** (router.refresh ก่อน push ไปคนละ route = re-render หน้าที่กำลังจะทิ้ง).
