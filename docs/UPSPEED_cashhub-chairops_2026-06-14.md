# UpSpeed — CashHub + ChairOps (เก้าอี้นวด) · 2026-06-14

> Deep performance hunt · 6 lenses × 2 modules · adversarial-verified · auto-fixed felt wins
> Branch: `claude/upspeed-cashhub-chairops` (off `origin/setup`) · commit `056164e`
> Build: `next build --webpack` EXIT 0 (110/110 static) · tsc clean on all changed files

## §1 · สรุป (ภาษาธุรกิจ)

ตรวจความเร็วทั้ง 2 โปรแกรมด้วยทีมวิศวกร 12 ตัว (6 มุม × 2 โปรแกรม) + ทีมตรวจค้านแยกอีกชุด.
เจอ **90 ข้อดิบ → ตรวจค้านทิ้ง 57 ข้อ (จับผิด/เกินจริง) → เหลือจริง 33 ข้อ แต่ "ผู้ใช้รู้สึกตอนนี้" แค่ 7 ข้อ**
(อีก 26 ข้อจริงแต่รู้สึกเมื่อโตขึ้น 50–100 เท่า — DB index ไว้ดีมาก 430 ตัว).

7 ข้อที่รู้สึกจริงยุบเหลือ 4 เรื่อง — แก้+build ผ่านครบ:

- **A · จอไม่ขาวตอนกดเปลี่ยนหน้าแล้ว** (perceived speed, อันดับ 1) — เพิ่มหน้า "กำลังโหลด" 3 ไฟล์ ครอบ ~80+ หน้า
- **B · รูปการ์ตูนแมวน้ำเบาลง** — จาก 366KB → รูปย่ออัตโนมัติ (next/image) บนหน้าแรกแม่บ้าน
- **C · หน้าแรกแม่บ้านไม่เขียน DB ทุกครั้งที่เปิดแล้ว** — อ่านค่าที่คำนวณไว้แทน (เร็วขึ้น + ปลอดภัยขึ้น)
- **D · ปุ่มคำนวณยอด/cron เร็วขึ้น ~5 เท่า** — คำนวณ 30 สาขาพร้อมกันเป็นชุด (เดิมทีละสาขา)

## §2 · Baseline → After

| metric | ก่อน | หลัง |
|---|---|---|
| CashHub หน้าที่มี loading.tsx | 4 / ~30 | **ครบทุกหน้า** (group-root 1 ไฟล์ + 4 เฉพาะ) |
| ChairOps (maid LIFF) loading.tsx | **0** | **ครบทั้ง tree** (1 ไฟล์ที่ `(maid)/m/`) |
| ChairOps admin-level loading.tsx | บางส่วน ((office) 6) | + group-root ครอบที่เหลือ |
| รูป mascot หน้าแรกแม่บ้าน | 366KB PNG ดิบ (`<img>`) | next/image → WebP ~ไม่กี่ KB @64px |
| หน้าแรกแม่บ้าน ต่อ 1 การเปิด | ~9 query + recompute (~6 agg) **+ 1 WRITE** | ~9 query + **อ่าน 1 แถว cache** (0 write) |
| recomputeAllDrifts (30 สาขา) | sequential ~30 round-trips ลึก | bounded Promise.all 6 ชุด × 5 |

> หมายเหตุ: A (loading) + C/D เป็น perceived/throughput → **curl วัดไม่เห็น ต้องกดเองถึงรู้สึก**.
> ให้ CEO ทดสอบ: เปิด LINE ของแม่บ้าน → กดสลับแท็บ → ควรเห็นโครงหน้าทันที (ไม่ขาว).

## §3 · Fixed (commit 056164e — 5 ไฟล์)

| | ไฟล์ | ทำอะไร |
|---|---|---|
| A | `app/(admin)/cashhub/loading.tsx` (ใหม่) | PageSkeleton — fallback ครอบ cashhub ทุกหน้า |
| A | `app/(admin)/chairops/loading.tsx` (ใหม่) | skeleton — ครอบ admin-level chairops |
| A | `app/(admin)/chairops/(maid)/m/loading.tsx` (ใหม่) | mobile skeleton — ครอบ maid LIFF ทั้ง tree |
| B+C | `app/(admin)/chairops/(maid)/m/page.tsx` | `<img>`→`<Image>` · `recomputeDriftForBranch`→`readDriftSnapshot` |
| C+D | `lib/chairops/reconcile/drift-engine.ts` | + `readDriftSnapshot()` (อ่าน cache, ไม่เขียน) · recomputeAllDrifts → bounded Promise.all |

