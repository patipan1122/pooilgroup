"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { updateMaidProfile } from "@/app/(admin)/chairops/users/actions";

type FormState = { ok: boolean; error?: string } | null;

interface Props {
  defaultValues: {
    displayName: string;
    mobilePhone: string | null;
    emergencyContact: string | null;
    emergencyPhone: string | null;
    currentMainEmployer: string | null;
  };
  onCancel: () => void;
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
        defaultValue={defaultValue ?? ""}
        required={required}
        className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
    </div>
  );
}

export function EditProfileForm({ defaultValues, onCancel }: Props) {
  const router = useRouter();
  const [state, action, pending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const result = await updateMaidProfile(formData);
      return result;
    },
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onCancel();
    }
  }, [state, router, onCancel]);

  return (
    <form action={action} className="space-y-4">
      <Field
        label="ชื่อ-นามสกุล"
        name="displayName"
        defaultValue={defaultValues.displayName}
        required
      />
      <Field
        label="เบอร์มือถือ"
        name="mobilePhone"
        type="tel"
        placeholder="08X-XXX-XXXX"
        defaultValue={defaultValues.mobilePhone ?? undefined}
        required
      />
      <Field
        label="ชื่อผู้ติดต่อฉุกเฉิน"
        name="emergencyContact"
        placeholder="เช่น แม่ / พ่อ / สามี"
        defaultValue={defaultValues.emergencyContact ?? undefined}
        required
      />
      <Field
        label="เบอร์ฉุกเฉิน"
        name="emergencyPhone"
        type="tel"
        placeholder="08X-XXX-XXXX"
        defaultValue={defaultValues.emergencyPhone ?? undefined}
        required
      />
      <Field
        label="งานประจำ (ถ้ามี)"
        name="currentMainEmployer"
        placeholder="เช่น อิสระ / บริษัท ABC"
        defaultValue={defaultValues.currentMainEmployer ?? undefined}
      />

      {state && !state.ok && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-500">
          {state.error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="flex-1 rounded-xl border border-zinc-200 py-3 text-base font-medium text-zinc-700 active:bg-zinc-50 disabled:opacity-50"
        >
          ยกเลิก
        </button>
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-xl bg-emerald-600 py-3 text-base font-semibold text-white active:opacity-80 disabled:opacity-50"
        >
          {pending ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>
    </form>
  );
}
