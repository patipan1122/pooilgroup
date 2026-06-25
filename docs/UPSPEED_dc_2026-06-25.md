# UpSpeed · DC Warehouse (คลังกลาง) · 2026-06-25

> /upspeed · Full mode · 2 profile lens (perceived-speed + DB/query) · mobile+desktop.
> ผลลัพธ์: +9 loading skeleton (felt-win อันดับ 1) · query = เขียนดีอยู่แล้ว (ไม่มี N+1) · scale-only deferred.

## §summary (Thai)
- **กดแล้วเด้งทันที**: เดิม 29 หน้า DC มี loading.tsx = 0 → ทุกครั้งที่กดเข้าหน้า = จอขาวรอ. เพิ่ม skeleton 9 ไฟล์ (โครงเทา shimmer) → กดปุ๊บเห็นโครงหน้าปั๊บ รู้สึกเร็วขึ้นมาก (perceived speed).
- **ไส้ในเร็วอยู่แล้ว**: profile query ทุกหน้า list + dashboard + actions = ไม่เจอ N+1, ใช้ select แคบ, Promise.all, batched id-in+Map, index ครอบ hot query → ไม่มี fix ปลอดภัยที่ "รู้สึกได้" ตอนนี้ (data ยังน้อย). บังคับแก้ = เสี่ยงเปล่า.
- **เลื่อนไว้ตอน data โต**: pagination หน้า list (ตอนใกล้ ~500 แถว) + index เพิ่มบางตัว — ทำเป็น migration ตอนนั้น (ไม่ใช่ตอนนี้).

## §baseline-vs-after
| ตัวชี้วัด | ก่อน | หลัง |
|---|---|---|
| loading.tsx ใน DC (skeleton) | 0 / 29 หน้า | 9 ไฟล์ครอบทุกหน้า (route-group inheritance) |
| กดเข้าหน้า | จอขาวรอจน server ตอบ | เห็นโครงหน้าทันที <100ms |
| N+1 ใน list pages | — | ไม่พบ (verified) |
| over-fetch (select เกิน) | — | ไม่พบ (ทุก loader select แคบ) |
| index coverage (dc hot query) | ครบเกือบหมด | ครบ (มี gap scale-only 2 ตัว defer) |

> หมายเหตุ: skeleton เป็น "felt" win วัดด้วย curl ไม่ได้ — CEO ต้องกดเองถึงรู้สึก.

## §fixed
- เพิ่ม `@keyframes dc-shimmer` + `.dc-skel*` ใน dc.css (เคารพ prefers-reduced-motion → ปิด animation)
- 9 loading.tsx (server component · aria-busy):
  - `dc/loading.tsx` (floor home · 8 tile skel · ครอบ floor leaves: move/search/labels)
  - `dc/office/loading.tsx` (hub · 8 card skel · ครอบ office subpages ทั้งหมด)
  - `dc/office/purchasing/loading.tsx` (list · chip + 6 row skel)
  - `dc/{receive-po,receive,issue,transfer,count}/loading.tsx` (floor task)
- `components/dc/floor-task-skeleton.tsx` — shared shape สำหรับ 5 floor task

## §deferred (next-round · ต้อง CEO/migration)
- **Pagination หน้า list** (products/purchasing/shipments/receipts/transfers/suppliers ยังดึงทุกแถว) — จงใจไม่ใส่ `take` เพราะจะตัดแถวเงียบ = ซ่อนข้อมูล. ทำ pagination จริงตอนข้อมูลใกล้ ~500 แถว (S-M effort). reports มี take:80 · reconcile slice 100+ป้ายแล้ว.
- **getDcOverview/getLowStock/getStockByWarehouse** filter/aggregate ใน JS — แปลงเป็น groupBy/aggregate ได้บางส่วน แต่ est-value ต้อง join landed-map + low-stock เทียบ column-vs-column (Prisma where ตรงไม่ได้) → เสี่ยงผิดบนข้อมูลเงิน/สต๊อก · effort M · defer.

## §scale-only (index gaps · REPORT ONLY · ต้อง migration ตอน data โต)
- `DcStockBalance` → `@@index([orgId, qtyOnHand])` (reconcile/reports filter onHand>0) · ผลต่ำ
- `DcCostLayer` → `@@index([orgId, productId, createdAt desc])` (landed map order) · ผลต่ำ-กลาง
> ห้ามแก้ schema ตอนนี้ — เสนอ CEO เป็น migration เมื่อ data โต

## §regression-pass
- write-path (recordMovement/createCostLayer ทีละบรรทัด) = **ต้อง sequential** เพื่อ atomicity+idempotency · ห้าม parallelize (race บน balance row) ✅ ยืนยันไม่แตะ
- ไม่ cache stock/money data (ต้อง live) ✅
- serverless ใช้ transaction pooler ✅ (config เดิม)
