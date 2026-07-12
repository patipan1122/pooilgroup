"use client";

// Maid contract flow (CEO 2026-07-12): กรอก → พรีวิว → เซ็นออนไลน์.
// Step 1 fills every field (prefilled from the maid profile), Step 2 shows the
// rendered contract exactly as it will be signed plus a signature pad. On
// confirm the drawn signature is uploaded to R2 and signContract() locks it.

import { useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Eraser, Loader2 } from "lucide-react";

import { IdCardUpload } from "@/components/chairops/id-card-upload";
import { ContractDocument } from "./contract-document";
import { saveContractDraft, signContract } from "./actions";
import type { ContractDocData } from "./types";

// react-signature-canvas is browser-only (canvas + pointer events).
const SignatureCanvas = dynamic(
  () => import("react-signature-canvas").then((m) => m.default ?? m),
  { ssr: false },
) as unknown as React.ComponentType<{
  ref?: React.Ref<SignaturePad>;
  penColor?: string;
  canvasProps?: React.CanvasHTMLAttributes<HTMLCanvasElement>;
}>;

type SignaturePad = {
  toDataURL: (type?: string) => string;
  clear: () => void;
  isEmpty: () => boolean;
};

export interface ContractPrefill {
  maidName: string;
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
  companyBankName: string;
  companyAccountNo: string;
  companyAccountName: string;
}

async function uploadDataUrl(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], `signature-${Date.now()}.png`, { type: "image/png" });
  const presign = await fetch("/api/r2/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
  });
  if (!presign.ok) throw new Error("ขอลิงก์อัปโหลดลายเซ็นไม่สำเร็จ");
  const { uploadUrl, publicUrl } = (await presign.json()) as {
    uploadUrl: string;
    publicUrl: string;
  };
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!put.ok) throw new Error("อัปโหลดลายเซ็นไม่สำเร็จ");
  return publicUrl;
}

