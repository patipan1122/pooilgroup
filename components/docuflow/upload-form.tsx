"use client";

// UploadForm — DocuFlow document upload (admin tier only)
// ────────────────────────────────────────────────────────────────────
// Phase 2 redesign 2026-05-10:
//   - Accepts `template` prop (from canonical-docs) → autofill name, level,
//     suggested tags, expiry, alertDays, documentType
//   - Auto-fills name from filename when no template
//   - Tag chips (suggested + custom) instead of free-text input
//   - Alert days as preset chip toggles instead of comma string
//   - Persists last-used scope to localStorage; UI shows "ใช้ค่าครั้งล่าสุด"
//
// Flow:
//   1. POST /api/docuflow/upload → returns { documentId, uploadUrl }
//   2. PUT file → uploadUrl (R2 presigned, 5-min lifetime)
//   3. Toast success → save lastContext → router.push to detail page
// ────────────────────────────────────────────────────────────────────

import { useState, useTransition, useEffect, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  X,
  Loader2,
  Upload as UploadIcon,
  Sparkles,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import {
  type TemplateDefaults,
  type LastUploadContext,
  readLastContext,
  writeLastContext,
} from "@/lib/docuflow/templates";

const OWNERSHIP_LEVELS = [
  { value: "group", label: "ทั้งกลุ่ม" },
  { value: "company", label: "บริษัท" },
  { value: "business_type", label: "ประเภทธุรกิจ" },
  { value: "branch", label: "สาขา" },
  { value: "person", label: "บุคคล" },
] as const;

type Level = (typeof OWNERSHIP_LEVELS)[number]["value"];

// Preset alert-day options — chip toggles
const ALERT_DAY_PRESETS = [180, 90, 60, 30, 14, 7] as const;

const FormSchema = z
  .object({
    name: z.string().min(1, "กรุณาใส่ชื่อเอกสาร").max(255),
    description: z.string().max(2000).optional(),
    level: z.enum(["group", "company", "business_type", "branch", "person"]),
    companyId: z.string().optional(),
    branchId: z.string().optional(),
    personId: z.string().optional(),
    businessType: z.string().optional(),
    expiryDate: z.string().optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (v) => {
      if (v.level === "company") return Boolean(v.companyId);
      if (v.level === "business_type") return Boolean(v.businessType);
      if (v.level === "branch") return Boolean(v.branchId);
      if (v.level === "person") return Boolean(v.personId);
      return true;
    },
    { message: "กรุณาเลือกข้อมูลให้ครบตามระดับที่เลือก", path: ["level"] },
  );

type FormValues = z.infer<typeof FormSchema>;

interface Branch {
  id: string;
  name: string;
  code: string;
  businessType: string;
  companyId: string;
}

interface Company {
  id: string;
  name: string;
  code: string;
}

interface UserRow {
  id: string;
  name: string;
  role: string;
}

interface BizType {
  value: string;
  label: string;
  emoji: string;
}

interface Props {
  companies: Company[];
  branches: Branch[];
  users: UserRow[];
  businessTypes: BizType[];
  /** Pre-fill from canonical doc spec — set when arriving via /upload/template */
  template?: TemplateDefaults | null;
  /** Stable doc-type identifier for the API — usually `${bizType}:${name}` */
  documentTypeKey?: string | null;
  /** Existing tags from this org — for autocomplete suggestions */
  orgTagSuggestions?: string[];
}

export function UploadForm({
  companies,
  branches,
  users,
  businessTypes,
  template = null,
  documentTypeKey = null,
  orgTagSuggestions = [],
}: Props) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState<string[]>(template?.suggestedTags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [alertDays, setAlertDays] = useState<number[]>(
    template?.alertDays ?? [90, 30, 7],
  );
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [lastCtx, setLastCtx] = useState<LastUploadContext | null>(null);
  const fileNameSyncRef = useRef(false);

  // Compute default expiryDate from template (today + N years)
  const defaultExpiryDate = (() => {
    if (!template?.expiryYears) return "";
    const d = new Date();
    d.setFullYear(d.getFullYear() + template.expiryYears);
    return d.toISOString().slice(0, 10);
  })();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: template?.suggestedName ?? "",
      level: template?.suggestedLevel ?? "group",
      expiryDate: defaultExpiryDate,
    },
  });

  // Hydrate last-context after mount (localStorage is client-only)
  useEffect(() => {
    const ctx = readLastContext();
    if (ctx) setLastCtx(ctx);
  }, []);

  function applyLastContext() {
    if (!lastCtx) return;
    setValue("level", lastCtx.level);
    if (lastCtx.companyId) setValue("companyId", lastCtx.companyId);
    if (lastCtx.branchId) setValue("branchId", lastCtx.branchId);
    if (lastCtx.businessType)
      setValue("businessType", lastCtx.businessType);
    if (lastCtx.personId) setValue("personId", lastCtx.personId);
    toast.success(`เลือก ${lastCtx.label} แล้ว`);
  }

  const level = watch("level") as Level;
  const filterCompanyId = watch("companyId");
  const branchOptions = filterCompanyId
    ? branches.filter((b) => b.companyId === filterCompanyId)
    : branches;

  // Auto-fill name from filename (ครั้งเดียวต่อ upload, ถ้ายังไม่มีชื่อ และไม่มี template)
  function handleFileChange(f: File | null) {
    setFile(f);
    if (!f || fileNameSyncRef.current || template) return;
    const currentName = watch("name");
    if (!currentName) {
      const cleaned = f.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
      setValue("name", cleaned);
      fileNameSyncRef.current = true;
    }
  }

  function addTag(t: string) {
    const trimmed = t.trim();
    if (!trimmed) return;
    if (tags.includes(trimmed)) return;
    setTags([...tags, trimmed]);
    setTagInput("");
  }

  function removeTag(t: string) {
    setTags(tags.filter((x) => x !== t));
  }

  function toggleAlertDay(d: number) {
    setAlertDays((curr) =>
      curr.includes(d)
        ? curr.filter((x) => x !== d)
        : [...curr, d].sort((a, b) => b - a),
    );
  }

  // Autocomplete: tags from org that match input + not already chosen
  const tagAutocomplete =
    tagInput.trim().length >= 1
      ? orgTagSuggestions
          .filter(
            (t) =>
              t.toLowerCase().includes(tagInput.toLowerCase()) &&
              !tags.includes(t),
          )
          .slice(0, 6)
      : [];

  async function onSubmit(values: FormValues) {
    if (!file) {
      toast.error("กรุณาเลือกไฟล์เอกสาร");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      toast.error("ไฟล์ใหญ่เกิน 500 MB");
      return;
    }

    const ownership: Record<string, unknown> = { level: values.level };
    if (values.level === "company") ownership.companyId = values.companyId;
    if (values.level === "business_type")
      ownership.businessType = values.businessType;
    if (values.level === "branch") ownership.branchId = values.branchId;
    if (values.level === "person") ownership.personId = values.personId;

    const renewal = values.expiryDate
      ? {
          expiryDate: values.expiryDate,
          alertDays: alertDays.length > 0 ? alertDays : [90, 30, 7],
          notes: values.notes || undefined,
        }
      : undefined;

    setUploading(true);
    try {
      const res = await fetch("/api/docuflow/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          description: values.description || undefined,
          documentType: documentTypeKey || undefined,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
          ownership,
          tags,
          renewal,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "อัปโหลดไม่สำเร็จ");
      }

      const { documentId, uploadUrl } = (await res.json()) as {
        documentId: string;
        uploadUrl: string;
      };

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      if (!putRes.ok) {
        throw new Error("อัปโหลดไฟล์ไป R2 ไม่สำเร็จ");
      }

      // Save last-context for next upload
      const labelParts: string[] = [];
      if (values.level === "branch" && values.branchId) {
        const b = branches.find((x) => x.id === values.branchId);
        if (b) labelParts.push(`${b.code} · ${b.name}`);
      } else if (values.level === "company" && values.companyId) {
        const c = companies.find((x) => x.id === values.companyId);
        if (c) labelParts.push(c.name);
      } else if (values.level === "business_type" && values.businessType) {
        const bt = businessTypes.find((x) => x.value === values.businessType);
        if (bt) labelParts.push(`${bt.emoji} ${bt.label}`);
      } else if (values.level === "person" && values.personId) {
        const u = users.find((x) => x.id === values.personId);
        if (u) labelParts.push(u.name);
      } else if (values.level === "group") {
        labelParts.push("ทั้งกลุ่ม");
      }

      writeLastContext({
        level: values.level,
        companyId: values.companyId,
        branchId: values.branchId,
        businessType: values.businessType,
        personId: values.personId,
        label: labelParts[0] ?? "ที่เลือกล่าสุด",
      });

      toast.success("อัปโหลดเอกสารสำเร็จ");
      startTransition(() => {
        router.push(`/docuflow/documents/${documentId}`);
        router.refresh();
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ ลองใหม่";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  const busy = uploading || isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {template && (
        <div className="rounded-xl border-2 border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/50 p-4 flex items-start gap-3">
          <Sparkles className="size-5 text-[var(--color-brand-600)] mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-zinc-900">
              ใช้ template: {template.suggestedName}
            </p>
            <p className="text-xs text-zinc-600 mt-0.5">
              {template.description}
              {template.regulator && ` · ${template.regulator}`}
            </p>
          </div>
        </div>
      )}

      {lastCtx && !template && (
        <div className="rounded-xl border-2 border-zinc-200 bg-zinc-50/60 p-3 flex items-center gap-3">
          <History className="size-4 text-zinc-500 shrink-0" />
          <p className="text-sm text-zinc-600 flex-1 min-w-0 truncate">
            ครั้งล่าสุดอัปโหลดไป: <strong>{lastCtx.label}</strong>
          </p>
          <button
            type="button"
            onClick={applyLastContext}
            className="text-xs font-bold text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] shrink-0"
          >
            ใช้ค่าเดิม
          </button>
        </div>
      )}

      <Field label="ไฟล์เอกสาร" required>
        <label
          className={cn(
            "flex flex-col items-center justify-center gap-2 h-32 rounded-xl border-2 border-dashed cursor-pointer transition-colors",
            file
              ? "border-[var(--color-brand-300)] bg-[var(--color-brand-50)]/40"
              : "border-zinc-200 bg-zinc-50/40 hover:border-zinc-300",
          )}
        >
          <input
            type="file"
            className="hidden"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
          <UploadIcon className="size-6 text-zinc-500" />
          {file ? (
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-900">{file.name}</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              คลิกเพื่อเลือกไฟล์ · PDF / รูปภาพ / DOCX
            </p>
          )}
        </label>
      </Field>

      <Field
        label="ชื่อเอกสาร"
        required
        error={errors.name?.message}
        htmlFor="name"
        hint={
          template
            ? "ปรับให้เฉพาะเจาะจง เช่น เพิ่ม code สาขา"
            : "ระบบดึงจากชื่อไฟล์ให้เริ่มต้น — ปรับได้"
        }
      >
        <Input
          id="name"
          {...register("name")}
          invalid={!!errors.name}
          placeholder="เช่น ใบอนุญาตประกอบการ ปั๊ม KKN-001"
          disabled={busy}
        />
      </Field>

      <Field label="คำอธิบาย" optional htmlFor="description">
        <textarea
          id="description"
          {...register("description")}
          rows={2}
          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-[var(--color-brand-500)] transition-colors disabled:bg-zinc-50"
          placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)"
          disabled={busy}
        />
      </Field>

      <Field
        label="ระดับการใช้งาน"
        required
        hint={
          template
            ? `ระบบแนะนำ "${OWNERSHIP_LEVELS.find((l) => l.value === template.suggestedLevel)?.label}" ตาม template — ปรับได้`
            : "เอกสารชิ้นเดียว ใช้ได้ที่ระดับใดระดับหนึ่ง"
        }
        error={errors.level?.message}
      >
        <Controller
          control={control}
          name="level"
          render={({ field }) => (
            <div className="flex flex-wrap gap-2">
              {OWNERSHIP_LEVELS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => field.onChange(l.value)}
                  disabled={busy}
                  className={cn(
                    "h-10 px-4 rounded-xl text-sm font-medium border transition-colors",
                    field.value === l.value
                      ? "bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]"
                      : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
        />
      </Field>

      {level === "company" && (
        <Field label="บริษัท" required htmlFor="companyId">
          <select
            id="companyId"
            {...register("companyId")}
            disabled={busy}
            className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base text-zinc-900 outline-none focus:border-[var(--color-brand-500)] transition-colors"
          >
            <option value="">— เลือกบริษัท —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {level === "business_type" && (
        <Field label="ประเภทธุรกิจ" required htmlFor="businessType">
          <select
            id="businessType"
            {...register("businessType")}
            disabled={busy}
            className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base text-zinc-900 outline-none focus:border-[var(--color-brand-500)] transition-colors"
          >
            <option value="">— เลือกประเภทธุรกิจ —</option>
            {businessTypes.map((b) => (
              <option key={b.value} value={b.value}>
                {b.emoji} {b.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {level === "branch" && (
        <>
          <Field label="บริษัท (กรองสาขา)" optional htmlFor="companyFilter">
            <select
              id="companyFilter"
              {...register("companyId")}
              disabled={busy}
              className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base text-zinc-900 outline-none focus:border-[var(--color-brand-500)] transition-colors"
            >
              <option value="">— ทุกบริษัท —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="สาขา" required htmlFor="branchId">
            <select
              id="branchId"
              {...register("branchId")}
              disabled={busy}
              className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base text-zinc-900 outline-none focus:border-[var(--color-brand-500)] transition-colors"
            >
              <option value="">— เลือกสาขา —</option>
              {branchOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} · {b.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      {level === "person" && (
        <Field label="พนักงาน" required htmlFor="personId">
          <select
            id="personId"
            {...register("personId")}
            disabled={busy}
            className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base text-zinc-900 outline-none focus:border-[var(--color-brand-500)] transition-colors"
          >
            <option value="">— เลือกพนักงาน —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.role}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Tag" hint="แท็กที่ระบบแนะนำ — กดเพื่อเอาออก หรือพิมพ์เพิ่มเอง">
        <div className="space-y-2">
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <Badge key={t} tone="brand" className="gap-1.5">
                  #{t}
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    className="hover:text-rose-700"
                    aria-label={`ลบ ${t}`}
                    disabled={busy}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <div className="relative flex gap-2">
            <div className="flex-1 relative">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                }}
                placeholder="พิมพ์แท็กแล้วกด Enter"
                disabled={busy}
              />
              {tagAutocomplete.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 rounded-xl border-2 border-zinc-200 bg-white shadow-pop z-10 overflow-hidden">
                  {tagAutocomplete.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => addTag(t)}
                      className="w-full px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
                    >
                      <span className="text-zinc-400">#</span>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => addTag(tagInput)}
              disabled={busy || !tagInput.trim()}
            >
              <Plus className="size-4" />
              เพิ่ม
            </Button>
          </div>
        </div>
      </Field>

      <div className="border-t border-zinc-100 pt-5">
        <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 font-bold mb-3">
          วันหมดอายุ {template?.expiryYears ? "(ระบบเดาให้)" : "(ไม่บังคับ)"}
        </p>
        <div className="space-y-4">
          <Field
            label="วันหมดอายุ"
            optional={!template?.expiryYears}
            htmlFor="expiryDate"
            hint={
              template?.expiryYears
                ? `default: today + ${template.expiryYears} ปี — ปรับได้`
                : undefined
            }
          >
            <Input
              id="expiryDate"
              type="date"
              {...register("expiryDate")}
              disabled={busy}
            />
          </Field>
          <Field
            label="แจ้งเตือนล่วงหน้า"
            optional
            hint="กด chip เพื่อเปิด/ปิด"
          >
            <div className="flex flex-wrap gap-2">
              {ALERT_DAY_PRESETS.map((d) => {
                const active = alertDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleAlertDay(d)}
                    disabled={busy}
                    className={cn(
                      "h-9 px-3.5 rounded-lg text-sm font-medium border transition-colors tabular-nums",
                      active
                        ? "bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]"
                        : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50",
                    )}
                  >
                    {d} วัน
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="หมายเหตุ" optional htmlFor="notes">
            <textarea
              id="notes"
              {...register("notes")}
              rows={2}
              className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-[var(--color-brand-500)] transition-colors disabled:bg-zinc-50"
              placeholder="เช่น ผู้รับผิดชอบ / link ระบบราชการ"
              disabled={busy}
            />
          </Field>
        </div>
      </div>

      <div className="flex items-center gap-2 justify-end pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={busy}
        >
          ยกเลิก
        </Button>
        <Button type="submit" variant="primary" loading={busy} size="lg">
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              กำลังอัปโหลด…
            </>
          ) : (
            <>
              <UploadIcon className="size-4" />
              อัปโหลดเอกสาร
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
