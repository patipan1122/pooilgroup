"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import {
  type Field,
  type FormSchema,
  ALLOWED_FILE_MIMES,
  MAX_FILE_SIZE,
} from "@/lib/recruit/types";
import { Upload, X, Loader2 } from "lucide-react";

interface UploadedFile {
  key: string;
  name: string;
  size: number;
  mime: string;
  localUrl?: string;
}

interface Props {
  schema: FormSchema;
  jobTitle: string;
  jobDescription?: string;
  companyName: string;
  slug?: string;
  onSubmit: (input: {
    applicant: { fullName: string; phone: string; email?: string };
    answers: Record<string, unknown>;
    files: UploadedFile[];
  }) => Promise<void> | void;
  disabled?: boolean;
  preview?: boolean;
  /** Initial draft (from localStorage) */
  initialAnswers?: Record<string, unknown>;
}

export function PublicFormRenderer({
  schema,
  jobTitle,
  jobDescription,
  companyName,
  slug,
  onSubmit,
  disabled,
  preview,
  initialAnswers,
}: Props) {
  const [answers, setAnswers] = useState<Record<string, unknown>>(
    initialAnswers ?? {},
  );
  const [files, setFiles] = useState<Record<string, UploadedFile[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const honeypotRef = useRef<HTMLInputElement>(null);

  // Top-level applicant fields (always required)
  const [fullName, setFullName] = useState((initialAnswers?.["_applicant_fullName"] as string) ?? "");
  const [phone, setPhone] = useState((initialAnswers?.["_applicant_phone"] as string) ?? "");
  const [email, setEmail] = useState((initialAnswers?.["_applicant_email"] as string) ?? "");

  function setAnswer(fieldId: string, value: unknown) {
    setAnswers((a) => ({ ...a, [fieldId]: value }));
    setErrors((e) => ({ ...e, [fieldId]: "" }));
    // Persist draft
    if (slug && !preview) {
      try {
        localStorage.setItem(
          `recruit_draft_${slug}`,
          JSON.stringify({ ...answers, [fieldId]: value }),
        );
      } catch {}
    }
  }

  async function uploadFile(fieldId: string, file: File) {
    if (!ALLOWED_FILE_MIMES.includes(file.type as (typeof ALLOWED_FILE_MIMES)[number])) {
      toast.error(`ชนิดไฟล์ไม่รองรับ: ${file.type}`);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`ไฟล์ใหญ่เกิน 5 MB (ไฟล์นี้ ${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      return;
    }
    if (preview) {
      // Preview mode — fake upload
      const fake: UploadedFile = {
        key: `preview/${file.name}`,
        name: file.name,
        size: file.size,
        mime: file.type,
        localUrl: URL.createObjectURL(file),
      };
      setFiles((f) => ({ ...f, [fieldId]: [...(f[fieldId] ?? []), fake] }));
      return;
    }

    try {
      // Step 1: get signed URL
      const signResp = await fetch("/api/recruit/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: slug,
          fileName: file.name,
          contentType: file.type,
          size: file.size,
        }),
      });
      if (!signResp.ok) {
        const err = await signResp.json().catch(() => ({}));
        toast.error(err.error ?? "ขอ upload URL ไม่สำเร็จ");
        return;
      }
      const { url, key } = await signResp.json();

      // Step 2: PUT to R2
      const putResp = await fetch(url, {
        method: "PUT",
        body: file,
        headers: { "content-type": file.type },
      });
      if (!putResp.ok) {
        toast.error("อัปโหลดไม่สำเร็จ");
        return;
      }

      const entry: UploadedFile = {
        key,
        name: file.name,
        size: file.size,
        mime: file.type,
      };
      setFiles((f) => ({ ...f, [fieldId]: [...(f[fieldId] ?? []), entry] }));
      toast.success(`อัปโหลด ${file.name} แล้ว`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function removeFile(fieldId: string, key: string) {
    setFiles((f) => ({
      ...f,
      [fieldId]: (f[fieldId] ?? []).filter((x) => x.key !== key),
    }));
  }

  function validate(): boolean {
    if (!fullName.trim()) {
      toast.error("กรอกชื่อ-นามสกุล");
      return false;
    }
    if (!/^0\d{8,9}$/.test(phone.trim())) {
      toast.error("กรอกเบอร์โทร 9-10 หลัก ขึ้นต้นด้วย 0");
      return false;
    }
    const newErrors: Record<string, string> = {};
    for (const section of schema.sections) {
      for (const field of section.fields) {
        if (!field.required) continue;
        const val = answers[field.id];
        const fileList = files[field.id];
        if (field.type === "file") {
          if (!fileList || fileList.length === 0) {
            newErrors[field.id] = "กรุณาอัปโหลดไฟล์";
          }
        } else if (
          val == null ||
          val === "" ||
          (Array.isArray(val) && val.length === 0)
        ) {
          newErrors[field.id] = "กรุณากรอก";
        }
      }
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      toast.error("กรอกข้อมูลให้ครบก่อนส่ง");
      // scroll to first error
      const firstId = Object.keys(newErrors)[0];
      const el = document.getElementById(`f-${firstId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    if (!consent) {
      toast.error("ติ๊กยินยอม PDPA ก่อน");
      return false;
    }
    // Honeypot check (bot detection)
    if (honeypotRef.current?.value) return false;
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || submitting) return;
    if (!validate()) return;
    setSubmitting(true);
    try {
      const allFiles = Object.values(files).flat();
      await onSubmit({
        applicant: {
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
        },
        answers,
        files: allFiles,
      });
      // Clear draft
      if (slug) {
        try {
          localStorage.removeItem(`recruit_draft_${slug}`);
        } catch {}
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl mx-auto">
      {/* Honeypot — hidden field bots fill */}
      <input
        ref={honeypotRef}
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        className="absolute left-[-9999px] opacity-0 pointer-events-none"
        aria-hidden
      />

      {/* Header */}
      <header className="text-center pb-4 border-b border-zinc-200">
        <p className="text-[10px] uppercase tracking-[0.22em] font-bold text-[var(--color-brand-700)]">
          {companyName}
        </p>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display mt-2 text-zinc-900">
          {jobTitle}
        </h1>
        {jobDescription && (
          <p className="text-sm text-zinc-600 mt-3 leading-relaxed whitespace-pre-wrap">
            {jobDescription}
          </p>
        )}
      </header>

      {/* Applicant top fields */}
      <section className="space-y-3">
        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-bold">
          ข้อมูลติดต่อ
        </p>
        <Field label="ชื่อ-นามสกุล" required>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={disabled}
            placeholder="เช่น สมชาย ใจดี"
            className="w-full h-12 px-3.5 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] text-base"
            maxLength={120}
            required
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="เบอร์โทร" required>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ""))}
              disabled={disabled}
              placeholder="081xxxxxxx"
              className="w-full h-12 px-3.5 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] text-base"
              maxLength={10}
              required
            />
          </Field>
          <Field label="อีเมล (ถ้ามี)">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={disabled}
              placeholder="email@example.com"
              className="w-full h-12 px-3.5 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] text-base"
              maxLength={200}
            />
          </Field>
        </div>
      </section>

      {/* Sections from schema */}
      {schema.sections.map((section, idx) => (
        <section key={section.id}>
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-bold mb-3">
            {String(idx + 1).padStart(2, "0")} · {section.title}
          </p>
          <div className="space-y-3">
            {section.fields.map((field) => (
              <FieldInput
                key={field.id}
                field={field}
                value={answers[field.id]}
                onChange={(v) => setAnswer(field.id, v)}
                error={errors[field.id]}
                files={files[field.id] ?? []}
                onUpload={(file) => uploadFile(field.id, file)}
                onRemoveFile={(key) => removeFile(field.id, key)}
                disabled={disabled}
              />
            ))}
          </div>
        </section>
      ))}

      {/* PDPA consent */}
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/40 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={disabled}
            className="mt-1 rounded"
          />
          <span className="text-xs text-zinc-700 leading-relaxed">
            ฉันยินยอมให้ {companyName} เก็บ ใช้ และเปิดเผยข้อมูลส่วนบุคคลของฉันตามนโยบาย
            ความเป็นส่วนตัว (PDPA) เพื่อกระบวนการพิจารณารับสมัครงาน · ข้อมูลจะถูกเก็บไม่เกิน 2 ปี
          </span>
        </label>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={disabled || submitting || !consent}
        className="w-full h-14 rounded-2xl bg-[var(--color-brand-600)] text-white font-extrabold text-base hover:bg-[var(--color-brand-700)] disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <Loader2 className="size-5 animate-spin" />
            กำลังส่ง...
          </>
        ) : preview ? (
          "ตัวอย่าง — ปุ่มส่งจะใช้ได้ตอนผู้สมัครจริง"
        ) : (
          "✓ ส่งใบสมัคร"
        )}
      </button>
      <p className="text-[10px] text-zinc-400 text-center">
        เปลี่ยน device ระหว่างกรอกได้ · บันทึกอัตโนมัติ
      </p>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700 mb-1.5 block">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

interface FieldInputProps {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  files: UploadedFile[];
  onUpload: (file: File) => void;
  onRemoveFile: (key: string) => void;
  disabled?: boolean;
}

function FieldInput({
  field,
  value,
  onChange,
  error,
  files,
  onUpload,
  onRemoveFile,
  disabled,
}: FieldInputProps) {
  const id = `f-${field.id}`;
  return (
    <div id={id}>
      <label className="block">
        <span className="text-sm font-medium text-zinc-800">
          {field.label}
          {field.required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
        {field.helpText && (
          <span className="block text-xs text-zinc-500 mt-0.5">
            {field.helpText}
          </span>
        )}
      </label>
      <div className="mt-1.5">{renderInput(field, value, onChange, files, onUpload, onRemoveFile, disabled)}</div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

function renderInput(
  field: Field,
  value: unknown,
  onChange: (v: unknown) => void,
  files: UploadedFile[],
  onUpload: (file: File) => void,
  onRemoveFile: (key: string) => void,
  disabled?: boolean,
) {
  const base =
    "w-full px-3.5 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] text-base disabled:bg-zinc-50";

  switch (field.type) {
    case "short_text":
      return (
        <input
          type={field.format === "email" ? "email" : field.format === "phone" ? "tel" : "text"}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          maxLength={field.maxLength ?? 200}
          placeholder={field.placeholder}
          className={`${base} h-12`}
        />
      );
    case "long_text":
      return (
        <textarea
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          maxLength={field.maxLength ?? 5000}
          placeholder={field.placeholder}
          rows={4}
          className={`${base} py-3`}
        />
      );
    case "yes_no":
      return (
        <div className="flex gap-2">
          {["yes", "no"].map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              disabled={disabled}
              className={`flex-1 h-12 rounded-xl border-2 font-bold transition-colors ${
                value === opt
                  ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)]"
                  : "border-zinc-200 text-zinc-700 hover:border-zinc-400"
              }`}
            >
              {opt === "yes" ? "ใช่" : "ไม่ใช่"}
            </button>
          ))}
        </div>
      );
    case "dropdown":
      return (
        <select
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`${base} h-12`}
        >
          <option value="">— เลือก —</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "radio":
      return (
        <div className="space-y-2">
          {field.options?.map((o) => (
            <label
              key={o.value}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                value === o.value
                  ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                  : "border-zinc-200 hover:border-zinc-400"
              }`}
            >
              <input
                type="radio"
                name={field.id}
                value={o.value}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
                disabled={disabled}
                className="accent-[var(--color-brand-600)]"
              />
              <span className="text-sm text-zinc-800">{o.label}</span>
            </label>
          ))}
        </div>
      );
    case "checkbox": {
      const arr = (value as string[]) ?? [];
      return (
        <div className="space-y-2">
          {field.options?.map((o) => {
            const checked = arr.includes(o.value);
            return (
              <label
                key={o.value}
                className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                  checked
                    ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                    : "border-zinc-200 hover:border-zinc-400"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange(
                      checked
                        ? arr.filter((x) => x !== o.value)
                        : [...arr, o.value],
                    )
                  }
                  disabled={disabled}
                  className="accent-[var(--color-brand-600)]"
                />
                <span className="text-sm text-zinc-800">{o.label}</span>
              </label>
            );
          })}
        </div>
      );
    }
    case "range": {
      const v = typeof value === "number" ? value : (field.min ?? 0);
      return (
        <div className="space-y-1">
          <input
            type="range"
            min={field.min ?? 0}
            max={field.max ?? 100}
            step={field.step ?? 1}
            value={v}
            onChange={(e) => onChange(Number(e.target.value))}
            disabled={disabled}
            className="w-full accent-[var(--color-brand-600)]"
          />
          <p className="text-xs text-zinc-600 tabular-num text-center">
            {v}
            {field.unit ? ` ${field.unit}` : ""}
          </p>
        </div>
      );
    }
    case "number":
      return (
        <input
          type="number"
          value={(value as number | string) ?? ""}
          onChange={(e) =>
            onChange(e.target.value ? Number(e.target.value) : null)
          }
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          disabled={disabled}
          className={`${base} h-12`}
        />
      );
    case "date":
      return (
        <input
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`${base} h-12`}
        />
      );
    case "file": {
      const accept = (field.accept ?? ["pdf", "doc", "docx", "jpg", "png"])
        .map((ext) => `.${ext}`)
        .join(",");
      const maxFiles = field.maxFiles ?? 3;
      return (
        <div className="space-y-2">
          {files.map((f) => (
            <div
              key={f.key}
              className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-zinc-200 bg-zinc-50"
            >
              <span className="text-sm text-zinc-800 truncate">📎 {f.name}</span>
              <button
                type="button"
                onClick={() => onRemoveFile(f.key)}
                disabled={disabled}
                className="text-zinc-400 hover:text-red-600 shrink-0"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
          {files.length < maxFiles && (
            <label className="block">
              <input
                type="file"
                accept={accept}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(file);
                  e.target.value = ""; // reset
                }}
                disabled={disabled}
                className="hidden"
              />
              <span
                className={`flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-zinc-300 hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)]/40 cursor-pointer transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <Upload className="size-4 text-zinc-500" />
                <span className="text-sm text-zinc-600">
                  แตะเพื่อเลือกไฟล์ ({files.length}/{maxFiles}) · สูงสุด 5 MB ต่อไฟล์
                </span>
              </span>
            </label>
          )}
        </div>
      );
    }
    default:
      return <p className="text-xs text-zinc-400">ไม่รองรับ type นี้</p>;
  }
}
