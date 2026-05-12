"use client";

// UploadForm — DocuFlow document upload (admin tier only)
// ────────────────────────────────────────────────────────────────────
// Phase 3 redesign 2026-05-11 (multi-select ownership):
//   - Ownership ทำเป็น checkbox 5 ระดับ — เลือกได้ทุกระดับพร้อมกัน
//     (e.g. ใบผ่อนผัน อยู่ทั้ง บริษัท + ธุรกิจ + สาขา ได้พร้อมกัน)
//   - schema มี Document.ownership[] รองรับอยู่แล้ว — แค่ UI/API ผูก array
//   - Each level ที่ติ๊ก → เลือก scope ย่อย (multi-chips: companies, types,
//     branches, persons) "ทั้งกลุ่ม" ไม่มี sub-picker
//
// Inherited from Phase 2:
//   - Template autofill (name, expiry, alertDays, tags)
//   - Filename → name auto-fill (no template + empty name)
//   - Last-context memory (localStorage)
//   - Tag autocomplete + suggested chips
//   - Alert days preset chips
//
// Flow:
//   1. POST /api/docuflow/upload → { documentId, uploadUrl }
//   2. PUT file → uploadUrl (R2 presigned, 5-min lifetime)
//   3. Toast → save lastContext → router.push to detail page
// ────────────────────────────────────────────────────────────────────

