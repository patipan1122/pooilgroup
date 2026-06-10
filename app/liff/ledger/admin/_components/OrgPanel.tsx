"use client";

// องค์กร tab — edit the company's tax-document info (ชื่อ · Tax ID · ที่อยู่ · โทร).
// These appear on tax documents, so accuracy matters. GAP 5. updateLedgerOrgInfo.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, Check } from "lucide-react";
import { updateLedgerOrgInfo } from "@/app/(admin)/ledger/_actions";

export type OrgInfo = {
  id: string;
  name: string;
  taxId: string | null;
  address: string | null;
  phone: string | null;
};

const inputCls =
  "h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base outline-none focus:border-[var(--color-brand-400)] focus:ring-2 focus:ring-[var(--color-brand-200)]";

export function OrgPanel({ company }: { company: OrgInfo }) {
  const [name, setName] = useState(company.name);
  const [taxId, setTaxId] = useState(company.taxId ?? "");
  const [address, setAddress] = useState(company.address ?? "");
  const [phone, setPhone] = useState(company.phone ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();

  function save() {
    setMsg(null);
    if (!name.trim()) { setMsg({ kind: "err", text: "ใส่ชื่อบริษัท" }); return; }
    start(async () => {
      const res = await updateLedgerOrgInfo({ companyId: company.id, name, taxId, address, phone });
      if (res.ok) {
        setMsg({ kind: "ok", text: "บันทึกแล้ว ✓" });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error ?? "บันทึกไม่สำเร็จ" });
      }
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-100 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <Building2 className="size-4 text-[var(--color-brand-600,#2563EB)]" aria-hidden />
        <h3 className="text-sm font-bold text-zinc-800">ข้อมูลบริษัท</h3>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">ใช้แสดงบนหัวเอกสารภาษี กรอกให้ครบและถูกต้อง</p>

      <div className="space-y-2.5">
        <Field label="ชื่อบริษัท">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น เจพีซิ้งค์ กรุ๊ป จำกัด" />
        </Field>
        <Field label="เลขประจำตัวผู้เสียภาษี (Tax ID)">
          <input className={inputCls} value={taxId} onChange={(e) => setTaxId(e.target.value)} inputMode="numeric" placeholder="13 หลัก" />
        </Field>
        <Field label="ที่อยู่">
          <textarea className={inputCls + " h-20 py-2"} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ที่อยู่ตามหนังสือรับรอง" />
        </Field>
        <Field label="โทรศัพท์">
          <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="เบอร์ติดต่อ" />
        </Field>
      </div>

      {msg && (
        <p className={"mt-2 text-xs font-medium " + (msg.kind === "ok" ? "text-emerald-700" : "text-red-600")} role="status" aria-live="polite">
          {msg.text}
        </p>
      )}
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="press mt-3 inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--color-brand-600,#2563EB)] px-3 text-sm font-semibold text-white active:bg-[var(--color-brand-700)] disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
        บันทึกข้อมูลบริษัท
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-zinc-600">{label}</label>
      {children}
    </div>
  );
}
