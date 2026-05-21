"use client";

// Public repair ticket form — sectioned, numbered, camera-first.
// Mirrors the Pooil App design (Linear-style density · biz tabs · category grid · live preview).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createTicket } from "@/lib/repair/actions";
import { URGENCY_LABELS } from "@/lib/repair/types";
import {
  Camera,
  AlertCircle,
  Loader2,
  X,
  Copy,
  Send,
  Shield,
  Building2,
  Fuel,
  ChevronDown,
  Check,
  AlarmClock,
  Receipt,
  MessageCircle,
  Plus,
} from "lucide-react";

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Branch {
  id: string;
  name: string;
  code: string;
  business_type: string;
  company_id: string;
}
interface Category {
  id: string;
  slug: string;
  label: string;
  emoji: string | null;
  default_urgency: "URGENT" | "NORMAL" | "LOW";
}

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

async function compressImage(
  file: File,
  maxEdge = 1024,
  quality = 0.65,
): Promise<{ dataUrl: string; sizeKB: number }> {
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
  let dataUrl = canvas.toDataURL("image/webp", quality);
  if (!dataUrl.startsWith("data:image/webp")) {
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  const sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024);
  return { dataUrl, sizeKB };
}

const SLA_HINT: Record<"URGENT" | "NORMAL" | "LOW", string> = {
  URGENT: "ทีมจะติดต่อกลับใน 15 นาที",
  NORMAL: "ทีมจะติดต่อกลับใน 2 ชม.",
  LOW: "ทีมจะติดต่อกลับใน 1 วันทำการ",
};

const SLA_BADGE: Record<"URGENT" | "NORMAL" | "LOW", { label: string; bg: string; color: string }> = {
  URGENT: { label: "4 ชม.", bg: "bg-red-50", color: "text-red-700" },
  NORMAL: { label: "48 ชม.", bg: "bg-blue-50", color: "text-blue-700" },
  LOW: { label: "7 วัน", bg: "bg-zinc-100", color: "text-zinc-700" },
};