### Architecture / Accounting check (RULE I — C/D แตะระบบเงิน)
- **C ปลอดภัย + ดีขึ้นเชิง correctness:** drift ถูก recompute ทุก "เหตุการณ์เงิน" อยู่แล้ว — เก็บ/ฝาก (`collect/actions.ts:293,535`), write-off (`reconcile/actions.ts:214`, `write-offs/actions.ts:112`), POS import (`pos-ingest`), cron gmail (`email/auto-ingest.ts`), ปุ่ม recompute. การ recompute+เขียนซ้ำทุกครั้งที่เปิดหน้าจึง **ซ้ำซ้อน** และเป็น write-on-GET (เสี่ยง race บนแถว (orgId,branchId) เดียวกันเมื่อเปิดพร้อมกัน). อ่าน cache แทน → ตัวเลขเท่าเดิม (status + lastCollectionAt มาจากแถว cache), ไม่มี write, ตัด race.
- **D ปลอดภัย:** แต่ละสาขาเขียนแถวตัวเอง (distinct branchId) → ไม่มี write-write race ภายใน 1 call. bounded ที่ 5 เคารพ pooler :6543 (ไม่ระเบิด fan-out). พฤติกรรม/เลขเท่าเดิม เปลี่ยนแค่ลำดับการรัน (ผลคงลำดับสาขา).
- Cold cache: `readDriftSnapshot` fallback → recompute 1 ครั้งเมื่อยังไม่เคยคำนวณ (สาขาใหม่ไม่ว่าง).

## §4 · Deferred — scale-only (26 ข้อ · ยังไม่แก้ · รู้สึกเมื่อโต 50–100×)

จริงทุกข้อแต่ที่ ~30 สาขา/ร้อยแถว ไม่มีใครรู้สึก (V8 รันใน sub-ms / 1 indexed round-trip):
- **CashHub:** O(N²) loop ใน `compare/page.tsx` + `aggregator.ts` (dailyTotals, duplicate last30 pass), sequential users query ใน `heatmap/page.tsx`, ai-chat ซ้ำซ้อนใน dashboard-view, loadReports `.limit(5000)` ไม่มี warning, heatmap grid ไม่ virtualize.
- **ChairOps:** `getDashboardRows` `include:{branch:true}` over-fetch (อ่าน 5 field), persistDrift 2-step upsert, exec-home KPI waterfall (2 serial await), getDashboardRows ถูกเรียกซ้ำ 4× ต่อ render (uncached), reconcile-v2 buildLedger 365-day fetch ×2, missing width/height บาง `<img>` (CLS), 28 ไฟล์ router.refresh (มี useTransition+spinner อยู่แล้ว → ไม่ขาว).
> หมายเหตุ: router.refresh บน mutation การเงิน **ไม่ควร** เปลี่ยนเป็น optimistic UI (เสี่ยงโชว์ success ก่อนจริง) — verify เห็นพ้อง.

## §5 · Regression pass (slow-pattern-library)
- S-001 (loading.tsx) — เคยเจอ → รอบนี้เจอซ้ำ → แก้ครบ ✅
- S-003/S-010/S-011 (over-fetch / per-row aggregate) — เจอแต่ verify ตัดเป็น scale-only ที่ scale ปัจจุบัน ✅
- S-006 (router.refresh) — เจอแต่ wrap useTransition แล้ว → ไม่ felt ✅
- S-009 (pooler/cold-start) — ตรวจ `lib/prisma.ts`: globalThis singleton + pg.Pool ผ่าน pooler → OK ✅
- NEW: S-014 write-on-GET-render-path · S-015 unbounded/sequential recompute → bounded · S-016 oversized-raw-png (ดู slow-pattern-library)

## §6 · Round-2 (ถ้าต้องการ "สุดขีด")
- Suspense streaming หน้า exec/(office) ที่มีหลาย region (ตอนนี้ loading.tsx ครอบแล้ว = พอสำหรับ felt)
- coalesce `getDashboardRows` (เรียก 4× → React `cache()` 1×) — clean-up, ไม่ felt วันนี้
- next/image กับ slip/gallery ที่เป็น R2 (ต้องตั้ง `images.remotePatterns` ก่อน)
