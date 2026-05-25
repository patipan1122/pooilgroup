"use client";

// UploadForm — DocuFlow (admin tier only)
// ────────────────────────────────────────────────────────────────────
// 2026-05-25 — switched to server-side proxy upload for files ≤ 25 MB.
// Reason: browser → R2 PUT was failing silently on prod (R2 bucket CORS
// not allowlisted). Proxy uploads via Next.js server, eliminating CORS
// as a failure mode. Files > 25 MB still use presigned PUT.
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
  Building2,
  Store,
  Layers,
  UserCircle,
  Globe2,
  ChevronDown,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

const DEFAULT_ALERT_DAYS = [90, 30, 7];
const PROXY_MAX_BYTES = 25 * 1024 * 1024;

const FormSchema = z.object({
  name: z.string().min(1, "ใส่ชื่อเอกสาร").max(255),
  expiryDate: z.string().optional(),
  description: z.string().max(2000).optional(),
  responsibleUserId: z.string().optional(),
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

interface Props {
  companies: Company[];
  branches: Branch[];
  users: UserRow[];
  businessTypes: BizType[];
}

type ScopeKind = "group" | "company" | "business_type" | "branch" | "person";

interface Scope {
  kind: ScopeKind;
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const fileNameSyncRef = useRef(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      expiryDate: "",
      description: "",
      responsibleUserId: "",
      notes: "",
    },
  });

  const expiryWatch = watch("expiryDate");

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

  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(e.target as Node)) setScopeOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function buildOwnerships() {
    return scopes.map((s) => {
      if (s.kind === "group") return { level: "group" as const };
      if (s.kind === "company")
        return { level: "company" as const, companyId: s.refId ?? undefined };
      if (s.kind === "business_type")
        return {
          level: "business_type" as const,
          businessType: s.refId ?? undefined,
        };
      if (s.kind === "branch")
        return { level: "branch" as const, branchId: s.refId ?? undefined };
      return { level: "person" as const, personId: s.refId ?? undefined };
    });
  }

  function buildRenewal(values: FormValues) {
    if (!values.expiryDate) return undefined;
    return {
      expiryDate: values.expiryDate,
      alertDays: DEFAULT_ALERT_DAYS,
      ...(values.responsibleUserId
        ? { responsibleUserId: values.responsibleUserId }
        : {}),
      ...(values.notes ? { notes: values.notes } : {}),
    };
  }

  async function uploadViaProxy(values: FormValues, fileObj: File) {
    const fd = new FormData();
    fd.append("file", fileObj);
    fd.append(
      "metadata",
      JSON.stringify({
        name: values.name,
        description: values.description || undefined,
        ownerships: buildOwnerships(),
        tags: [],
        renewal: buildRenewal(values),
      }),
    );

    const res = await fetch("/api/docuflow/upload-proxy", {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        err.error ||
          `อัปโหลดไม่สำเร็จ (HTTP ${res.status})${err.detail ? " · " + err.detail : ""}`,
      );
    }
    const data = (await res.json()) as { documentId: string };
    return data.documentId;
  }

  async function uploadViaPresigned(values: FormValues, fileObj: File) {
    const res = await fetch("/api/docuflow/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name,
        description: values.description || undefined,
        filename: fileObj.name,
        mimeType: fileObj.type || "application/octet-stream",
        fileSize: fileObj.size,
        ownerships: buildOwnerships(),
        tags: [],
        renewal: buildRenewal(values),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "เตรียมอัปโหลดไม่สำเร็จ");
    }
    const { documentId, uploadUrl } = (await res.json()) as {
      documentId: string;
      uploadUrl: string;
    };

    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": fileObj.type || "application/octet-stream",
      },
      body: fileObj,
    });
    if (!putRes.ok) {
      const text = await putRes.text().catch(() => "");
      // Try to cleanup the orphan row server-side
      fetch(`/api/docuflow/upload?id=${documentId}`, {
        method: "DELETE",
      }).catch(() => {});
      throw new Error(
        `ส่งไฟล์ไป R2 ไม่สำเร็จ (HTTP ${putRes.status})${text ? " · " + text.slice(0, 120) : ""}`,
      );
    }
    return documentId;
  }

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

    setUploading(true);
    try {
      const documentId =
        file.size <= PROXY_MAX_BYTES
          ? await uploadViaProxy(values, file)
          : await uploadViaPresigned(values, file);

      toast.success("อัปโหลดเสร็จ");
      startTransition(() => {
        router.push(`/docuflow/documents/${documentId}`);
        router.refresh();
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ";
      toast.error(msg);
      console.error("[upload]", e);
    } finally {
      setUploading(false);
    }
  }

  const busy = uploading || isPending;
  const hasExpiry = Boolean(expiryWatch);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <Field label="ไฟล์เอกสาร" required>
        <label
          className={cn(
            "df-upload-zone relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors",
            file
              ? "border-[var(--color-brand-300)] bg-[var(--color-brand-50)]/40"
              : "border-[var(--color-brand-500)] hover:border-[var(--color-brand-700)]",
          )}
          style={{
            padding: "32px 24px",
            minHeight: file ? 140 : 220,
            background: file
              ? undefined
              : "linear-gradient(180deg, #EFF3FC, #FAF6EE)",
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add("df-drop-hover");
          }}
          onDragLeave={(e) =>
            e.currentTarget.classList.remove("df-drop-hover")
          }
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("df-drop-hover");
            const f = e.dataTransfer.files?.[0];
            if (f) handleFileChange(f);
          }}
        >
          <input
            type="file"
            className="hidden"
            accept="application/pdf,image/*,.docx,.doc"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
          {file ? (
            <>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: "var(--color-brand-50)",
                  color: "var(--color-brand-700)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <UploadIcon className="size-7" />
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-zinc-900">{file.name}</p>
                <p className="text-xs text-zinc-500 mt-1">
                  {(file.size / 1024 / 1024).toFixed(2)} MB · พร้อมส่ง
                  {file.size > PROXY_MAX_BYTES ? " · presigned mode" : ""}
                </p>
                <p className="text-[11px] text-zinc-500 mt-2">
                  คลิกอีกครั้งเพื่อเปลี่ยนไฟล์
                </p>
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 16,
                  background: "#fff",
                  boxShadow: "0 8px 24px -8px rgba(27,71,181,0.3)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--color-brand-600)",
                }}
              >
                <UploadIcon className="size-7" />
              </div>
              <div className="text-center">
                <p
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    color: "var(--color-zinc-900, #18181b)",
                    margin: 0,
                  }}
                >
                  ลากไฟล์มาวางตรงนี้
                </p>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--color-zinc-500, #71717a)",
                    marginTop: 6,
                    marginBottom: 0,
                  }}
                >
                  หรือคลิกเพื่อเลือกจากเครื่อง · PDF · รูป · DOCX (สูงสุด 500 MB)
                </p>
              </div>
              <span
                style={{
                  position: "absolute",
                  top: 14,
                  right: 14,
                  background: "#fff",
                  padding: "6px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--color-brand-600)",
                  border: "1px solid var(--color-brand-200)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                ✦ AI Auto-fill เปิดอยู่
              </span>
            </>
          )}
        </label>
      </Field>

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

      {/* Advanced section — collapsed by default */}
      <div className="border-2 border-zinc-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-zinc-50 hover:bg-zinc-100 transition-colors"
          aria-expanded={advancedOpen}
        >
          <span className="inline-flex items-center gap-2 text-sm font-bold text-zinc-700">
            <Settings2 className="size-4 text-[var(--color-brand-600)]" />
            ตั้งค่าขั้นสูง
            <span className="text-[11px] font-medium text-zinc-500 ml-1">
              คำอธิบาย · ผู้รับผิดชอบ · หมายเหตุ
            </span>
          </span>
          <ChevronDown
            className={cn(
              "size-4 text-zinc-500 transition-transform",
              advancedOpen && "rotate-180",
            )}
          />
        </button>
        {advancedOpen && (
          <div className="p-4 space-y-4 bg-white">
            <Field
              label="คำอธิบาย"
              optional
              htmlFor="description"
              hint="บอกข้อมูลเพิ่มเติม · เช่น สำหรับยื่นกระทรวงพลังงาน"
            >
              <textarea
                id="description"
                {...register("description")}
                rows={3}
                disabled={busy}
                className="w-full rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none resize-none"
                placeholder="(ไม่บังคับ)"
              />
            </Field>

            <Field
              label="ผู้รับผิดชอบ"
              optional
              htmlFor="responsibleUserId"
              hint={
                hasExpiry
                  ? "ระบบจะส่ง notification ให้คนนี้ก่อนหมดอายุ"
                  : "ใช้คู่กับวันหมดอายุ · ระบบจะเตือนคนนี้"
              }
            >
              <select
                id="responsibleUserId"
                {...register("responsibleUserId")}
                disabled={busy || !hasExpiry}
                className="w-full rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none bg-white disabled:bg-zinc-50 disabled:text-zinc-400"
              >
                <option value="">— ไม่ระบุ —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="หมายเหตุการต่ออายุ"
              optional
              htmlFor="notes"
              hint={
                hasExpiry
                  ? "บอกขั้นตอนพิเศษ · เช่น ต้องยื่นล่วงหน้า 60 วัน"
                  : "ใช้คู่กับวันหมดอายุ"
              }
            >
              <textarea
                id="notes"
                {...register("notes")}
                rows={2}
                disabled={busy || !hasExpiry}
                className="w-full rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none resize-none disabled:bg-zinc-50 disabled:text-zinc-400"
                placeholder="(ไม่บังคับ)"
              />
            </Field>
          </div>
        )}
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