export function ContractFlow({ prefill }: { prefill: ContractPrefill }) {
  const router = useRouter();
  const [f, setF] = useState<ContractPrefill>(prefill);
  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [savingDraft, setSavingDraft] = useState(false);
  const padRef = useRef<SignaturePad | null>(null);

  const set = (k: keyof ContractPrefill) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const docData: ContractDocData = useMemo(
    () => ({
      maidName: f.maidName || null,
      idCardNumber: f.idCardNumber || null,
      address: f.address || null,
      phone: f.phone || null,
      monthlyWage: f.monthlyWage.trim() === "" ? null : Number(f.monthlyWage.replace(/[, ]/g, "")),
      payDayOfMonth: f.payDayOfMonth.trim() === "" ? null : Number(f.payDayOfMonth),
      salaryBankName: f.salaryBankName || null,
      salaryAccountNo: f.salaryAccountNo || null,
      salaryAccountName: f.salaryAccountName || null,
      companyBankName: f.companyBankName || null,
      companyAccountNo: f.companyAccountNo || null,
      companyAccountName: f.companyAccountName || null,
      companyAccountType: null,
      startDate: f.startDate || null,
      endDate: f.endDate || null,
      idCardImageUrl: f.idCardImageUrl || null,
    }),
    [f],
  );

  function buildFd(): FormData {
    const fd = new FormData();
    fd.set("maidName", f.maidName);
    fd.set("idCardNumber", f.idCardNumber);
    fd.set("address", f.address);
    fd.set("phone", f.phone);
    fd.set("monthlyWage", f.monthlyWage);
    fd.set("payDayOfMonth", f.payDayOfMonth);
    fd.set("salaryBankName", f.salaryBankName);
    fd.set("salaryAccountNo", f.salaryAccountNo);
    fd.set("salaryAccountName", f.salaryAccountName);
    fd.set("startDate", f.startDate);
    fd.set("endDate", f.endDate);
    fd.set("idCardImageUrl", f.idCardImageUrl);
    return fd;
  }

  const onSaveDraft = async () => {
    setError(null);
    setSavingDraft(true);
    try {
      const res = await saveContractDraft(buildFd());
      if (!res.ok) setError(res.error);
    } finally {
      setSavingDraft(false);
    }
  };

  const goPreview = () => {
    setError(null);
    if (!f.maidName.trim()) return setError("กรุณากรอกชื่อ-นามสกุล");
    if (!f.idCardNumber.trim()) return setError("กรุณากรอกเลขบัตรประชาชน");
    if (!f.address.trim()) return setError("กรุณากรอกที่อยู่");
    if (!f.idCardImageUrl) return setError("กรุณาแนบรูปบัตรประชาชน");
    if (!f.salaryBankName.trim() || !f.salaryAccountNo.trim())
      return setError("กรุณากรอกบัญชีรับเงินเดือน");
    void onSaveDraft();
    setStep(2);
    window.scrollTo({ top: 0 });
  };

  const onSign = () => {
    setError(null);
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) return setError("กรุณาเซ็นชื่อในกรอบก่อน");
    if (!f.salaryAccountName.trim() && !f.maidName.trim())
      return setError("กรุณากรอกชื่อผู้เซ็น");
    const dataUrl = pad.toDataURL("image/png");
    startTransition(async () => {
      try {
        const signatureImageUrl = await uploadDataUrl(dataUrl);
        const fd = buildFd();
        fd.set("signatureImageUrl", signatureImageUrl);
        fd.set("signedName", f.maidName);
        const res = await signContract(fd);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.refresh();
        window.scrollTo({ top: 0 });
      } catch (err) {
        setError(err instanceof Error ? err.message : "เซ็นสัญญาไม่สำเร็จ");
      }
    });
  };

  if (step === 2) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-2 shadow-sm">
          <ContractDocument data={docData} />
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-sm font-semibold text-zinc-900">ลงลายมือชื่อ (ผู้รับจ้าง)</p>
          <p className="mb-2 text-xs text-zinc-500">เซ็นด้วยนิ้วในกรอบด้านล่าง</p>
          <div className="overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-zinc-50">
            <SignatureCanvas
              ref={padRef}
              penColor="#111827"
              canvasProps={{ className: "w-full h-40 touch-none" }}
            />
          </div>
          <button
            type="button"
            onClick={() => padRef.current?.clear()}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800"
          >
            <Eraser className="size-3.5" /> ลบลายเซ็น เริ่มใหม่
          </button>

          <label className="mt-3 flex items-start gap-2 text-xs text-zinc-600">
            <span>
              ข้าพเจ้าได้อ่านและเข้าใจสัญญาฉบับนี้ และยินยอมลงลายมือชื่อทางอิเล็กทรอนิกส์
            </span>
          </label>
        </div>

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep(1);
            }}
            disabled={pending}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 py-3 text-base font-medium text-zinc-700 active:bg-zinc-50 disabled:opacity-50"
          >
            <ArrowLeft className="size-4" /> กลับไปแก้
          </button>
          <button
            type="button"
            onClick={onSign}
            disabled={pending}
            className="inline-flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-3 text-base font-semibold text-white active:opacity-80 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {pending ? "กำลังบันทึก…" : "ยืนยันและเซ็นสัญญา"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Group title="ข้อมูลผู้รับจ้าง">
        <TextField label="ชื่อ-นามสกุล" value={f.maidName} onChange={set("maidName")} required />
        <TextField label="เลขบัตรประชาชน" value={f.idCardNumber} onChange={set("idCardNumber")} inputMode="numeric" required />
        <TextArea label="ที่อยู่ตามบัตร" value={f.address} onChange={set("address")} required />
        <TextField label="เบอร์โทร" value={f.phone} onChange={set("phone")} inputMode="tel" />
        <IdCardUpload
          name="idCard"
          initialUrl={f.idCardImageUrl || null}
          initialName={f.idCardFileName || null}
          onChange={(url, name) =>
            setF((prev) => ({ ...prev, idCardImageUrl: url ?? "", idCardFileName: name ?? "" }))
          }
        />
      </Group>

      <Group title="บัญชีรับเงินเดือน (ของแม่บ้าน)">
        <TextField label="ธนาคาร" value={f.salaryBankName} onChange={set("salaryBankName")} required />
        <TextField label="เลขที่บัญชี" value={f.salaryAccountNo} onChange={set("salaryAccountNo")} inputMode="numeric" required />
        <TextField label="ชื่อบัญชี" value={f.salaryAccountName} onChange={set("salaryAccountName")} />
      </Group>

      <Group title="เงื่อนไข (ถ้าทราบ · ไม่บังคับ)">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="ค่าจ้าง/เดือน (บาท)" value={f.monthlyWage} onChange={set("monthlyWage")} inputMode="numeric" />
          <TextField label="โอนภายในวันที่" value={f.payDayOfMonth} onChange={set("payDayOfMonth")} inputMode="numeric" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <DateField label="เริ่มสัญญา" value={f.startDate} onChange={set("startDate")} />
          <DateField label="ถึงวันที่" value={f.endDate} onChange={set("endDate")} />
        </div>
      </Group>

      {f.companyAccountNo && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
          บัญชีบริษัทที่ต้องนำเงินไปฝาก: {f.companyAccountName} · {f.companyBankName} · {f.companyAccountNo}
          <span className="mt-0.5 block text-zinc-400">(บริษัทกำหนดให้ · แก้ไขไม่ได้)</span>
        </div>
      )}

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={savingDraft || pending}
          className="inline-flex flex-1 items-center justify-center rounded-xl border border-zinc-200 py-3 text-base font-medium text-zinc-700 active:bg-zinc-50 disabled:opacity-50"
        >
          {savingDraft ? "กำลังบันทึก…" : "บันทึกร่าง"}
        </button>
        <button
          type="button"
          onClick={goPreview}
          disabled={pending}
          className="inline-flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-zinc-900 py-3 text-base font-semibold text-white active:opacity-80 disabled:opacity-50"
        >
          ดูตัวอย่าง + เซ็น <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
      <p className="text-sm font-semibold text-zinc-900">{title}</p>
      {children}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  required,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
  inputMode?: "text" | "numeric" | "tel";
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-zinc-800">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </span>
      <input
        type="text"
        value={value}
        onChange={onChange}
        inputMode={inputMode}
        className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
    </label>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-zinc-800">{label}</span>
      <input
        type="date"
        value={value}
        onChange={onChange}
        className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  required?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-zinc-800">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </span>
      <textarea
        value={value}
        onChange={onChange}
        rows={2}
        className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
    </label>
  );
}
