"use client";

// สิทธิ์ tab — money-capability toggles per role (Bainy-style). GAP 5.
//
// Pick a role (chip) → see the 5 money-risk capabilities as labelled switches.
// Toggling calls setLedgerPermission (admin-tier, server-verified). The ผู้ดูแล
// (admin) role is locked ON (can't lock yourself out). Copy is sentence-form so a
// non-technical owner understands exactly what each switch grants.

import { useState, useTransition } from "react";
import { Loader2, ShieldCheck, Lock, Check } from "lucide-react";
import { setLedgerPermission } from "@/app/(admin)/ledger/_actions";
import {
  LEDGER_ROLES,
  LEDGER_CAPABILITIES,
  ROLE_LABEL,
  ROLE_HINT,
  CAPABILITY_LABEL,
  type LedgerRole,
  type LedgerCapability,
} from "@/lib/ledger/permission-constants";

// คอลัมน์ในตารางสรุปแคบ → ใช้ชื่อตำแหน่งแบบสั้น (ชื่อเต็มยาวเกินสำหรับหัวตาราง)
const ROLE_LABEL_SHORT: Record<LedgerRole, string> = {
  staff: "พนักงาน",
  accountant: "บัญชี",
  admin: "ผู้ดูแล",
  external_accountant: "บัญชีภายนอก",
};

export function PermissionPanel({
  matrix,
}: {
  matrix: Record<LedgerRole, Record<LedgerCapability, boolean>>;
}) {
  const [role, setRole] = useState<LedgerRole>("staff");
  const [state, setState] = useState(matrix);
  const [pending, start] = useTransition();
  const [busyCap, setBusyCap] = useState<LedgerCapability | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const locked = role === "admin"; // ผู้ดูแลเปิดทุกอย่างเสมอ

  function toggle(cap: LedgerCapability) {
    if (locked) return;
    const next = !state[role][cap];
    setErr(null);
    setBusyCap(cap);
    // optimistic
    setState((s) => ({ ...s, [role]: { ...s[role], [cap]: next } }));
    start(async () => {
      const res = await setLedgerPermission(role, cap, next);
      if (!res.ok) {
        // revert
        setState((s) => ({ ...s, [role]: { ...s[role], [cap]: !next } }));
        setErr(res.error ?? "บันทึกไม่สำเร็จ");
      }
      setBusyCap(null);
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-100 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck className="size-4 text-[var(--color-brand-600,#2563EB)]" aria-hidden />
        <h3 className="text-sm font-bold text-zinc-800">สิทธิ์การใช้งาน</h3>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        เลือกตำแหน่ง แล้วเปิด-ปิดว่าทำอะไรได้บ้าง (เฉพาะเรื่องเงิน · อย่างอื่นทุกคนทำได้)
      </p>

      {/* สรุปภาพรวม (อ่านอย่างเดียว) — ใครทำอะไรได้บ้าง ดูครบในตารางเดียว
          แถว = สิทธิ์ · คอลัมน์ = ตำแหน่ง · เลื่อนแนวนอนได้บนมือถือ (คอลัมน์ชื่อสิทธิ์ค้างซ้าย) */}
      <div className="mb-4">
        <p className="mb-1.5 text-xs font-semibold text-zinc-700">ภาพรวม — ใครทำอะไรได้บ้าง</p>
        <div className="overflow-x-auto rounded-xl border border-zinc-100">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-50">
                <th className="sticky left-0 z-10 border-b border-zinc-100 bg-zinc-50 px-3 py-2 text-left font-semibold text-zinc-500">
                  สิทธิ์
                </th>
                {LEDGER_ROLES.map((r) => (
                  <th
                    key={r}
                    className="border-b border-l border-zinc-100 px-2 py-2 text-center font-semibold text-zinc-600"
                  >
                    <span className="inline-flex items-center justify-center gap-1">
                      {ROLE_LABEL_SHORT[r]}
                      {r === "admin" && <Lock className="size-3 text-zinc-400" aria-hidden />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LEDGER_CAPABILITIES.map((cap) => (
                <tr key={cap} className="odd:bg-white even:bg-zinc-50/40">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-zinc-100 bg-inherit px-3 py-2 text-left font-medium text-zinc-700"
                  >
                    {CAPABILITY_LABEL[cap].title}
                  </th>
                  {LEDGER_ROLES.map((r) => {
                    // ผู้ดูแลเปิดทุกอย่างเสมอ (สอดคล้องกับตัวแก้ด้านล่างที่ล็อก ON)
                    const on = r === "admin" ? true : state[r][cap];
                    return (
                      <td
                        key={r}
                        className="border-b border-l border-zinc-100 px-2 py-2 text-center align-middle"
                      >
                        {on ? (
                          <Check
                            className="mx-auto size-4 text-emerald-600"
                            aria-label="ทำได้"
                          />
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
        <p className="mt-1.5 text-[11px] text-zinc-400">
          ปรับสิทธิ์ได้ที่ด้านล่าง — เลือกตำแหน่งแล้วเปิด-ปิดทีละข้อ
        </p>
      </div>

      {/* Role chips */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {LEDGER_ROLES.map((r) => {
          const on = r === role;
          return (
            <button
              key={r}
              type="button"
              onClick={() => { setRole(r); setErr(null); }}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
                on
                  ? "bg-[var(--color-brand-600,#2563EB)] text-white ring-transparent"
                  : "bg-white text-zinc-600 ring-zinc-200"
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
          ผู้ดูแลมีสิทธิ์ทุกอย่างเสมอ (ปิดไม่ได้ กันล็อกตัวเองออก)
        </div>
      )}

      {/* Capability switches */}
      <ul className="divide-y divide-zinc-100">
        {LEDGER_CAPABILITIES.map((cap) => {
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
    </div>
  );
}
