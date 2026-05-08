"use client";

// UploadForm — DocuFlow document upload (admin tier only)
// ────────────────────────────────────────────────────────────────────
// Flow:
//   1. POST /api/docuflow/upload → returns { documentId, uploadUrl }
//      (Document row + ownership + tags + renewal already created
//       by Agent A's API)
//   2. PUT file → uploadUrl (R2 presigned, 5-min lifetime)
//   3. Toast success → router.push to /docuflow/documents/[id]
// ────────────────────────────────────────────────────────────────────

import { useState, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X, Loader2, Upload as UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";

const OWNERSHIP_LEVELS = [
  { value: "group", label: "ทั้งกลุ่ม" },
  { value: "company", label: "บริษัท" },
  { value: "business_type", label: "ประเภทธุรกิจ" },
  { value: "branch", label: "สาขา" },
  { value: "person", label: "บุคคล" },
] as const;

type Level = (typeof OWNERSHIP_LEVELS)[number]["value"];

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
    alertDays: z.string().optional(),
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
}

export function UploadForm({
  companies,
  branches,
  users,
  businessTypes,
}: Props) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      level: "group",
      alertDays: "90,30,7",
    },
  });

  const level = watch("level") as Level;
  const filterCompanyId = watch("companyId");
  // Layered filter: when company picked, narrow branches to that company
  const branchOptions = filterCompanyId
    ? branches.filter((b) => b.companyId === filterCompanyId)
    : branches;

  function addTag() {
    const t = tagInput.trim();
    if (!t) return;
    if (tags.includes(t)) {
      setTagInput("");
      return;
    }
    setTags([...tags, t]);
    setTagInput("");
  }

  function removeTag(t: string) {
    setTags(tags.filter((x) => x !== t));
  }

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
          alertDays: values.alertDays
            ? values.alertDays
                .split(",")
                .map((s) => parseInt(s.trim(), 10))
                .filter((n) => Number.isFinite(n) && n >= 0 && n <= 365)
            : [90, 30, 7],
          notes: values.notes || undefined,
        }
      : undefined;

    setUploading(true);
    try {
      // Step 1 — create Document + ownership + tags + renewal, get uploadUrl
      const res = await fetch("/api/docuflow/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          description: values.description || undefined,
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

      // Step 2 — PUT file directly to R2
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      if (!putRes.ok) {
        throw new Error("อัปโหลดไฟล์ไป R2 ไม่สำเร็จ");
      }

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
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
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
        hint="เอกสารชิ้นเดียว ใช้ได้ที่ระดับใดระดับหนึ่ง"
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

      <Field label="Tag" hint="กด Enter เพื่อเพิ่มแท็ก เช่น ใบอนุญาต / ต่ออายุทุกปี">
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="พิมพ์แท็กแล้วกด Enter"
              disabled={busy}
            />
            <Button
              type="button"
              variant="outline"
              onClick={addTag}
              disabled={busy || !tagInput.trim()}
            >
              <Plus className="size-4" />
              เพิ่ม
            </Button>
          </div>
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
        </div>
      </Field>

      <div className="border-t border-zinc-100 pt-5">
        <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 font-bold mb-3">
          วันหมดอายุ (ไม่บังคับ)
        </p>
        <div className="space-y-4">
          <Field label="วันหมดอายุ" optional htmlFor="expiryDate">
            <Input
              id="expiryDate"
              type="date"
              {...register("expiryDate")}
              disabled={busy}
            />
          </Field>
          <Field
            label="แจ้งเตือนล่วงหน้า (วัน)"
            optional
            hint="คั่นด้วย comma เช่น 90,30,7"
            htmlFor="alertDays"
          >
            <Input
              id="alertDays"
              {...register("alertDays")}
              placeholder="90,30,7"
              disabled={busy}
            />
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
