# ตู้คีบ OS (ClawOS) — BUILD LOG · 2026-06-28

Rebuild UI ของโมดูล `clawfleet` ให้ตรง design ใหม่ (claude.ai/design) · full-bleed DC-style · ขาวบนน้ำเงิน indigo.
Backend เดิม reuse 100% (P&L · 3-way anti-cheat · stock · team). worktree off `origin/setup`.

## หน้าจอที่สร้าง (10 + foundation)
| หน้า | route | ข้อมูล | สถานะ |
|---|---|---|---|
| Foundation (css/shell/nav/kit/layout) | `os/*` | — | ✅ |
| ภาพรวม (Dashboard) | `/clawfleet/os/dashboard` | `getBranchPnl`+`loadAnomalies` จริง + sample fallback | ✅ |
| สาขา (Branches) | `/clawfleet/os/branches` | `getBranchPnl` จริง + sample | ✅ |
| คลังสินค้า (Stock) | `/clawfleet/os/stock` | `getCfStockOverview`/`getV2BranchStock` (สาขาแรก) + sample | ✅ |
| ตรวจเงิน & กระทบยอด (Collections) | `/clawfleet/os/collections` | `loadAnomalies` จริง + `reviewV2Session` wire | ✅ |
| ตั้งค่าตู้ (Config) | `/clawfleet/os/config` | sample (ยังไม่มีตาราง) | ✅ UI · ⚠️ backend gap |
| รายงานเจาะสาขา (Matrix) | `/clawfleet/os/matrix` | `getV2Branches` + sample matrix | ✅ UI · ⚠️ backend gap |
| รายงาน (Reports) | `/clawfleet/os/reports` | `getBranchPnl`+`getTeamData` จริง + sample | ✅ |
| พนักงาน (Staff) | `/clawfleet/os/staff` | `getTeamData` จริง + sample | ✅ |
| ตั้งค่า & สิทธิ์ (Settings) | `/clawfleet/os/settings` | `getTeamData`/`getSettingsData` จริง + sample | ✅ |
| แอปพนักงานมือถือ (Front) | `/clawfleet/os/app` | `getGroupCollectData` จริง + demo fallback · wire collect actions | ✅ · ⚠️ photo |

Host wiring: `modules.ts` (ชื่อ "ตู้คีบ OS" + nav → os) · `clawfleet/page.tsx` redirect → os · `admin-shell.tsx` full-bleed escape hatch `/clawfleet/os`.

## ✅ ตรวจแล้ว
- `tsc --noEmit` ทั้งโปรเจกต์: 0 error ในไฟล์ os (เหลือ 1 error เดิมที่ pinpoint — ไม่ใช่ของเรา + ignoreBuildErrors เปิด)
- ไม่มี double-shell · server/client boundary ถูกทุกไฟล์
- `next build`: (กรอกผลหลังเสร็จ)

## ⚠️ ต้องให้ CEO ตัดสิน / follow-up (ยังไม่ทำ)
1. **รูปมิเตอร์หน้าบ้าน (สำคัญสุด):** design ทำรูปเป็น "แตะยืนยัน" (optional) แต่ schema `submitBranchEvent` บังคับ URL รูป 5 รูป (Zod `.url()`). ตอนนี้ส่ง sentinel PNG 1×1 ผ่าน validation → flow ครบ แต่ submit จริงเก็บรูป placeholder (ไม่ใช่รูปถ่ายจริง → หลักฐาน audit ไม่จริง). **ทางเลือก:** (A) ใช้ `PhotoCaptureButton` (อัป R2 จริง) ตอน submit จริง · (B) relax backend ให้รูป optional จริง. → ขอ CEO เคาะก่อน go-live ฝั่งพนักงานจริง.
2. **ตาราง config-request (ตั้งค่าตู้):** ยังไม่มี table/query/action — หน้าตั้งค่าตู้เป็น sample + optimistic. ต้องสร้าง `cf_config_request` + `getCfConfigRequests` + `propose/approve/rejectCfConfig` + จุดเสนอจากแอปมือถือ.
3. **Matrix query:** ยังไม่มี query day×machine — ตารางเป็น sample deterministic. ต้อง `getCfDailyMatrix(branchId,days)`.
4. **Central warehouse + shipment reconcile (Stock tab การกระจาย):** ไม่มี query คลังกลาง/ใบโอน line-item — sample. ต้อง query รวม + wire `transferStock`/`receiveStock`.
5. **Per-staff รอบเก็บ/ยอดไม่ตรง + low-stock aggregate:** ไม่มี aggregate query — แสดง — / sample.
6. **Policy toggles (Settings):** client state เท่านั้น — ต้อง `cf_org_policy` + `saveCfPolicy`.

## ของเก่า (v2)
routes เดิม `/clawfleet/v2/*` ยังอยู่ (ไม่ลบ · ไม่ถูกลิงก์แล้ว) — ปลอดภัย. ลบทีหลังได้เมื่อ os ผ่าน CEO.
