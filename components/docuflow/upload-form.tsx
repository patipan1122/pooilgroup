"use client";

// UploadForm — DocuFlow (admin tier only)
// ────────────────────────────────────────────────────────────────────
// Phase 4 radical strip 2026-05-12 — user complained "ใช้โคตรยาก เยอะเกิน"
//
//   4 input only:
//     1. ไฟล์
//     2. ชื่อเอกสาร (auto-fill จาก filename)
//     3. เก็บไว้ที่ไหน — single search picker (group/บริษัท/สาขา/ฯลฯ)
//     4. วันหมดอายุ (optional)
//
//   Cut: description, tags input, alert chips, notes, last-context UI,
//   multi-checkbox 5-level ownership, template autofill, wizard pre-fill banner.
//
//   Default alert days = [90,30,7] hard-coded (org-level setting later).
//   Multi-ownership still supported in schema; UI is single pick + chip
//   "เพิ่มที่อื่นด้วย" to add a 2nd/3rd scope when needed.
// ────────────────────────────────────────────────────────────────────

import { useState, useTransition, useRef, useMemo, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  Upload as UploadIcon,
  Search,
  X,
  Plus,
  Building2,
  Store,
  Layers,
  UserCircle,
  Globe2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

const DEFAULT_ALERT_DAYS = [90, 30, 7];

const FormSchema = z.object({
  name: z.string().min(1, "ใส่ชื่อเอกสาร").max(255),
  expiryDate: z.string().optional(),
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

interface Props {
  companies: Company[];
  branches: Branch[];
  users: UserRow[];
  businessTypes: BizType[];
}

type ScopeKind = "group" | "company" | "business_type" | "branch" | "person";

interface Scope {
  kind: ScopeKind;
  /** id (company/branch/person) or businessType value */
  refId: string | null;
  label: string;
  emoji: string;
}

const TYPE_EMOJI: Record<string, string> = {
  fuel_station: "⛽",
  lpg_station: "🔵",
  lpg_retail: "🛢️",
  bottling_plant: "🏭",
  hotel: "🏨",
  convenience_store: "🏪",
  ev_station: "⚡",
  cafe: "☕",
  cafe_punthai: "🍵",
  massage_chair: "💺",
  claw_machine: "🎰",
  training_center: "🎓",
  transport: "🚛",
  gas_fleet: "🛻",
};

export function UploadForm({
  companies,
  branches,
  users,
  businessTypes,
}: Props) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [scopeQuery, setScopeQuery] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
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

  // Build searchable scope universe
  const allScopes: Scope[] = useMemo(() => {
    const list: Scope[] = [];
    list.push({
      kind: "group",
      refId: null,
      label: "ทั้งกลุ่ม Pooilgroup",
      emoji: "🌐",
    });
    for (const c of companies) {
      list.push({
        kind: "company",
        refId: c.id,
        label: `บริษัท ${c.name}`,
        emoji: "🏢",
      });
    }
    for (const b of businessTypes) {
      list.push({
        kind: "business_type",
        refId: b.value,
        label: `ทุกสาขา ${b.label}`,
        emoji: b.emoji ?? "📁",
      });
    }
    for (const br of branches) {
      const company = companies.find((c) => c.id === br.companyId);
      list.push({
        kind: "branch",
        refId: br.id,
        label: `${br.code} · ${br.name}`,
        emoji: TYPE_EMOJI[br.businessType] ?? "🏪",
      });
    }
    for (const u of users) {
      list.push({
        kind: "person",
        refId: u.id,
        label: `${u.name} (${u.role})`,
        emoji: "👤",
      });
    }
    return list;
  }, [companies, branches, businessTypes, users]);

  const q = scopeQuery.trim().toLowerCase();
  const filteredScopes = useMemo(() => {
    if (!q) return allScopes.slice(0, 40);
    return allScopes
      .filter((s) => s.label.toLowerCase().includes(q))
      .slice(0, 40);
  }, [q, allScopes]);

  function addScope(s: Scope) {
    setScopes((prev) => {
      const key = `${s.kind}:${s.refId ?? ""}`;
      if (prev.some((x) => `${x.kind}:${x.refId ?? ""}` === key)) return prev;
      return [...prev, s];
    });
    setScopeQuery("");
    setScopeOpen(false);
  }

  function removeScope(idx: number) {
    setScopes((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleFileChange(f: File | null) {
    setFile(f);
    if (!f || fileNameSyncRef.current) return;
    if (!watch("name")) {
      const cleaned = f.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
      setValue("name", cleaned);
      fileNameSyncRef.current = true;
    }
  }

  // Close scope picker on outside click
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(e.target as Node)) setScopeOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function onSubmit(values: FormValues) {
    if (!file) {
      toast.error("เลือกไฟล์ก่อน");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      toast.error("ไฟล์ใหญ่เกิน 500 MB");
      return;
    }
    if (scopes.length === 0) {
      toast.error("ระบุที่เก็บอย่างน้อย 1 อย่าง");
      return;
    }

    const ownerships = scopes.map((s) => {
      if (s.kind === "group") return { level: "group" };
      if (s.kind === "company")
        return { level: "company", companyId: s.refId ?? undefined };
      if (s.kind === "business_type")
        return { level: "business_type", businessType: s.refId ?? undefined };
      if (s.kind === "branch")
        return { level: "branch", branchId: s.refId ?? undefined };
      return { level: "person", personId: s.refId ?? undefined };
    });

    const renewal = values.expiryDate
      ? { expiryDate: values.expiryDate, alertDays: DEFAULT_ALERT_DAYS }
      : undefined;

    setUploading(true);
    try {
      const res = await fetch("/api/docuflow/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
          ownerships,
          tags: [],
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
      if (!putRes.ok) throw new Error("ส่งไฟล์ไป R2 ไม่สำเร็จ");

      toast.success("อัปโหลดเสร็จ");
      startTransition(() => {
        router.push(`/docuflow/documents/${documentId}`);
        router.refresh();
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  }

  const busy = uploading || isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* 1. File */}
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
            accept="application/pdf,image/*,.docx,.doc"
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
              คลิกหรือลากไฟล์มาวาง · PDF / รูป / DOCX
            </p>
          )}
        </label>
      </Field>

      {/* 2. Name */}
      <Field
        label="ชื่อเอกสาร"
        required
        error={errors.name?.message}
        htmlFor="name"
        hint="ระบบดึงจากชื่อไฟล์ให้ — แก้ได้"
      >
        <Input
          id="name"
          {...register("name")}
          invalid={!!errors.name}
          placeholder="เช่น ใบอนุญาตปั๊ม KKN-001"
          disabled={busy}
        />
      </Field>

      {/* 3. Scope — single search picker with multi chips */}
      <Field
        label="เก็บไว้ที่ไหน"
        required
        hint="พิมพ์ค้นหา · เลือกเพิ่มได้ถ้าใช้หลายที่"
      >
        <div className="space-y-2" ref={pickerRef}>
          {scopes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {scopes.map((s, i) => (
                <span
                  key={`${s.kind}:${s.refId}:${i}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-200)] text-sm"
                >
                  <span>{s.emoji}</span>
                  <span className="font-medium text-zinc-800">{s.label}</span>
                  <button
                    type="button"
                    onClick={() => removeScope(i)}
                    className="text-zinc-500 hover:text-rose-700"
                    disabled={busy}
                    aria-label={`ลบ ${s.label}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <Search className="size-4 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={scopeQuery}
              onChange={(e) => {
                setScopeQuery(e.target.value);
                setScopeOpen(true);
              }}
              onFocus={() => setScopeOpen(true)}
              placeholder={
                scopes.length === 0
                  ? "พิมพ์ เช่น KKN, ปั๊ม, Pooil, ทั้งกลุ่ม, ชื่อพนักงาน"
                  : "+ เพิ่มที่อื่นด้วย (ถ้าใช้หลายที่)"
              }
              className="pl-10"
              disabled={busy}
            />
            {scopeOpen && filteredScopes.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 rounded-xl border-2 border-zinc-200 bg-white shadow-pop z-20 max-h-72 overflow-y-auto">
                {filteredScopes.map((s) => (
                  <button
                    key={`${s.kind}:${s.refId ?? ""}`}
                    type="button"
                    onClick={() => addScope(s)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-zinc-50 transition-colors border-b border-zinc-50 last:border-b-0"
                  >
                    <span className="text-base shrink-0">{s.emoji}</span>
                    <span className="flex-1 truncate text-zinc-800">
                      {s.label}
                    </span>
                    <ScopeKindBadge kind={s.kind} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Field>

      {/* 4. Expiry (optional) */}
      <Field
        label="วันหมดอายุ"
        optional
        htmlFor="expiryDate"
        hint="ไม่มีก็เว้นได้ · ถ้าใส่ระบบจะเตือน 90/30/7 วันก่อน"
      >
        <Input
          id="expiryDate"
          type="date"
          {...register("expiryDate")}
          disabled={busy}
        />
      </Field>

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

function ScopeKindBadge({ kind }: { kind: ScopeKind }) {
  const map: Record<ScopeKind, { label: string; icon: React.ReactNode }> = {
    group: { label: "กลุ่ม", icon: <Globe2 className="size-3" /> },
    company: { label: "บริษัท", icon: <Building2 className="size-3" /> },
    business_type: { label: "ธุรกิจ", icon: <Layers className="size-3" /> },
    branch: { label: "สาขา", icon: <Store className="size-3" /> },
    person: { label: "บุคคล", icon: <UserCircle className="size-3" /> },
  };
  const { label, icon } = map[kind];
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-600 text-[10px] font-bold shrink-0">
      {icon}
      {label}
    </span>
  );
}
