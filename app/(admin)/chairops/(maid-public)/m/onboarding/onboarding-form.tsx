"use client";

// F4 maid self-onboarding form. Single long-scroll page split into visual
// sections — deliberately NOT a multi-page wizard: maids fill this on a phone,
// often on a weak connection, and every page transition is a place where a
// dropped request loses what they already typed.
//
// Section order runs easy → hard → binding: plain typing first (momentum),
// then the two camera steps (one permission prompt, both photos), then the
// consent + submit. The contract signing continues on the next page.

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { submitOnboarding } from "@/app/(admin)/chairops/users/actions";
import { IdCardUpload } from "@/components/chairops/id-card-upload";
import { SelfieCapture } from "@/components/chairops/selfie-capture";

type FormState = { ok: boolean; error?: string } | null;

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [consent, setConsent] = useState(false);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [idCardUrl, setIdCardUrl] = useState<string | null>(null);

  const [state, action, pending] = useActionState<FormState, FormData>(
    async (_prev, formData) => submitOnboarding(formData),
    null,
  );

  useEffect(() => {
    // เสร็จแล้วพาไปเซ็นสัญญาต่อทันที (CEO 2026-09-22) — เดิมเด้งกลับหน้าแรก
    // แล้วแม่บ้านต้องหาเมนูสัญญาเอง ซึ่งส่วนใหญ่ไม่ได้ทำต่อ
    if (state?.ok) router.replace("/chairops/m/contract?from=onboarding");
  }, [state, router]);

  // ทั้งรูปบัตรและเซลฟี่บังคับตรงนี้ เพราะขั้นถัดไป (เซ็นสัญญา) บังคับรูปบัตร
  // อยู่แล้ว — ถ้าปล่อยผ่านตรงนี้ แม่บ้านจะไปติดกำแพงที่หน้าสัญญาแทนโดยไม่รู้ตัว
  const hasSensitive = Boolean(selfieUrl || idCardUrl);
  const blockedReason = !idCardUrl
    ? "แนบรูปบัตรประชาชนก่อน"
    : !selfieUrl
      ? "ถ่ายเซลฟี่ก่อน"
      : hasSensitive && !consent
        ? "ติ๊กยินยอมก่อน"
        : null;

  return (
    <form action={action} className="mx-auto max-w-sm space-y-5">
      <Section title="ข้อมูลของคุณ">
        <Field label="ชื่อ-นามสกุล" name="displayName" defaultValue={defaultName} required />
        <Field label="เบอร์มือถือ" name="mobilePhone" type="tel" placeholder="08X-XXX-XXXX" required />
        <Field
          label="งานประจำ (ถ้ามี)"
          name="currentMainEmployer"
          placeholder="เช่น อิสระ / บริษัท ABC"
          required
        />
      </Section>

      <Section
        title="ผู้ติดต่อฉุกเฉิน 2 คน"
        hint="เผื่อเกิดเหตุด่วนระหว่างทำงาน · ควรบอกเจ้าตัวก่อนว่าใส่ชื่อเขาไว้"
      >
        <Field label="คนที่ 1 — ชื่อ" name="emergencyContact" placeholder="เช่น แม่ / พ่อ / สามี" required />
        <Field label="คนที่ 1 — เบอร์โทร" name="emergencyPhone" type="tel" placeholder="08X-XXX-XXXX" required />
        <Field label="คนที่ 2 — ชื่อ" name="emergencyContact2" placeholder="เช่น พี่สาว / เพื่อนสนิท" required />
        <Field label="คนที่ 2 — เบอร์โทร" name="emergencyPhone2" type="tel" placeholder="08X-XXX-XXXX" required />
      </Section>

      <Section title="บัญชีรับเงินเดือน" hint="สำหรับโอนเงินเดือนเข้าบัญชีของคุณ">
        <Field label="ธนาคาร" name="bankName" placeholder="เช่น กสิกรไทย / ไทยพาณิชย์" required />
        <Field label="เลขที่บัญชี" name="bankAccountNo" type="tel" placeholder="เลขบัญชีธนาคาร" required />
        <Field label="ชื่อบัญชี" name="bankAccountName" placeholder="ชื่อเจ้าของบัญชี" required />
      </Section>

      <Section title="ยืนยันตัวตน" hint="ใช้ทำสัญญาจ้าง · เก็บเป็นความลับ ไม่เปิดเผยให้ใคร">
        <Field label="เลขบัตรประชาชน" name="idCardNumber" type="tel" placeholder="เลข 13 หลัก" required />
        <div className="space-y-1.5">
          <label htmlFor="homeAddress" className="block text-sm font-medium text-zinc-800">
            ที่อยู่ตามบัตร <span className="text-red-500" aria-hidden>*</span>
          </label>
          <textarea
            id="homeAddress"
            name="homeAddress"
            rows={2}
            required
            placeholder="บ้านเลขที่ / ถนน / ตำบล / อำเภอ / จังหวัด / รหัสไปรษณีย์"
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <IdCardUpload name="idCard" label="รูปบัตรประชาชน" onChange={(url) => setIdCardUrl(url)} />
        <SelfieCapture name="selfie" onChange={setSelfieUrl} />
      </Section>

      {/* PDPA ม.26 — ข้อมูลอ่อนไหว (รูปบัตร ปชช. มีช่องศาสนาติดมาเสมอ + รูปใบหน้า)
          ต้องขอความยินยอมแยกชัดเจนจากการยอมรับตัวสัญญา */}
      <label className="flex items-start gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 text-sm leading-relaxed text-zinc-700">
        <input
          type="checkbox"
          name="sensitiveConsent"
          value="true"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
        />
        <span>
          ยินยอมให้บริษัทเก็บรูปบัตรประชาชนและรูปถ่ายใบหน้าของฉัน
          เพื่อใช้ยืนยันตัวตนในการทำสัญญาจ้างและงานบุคคลเท่านั้น
          <span className="mt-1 block text-xs text-zinc-500">
            เก็บเป็นความลับ · ไม่ส่งต่อให้บุคคลภายนอก · ขอให้ลบได้ภายหลัง
          </span>
        </span>
      </label>

      {state && !state.ok && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending || Boolean(blockedReason)}
        className="w-full rounded-xl bg-emerald-600 py-3.5 text-base font-semibold text-white hover:bg-emerald-700 active:opacity-80 disabled:opacity-50"
      >
        {pending ? "กำลังบันทึก..." : (blockedReason ?? "บันทึก แล้วไปเซ็นสัญญา")}
      </button>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-0.5 pt-1">
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      </div>
      {children}
    </section>
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
      <label htmlFor={name} className="block text-sm font-medium text-zinc-800">
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