export function PublicRepairForm({ orgName, companies, branches, categories }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const REPORTER_KEY = "pooil.repair.reporter";
  const initialReporter = (() => {
    if (typeof window === "undefined")
      return { name: "", phone: "", email: "", companyId: "", branchId: "" };
    try {
      const raw = window.localStorage.getItem(REPORTER_KEY);
      return raw
        ? JSON.parse(raw)
        : { name: "", phone: "", email: "", companyId: "", branchId: "" };
    } catch {
      return { name: "", phone: "", email: "", companyId: "", branchId: "" };
    }
  })();

  const [companyId, setCompanyId] = useState<string>(initialReporter.companyId ?? "");
  const [branchId, setBranchId] = useState<string>(initialReporter.branchId ?? "");
  const [categoryId, setCategoryId] = useState<string>("");
  const [urgency, setUrgency] = useState<"URGENT" | "NORMAL" | "LOW">("NORMAL");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reporterName, setReporterName] = useState(initialReporter.name ?? "");
  const [reporterPhone, setReporterPhone] = useState(initialReporter.phone ?? "");
  const [reporterEmail, setReporterEmail] = useState(initialReporter.email ?? "");
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ticketCode: string; id: string } | null>(null);

  function rememberReporter() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        REPORTER_KEY,
        JSON.stringify({
          name: reporterName.trim(),
          phone: reporterPhone.trim(),
          email: reporterEmail.trim(),
          companyId,
          branchId,
        }),
      );
    } catch {}
  }

  function pickCategory(id: string) {
    setCategoryId(id);
    const c = categories.find((x) => x.id === id);
    if (c) setUrgency(c.default_urgency);
  }

  const filteredBranches = useMemo(
    () => (companyId ? branches.filter((b) => b.company_id === companyId) : branches),
    [branches, companyId],
  );

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === branchId) || null,
    [branches, branchId],
  );

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) || null,
    [categories, categoryId],
  );

  const progress = useMemo(() => {
    let n = 0;
    const total = 6;
    if (branchId || filteredBranches.length === 0) n++;
    if (categoryId) n++;
    if (title.trim().length >= 5) n++;
    if (urgency) n++;
    if (photos.length > 0) n++;
    if (reporterName.trim().length >= 2 && reporterPhone.trim().length >= 9) n++;
    return Math.round((n / total) * 100);
  }, [branchId, filteredBranches.length, categoryId, title, urgency, photos.length, reporterName, reporterPhone]);

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
      rememberReporter();
      setResult({ ticketCode: res.ticketCode, id: res.id });
      router.refresh();
    });
  }

  // ===== success page =====
  if (result) {
    const trackUrl = `/r/track?code=${encodeURIComponent(result.ticketCode)}`;
    return (
      <div className="max-w-[560px] mx-auto">
        <div className="bg-white border border-zinc-200 rounded-3xl p-7 sm:p-9 text-center">
          <div className="size-16 mx-auto rounded-full bg-emerald-50 grid place-items-center text-emerald-600">
            <Check className="size-8" />
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-zinc-900 mt-4">
            เราได้รับเรื่องของคุณแล้ว
          </h2>
          <div className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-50 text-blue-800 rounded-full font-mono font-bold text-sm">
            <Receipt className="size-3.5" /> {result.ticketCode}
          </div>
          <p className="mt-3 text-sm text-zinc-600 leading-relaxed">
            ทีมประสานงานของ {orgName} จะติดต่อกลับใน{" "}
            <b>{SLA_HINT[urgency].replace("ทีมจะติดต่อกลับใน ", "")}</b>
            <br />
            ส่งสถานะให้ทาง LINE และลิงก์ติดตามทางข้อความ
          </p>

          <div className="grid sm:grid-cols-2 gap-2.5 mt-5">
            <Link
              href={trackUrl}
              className="inline-flex items-center justify-center gap-2 h-12 px-5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700"
            >
              <MessageCircle className="size-4" />
              ดูสถานะใบนี้
            </Link>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(window.location.origin + trackUrl);
              }}
              className="inline-flex items-center justify-center gap-2 h-12 px-5 rounded-xl border border-zinc-200 bg-white text-zinc-900 font-bold hover:bg-zinc-50"
            >
              <Copy className="size-4" />
              คัดลอกลิงก์ติดตาม
            </button>
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl mt-3 p-5">
          <h3 className="text-[11px] uppercase tracking-wide font-bold text-zinc-500">
            กระบวนการถัดไป
          </h3>
          <Step done label="ส่งใบเรียบร้อย" when={`เมื่อสักครู่ · ${result.ticketCode}`} n={1} />
          <Step
            now
            label="ทีมประสานงานรับเรื่อง + มอบหมายช่าง"
            when={`ภายใน ${SLA_HINT[urgency].replace("ทีมจะติดต่อกลับใน ", "")}`}
            n={2}
          />
          <Step label="ช่างประเมินหน้างาน + แจ้งเวลามาถึง" when="ภายในวันนี้" n={3} />
          <Step label="ซ่อมเสร็จ · ปิดงาน" when="ตาม SLA" n={4} />
        </div>

        <div className="text-center mt-5">
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setTitle("");
              setDescription("");
              setPhotos([]);
              setCategoryId("");
              setUrgency("NORMAL");
            }}
            className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 text-sm font-bold"
          >
            <Plus className="size-3.5" /> แจ้งใบใหม่
          </button>
        </div>
      </div>
    );
  }

  // ===== form =====
  return (
    <div>
      {/* Hero */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-900 text-white rounded-3xl p-6 sm:p-8 text-center mb-4">
        <div className="size-10 mx-auto rounded-xl bg-white/20 backdrop-blur grid place-items-center font-extrabold text-base mb-2">
          P
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight">
          แจ้งซ่อม {orgName}
        </h1>
        <p className="text-[13px] sm:text-sm opacity-85 mt-1 leading-relaxed max-w-md mx-auto">
          ให้ทันที · ใช้คุณภาพ · ทีมรับเรื่องภายใน 30 นาที
        </p>
      </div>

      <form onSubmit={submit} className="grid lg:grid-cols-[1fr_320px] gap-4 pb-32 lg:pb-6">
        <div className="space-y-3">
          {/* SECTION 1 — Branch */}
          <Section n={1} title="สาขาที่แจ้ง" done={!!branchId || filteredBranches.length === 0}>
            {companies.length > 1 && (
              <>
                <Label required>บริษัท</Label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {companies.map((c) => (
                    <CompanyPill
                      key={c.id}
                      active={companyId === c.id}
                      onClick={() => {
                        setCompanyId(c.id === companyId ? "" : c.id);
                        setBranchId("");
                      }}
                      code={c.code}
                    >
                      {c.name}
                    </CompanyPill>
                  ))}
                </div>
              </>
            )}
            <Label required>สาขา</Label>
            <BranchCombobox
              value={branchId}
              options={filteredBranches}
              onChange={setBranchId}
            />
            <Help>พิมพ์ค้นหา หรือเลือกจากรายการ · กว่า {branches.length} สาขา</Help>
          </Section>

          {/* SECTION 2 — Category */}
          <Section n={2} title="เรื่องที่แจ้ง" done={!!categoryId} hint="ช่วยทีมจัดงานได้ตรงคน">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {categories.map((c) => (
                <CategoryCard
                  key={c.id}
                  active={categoryId === c.id}
                  onClick={() => pickCategory(c.id)}
                  emoji={c.emoji ?? "🛠"}
                  label={c.label}
                />
              ))}
              <CategoryCard
                active={categoryId === ""}
                onClick={() => setCategoryId("")}
                emoji="❓"
                label="อื่น ๆ"
              />
            </div>
          </Section>

          {/* SECTION 3 — Photos */}
          <Section
            n={3}
            title={`รูปประกอบ${photos.length > 0 ? ` (${photos.length}/6)` : ""}`}
            done={photos.length > 0}
            hint="ช่วยให้ทีมเตรียมตัวได้ดีขึ้น"
          >
            <label className="cursor-pointer flex items-center justify-center gap-2 h-14 rounded-2xl bg-zinc-900 text-white font-bold text-base hover:bg-zinc-800 transition-colors">
              <Camera className="size-5" />
              <span>ถ่ายรูป / เลือกรูป</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={handlePickFiles}
              />
            </label>
            <Help>
              <Check className="size-3 text-emerald-600 inline mr-0.5" />
              รูปจะถูกย่อให้เล็กก่อนส่ง · ใช้คลังภัย
            </Help>
            {photos.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3">
                {photos.map((p) => (
                  <div
                    key={p.id}
                    className="relative aspect-square rounded-xl overflow-hidden bg-zinc-100"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.dataUrl}
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(p.id)}
                      className="absolute top-1 right-1 size-6 rounded-full bg-zinc-900/70 backdrop-blur text-white grid place-items-center hover:bg-zinc-900"
                      aria-label="ลบรูป"
                    >
                      <X className="size-3" />
                    </button>
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-zinc-900/70 to-transparent text-[10px] font-bold text-white px-1 pb-0.5 pt-2 text-right">
                      {p.sizeKB} KB
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* SECTION 4 — Title + Priority + Description */}
          <Section
            n={4}
            title="อาการ + ความเร่งด่วน"
            done={title.trim().length >= 5}
          >
            <Label required>หัวเรื่อง</Label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              minLength={5}
              placeholder="เช่น แอร์ห้อง 305 ไม่เย็น เสียงดัง"
              className="w-full h-12 px-3.5 rounded-xl border-[1.5px] border-zinc-200 bg-white text-zinc-900 font-medium focus:border-blue-400 focus:ring-4 focus:ring-blue-100 outline-none transition-all"
            />
            <Help>
              บอกสั้น ๆ ว่าอะไรเสีย
              {title.length > 0 && (
                <span className="tabular-nums"> · {title.length} ตัวอักษร</span>
              )}
            </Help>

            <div className="h-3" />

            <Label required>ความเร่งด่วน</Label>
            <div className="grid grid-cols-3 gap-2">
              <PriorityPill active={urgency === "URGENT"} onClick={() => setUrgency("URGENT")} tone="urgent">
                ด่วนมาก
                <span className="block text-[10.5px] font-medium opacity-75 mt-0.5">
                  ภายใน 4 ชม.
                </span>
              </PriorityPill>
              <PriorityPill active={urgency === "NORMAL"} onClick={() => setUrgency("NORMAL")} tone="normal">
                ปานกลาง
                <span className="block text-[10.5px] font-medium opacity-75 mt-0.5">
                  ภายใน 48 ชม.
                </span>
              </PriorityPill>
              <PriorityPill active={urgency === "LOW"} onClick={() => setUrgency("LOW")} tone="low">
                ไม่เร่งด่วน
                <span className="block text-[10.5px] font-medium opacity-75 mt-0.5">
                  ภายใน 7 วัน
                </span>
              </PriorityPill>
            </div>
            <Help>{SLA_HINT[urgency]}</Help>

            <div className="h-3" />

            <Label hint="(ไม่บังคับ)">รายละเอียดเพิ่มเติม</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="อาการ · สังเกตเห็นเมื่อไหร่ · เคยเป็นก่อนหรือไม่ · มีอะไรเปลี่ยนแปลงก่อนหน้า"
              className="w-full px-3.5 py-3 rounded-xl border-[1.5px] border-zinc-200 bg-white text-zinc-900 font-medium focus:border-blue-400 focus:ring-4 focus:ring-blue-100 outline-none resize-y leading-relaxed"
            />
          </Section>

          {/* SECTION 5 — Contact */}
          <Section
            n={5}
            title="เบอร์ติดต่อกลับ"
            done={reporterName.trim().length >= 2 && reporterPhone.trim().length >= 9}
            hint="ยืนยันด้วย OTP"
          >
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label hint="(ไม่บังคับ)">ชื่อ-นามสกุล</Label>
                <input
                  value={reporterName}
                  onChange={(e) => setReporterName(e.target.value)}
                  maxLength={100}
                  required
                  placeholder="ชื่อ นามสกุล หรือชื่อเล่น"
                  className="w-full h-12 px-3.5 rounded-xl border-[1.5px] border-zinc-200 bg-white text-zinc-900 font-medium focus:border-blue-400 focus:ring-4 focus:ring-blue-100 outline-none"
                />
              </div>
              <div>
                <Label required>เบอร์โทร</Label>
                <input
                  value={reporterPhone}
                  onChange={(e) => setReporterPhone(e.target.value)}
                  maxLength={20}
                  required
                  inputMode="tel"
                  placeholder="08x-xxx-xxxx"
                  className="w-full h-12 px-3.5 rounded-xl border-[1.5px] border-zinc-200 bg-white text-zinc-900 font-medium focus:border-blue-400 focus:ring-4 focus:ring-blue-100 outline-none"
                />
              </div>
            </div>

            <div className="mt-3">
              <Label hint="(ไม่บังคับ)">อีเมล</Label>
              <input
                type="email"
                value={reporterEmail}
                onChange={(e) => setReporterEmail(e.target.value)}
                maxLength={150}
                placeholder="you@example.com"
                className="w-full h-12 px-3.5 rounded-xl border-[1.5px] border-zinc-200 bg-white text-zinc-900 font-medium focus:border-blue-400 focus:ring-4 focus:ring-blue-100 outline-none"
              />
            </div>

            <div className="mt-3 p-3 bg-blue-50 rounded-xl flex items-center gap-2 text-blue-800 text-[12.5px]">
              <Shield className="size-4 shrink-0" />
              <span>
                ระบบจะส่งสถานะให้ทาง LINE และลิงก์ติดตามทางข้อความตามอัตโนมัติ
              </span>
            </div>
          </Section>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 flex gap-2.5 text-red-800 text-[13px]">
              <AlertCircle className="size-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit (desktop) */}
          <button
            type="submit"
            disabled={isPending}
            className="hidden lg:flex w-full items-center justify-center gap-2 h-14 rounded-2xl bg-blue-600 text-white font-extrabold text-base shadow-lg shadow-blue-600/25 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
          >
            {isPending ? (
              <>
                <Loader2 className="size-5 animate-spin" /> กำลังส่ง...
              </>
            ) : (
              <>
                <Send className="size-5" /> ส่งใบแจ้งซ่อม
              </>
            )}
          </button>
        </div>

        {/* Preview — desktop only */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 bg-white border border-zinc-200 rounded-2xl p-5">
            <h3 className="text-[11px] uppercase tracking-wide font-bold text-zinc-500 mb-2.5">
              Preview
            </h3>
            <div className="text-[17px] font-bold text-zinc-900 leading-snug mb-3">
              {title || (
                <span className="text-zinc-400 italic font-medium">
                  (หัวเรื่องจะแสดงที่นี่)
                </span>
              )}
            </div>
            <PreviewRow label="บริษัท">
              {companyId ? companies.find((c) => c.id === companyId)?.name : "—"}
            </PreviewRow>
            <PreviewRow label="สาขา">
              {selectedBranch ? (
                <>
                  <span className="font-mono font-bold">{selectedBranch.code}</span>
                  <span className="ml-1.5">{selectedBranch.name}</span>
                </>
              ) : (
                "—"
              )}
            </PreviewRow>
            <PreviewRow label="หมวด">
              {selectedCategory ? (
                <>
                  {selectedCategory.emoji && <span className="mr-1">{selectedCategory.emoji}</span>}
                  {selectedCategory.label}
                </>
              ) : (
                "—"
              )}
            </PreviewRow>
            <PreviewRow label="เร่งด่วน">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-bold ${SLA_BADGE[urgency].bg} ${SLA_BADGE[urgency].color}`}
              >
                {URGENCY_LABELS[urgency]}
              </span>
            </PreviewRow>
            <PreviewRow label="รูป">{photos.length} รูป</PreviewRow>
            <PreviewRow label="SLA">
              <span
                className={`tabular-nums font-bold ${urgency === "URGENT" ? "text-red-600" : "text-zinc-700"}`}
              >
                {SLA_BADGE[urgency].label}
              </span>
            </PreviewRow>
            <PreviewRow label="ผู้แจ้ง">{reporterName || "—"}</PreviewRow>
            <PreviewRow label="ติดต่อ">{reporterPhone || "—"}</PreviewRow>

            <div className="mt-4 p-3 bg-zinc-50 rounded-xl text-[11px] text-zinc-600 leading-relaxed flex gap-2">
              <AlarmClock className="size-3.5 shrink-0 mt-0.5 text-zinc-500" />
              <div>
                <span className="font-bold text-zinc-900">หลังกดส่ง</span> · ทีมจะเห็นทันที
                <br />
                {SLA_HINT[urgency]}
              </div>
            </div>
          </div>
        </aside>
      </form>

      {/* Mobile sticky bottom: progress + submit */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-zinc-200 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">
        <div className="flex items-center gap-3 mb-2.5">
          <span className="text-[11px] text-zinc-500 font-medium">กรอกครบ</span>
          <div className="flex-1 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[12px] font-bold text-blue-700 tabular-nums">{progress}%</span>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-blue-600 text-white font-bold text-base shadow-md shadow-blue-600/20 disabled:opacity-60"
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" /> กำลังส่ง...
            </>
          ) : (
            <>
              <Send className="size-4" /> ส่งใบแจ้งซ่อม
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ---- atoms ----

function Section({
  n,
  title,
  hint,
  done,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-2.5 mb-3.5">
        <span
          className={`size-7 grid place-items-center rounded-full font-bold text-[12.5px] shrink-0 ${
            done ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-700"
          }`}
        >
          {done ? <Check className="size-3.5" /> : n}
        </span>
        <span className="text-[15.5px] font-bold text-zinc-900">{title}</span>
        {hint && (
          <span className="ml-auto text-[11.5px] text-zinc-500 hidden sm:inline">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Label({
  children,
  required,
  hint,
}: {
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 mb-1.5">
      <label className="text-[12.5px] font-bold text-zinc-800">
        {children}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {hint && <span className="font-medium text-zinc-400 ml-1.5">{hint}</span>}
      </label>
    </div>
  );
}

function Help({ children }: { children: React.ReactNode }) {
  return <p className="text-[11.5px] text-zinc-500 mt-1.5 leading-relaxed">{children}</p>;
}

function CompanyPill({
  active,
  onClick,
  children,
  code,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  code: string;
}) {
  const isPooil = code === "POOIL";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 h-11 px-3 rounded-xl border-[1.5px] font-semibold text-[13.5px] transition-colors whitespace-nowrap ${
        active
          ? "bg-blue-50 text-blue-800 border-blue-500"
          : "bg-white text-zinc-700 border-zinc-200 hover:border-zinc-300"
      }`}
    >
      {isPooil ? <Fuel className="size-4" /> : <Building2 className="size-4" />}
      {children}
    </button>
  );
}

function CategoryCard({
  active,
  onClick,
  emoji,
  label,
}: {
  active: boolean;
  onClick: () => void;
  emoji: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 p-3 min-h-[86px] rounded-xl border-[1.5px] transition-colors ${
        active
          ? "bg-blue-50 text-blue-800 border-blue-500"
          : "bg-white text-zinc-700 border-zinc-200 hover:border-zinc-300"
      }`}
    >
      <span className="text-2xl">{emoji}</span>
      <span className="text-[12px] font-semibold text-center leading-tight">{label}</span>
    </button>
  );
}

function PriorityPill({
  active,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone: "urgent" | "normal" | "low";
  children: React.ReactNode;
}) {
  const map = {
    urgent: active ? "bg-red-50 text-red-700 border-red-400" : "bg-white text-zinc-700 border-zinc-200",
    normal: active ? "bg-blue-50 text-blue-800 border-blue-400" : "bg-white text-zinc-700 border-zinc-200",
    low: active ? "bg-zinc-100 text-zinc-700 border-zinc-400" : "bg-white text-zinc-700 border-zinc-200",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 p-3 rounded-xl border-[1.5px] font-bold text-[13.5px] transition-colors min-h-[64px] ${map[tone]}`}
    >
      {children}
    </button>
  );
}

function PreviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] py-1.5 text-[12px] border-b border-dashed border-zinc-100 last:border-0">
      <span className="text-zinc-400">{label}</span>
      <span className="text-zinc-900 font-medium">{children}</span>
    </div>
  );
}

function Step({
  n,
  label,
  when,
  done,
  now,
}: {
  n: number;
  label: string;
  when?: string;
  done?: boolean;
  now?: boolean;
}) {
  return (
    <div className="grid grid-cols-[24px_1fr] gap-3 py-2.5 text-left">
      <span
        className={`size-6 rounded-full grid place-items-center text-[11px] font-bold shrink-0 ${
          done
            ? "bg-emerald-50 text-emerald-600"
            : now
              ? "bg-blue-600 text-white ring-4 ring-blue-100"
              : "bg-zinc-100 text-zinc-400"
        }`}
      >
        {done ? <Check className="size-3" /> : n}
      </span>
      <div>
        <div
          className={`text-[13px] leading-tight ${now ? "text-blue-800 font-bold" : "text-zinc-900 font-semibold"}`}
        >
          {label}
        </div>
        {when && <div className="text-[11px] text-zinc-500 mt-0.5">{when}</div>}
      </div>
    </div>
  );
}

// Branch searchable combobox
function BranchCombobox({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Branch[];
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find((b) => b.id === value);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(
        (b) => b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q),
      )
    : options;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full h-12 px-3.5 rounded-xl border-[1.5px] border-zinc-200 bg-white text-left flex items-center justify-between gap-2 focus:border-blue-400 focus:ring-4 focus:ring-blue-100 outline-none"
      >
        <span
          className={
            selected
              ? "text-zinc-900 font-medium truncate"
              : "text-zinc-400"
          }
        >
          {selected ? (
            <>
              <span className="font-mono font-bold text-zinc-700 mr-1.5">
                {selected.code}
              </span>
              {selected.name}
            </>
          ) : (
            "— เลือกสาขา —"
          )}
        </span>
        <ChevronDown className="size-4 text-zinc-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1.5 inset-x-0 bg-white rounded-xl border border-zinc-200 shadow-lg max-h-80 overflow-hidden flex flex-col">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="พิมพ์ค้นหา · ชื่อสาขา / รหัส"
            className="h-11 px-3.5 border-b border-zinc-100 text-[13px] focus:outline-none"
          />
          <ul className="overflow-y-auto flex-1">
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                  setQuery("");
                }}
                className={`w-full text-left px-3.5 py-2.5 text-[13px] hover:bg-zinc-50 ${
                  !value ? "bg-blue-50 font-bold" : ""
                }`}
              >
                — ไม่ระบุสาขา —
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-3.5 py-4 text-[12.5px] text-zinc-400 text-center">
                ไม่พบสาขา &quot;{query}&quot;
              </li>
            ) : (
              filtered.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(b.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`w-full text-left px-3.5 py-2 text-[13px] hover:bg-zinc-50 flex items-baseline gap-2 ${
                      value === b.id ? "bg-blue-50 font-bold" : ""
                    }`}
                  >
                    <span className="font-mono font-bold text-[11px] text-zinc-500 shrink-0">
                      {b.code}
                    </span>
                    <span className="truncate">{b.name}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