import { useState, useTransition, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
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
  Building2,
  Layers,
  Store,
  UserCircle,
  Globe2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import {
  type LastUploadContext,
  readLastContext,
  writeLastContext,
} from "@/lib/docuflow/templates";

const ALERT_DAY_PRESETS = [180, 90, 60, 30, 14, 7] as const;

const FormSchema = z.object({
  name: z.string().min(1, "กรุณาใส่ชื่อเอกสาร").max(255),
  description: z.string().max(2000).optional(),
  expiryDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

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

interface InitialOwnership {
  group: boolean;
  companyIds: string[];
  businessTypes: string[];
  branchIds: string[];
  personIds: string[];
}

interface Props {
  companies: Company[];
  branches: Branch[];
  users: UserRow[];
  businessTypes: BizType[];
  orgTagSuggestions?: string[];
  /** Pre-fill ownership from wizard scope picker */
  initialOwnership?: InitialOwnership;
  /** Wizard step 1 answer — controls expiry section default visibility */
  hasExpiryHint?: "expires" | "forever" | null;
  /** Tweak copy / breadcrumb when user came through wizard */
  fromWizard?: boolean;
}

interface OwnershipState {
  group: boolean;
  companyIds: string[];
  businessTypes: string[];
  branchIds: string[];
  personIds: string[];
}

const EMPTY_OWNERSHIP: OwnershipState = {
  group: false,
  companyIds: [],
  businessTypes: [],
  branchIds: [],
  personIds: [],
};

function ownershipCount(o: OwnershipState): number {
  return (
    (o.group ? 1 : 0) +
    o.companyIds.length +
    o.businessTypes.length +
    o.branchIds.length +
    o.personIds.length
  );
}

export function UploadForm({
  companies,
  branches,
  users,
  businessTypes,
  orgTagSuggestions = [],
  initialOwnership,
  hasExpiryHint = null,
  fromWizard = false,
}: Props) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [alertDays, setAlertDays] = useState<number[]>([90, 30, 7]);
  const [ownership, setOwnership] = useState<OwnershipState>(
    initialOwnership ?? EMPTY_OWNERSHIP,
  );
  const [branchFilter, setBranchFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [companyForBranchFilter, setCompanyForBranchFilter] = useState<
    string | null
  >(null);
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [lastCtx, setLastCtx] = useState<LastUploadContext | null>(null);
  const fileNameSyncRef = useRef(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: "", expiryDate: "" },
  });

  useEffect(() => {
    const ctx = readLastContext();
    if (ctx) setLastCtx(ctx);
  }, []);

  function applyLastContext() {
    if (!lastCtx) return;
    // Convert legacy single-level lastCtx into multi-select state
    const next: OwnershipState = { ...EMPTY_OWNERSHIP };
    if (lastCtx.level === "group") next.group = true;
    if (lastCtx.companyId) next.companyIds = [lastCtx.companyId];
    if (lastCtx.businessType) next.businessTypes = [lastCtx.businessType];
    if (lastCtx.branchId) next.branchIds = [lastCtx.branchId];
    if (lastCtx.personId) next.personIds = [lastCtx.personId];
    setOwnership(next);
    toast.success(`เลือก ${lastCtx.label} แล้ว`);
  }

  function handleFileChange(f: File | null) {
    setFile(f);
    if (!f || fileNameSyncRef.current) return;
    const currentName = watch("name");
    if (!currentName) {
      const cleaned = f.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
      setValue("name", cleaned);
      fileNameSyncRef.current = true;
    }
  }

  function toggleArrayMember(
    list: string[],
    value: string,
    setter: (next: string[]) => void,
  ) {
    setter(
      list.includes(value)
        ? list.filter((x) => x !== value)
        : [...list, value],
    );
  }

  function addTag(t: string) {
    const trimmed = t.trim();
    if (!trimmed || tags.includes(trimmed)) {
      setTagInput("");
      return;
    }
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

  const filteredBranches = branches.filter((b) => {
    if (companyForBranchFilter && b.companyId !== companyForBranchFilter)
      return false;
    if (!branchFilter) return true;
    const q = branchFilter.toLowerCase();
    return (
      b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q)
    );
  });

  const filteredUsers = personFilter
    ? users.filter((u) =>
        u.name.toLowerCase().includes(personFilter.toLowerCase()),
      )
    : users;

  async function onSubmit(values: FormValues) {
    if (!file) {
      toast.error("กรุณาเลือกไฟล์เอกสาร");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      toast.error("ไฟล์ใหญ่เกิน 500 MB");
      return;
    }
    if (ownershipCount(ownership) === 0) {
      toast.error("เลือกระดับการใช้งานอย่างน้อย 1 อย่าง");
      return;
    }

    // Build ownerships array — one row per scope element
    const ownerships: Array<Record<string, string>> = [];
    if (ownership.group) ownerships.push({ level: "group" });
    for (const cid of ownership.companyIds)
      ownerships.push({ level: "company", companyId: cid });
    for (const bt of ownership.businessTypes)
      ownerships.push({ level: "business_type", businessType: bt });
    for (const bid of ownership.branchIds)
      ownerships.push({ level: "branch", branchId: bid });
    for (const pid of ownership.personIds)
      ownerships.push({ level: "person", personId: pid });

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
          // documentType reserved for future Tier-2 type system (not used in Phase 3 wizard)
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
          ownerships,
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

      // Save lastContext — primary scope (first non-group ownership for next time)
      const firstBranch = ownership.branchIds[0];
      const firstCompany = ownership.companyIds[0];
      const firstType = ownership.businessTypes[0];
      const firstPerson = ownership.personIds[0];

      let lastCtxToSave: LastUploadContext | null = null;
      if (firstBranch) {
        const b = branches.find((x) => x.id === firstBranch);
        lastCtxToSave = {
          level: "branch",
          branchId: firstBranch,
          companyId: b?.companyId,
          label: b ? `${b.code} · ${b.name}` : "สาขา",
        };
      } else if (firstCompany) {
        const c = companies.find((x) => x.id === firstCompany);
        lastCtxToSave = {
          level: "company",
          companyId: firstCompany,
          label: c?.name ?? "บริษัท",
        };
      } else if (firstType) {
        const t = businessTypes.find((x) => x.value === firstType);
        lastCtxToSave = {
          level: "business_type",
          businessType: firstType,
          label: t ? `${t.emoji} ${t.label}` : "ประเภทธุรกิจ",
        };
      } else if (firstPerson) {
        const u = users.find((x) => x.id === firstPerson);
        lastCtxToSave = {
          level: "person",
          personId: firstPerson,
          label: u?.name ?? "บุคคล",
        };
      } else if (ownership.group) {
        lastCtxToSave = { level: "group", label: "ทั้งกลุ่ม" };
      }
      if (lastCtxToSave) writeLastContext(lastCtxToSave);

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
  const ownCount = ownershipCount(ownership);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {fromWizard && hasExpiryHint && (
        <div className="rounded-xl border-2 border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/50 p-4 flex items-start gap-3">
          <Sparkles className="size-5 text-[var(--color-brand-600)] mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-zinc-900">
              ผ่านตัวช่วย — {hasExpiryHint === "expires" ? "⏰ เอกสารมีวันหมดอายุ" : "∞ เอกสารไม่มีวันหมดอายุ"}
            </p>
            <p className="text-xs text-zinc-600 mt-0.5">
              ระดับการใช้งานถูก pre-set ตามขั้นตอนแล้ว — ปรับเพิ่ม/ลด ใน checkbox ด้านล่างได้
            </p>
          </div>
        </div>
      )}

      {lastCtx && (
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
        hint="ระบบดึงจากชื่อไฟล์ให้เริ่มต้น — ปรับได้"
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

      {/* ============================================================
          OWNERSHIP — MULTI-SELECT ระดับการใช้งาน
          เลือกได้ทุกระดับพร้อมกัน (e.g. ใบผ่อนผัน = บริษัท + ธุรกิจ + สาขา)
          ============================================================ */}
      <div className="rounded-2xl border-2 border-zinc-200 p-4 sm:p-5 bg-zinc-50/40">
        <div className="flex items-baseline justify-between mb-3">
          <p className="text-sm font-bold text-zinc-900">
            ระดับการใช้งาน
            <span className="text-rose-600 ml-1">*</span>
          </p>
          <span className="text-xs text-zinc-500">
            {ownCount === 0
              ? "ติ๊กอย่างน้อย 1 ระดับ"
              : `เลือก ${ownCount} ขอบเขต`}
          </span>
        </div>
        <p className="text-xs text-zinc-500 mb-4">
          เอกสารชิ้นเดียวอยู่ได้หลายระดับพร้อมกัน — ทั้งบริษัท + ธุรกิจ + สาขา = ติ๊กทั้ง 3
        </p>

        <div className="space-y-3">
          {/* ทั้งกลุ่ม */}
          <OwnershipRow
            icon={<Globe2 className="size-4" />}
            label="ทั้งกลุ่ม"
            sublabel="ใช้ทั่ว Pooilgroup"
            checked={ownership.group}
            onToggle={() =>
              setOwnership({ ...ownership, group: !ownership.group })
            }
            disabled={busy}
          />

          {/* บริษัท */}
          <OwnershipRow
            icon={<Building2 className="size-4" />}
            label="บริษัท"
            sublabel="ใช้ทั้งบริษัทใดบริษัทหนึ่งหรือทั้งสอง"
            checked={ownership.companyIds.length > 0}
            indeterminate={
              ownership.companyIds.length > 0 &&
              ownership.companyIds.length < companies.length
            }
            onToggle={() =>
              setOwnership({
                ...ownership,
                companyIds:
                  ownership.companyIds.length > 0
                    ? []
                    : companies.map((c) => c.id),
              })
            }
            disabled={busy}
          >
            <div className="flex flex-wrap gap-1.5">
              {companies.map((c) => {
                const on = ownership.companyIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      toggleArrayMember(
                        ownership.companyIds,
                        c.id,
                        (next) =>
                          setOwnership({ ...ownership, companyIds: next }),
                      )
                    }
                    disabled={busy}
                    className={cn(
                      "h-8 px-3 rounded-lg text-xs font-medium border transition-colors",
                      on
                        ? "bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]"
                        : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50",
                    )}
                  >
                    {on && <Check className="size-3 inline mr-1" />}
                    {c.name}
                  </button>
                );
              })}
            </div>
          </OwnershipRow>

          {/* ประเภทธุรกิจ */}
          <OwnershipRow
            icon={<Layers className="size-4" />}
            label="ประเภทธุรกิจ"
            sublabel="ใช้กับทุกสาขาในประเภทธุรกิจนั้น"
            checked={ownership.businessTypes.length > 0}
            indeterminate={
              ownership.businessTypes.length > 0 &&
              ownership.businessTypes.length < businessTypes.length
            }
            onToggle={() =>
              setOwnership({
                ...ownership,
                businessTypes:
                  ownership.businessTypes.length > 0
                    ? []
                    : businessTypes.map((b) => b.value),
              })
            }
            disabled={busy}
          >
            <div className="flex flex-wrap gap-1.5">
              {businessTypes.map((b) => {
                const on = ownership.businessTypes.includes(b.value);
                return (
                  <button
                    key={b.value}
                    type="button"
                    onClick={() =>
                      toggleArrayMember(
                        ownership.businessTypes,
                        b.value,
                        (next) =>
                          setOwnership({ ...ownership, businessTypes: next }),
                      )
                    }
                    disabled={busy}
                    className={cn(
                      "h-8 px-3 rounded-lg text-xs font-medium border transition-colors",
                      on
                        ? "bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]"
                        : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50",
                    )}
                  >
                    {b.emoji} {b.label}
                  </button>
                );
              })}
            </div>
          </OwnershipRow>

          {/* สาขา */}
          <OwnershipRow
            icon={<Store className="size-4" />}
            label="สาขา"
            sublabel={`${ownership.branchIds.length || 0} สาขาที่เลือก`}
            checked={ownership.branchIds.length > 0}
            onToggle={() =>
              setOwnership({
                ...ownership,
                branchIds: ownership.branchIds.length > 0 ? [] : [],
              })
            }
            disabled={busy}
            forceOpen={ownership.branchIds.length > 0}
          >
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="ค้นหาสาขา (code หรือชื่อ)"
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  disabled={busy}
                  className="flex-1 min-w-[180px]"
                />
                <select
                  value={companyForBranchFilter ?? ""}
                  onChange={(e) =>
                    setCompanyForBranchFilter(e.target.value || null)
                  }
                  disabled={busy}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700"
                >
                  <option value="">— ทุกบริษัท —</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1">
                {filteredBranches.length === 0 ? (
                  <p className="text-sm text-zinc-500 p-3 text-center">
                    ไม่พบสาขา
                  </p>
                ) : (
                  filteredBranches.map((b) => {
                    const on = ownership.branchIds.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() =>
                          toggleArrayMember(
                            ownership.branchIds,
                            b.id,
                            (next) =>
                              setOwnership({
                                ...ownership,
                                branchIds: next,
                              }),
                          )
                        }
                        disabled={busy}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left text-sm transition-colors",
                          on
                            ? "bg-[var(--color-brand-50)] text-[var(--color-brand-900)]"
                            : "hover:bg-zinc-50 text-zinc-700",
                        )}
                      >
                        <span
                          className={cn(
                            "size-4 rounded border-2 flex items-center justify-center shrink-0",
                            on
                              ? "bg-[var(--color-brand-600)] border-[var(--color-brand-600)]"
                              : "border-zinc-300",
                          )}
                        >
                          {on && <Check className="size-3 text-white" />}
                        </span>
                        <span className="font-mono text-xs text-zinc-500 shrink-0 w-16">
                          {b.code}
                        </span>
                        <span className="truncate">{b.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </OwnershipRow>

          {/* บุคคล */}
          <OwnershipRow
            icon={<UserCircle className="size-4" />}
            label="บุคคล"
            sublabel={`${ownership.personIds.length || 0} คนที่เลือก`}
            checked={ownership.personIds.length > 0}
            onToggle={() =>
              setOwnership({
                ...ownership,
                personIds: ownership.personIds.length > 0 ? [] : [],
              })
            }
            disabled={busy}
            forceOpen={ownership.personIds.length > 0}
          >
            <div className="space-y-2">
              <Input
                placeholder="ค้นหาชื่อพนักงาน"
                value={personFilter}
                onChange={(e) => setPersonFilter(e.target.value)}
                disabled={busy}
              />
              <div className="max-h-40 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1">
                {filteredUsers.length === 0 ? (
                  <p className="text-sm text-zinc-500 p-3 text-center">
                    ไม่พบพนักงาน
                  </p>
                ) : (
                  filteredUsers.slice(0, 100).map((u) => {
                    const on = ownership.personIds.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() =>
                          toggleArrayMember(
                            ownership.personIds,
                            u.id,
                            (next) =>
                              setOwnership({
                                ...ownership,
                                personIds: next,
                              }),
                          )
                        }
                        disabled={busy}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left text-sm transition-colors",
                          on
                            ? "bg-[var(--color-brand-50)] text-[var(--color-brand-900)]"
                            : "hover:bg-zinc-50 text-zinc-700",
                        )}
                      >
                        <span
                          className={cn(
                            "size-4 rounded border-2 flex items-center justify-center shrink-0",
                            on
                              ? "bg-[var(--color-brand-600)] border-[var(--color-brand-600)]"
                              : "border-zinc-300",
                          )}
                        >
                          {on && <Check className="size-3 text-white" />}
                        </span>
                        <span className="truncate flex-1">{u.name}</span>
                        <span className="text-[10px] uppercase tracking-wider text-zinc-400 shrink-0">
                          {u.role}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </OwnershipRow>
        </div>
      </div>

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
          วันหมดอายุ{" "}
          {hasExpiryHint === "expires"
            ? "(จากตัวช่วย — กำหนดวันที่ด้วย)"
            : hasExpiryHint === "forever"
              ? "(ไม่จำเป็น — ตัวช่วยระบุไม่มีหมดอายุ)"
              : "(ไม่บังคับ)"}
        </p>
        <div className="space-y-4">
          <Field
            label="วันหมดอายุ"
            optional={hasExpiryHint !== "expires"}
            htmlFor="expiryDate"
            hint={
              hasExpiryHint === "expires"
                ? "ระบุวันที่บนเอกสาร — alert chips ใต้นี้จะนับถอยหลัง"
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
          <Field label="แจ้งเตือนล่วงหน้า" optional hint="กด chip เพื่อเปิด/ปิด">
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

/* ============================================================
   OwnershipRow — collapsible row per ownership level
   ============================================================ */

function OwnershipRow({
  icon,
  label,
  sublabel,
  checked,
  indeterminate,
  onToggle,
  disabled,
  children,
  forceOpen,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  checked: boolean;
  indeterminate?: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
  forceOpen?: boolean;
}) {
  const open = checked || forceOpen;
  return (
    <div className="rounded-xl bg-white border border-zinc-200">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-zinc-50 transition-colors rounded-xl"
      >
        <span
          className={cn(
            "size-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors",
            checked
              ? "bg-[var(--color-brand-600)] border-[var(--color-brand-600)]"
              : indeterminate
                ? "bg-[var(--color-brand-100)] border-[var(--color-brand-400)]"
                : "border-zinc-300",
          )}
        >
          {checked && <Check className="size-3.5 text-white" />}
          {indeterminate && !checked && (
            <span className="size-2 bg-[var(--color-brand-600)] rounded-sm" />
          )}
        </span>
        <span className="size-8 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-600 shrink-0">
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-zinc-900">{label}</p>
          {sublabel && (
            <p className="text-xs text-zinc-500 truncate">{sublabel}</p>
          )}
        </div>
      </button>
      {open && children && (
        <div className="px-3 pb-3 pt-1">{children}</div>
      )}
    </div>
  );
}
