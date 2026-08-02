"use client";

// Office-side maid contract editor (F4b · CEO 2026-08-02).
// The office fills the maid's contract → saves DRAFT → the maid signs online in
// the LIFF app. A SIGNED contract is read-only here (view/print + VOID to redo).

import { useActionState } from "react";
import Link from "next/link";
import { CheckCircle2, FileSignature, Printer, Loader2 } from "lucide-react";

import { IdCardUpload } from "@/components/chairops/id-card-upload";
import { adminSaveMaidContract, adminVoidMaidContract } from "../contract-actions";

export interface OfficeContractPrefill {
  maidName: string;
  nickname: string;
  idCardNumber: string;
  address: string;
  phone: string;
  monthlyWage: string;
  payDayOfMonth: string;
  salaryBankName: string;
  salaryAccountNo: string;
  salaryAccountName: string;
  startDate: string;
  endDate: string;
  idCardImageUrl: string;
  idCardFileName: string;
}

export function OfficeContractEditor({
  maidId,
  status,
  signedAtLabel,
  prefill,
  companyLine,
}: {
  maidId: string;
  status: "none" | "draft" | "signed";
  signedAtLabel: string | null;
  prefill: OfficeContractPrefill;
  companyLine: string | null;
}) {
  const viewHref = `/chairops/maids/${maidId}/contract`;

  if (status === "signed") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          <CheckCircle2 className="size-4 text-emerald-600" />
          <span className="font-medium text-emerald-800">
            แม่บ้านเซ็นสัญญาแล้ว{signedAtLabel ? ` · ${signedAtLabel}` : ""}
          </span>
          <Link
            href={viewHref}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            <Printer className="size-3.5" /> เปิดดู / พิมพ์สัญญา
          </Link>
        </div>
        <VoidForm maidId={maidId} label="ยกเลิกสัญญา (เพื่อทำใหม่)" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <FileSignature className="size-4 text-zinc-400" />
        {status === "draft"
          ? "มีร่างสัญญาแล้ว · ยังไม่เซ็น — แก้ไขได้ แล้วให้แม่บ้านเปิดแอปเซ็น"
          : "กรอกข้อมูลแล้วบันทึกร่าง — แม่บ้านจะเปิดแอปตรวจและเซ็นออนไลน์เอง"}
        {status !== "none" && (
          <Link href={viewHref} className="ml-auto font-medium text-blue-600 hover:underline">
            ดูตัวอย่าง / พิมพ์
          </Link>
        )}
      </div>

      <SaveForm maidId={maidId} prefill={prefill} companyLine={companyLine} />

      {status === "draft" && <VoidForm maidId={maidId} label="ลบร่างสัญญานี้" />}
    </div>
  );
}

function SaveForm({
  maidId,
  prefill,
  companyLine,
}: {
  maidId: string;
  prefill: OfficeContractPrefill;
  companyLine: string | null;
}) {
  const [state, formAction, pending] = useActionState(adminSaveMaidContract, null);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="maidId" value={maidId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ชื่อ-นามสกุล" name="maidName" defaultValue={prefill.maidName} required />
        <Field label="ชื่อเล่น" name="nickname" defaultValue={prefill.nickname} />
        <Field label="เลขบัตรประชาชน" name="idCardNumber" defaultValue={prefill.idCardNumber} inputMode="numeric" />
        <Field label="เบอร์โทร" name="phone" defaultValue={prefill.phone} inputMode="tel" />
      </div>
      <Field label="ที่อยู่ตามบัตร" name="address" defaultValue={prefill.address} textarea />

      <IdCardUpload name="idCard" initialUrl={prefill.idCardImageUrl || null} initialName={prefill.idCardFileName || null} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="ธนาคาร (รับเงินเดือน)" name="salaryBankName" defaultValue={prefill.salaryBankName} />
        <Field label="เลขที่บัญชี" name="salaryAccountNo" defaultValue={prefill.salaryAccountNo} inputMode="numeric" />
        <Field label="ชื่อบัญชี" name="salaryAccountName" defaultValue={prefill.salaryAccountName} />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="ค่าจ้าง/เดือน" name="monthlyWage" defaultValue={prefill.monthlyWage} inputMode="numeric" />
        <Field label="โอนภายในวันที่" name="payDayOfMonth" defaultValue={prefill.payDayOfMonth} inputMode="numeric" />
        <Field label="เริ่มสัญญา" name="startDate" defaultValue={prefill.startDate} type="date" />
        <Field label="ถึงวันที่" name="endDate" defaultValue={prefill.endDate} type="date" />
      </div>

      {companyLine && (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
          บัญชีบริษัทที่แม่บ้านต้องนำเงินไปฝาก: {companyLine} <span className="text-zinc-400">(บริษัทกำหนด · แก้ในตั้งค่า)</span>
        </p>
      )}

      {state && !state.ok && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>
      )}
      {state && state.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          บันทึกร่างสัญญาแล้ว — ให้แม่บ้านเปิดแอปเพื่อตรวจและเซ็น
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {pending ? "กำลังบันทึก…" : "บันทึกร่างสัญญา"}
      </button>
    </form>
  );
}

function VoidForm({ maidId, label }: { maidId: string; label: string }) {
  const [state, formAction, pending] = useActionState(adminVoidMaidContract, null);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm("ยืนยันยกเลิกสัญญาฉบับนี้? (จะทำสัญญาใหม่ได้)")) e.preventDefault();
      }}
    >
      <input type="hidden" name="maidId" value={maidId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-medium text-rose-600 hover:text-rose-800 hover:underline disabled:opacity-50"
      >
        {pending ? "กำลังยกเลิก…" : label}
      </button>
      {state && !state.ok && <span className="ml-2 text-xs text-rose-700">{state.error}</span>}
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  required,
  inputMode,
  type = "text",
  textarea,
}: {
  label: string;
  name: string;
  defaultValue: string;
  required?: boolean;
  inputMode?: "text" | "numeric" | "tel";
  type?: string;
  textarea?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-zinc-600">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {textarea ? (
        <textarea
          name={name}
          defaultValue={defaultValue}
          rows={2}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      ) : (
        <input
          type={type}
          name={name}
          defaultValue={defaultValue}
          inputMode={inputMode}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      )}
    </label>
  );
}
