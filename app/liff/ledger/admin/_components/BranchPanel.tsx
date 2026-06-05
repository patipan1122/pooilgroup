"use client";

// สาขา tab — list / add / edit branches (GAP 5). Branch is a SHARED Pool entity
// (chairops/clawfleet/fuel use it), so the panel warns that edits affect every
// module. Add via an inline form; edit name/active via a bottom sheet.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Plus, Loader2, AlertTriangle, Check, X } from "lucide-react";
import {
  createLedgerBranch,
  updateLedgerBranch,
} from "@/app/(admin)/ledger/_actions";

export type BranchFull = {
  id: string;
  code: string;
  name: string;
  province: string | null;
  isActive: boolean;
};

const inputCls =
  "h-10 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]";

// Branch is shared across modules → it needs a business type. Thai labels.
const BUSINESS_TYPES: { value: string; label: string }[] = [
  { value: "massage_chair", label: "เก้าอี้นวด" },
  { value: "claw_machine", label: "ตู้คีบ" },
  { value: "fuel_station", label: "ปั๊มน้ำมัน" },
  { value: "lpg_station", label: "ปั๊มแก๊ส (เติมรถ)" },
  { value: "lpg_retail", label: "ร้านค้าแก๊ส (ขายถัง)" },
  { value: "bottling_plant", label: "โรงบรรจุก๊าซ" },
  { value: "hotel", label: "โรงแรม" },
  { value: "convenience_store", label: "ร้านสะดวกซื้อ" },
  { value: "ev_station", label: "EV Station" },
  { value: "cafe", label: "คาเฟ่ (Amazon)" },
  { value: "cafe_punthai", label: "กาแฟพันธุ์ไทย" },
  { value: "training_center", label: "ศูนย์ฝึกอบรม" },
  { value: "transport", label: "ขนส่ง" },
  { value: "gas_fleet", label: "รถแก๊ส" },
];

export function BranchPanel({
  companyId,
  branches,
}: {
  companyId: string;
  branches: BranchFull[];
}) {
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [province, setProvince] = useState("");
  const [businessType, setBusinessType] = useState("massage_chair");
  const [edit, setEdit] = useState<BranchFull | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const router = useRouter();

  function create() {
    setErr(null);
    setOkMsg(null);
    if (!code.trim() || !name.trim()) {
      setErr("ใส่รหัสและชื่อสาขา");
      return;
    }
    start(async () => {
      const res = await createLedgerBranch({ companyId, code, name, province, businessType });
      if (!res.ok) { setErr(res.error ?? "เพิ่มไม่สำเร็จ"); return; }
      setCode(""); setName(""); setProvince(""); setAdding(false);
      setOkMsg(`เพิ่มสาขา "${name}" แล้ว ✓`);
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-100 bg-white p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-[var(--color-brand-600,#2563EB)]" aria-hidden />
          <h3 className="text-sm font-bold text-zinc-800">สาขา ({branches.length})</h3>
        </div>
        <button
          type="button"
          onClick={() => { setAdding((v) => !v); setErr(null); }}
          className="inline-flex items-center gap-1 rounded-lg bg-[var(--color-brand-600,#2563EB)] px-2.5 py-1.5 text-xs font-semibold text-white"
        >
          <Plus className="size-3.5" aria-hidden /> เพิ่มสาขา
        </button>
      </div>

      <div className="mb-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        สาขาใช้ร่วมกับทุกระบบ (เก้าอี้นวด/ตู้คีบ/น้ำมัน) — เพิ่ม/แก้ที่นี่กระทบทุกที่
      </div>

      {okMsg && (
        <p className="mb-3 text-xs font-medium text-emerald-700" role="status" aria-live="polite">{okMsg}</p>
      )}

      {adding && (
        <div className="mb-3 space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
          <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="รหัสสาขา เช่น CPV01" />
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อสาขา เช่น ชุมพวง" />
          <input className={inputCls} value={province} onChange={(e) => setProvince(e.target.value)} placeholder="จังหวัด (ไม่บังคับ)" />
          <select className={inputCls} value={businessType} onChange={(e) => setBusinessType(e.target.value)} aria-label="ประเภทธุรกิจ">
            {BUSINESS_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={create}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-600,#2563EB)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            บันทึกสาขา
          </button>
          {err && <p className="text-xs text-rose-600">{err}</p>}
        </div>
      )}

      {branches.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-xs text-zinc-500">
          ยังไม่มีสาขา — กด “เพิ่มสาขา” เพื่อสร้างสาขาแรก
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {branches.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => { setEdit(b); setErr(null); }}
                className="flex w-full items-center justify-between gap-2 py-2.5 text-left"
              >
                <span className="min-w-0">
                  <span className="text-sm font-medium text-zinc-800">{b.name}</span>
                  <span className="ml-1.5 text-xs text-zinc-400">{b.code}{b.province ? ` · ${b.province}` : ""}</span>
                </span>
                {!b.isActive && <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">ปิดอยู่</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {edit && (
        <BranchEditSheet
          branch={edit}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

function BranchEditSheet({
  branch,
  onClose,
}: {
  branch: BranchFull;
  onClose: () => void;
}) {
  const [name, setName] = useState(branch.name);
  const [province, setProvince] = useState(branch.province ?? "");
  const [isActive, setIsActive] = useState(branch.isActive);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  function save() {
    setErr(null);
    start(async () => {
      const res = await updateLedgerBranch(branch.id, { name, province, isActive });
      if (!res.ok) { setErr(res.error ?? "บันทึกไม่สำเร็จ"); return; }
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/30" onClick={onClose}>
      <div
        className="w-full rounded-t-2xl bg-white p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-bold text-zinc-800">แก้ไขสาขา · {branch.code}</h4>
          <button onClick={onClose} aria-label="ปิด" className="grid size-8 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-50">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="space-y-2">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อสาขา" />
          <input className={inputCls} value={province} onChange={(e) => setProvince(e.target.value)} placeholder="จังหวัด" />
          <label className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2.5 text-sm">
            <span className="text-zinc-700">เปิดใช้งานสาขานี้</span>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-5 accent-emerald-500" />
          </label>
        </div>
        {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--color-brand-600,#2563EB)] px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
          บันทึก
        </button>
      </div>
    </div>
  );
}
