"use client";

// สิทธิ์ tab — RentSpace role-capability toggles (super_admin เท่านั้นแก้ได้).
// Mirror ของ app/liff/ledger/admin/_components/PermissionPanel.tsx — เพิ่มโดย
// /bigsolvebug 2026-09-20 (audit doc §8 decision 5, CEO request: "หน้าตั้งค่าสิทธิ์
// สำหรับ super_admin ว่าใครมีสิทธิ์ยังไง แบบติ๊ก").
//
// เลือกตำแหน่ง (chip) → เห็น 5 สิทธิ์เป็นสวิตช์ปิด/เปิด. ตำแหน่ง super_admin ล็อกเปิด
// เสมอ (กันล็อกตัวเองออกจากหน้าตั้งค่า). Default ทุกอันตรงกับพฤติกรรมเดิมของระบบ —
// หน้านี้แค่ทำให้เห็น+ปรับได้ ไม่เปลี่ยนอะไรเองจนกว่า super_admin จะกดสวิตช์.

import { useState, useTransition } from "react";
import { Loader2, ShieldCheck, Lock, Check } from "lucide-react";
import { setRentspacePermission } from "../../_actions";
import {
  RENTSPACE_ROLES,
  RENTSPACE_CAPABILITIES,
  ROLE_LABEL,
  ROLE_HINT,
  CAPABILITY_LABEL,
  type RentspaceRole,
  type RentspaceCapability,
} from "@/lib/rentspace/permission-constants";

const ROLE_LABEL_SHORT: Record<RentspaceRole, string> = {
  staff: "พนักงาน",
  branch_manager: "ผจก.สาขา",
  program_admin: "แอดมินโปรแกรม",
  admin: "ผู้ดูแล",
  super_admin: "ซูเปอร์แอดมิน",
};

export function PermissionSection({
  matrix,
}: {
  matrix: Record<RentspaceRole, Record<RentspaceCapability, boolean>>;
}) {
  const [role, setRole] = useState<RentspaceRole>("staff");
  const [state, setState] = useState(matrix);
  const [pending, start] = useTransition();
  const [busyCap, setBusyCap] = useState<RentspaceCapability | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const locked = role === "super_admin"; // ซูเปอร์แอดมินเปิดทุกอย่างเสมอ กันล็อกตัวเองออก

  function toggle(cap: RentspaceCapability) {
    if (locked) return;
    const next = !state[role][cap];
    setErr(null);
    setBusyCap(cap);
    setState((s) => ({ ...s, [role]: { ...s[role], [cap]: next } }));
    start(async () => {
      try {
        await setRentspacePermission(role, cap, next);
      } catch (e) {
        setState((s) => ({ ...s, [role]: { ...s[role], [cap]: !next } }));
        setErr(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
      setBusyCap(null);
    });
  }

  return (
    <section className="rs-scope mt-6 rounded-2xl border border-zinc-100 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck className="size-4" style={{ color: "var(--rs-brand, #2563EB)" }} aria-hidden />
        <h3 className="text-sm font-bold text-zinc-800">สิทธิ์การใช้งาน (RentSpace)</h3>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        เลือกตำแหน่ง แล้วเปิด-ปิดว่าทำอะไรได้บ้าง — ค่าเริ่มต้นตรงกับระบบเดิมทุกอย่าง
        ปรับที่นี่เมื่อพร้อมให้ตำแหน่งนั้นทำมากขึ้น/น้อยลง
      </p>

      <div className="mb-4">
        <p className="mb-1.5 text-xs font-semibold text-zinc-700">ภาพรวม — ใครทำอะไรได้บ้าง</p>
        <div className="overflow-x-auto rounded-xl border border-zinc-100">
          <table className="w-full min-w-[520px] border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-50">
                <th className="sticky left-0 z-10 border-b border-zinc-100 bg-zinc-50 px-3 py-2 text-left font-semibold text-zinc-500">
                  สิทธิ์
                </th>
                {RENTSPACE_ROLES.map((r) => (
                  <th key={r} className="border-b border-l border-zinc-100 px-2 py-2 text-center font-semibold text-zinc-600">
                    <span className="inline-flex items-center justify-center gap-1">
                      {ROLE_LABEL_SHORT[r]}
                      {r === "super_admin" && <Lock className="size-3 text-zinc-400" aria-hidden />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RENTSPACE_CAPABILITIES.map((cap) => (
                <tr key={cap} className="odd:bg-white even:bg-zinc-50/40">
                  <th scope="row" className="sticky left-0 z-10 border-b border-zinc-100 bg-inherit px-3 py-2 text-left font-medium text-zinc-700">
                    {CAPABILITY_LABEL[cap].title}
                  </th>
                  {RENTSPACE_ROLES.map((r) => {
                    const on = r === "super_admin" ? true : state[r][cap];
                    return (
                      <td key={r} className="border-b border-l border-zinc-100 px-2 py-2 text-center align-middle">
                        {on ? (
                          <Check className="mx-auto size-4 text-emerald-600" aria-label="ทำได้" />
                        ) : (
                          <span className="text-zinc-300" aria-label="ทำไม่ได้">
                            —
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-400">ปรับสิทธิ์ได้ที่ด้านล่าง — เลือกตำแหน่งแล้วเปิด-ปิดทีละข้อ</p>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {RENTSPACE_ROLES.map((r) => {
          const on = r === role;
          return (
            <button
              key={r}
              type="button"
              onClick={() => {
                setRole(r);
                setErr(null);
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
                on ? "bg-blue-600 text-white ring-transparent" : "bg-white text-zinc-600 ring-zinc-200"
              }`}
            >
              {ROLE_LABEL[r]}
            </button>
          );
        })}
      </div>
      <p className="mb-3 text-xs text-zinc-500">{ROLE_HINT[role]}</p>

      {locked && (
        <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
          <Lock className="size-3.5" aria-hidden />
          ซูเปอร์แอดมินมีสิทธิ์ทุกอย่างเสมอ (ปิดไม่ได้ กันล็อกตัวเองออก)
        </div>
      )}

      <ul className="divide-y divide-zinc-100">
        {RENTSPACE_CAPABILITIES.map((cap) => {
          const on = state[role][cap];
          const label = CAPABILITY_LABEL[cap];
          const busy = pending && busyCap === cap;
          return (
            <li key={cap} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-800">{label.title}</p>
                <p className="text-xs text-zinc-500">{label.desc}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={label.title}
                disabled={locked || busy}
                onClick={() => toggle(cap)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  on ? "bg-emerald-500" : "bg-zinc-300"
                } ${locked ? "opacity-50" : ""}`}
              >
                {busy ? (
                  <Loader2 className="absolute left-1/2 size-3.5 -translate-x-1/2 animate-spin text-white" aria-hidden />
                ) : (
                  <span
                    className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
                      on ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
    </section>
  );
}
