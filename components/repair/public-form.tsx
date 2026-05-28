"use client";
// Pooil App · Public repair form (1:1 port using .rf-* classes from form-styles.css)

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
  URGENT: { label: "4 ชม.",  bg: "#FEF2F2", color: "#B91C1C" },
  NORMAL: { label: "48 ชม.", bg: "#EFF6FF", color: "#1D4ED8" },
  LOW:    { label: "7 วัน",  bg: "#F1F5F9", color: "#475569" },
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
      return raw ? JSON.parse(raw) : { name: "", phone: "", email: "", companyId: "", branchId: "" };
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
      window.localStorage.setItem(REPORTER_KEY, JSON.stringify({
        name: reporterName.trim(),
        phone: reporterPhone.trim(),
        email: reporterEmail.trim(),
        companyId, branchId,
      }));
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
    if (remaining <= 0) { setError("รูปสูงสุด 6 รูป"); return; }
    const accept = files.slice(0, remaining);
    const out: PhotoEntry[] = [];
    for (const f of accept) {
      if (!f.type.startsWith("image/")) continue;
      try {
        const { dataUrl, sizeKB } = await compressImage(f);
        out.push({ id: crypto.randomUUID(), dataUrl, sizeKB, phase: "BEFORE" });
      } catch { setError("ย่อรูปไม่สำเร็จ · ใช้รูปอื่นได้ไหม"); }
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
    if (title.trim().length < 5) { setError("หัวเรื่องสั้นไป · เขียนให้บอกอาการได้ (อย่างน้อย 5 ตัวอักษร)"); return; }
    if (reporterName.trim().length < 2) { setError("กรอกชื่อ-นามสกุล"); return; }
    if (reporterPhone.trim().length < 9) { setError("กรอกเบอร์โทรให้ครบ"); return; }

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
      if (!res.ok) { setError(res.error); return; }
      rememberReporter();
      setResult({ ticketCode: res.ticketCode, id: res.id });
      router.refresh();
    });
  }

  if (result) {
    const trackUrl = `/r/track?code=${encodeURIComponent(result.ticketCode)}`;
    return (
      <div className="rf-success">
        <div className="rf-success-card">
          <div className="check"><Check size={32} /></div>
          <h2>เราได้รับเรื่องของคุณแล้ว</h2>
          <div className="ticket-id">
            <Receipt size={14} /> {result.ticketCode}
          </div>
          <p className="desc">
            ทีมประสานงานของ {orgName} จะติดต่อกลับใน{" "}
            <b>{SLA_HINT[urgency].replace("ทีมจะติดต่อกลับใน ", "")}</b>
            <br />
            ส่งสถานะให้ทาง LINE และลิงก์ติดตามทางข้อความ
          </p>

          <div className="rf-success-actions">
            <Link href={trackUrl} className="rf-btn primary" style={{ background: "#059669", borderColor: "#047857" }}>
              <MessageCircle size={16} />
              ดูสถานะใบนี้
            </Link>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(window.location.origin + trackUrl);
              }}
              className="rf-btn"
            >
              <Copy size={16} />
              คัดลอกลิงก์ติดตาม
            </button>
          </div>
        </div>

        <div className="rf-success-card" style={{ marginTop: 12, textAlign: "left", padding: "20px 24px" }}>
          <h3 style={{
            fontSize: 11, fontWeight: 700, color: "#6B7280",
            textTransform: "uppercase", letterSpacing: "0.06em", margin: 0,
          }}>
            กระบวนการถัดไป
          </h3>
          <Step done label="ส่งใบเรียบร้อย" when={`เมื่อสักครู่ · ${result.ticketCode}`} n={1} />
          <Step now label="ทีมประสานงานรับเรื่อง + มอบหมายช่าง"
            when={`ภายใน ${SLA_HINT[urgency].replace("ทีมจะติดต่อกลับใน ", "")}`} n={2}
          />
          <Step label="ช่างประเมินหน้างาน + แจ้งเวลามาถึง" when="ภายในวันนี้" n={3} />
          <Step label="ซ่อมเสร็จ · ปิดงาน" when="ตาม SLA" n={4} />
        </div>

        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setTitle(""); setDescription("");
              setPhotos([]); setCategoryId("");
              setUrgency("NORMAL");
            }}
            style={{
              background: "transparent", border: 0,
              color: "#1740A3", fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
              display: "inline-flex", alignItems: "center", gap: 4,
            }}
          >
            <Plus size={12} /> แจ้งใบใหม่
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Hero */}
      <div className="rf-hero" style={{ marginBottom: 16 }}>
        <div className="rf-hero-mark">P</div>
        <h1>แจ้งซ่อม {orgName}</h1>
        <div className="sub">ให้ทันที · ใช้คุณภาพ · ทีมรับเรื่องภายใน 30 นาที</div>
      </div>

      <form
        onSubmit={submit}
        className="rf-grid"
        style={{ paddingBottom: 120 }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* SECTION 1 — Branch */}
          <Section n={1} title="สาขาที่แจ้ง" done={!!branchId || filteredBranches.length === 0}>
            {companies.length > 1 && (
              <>
                <Label required>บริษัท</Label>
                <div className="rf-pills" style={{ marginBottom: 14 }}>
                  {companies.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setCompanyId(c.id === companyId ? "" : c.id);
                        setBranchId("");
                      }}
                      className={"rf-pill " + (companyId === c.id ? "is-selected" : "")}
                    >
                      {c.code === "POOIL" ? <Fuel size={16} /> : <Building2 size={16} />}
                      {c.name}
                    </button>
                  ))}
                </div>
              </>
            )}
            <Label required>สาขา</Label>
            <BranchCombobox value={branchId} options={filteredBranches} onChange={setBranchId} />
            <div className="rf-help">
              พิมพ์ค้นหา หรือเลือกจากรายการ · กว่า {branches.length} สาขา
            </div>
          </Section>

          {/* SECTION 2 — Category */}
          <Section n={2} title="เรื่องที่แจ้ง" done={!!categoryId} hint="ช่วยทีมจัดงานได้ตรงคน">
            <div className="rf-cat-grid">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pickCategory(c.id)}
                  className={"rf-cat " + (categoryId === c.id ? "is-selected" : "")}
                >
                  <span className="rf-cat-emoji">{c.emoji ?? "🛠"}</span>
                  {c.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCategoryId("")}
                className={"rf-cat " + (categoryId === "" ? "is-selected" : "")}
              >
                <span className="rf-cat-emoji">❓</span>
                อื่น ๆ
              </button>
            </div>
          </Section>

          {/* SECTION 3 — Photos */}
          <Section
            n={3}
            title={`รูปประกอบ${photos.length > 0 ? ` (${photos.length}/6)` : ""}`}
            done={photos.length > 0}
            hint="ช่วยให้ทีมเตรียมตัวได้ดีขึ้น"
          >
            <label className="rf-photo-cta" style={{ cursor: "pointer" }}>
              <Camera size={20} />
              <span>ถ่ายรูป / เลือกรูป</span>
              <input
                type="file" accept="image/*" capture="environment"
                multiple style={{ display: "none" }}
                onChange={handlePickFiles}
              />
            </label>
            <div className="rf-help">
              <Check size={11} style={{ color: "#047857", display: "inline" }} /> รูปจะถูกย่อให้เล็กก่อนส่ง
            </div>
            {photos.length > 0 && (
              <div className="rf-photo-grid">
                {photos.map((p) => (
                  <div key={p.id} className="rf-photo-tile">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.dataUrl} alt=""
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(p.id)}
                      className="rf-photo-remove"
                      aria-label="ลบรูป"
                    >
                      <X size={12} />
                    </button>
                    <div style={{
                      position: "absolute", bottom: 0, left: 0, right: 0,
                      background: "linear-gradient(to top, rgba(11,18,32,0.7), transparent)",
                      fontSize: 10, fontWeight: 700, color: "white",
                      padding: "8px 4px 4px",
                      textAlign: "right",
                    }}>
                      {p.sizeKB} KB
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* SECTION 4 — Title + Priority + Description */}
          <Section n={4} title="อาการ + ความเร่งด่วน" done={title.trim().length >= 5}>
            <Label required>หัวเรื่อง</Label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200} required minLength={5}
              placeholder="เช่น แอร์ห้อง 305 ไม่เย็น เสียงดัง"
              className="rf-input"
            />
            <div className="rf-help">
              บอกสั้น ๆ ว่าอะไรเสีย
              {title.length > 0 && <span className="num"> · {title.length} ตัวอักษร</span>}
            </div>

            <div style={{ height: 12 }} />

            <Label required>ความเร่งด่วน</Label>
            <div className="rf-prio-row">
              {(["URGENT", "NORMAL", "LOW"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUrgency(u)}
                  className={
                    "rf-prio " +
                    (u === "URGENT" ? "urgent" : u === "NORMAL" ? "normal" : "low") +
                    (urgency === u ? " is-selected" : "")
                  }
                >
                  {u === "URGENT" ? "ด่วนมาก" : u === "NORMAL" ? "ปานกลาง" : "ไม่เร่งด่วน"}
                  <span className="sub">
                    {u === "URGENT" ? "ภายใน 4 ชม." : u === "NORMAL" ? "ภายใน 48 ชม." : "ภายใน 7 วัน"}
                  </span>
                </button>
              ))}
            </div>
            <div className="rf-help">{SLA_HINT[urgency]}</div>

            <div style={{ height: 12 }} />

            <Label hint="(ไม่บังคับ)">รายละเอียดเพิ่มเติม</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000} rows={4}
              placeholder="อาการ · สังเกตเห็นเมื่อไหร่ · เคยเป็นก่อนหรือไม่ · มีอะไรเปลี่ยนแปลงก่อนหน้า"
              className="rf-textarea"
            />
          </Section>

          {/* SECTION 5 — Contact */}
          <Section
            n={5}
            title="เบอร์ติดต่อกลับ"
            done={reporterName.trim().length >= 2 && reporterPhone.trim().length >= 9}
            hint="ยืนยันด้วย OTP"
          >
            <div className="rf-row two">
              <div>
                <Label hint="(ไม่บังคับ)">ชื่อ-นามสกุล</Label>
                <input
                  value={reporterName}
                  onChange={(e) => setReporterName(e.target.value)}
                  maxLength={100} required
                  placeholder="ชื่อ นามสกุล หรือชื่อเล่น"
                  className="rf-input"
                />
              </div>
              <div>
                <Label required>เบอร์โทร</Label>
                <input
                  value={reporterPhone}
                  onChange={(e) => setReporterPhone(e.target.value)}
                  maxLength={20} required
                  inputMode="tel"
                  placeholder="08x-xxx-xxxx"
                  className="rf-input"
                />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <Label hint="(ไม่บังคับ)">อีเมล</Label>
              <input
                type="email"
                value={reporterEmail}
                onChange={(e) => setReporterEmail(e.target.value)}
                maxLength={150}
                placeholder="you@example.com"
                className="rf-input"
              />
            </div>
            <div style={{
              marginTop: 12, padding: 12,
              background: "#EFF4FF", borderRadius: 12,
              display: "flex", alignItems: "center", gap: 8,
              color: "#1740A3", fontSize: 12.5,
            }}>
              <Shield size={14} />
              <span>ระบบจะส่งสถานะให้ทาง LINE และลิงก์ติดตามทางข้อความตามอัตโนมัติ</span>
            </div>
          </Section>

          {error && (
            <div style={{
              background: "#FEF2F2", border: "1px solid #FECACA",
              borderRadius: 12, padding: 14,
              display: "flex", alignItems: "flex-start", gap: 10,
              color: "#B91C1C", fontSize: 13,
              marginTop: 12,
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          {/* desktop submit */}
          <button
            type="submit"
            disabled={isPending}
            className="rf-btn primary"
            style={{
              display: "none",
              marginTop: 16,
            }}
            data-desktop-only="1"
          >
            {isPending ? (
              <>
                <Loader2 size={18} className="rf-spin" /> กำลังส่ง...
              </>
            ) : (
              <>
                <Send size={18} /> ส่งใบแจ้งซ่อม
              </>
            )}
          </button>
          <style>{`
            @media (min-width: 900px) {
              button[data-desktop-only="1"] { display: inline-flex !important; }
            }
            @keyframes rfSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .rf-spin { animation: rfSpin 0.9s linear infinite; }
          `}</style>
        </div>

        {/* PREVIEW SIDEBAR */}
        <aside className="rf-preview">
          <h3>Preview</h3>
          <div className="rf-preview-title">
            {title || <span className="none">(หัวเรื่องจะแสดงที่นี่)</span>}
          </div>
          <PreviewRow label="บริษัท">
            {companyId ? companies.find((c) => c.id === companyId)?.name : <span className="none">—</span>}
          </PreviewRow>
          <PreviewRow label="สาขา">
            {selectedBranch ? (
              <>
                <span className="num" style={{ fontWeight: 700 }}>{selectedBranch.code}</span>
                <span style={{ marginLeft: 6 }}>{selectedBranch.name}</span>
              </>
            ) : (
              <span className="none">—</span>
            )}
          </PreviewRow>
          <PreviewRow label="หมวด">
            {selectedCategory ? (
              <>
                {selectedCategory.emoji && <span style={{ marginRight: 4 }}>{selectedCategory.emoji}</span>}
                {selectedCategory.label}
              </>
            ) : (
              <span className="none">—</span>
            )}
          </PreviewRow>
          <PreviewRow label="เร่งด่วน">
            <span style={{
              display: "inline-flex", alignItems: "center",
              padding: "2px 10px", borderRadius: 999,
              fontSize: 11, fontWeight: 700,
              background: SLA_BADGE[urgency].bg,
              color: SLA_BADGE[urgency].color,
            }}>
              {URGENCY_LABELS[urgency]}
            </span>
          </PreviewRow>
          <PreviewRow label="รูป">{photos.length} รูป</PreviewRow>
          <PreviewRow label="SLA">
            <span className="num" style={{
              fontWeight: 700,
              color: urgency === "URGENT" ? "#B91C1C" : "#475569",
            }}>
              {SLA_BADGE[urgency].label}
            </span>
          </PreviewRow>
          <PreviewRow label="ผู้แจ้ง">
            {reporterName || <span className="none">—</span>}
          </PreviewRow>
          <PreviewRow label="ติดต่อ">
            {reporterPhone || <span className="none">—</span>}
          </PreviewRow>
          <div style={{
            marginTop: 16, padding: 12,
            background: "#F8FAFD", borderRadius: 10,
            fontSize: 11.5, color: "#475569",
            lineHeight: 1.5,
            display: "flex", gap: 8,
          }}>
            <AlarmClock size={14} style={{ flexShrink: 0, marginTop: 2, color: "#64748B" }} />
            <div>
              <b style={{ color: "#0B1220" }}>หลังกดส่ง</b> · ทีมจะเห็นทันที
              <br />
              {SLA_HINT[urgency]}
            </div>
          </div>
        </aside>
      </form>

      {/* Mobile sticky progress + submit */}
      <div className="rf-progress-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
          <span style={{ fontSize: 11, color: "#475569", fontWeight: 500 }}>กรอกครบ</span>
          <div className="rf-progress-fill"><div style={{ width: `${progress}%` }} /></div>
          <span className="rf-progress-pct">{progress}%</span>
        </div>
      </div>
      <div style={{
        position: "fixed", bottom: 16, left: 16, right: 16,
        zIndex: 31, maxWidth: 480, margin: "0 auto",
      }} className="rf-mobile-submit">
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="rf-btn primary"
          style={{ width: "100%" }}
        >
          {isPending ? (
            <>
              <Loader2 size={16} className="rf-spin" /> กำลังส่ง...
            </>
          ) : (
            <>
              <Send size={16} /> ส่งใบแจ้งซ่อม
            </>
          )}
        </button>
      </div>
      <style>{`
        .rf-mobile-submit { display: block; }
        @media (min-width: 900px) {
          .rf-mobile-submit { display: none; }
        }
      `}</style>
    </div>
  );
}

// ---- atoms ----

function Section({
  n, title, hint, done, children,
}: {
  n: number; title: string; hint?: string; done?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="rf-section">
      <div className="rf-section-h">
        <span className={"rf-section-num " + (done ? "done" : "")}>
          {done ? <Check size={14} /> : n}
        </span>
        <span className="rf-section-title">{title}</span>
        {hint && <span className="rf-section-sub">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Label({
  children, required, hint,
}: {
  children: React.ReactNode; required?: boolean; hint?: string;
}) {
  return (
    <div className="rf-label">
      <label style={{ display: "inline" }}>
        {children}
        {required && <span className="req"> *</span>}
        {hint && <span className="opt" style={{ marginLeft: 6 }}>{hint}</span>}
      </label>
    </div>
  );
}

function PreviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rf-preview-row">
      <span className="l">{label}</span>
      <span className="v">{children}</span>
    </div>
  );
}

function Step({
  n, label, when, done, now,
}: {
  n: number; label: string; when?: string; done?: boolean; now?: boolean;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: 12, padding: "10px 0" }}>
      <span style={{
        width: 22, height: 22, borderRadius: 50,
        display: "grid", placeItems: "center",
        fontSize: 11, fontWeight: 700, flexShrink: 0,
        background: done ? "#ECFDF5" : now ? "#1E4FCC" : "#F1F5F9",
        color: done ? "#047857" : now ? "white" : "#94A3B8",
        boxShadow: now ? "0 0 0 4px #DBE6FF" : undefined,
      }}>
        {done ? <Check size={11} /> : n}
      </span>
      <div>
        <div style={{
          fontSize: 13, lineHeight: 1.3,
          color: now ? "#1740A3" : "#0B1220",
          fontWeight: now ? 700 : 600,
        }}>
          {label}
        </div>
        {when && (
          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>{when}</div>
        )}
      </div>
    </div>
  );
}

// Branch combobox
function BranchCombobox({
  value, options, onChange,
}: {
  value: string; options: Branch[]; onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find((b) => b.id === value);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((b) =>
        b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q),
      )
    : options;
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="rf-input"
        style={{
          textAlign: "left", height: 48,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        }}
      >
        <span style={{
          color: selected ? "#0B1220" : "#9CA3AF",
          fontWeight: selected ? 500 : 400,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {selected ? (
            <>
              <span className="num" style={{ fontWeight: 700, color: "#374151", marginRight: 6 }}>
                {selected.code}
              </span>
              {selected.name}
            </>
          ) : (
            "— เลือกสาขา —"
          )}
        </span>
        <ChevronDown size={16} style={{ color: "#9CA3AF", flexShrink: 0 }} />
      </button>
      {open && (
        <div style={{
          position: "absolute", zIndex: 30, marginTop: 6, left: 0, right: 0,
          background: "white", borderRadius: 12,
          border: "1px solid #E5EAF2",
          boxShadow: "0 10px 30px rgba(15,23,42,0.12)",
          maxHeight: 320, overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="พิมพ์ค้นหา · ชื่อสาขา / รหัส"
            style={{
              height: 44, padding: "0 14px",
              borderBottom: "1px solid #F1F5F9",
              fontSize: 13, outline: 0, border: 0,
            }}
          />
          <ul style={{ listStyle: "none", margin: 0, padding: 0, overflow: "auto", flex: 1 }}>
            <li>
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); setQuery(""); }}
                style={{
                  width: "100%", textAlign: "left",
                  padding: "10px 14px", fontSize: 13,
                  background: !value ? "#EFF4FF" : "transparent",
                  fontWeight: !value ? 700 : 400,
                  border: 0, cursor: "pointer", color: "#0B1220",
                }}
              >
                — ไม่ระบุสาขา —
              </button>
            </li>
            {filtered.length === 0 ? (
              <li style={{ padding: "16px 14px", fontSize: 12.5, color: "#94A3B8", textAlign: "center" }}>
                ไม่พบสาขา &quot;{query}&quot;
              </li>
            ) : (
              filtered.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => { onChange(b.id); setOpen(false); setQuery(""); }}
                    style={{
                      width: "100%", textAlign: "left",
                      padding: "10px 14px", fontSize: 13,
                      background: value === b.id ? "#EFF4FF" : "transparent",
                      fontWeight: value === b.id ? 700 : 400,
                      border: 0, cursor: "pointer", color: "#0B1220",
                      display: "flex", alignItems: "baseline", gap: 8,
                    }}
                  >
                    <span className="num" style={{
                      fontFamily: "IBM Plex Sans, system-ui",
                      fontWeight: 700, fontSize: 11, color: "#64748B", flexShrink: 0,
                    }}>
                      {b.code}
                    </span>
                    <span style={{
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{b.name}</span>
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
