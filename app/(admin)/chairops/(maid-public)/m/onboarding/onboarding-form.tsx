"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { submitOnboarding } from "@/app/(admin)/chairops/users/actions";
import { IdCardUpload } from "@/components/chairops/id-card-upload";

type FormState = { ok: boolean; error?: string } | null;

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const result = await submitOnboarding(formData);
      return result;
    },
    null,
  );

  useEffect(() => {
    if (state?.ok) router.replace("/chairops/m");
  }, [state, router]);

  return (
    <form action={action} className="space-y-5 max-w-sm mx-auto">
      <Field label="ชื่อ-นามสกุล" name="displayName" defaultValue={defaultName} required />
      <Field label="เบอร์มือถือ" name="mobilePhone" type="tel" placeholder="08X-XXX-XXXX" required />
      <Field label="ชื่อผู้ติดต่อฉุกเฉิน" name="emergencyContact" placeholder="เช่น แม่ / พ่อ / สามี" required />
      <Field label="เบอร์ฉุกเฉิน" name="emergencyPhone" type="tel" placeholder="08X-XXX-XXXX" required />
      <Field
        label="งานประจำ (ถ้ามี)"
        name="currentMainEmployer"
        placeholder="เช่น อิสระ / บริษัท ABC"
        required
      />

      {/* บัญชีรับเงินเดือน (CEO 2026-06-18) — เก็บไว้สำหรับจ่ายเงินเดือน */}
      <div className="pt-2">
        <p className="text-sm font-semibold text-zinc-800">บัญชีรับเงินเดือน</p>
        <p className="text-xs text-zinc-500">สำหรับโอนเงินเดือนเข้าบัญชีของคุณ</p>
      </div>
      <Field label="ธนาคาร" name="bankName" placeholder="เช่น กสิกรไทย / ไทยพาณิชย์" required />
      <Field
        label="เลขที่บัญชี"
        name="bankAccountNo"
        type="tel"
        placeholder="เลขบัญชีธนาคาร"
        required
      />
      <Field label="ชื่อบัญชี" name="bankAccountName" placeholder="ชื่อเจ้าของบัญชี" required />

      {/* บัตรประชาชน + ที่อยู่ (CEO 2026-07-12) — สำหรับสัญญาจ้าง · กรอกทีหลังได้ */}
      <div className="pt-2">
        <p className="text-sm font-semibold text-zinc-800">บัตรประชาชน + ที่อยู่</p>
        <p className="text-xs text-zinc-500">ใช้สำหรับทำสัญญาจ้าง (จะกรอกทีหลังในเมนูโปรไฟล์ก็ได้)</p>
      </div>
      <Field label="เลขบัตรประชาชน" name="idCardNumber" type="tel" placeholder="เลข 13 หลัก" />
      <div className="space-y-1.5">
        <label htmlFor="homeAddress" className="block text-sm font-medium text-[var(--co-text)]">
          ที่อยู่ตามบัตร
        </label>
        <textarea
          id="homeAddress"
          name="homeAddress"
          rows={2}
          placeholder="บ้านเลขที่ / ถนน / ตำบล / อำเภอ / จังหวัด / รหัสไปรษณีย์"
          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>
      <IdCardUpload name="idCard" label="รูปบัตรประชาชน (ถ้ามี)" />

      {state && !state.ok && (
        <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-emerald-600 py-3.5 text-base font-semibold text-white hover:bg-emerald-700 active:opacity-80 disabled:opacity-50"
      >
        {pending ? "กำลังบันทึก..." : "ยืนยันและเริ่มใช้งาน"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-medium text-[var(--co-text)]">
        {label}
        {required && <span className="ml-1 text-red-500" aria-hidden>*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
    </div>
  );
}
