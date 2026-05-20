"use client";

// Public repair ticket form. Compresses photos client-side before submit.
// Submits via the createTicket server action.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createTicket } from "@/lib/repair/actions";
import { URGENCY_LABELS } from "@/lib/repair/types";
import { Camera, CheckCircle2, AlertCircle, Loader2, X, Copy } from "lucide-react";

interface Company { id: string; name: string; code: string }
interface Branch { id: string; name: string; code: string; business_type: string; company_id: string }
interface Category { id: string; slug: string; label: string; emoji: string | null; default_urgency: "URGENT" | "NORMAL" | "LOW" }

interface Props {
  orgName: string;
  companies: Company[];
  branches: Branch[];
  categories: Category[];
}

interface PhotoEntry {
  id: string;
  dataUrl: string;
  sizeKB: number;
  phase: "BEFORE" | "DURING" | "AFTER" | "PART" | "RECEIPT";
}

async function compressImage(file: File, maxEdge = 1024, quality = 0.65): Promise<{ dataUrl: string; sizeKB: number }> {
  const bmp = await createImageBitmap(file);
  const ratio = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * ratio));
  const h = Math.max(1, Math.round(bmp.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas-unsupported");
  ctx.drawImage(bmp, 0, 0, w, h);
  // Try WebP; fall back to JPEG if browser doesn't support it.
  let dataUrl = canvas.toDataURL("image/webp", quality);
  if (!dataUrl.startsWith("data:image/webp")) {
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  const sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024); // base64 → bytes / 1024
  return { dataUrl, sizeKB };
}

export function PublicRepairForm({ orgName, companies, branches, categories }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [companyId, setCompanyId] = useState<string>("");
  const [branchId, setBranchId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [urgency, setUrgency] = useState<"URGENT" | "NORMAL" | "LOW">("NORMAL");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reporterName, setReporterName] = useState("");
  const [reporterPhone, setReporterPhone] = useState("");
  const [reporterEmail, setReporterEmail] = useState("");
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ticketCode: string; id: string } | null>(null);

  // When a category is picked, suggest urgency
  function pickCategory(id: string) {
    setCategoryId(id);
    const c = categories.find((x) => x.id === id);
    if (c) setUrgency(c.default_urgency);
  }

  const filteredBranches = useMemo(
    () => (companyId ? branches.filter((b) => b.company_id === companyId) : branches),
    [branches, companyId],
  );

  async function handlePickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const remaining = 6 - photos.length;
    if (remaining <= 0) {
      setError("รูปสูงสุด 6 รูป");
      return;
    }
    const accept = files.slice(0, remaining);
    const out: PhotoEntry[] = [];
    for (const f of accept) {
      if (!f.type.startsWith("image/")) continue;
      try {
        const { dataUrl, sizeKB } = await compressImage(f);
        out.push({
          id: crypto.randomUUID(),
          dataUrl,
          sizeKB,
          phase: "BEFORE",
        });
      } catch {
        setError("ย่อรูปไม่สำเร็จ · ใช้รูปอื่นได้ไหม");
      }
    }
    setPhotos((prev) => [...prev, ...out]);
    // reset input so same file can be picked again
    e.target.value = "";
  }

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (title.trim().length < 5) {
      setError("หัวเรื่องสั้นไป · เขียนให้บอกอาการได้ (อย่างน้อย 5 ตัวอักษร)");
      return;
    }
    if (reporterName.trim().length < 2) {
      setError("กรอกชื่อ-นามสกุล");
      return;
    }
    if (reporterPhone.trim().length < 9) {
      setError("กรอกเบอร์โทรให้ครบ");
      return;
    }

    startTransition(async () => {
      const res = await createTicket({
        companyId: companyId || null,
        branchId: branchId || null,
        categoryId: categoryId || null,
        title: title.trim(),
        description: description.trim(),
        urgency,
        source: "FREEFORM",
        reporterName: reporterName.trim(),
        reporterPhone: reporterPhone.trim(),
        reporterEmail: reporterEmail.trim() || undefined,
        photos: photos.map((p) => ({ phase: p.phase, dataUrl: p.dataUrl })),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({ ticketCode: res.ticketCode, id: res.id });
      router.refresh();
    });
  }

  if (result) {
    const trackUrl = `/r/track?code=${encodeURIComponent(result.ticketCode)}`;
    return (
      <div className="rounded-3xl border-2 border-emerald-200 bg-emerald-50 p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="size-12 rounded-2xl bg-emerald-600 text-white grid place-items-center flex-shrink-0">
            <CheckCircle2 className="size-7" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-extrabold text-emerald-900">รับเรื่องเรียบร้อย</h2>
            <p className="mt-1 text-emerald-800 text-sm">
              ทีมงานของ {orgName} ได้รับใบแจ้งซ่อมของคุณแล้ว — เริ่มดำเนินการตามเวลา SLA
            </p>
            <div className="mt-4 rounded-xl bg-white border border-emerald-200 p-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wide font-bold">เลขที่ใบ</p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-3xl font-black tracking-tight text-zinc-900">
                  {result.ticketCode}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(result.ticketCode);
                  }}
                  className="size-9 rounded-lg border border-zinc-200 grid place-items-center hover:bg-zinc-50"
                  aria-label="คัดลอกเลขที่ใบ"
                >
                  <Copy className="size-4 text-zinc-700" />
                </button>
              </div>
              <p className="mt-3 text-xs text-zinc-600">
                เก็บเลขที่ใบไว้กับเบอร์ที่กรอก · ใช้เปิดดูสถานะภายหลัง
              </p>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href={trackUrl}
                className="inline-flex items-center gap-2 h-12 px-5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700"
              >
                ดูสถานะใบนี้
              </Link>
              <Link
                href="/r/new"
                className="inline-flex items-center gap-2 h-12 px-5 rounded-xl border-2 border-emerald-300 text-emerald-800 font-bold hover:bg-emerald-100"
              >
                แจ้งใบใหม่อีก
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* Company picker (only if more than 1) */}
      {companies.length > 1 && (
        <Field label="บริษัท" hint="เลือกถ้ารู้ว่าเป็นของบริษัทไหน">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <ChipButton
              active={companyId === ""}
              onClick={() => {
                setCompanyId("");
                setBranchId("");
              }}
            >
              ไม่ระบุ
            </ChipButton>
            {companies.map((c) => (
              <ChipButton
                key={c.id}
                active={companyId === c.id}
                onClick={() => {
                  setCompanyId(c.id);
                  setBranchId("");
                }}
              >
                {c.name}
              </ChipButton>
            ))}
          </div>
        </Field>
      )}

      {/* Branch */}
      {filteredBranches.length > 0 && (
        <Field label="สาขา" hint="เลือกสาขาที่เกิดปัญหา (ถ้ารู้)">
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="w-full h-12 px-3 rounded-xl border-2 border-zinc-200 bg-white text-zinc-900 font-medium focus:border-[var(--color-brand-500)] outline-none"
          >
            <option value="">— ไม่ระบุสาขา —</option>
            {filteredBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} · {b.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {/* Category */}
      {categories.length > 0 && (
        <Field label="หมวดปัญหา" hint="ช่วยทีมงานจัดงานได้ตรงกลุ่ม">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {categories.map((c) => (
              <ChipButton
                key={c.id}
                active={categoryId === c.id}
                onClick={() => pickCategory(c.id)}
              >
                <span className="mr-1">{c.emoji ?? "🛠"}</span>
                {c.label}
              </ChipButton>
            ))}
            <ChipButton active={categoryId === ""} onClick={() => setCategoryId("")}>
              อื่นๆ
            </ChipButton>
          </div>
        </Field>
      )}

      {/* Urgency */}
      <Field label="ระดับความเร่งด่วน">
        <div className="grid grid-cols-3 gap-2">
          {(["URGENT", "NORMAL", "LOW"] as const).map((u) => (
            <ChipButton key={u} active={urgency === u} onClick={() => setUrgency(u)} variant="urgency" urgency={u}>
              {URGENCY_LABELS[u]}
            </ChipButton>
          ))}
        </div>
      </Field>

      {/* Title */}
      <Field label="หัวเรื่อง" required hint="บอกสั้น ๆ ว่าอะไรเสีย (เช่น 'แอร์ห้อง 305 ไม่เย็น')">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          minLength={5}
          placeholder="แอร์ห้อง 305 ไม่เย็น เสียงดัง"
          className="w-full h-12 px-3 rounded-xl border-2 border-zinc-200 bg-white text-zinc-900 font-medium focus:border-[var(--color-brand-500)] outline-none"
        />
      </Field>

      {/* Description */}
      <Field label="รายละเอียดเพิ่มเติม" hint="อาการ · สังเกตเห็นเมื่อไหร่ · เคยเป็นก่อนหรือไม่">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="แขกแจ้งว่าแอร์เย็นไม่พอตั้งแต่เมื่อคืน · ตอนเปิด 20°C แต่อุณหภูมิห้องอยู่ที่ ~26°C เสียงพัดลมดังกว่าปกติ"
          className="w-full px-3 py-3 rounded-xl border-2 border-zinc-200 bg-white text-zinc-900 font-medium focus:border-[var(--color-brand-500)] outline-none resize-y"
        />
      </Field>

      {/* Photos */}
      <Field label="แนบรูป (สูงสุด 6 รูป)" hint="กล้องมือถือก็ได้ · ระบบจะย่อรูปให้เล็กพอใช้">
        {photos.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
            {photos.map((p) => (
              <div key={p.id} className="relative aspect-square rounded-xl overflow-hidden border-2 border-zinc-200 bg-zinc-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.dataUrl} alt="" className="absolute inset-0 size-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(p.id)}
                  className="absolute top-1 right-1 size-7 rounded-full bg-zinc-900/80 text-white grid place-items-center hover:bg-zinc-900"
                  aria-label="ลบรูป"
                >
                  <X className="size-3.5" />
                </button>
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-zinc-900/70 to-transparent px-1.5 pb-1 pt-3 text-[10px] text-white font-bold">
                  {p.sizeKB} KB
                </div>
              </div>
            ))}
          </div>
        )}
        {photos.length < 6 && (
          <label className="cursor-pointer inline-flex items-center gap-2 h-12 px-4 rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 text-zinc-700 font-bold hover:border-[var(--color-brand-400)] hover:bg-white">
            <Camera className="size-5" />
            <span>เลือก/ถ่ายรูป</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={handlePickFiles}
            />
          </label>
        )}
      </Field>

      {/* Reporter info */}
      <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4 sm:p-5">
        <h3 className="font-extrabold text-zinc-900">ข้อมูลผู้แจ้ง</h3>
        <p className="text-xs text-zinc-500 mt-0.5">
          ทีมงานใช้ติดต่อกลับ · ใช้เลขที่ใบ + เบอร์ติดตามใบทีหลังได้
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <Field label="ชื่อ-นามสกุล" required>
            <input
              value={reporterName}
              onChange={(e) => setReporterName(e.target.value)}
              maxLength={100}
              required
              placeholder="ชื่อ นามสกุล"
              className="w-full h-12 px-3 rounded-xl border-2 border-zinc-200 bg-white text-zinc-900 font-medium focus:border-[var(--color-brand-500)] outline-none"
            />
          </Field>
          <Field label="เบอร์โทร" required>
            <input
              value={reporterPhone}
              onChange={(e) => setReporterPhone(e.target.value)}
              maxLength={20}
              required
              inputMode="tel"
              placeholder="08x-xxx-xxxx"
              className="w-full h-12 px-3 rounded-xl border-2 border-zinc-200 bg-white text-zinc-900 font-medium focus:border-[var(--color-brand-500)] outline-none"
            />
          </Field>
          <Field label="อีเมล (ไม่บังคับ)" hint="ระบบจะส่งสถานะให้ทาง email ถ้ามี">
            <input
              type="email"
              value={reporterEmail}
              onChange={(e) => setReporterEmail(e.target.value)}
              maxLength={150}
              placeholder="you@example.com"
              className="w-full h-12 px-3 rounded-xl border-2 border-zinc-200 bg-white text-zinc-900 font-medium focus:border-[var(--color-brand-500)] outline-none"
            />
          </Field>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border-2 border-red-200 p-4 flex gap-3 text-red-800 text-sm">
          <AlertCircle className="size-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="sticky bottom-2 z-10 mt-2">
        <button
          type="submit"
          disabled={isPending}
          className="w-full h-14 rounded-2xl bg-[var(--color-brand-600)] text-white font-extrabold text-lg shadow-lg hover:bg-[var(--color-brand-700)] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
        >
          {isPending ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-5 animate-spin" />
              กำลังส่ง...
            </span>
          ) : (
            "ส่งใบแจ้งซ่อม"
          )}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-sm font-bold text-zinc-900">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        {hint && <span className="text-xs text-zinc-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ChipButton({
  active,
  onClick,
  children,
  variant,
  urgency,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  variant?: "urgency";
  urgency?: "URGENT" | "NORMAL" | "LOW";
}) {
  let cls =
    "h-11 px-3 rounded-xl border-2 font-bold text-sm transition-colors flex items-center justify-center text-center ";
  if (active) {
    if (variant === "urgency") {
      if (urgency === "URGENT") cls += "bg-red-600 text-white border-red-600";
      else if (urgency === "LOW") cls += "bg-emerald-600 text-white border-emerald-600";
      else cls += "bg-amber-500 text-white border-amber-500";
    } else {
      cls += "bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]";
    }
  } else {
    cls += "bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400";
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}
