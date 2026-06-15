"use client";

// ตัวเลือก "กำลังตั้งค่าสำหรับสาขาไหน" (shared ทุกโมดูล CashHub settings)
// "" = ค่าเริ่มต้นทุกสาขา (org default) · ระบุสาขา = ตั้งค่าเฉพาะสาขานั้น (ทับค่าเริ่มต้น)
// navigate ?branch=<code> (preserve param อื่น เช่น previewDate)
import { useRouter, useSearchParams, usePathname } from "next/navigation";

export function SettingsBranchPicker({
  branches,
  activeBranch,
  hasOwnConfig,
}: {
  branches: { code: string; label: string }[];
  activeBranch: string;
  hasOwnConfig: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const pathname = usePathname();
  const nav = (branch: string) => {
    const p = new URLSearchParams(sp.toString());
    if (branch) p.set("branch", branch);
    else p.delete("branch");
    router.push(`${pathname}?${p.toString()}`);
  };

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 mb-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-sm font-semibold text-indigo-900">กำลังตั้งค่าสำหรับ:</span>
        <select
          value={activeBranch}
          onChange={(e) => nav(e.target.value)}
          aria-label="เลือกสาขาที่จะตั้งค่า"
          className="h-10 rounded-xl border border-indigo-200 bg-white px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
        >
          <option value="">⭐ ค่าเริ่มต้น (ทุกสาขา)</option>
          {branches.map((b) => (
            <option key={b.code} value={b.code}>
              {b.label}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-2 text-xs text-indigo-700/80">
        {activeBranch === "" ? (
          <>
            ค่าที่ตั้งตรงนี้ใช้กับ <b>ทุกสาขา</b> ที่ยังไม่ได้ตั้งค่าเอง · ถ้าบางสาขาเข้าบัญชีคนละบัญชี
            เลือกสาขานั้นด้านบนแล้วตั้งทับเฉพาะสาขาได้
          </>
        ) : hasOwnConfig ? (
          <>
            สาขานี้ <b className="text-emerald-700">ตั้งค่าเอง</b> (ไม่อิงค่าเริ่มต้น) ·
            แก้แล้วกดบันทึกจะมีผลเฉพาะสาขานี้
          </>
        ) : (
          <>
            สาขานี้ยัง <b>อิงค่าเริ่มต้น</b> อยู่ · แก้แล้วกดบันทึก = สร้างค่าเฉพาะสาขานี้ (สาขาอื่นไม่กระทบ)
          </>
        )}
      </p>
    </div>
  );
}
