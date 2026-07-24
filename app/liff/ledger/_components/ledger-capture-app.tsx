"use client";

// LedgerLine LIFF capture flow (mobile, in-LINE) — the "Bainy in LINE" loop.
//
//   pick company/branch (sticky context)
//     → take/upload photo
//     → presign + PUT to R2          (POST /api/ledger/r2/presign)
//     → AI parse the receipt          (POST /api/ledger/ocr → { parsed, recheck })
//     → show read-back fields + per-field confidence + Recheck warnings (edit)
//     → confirm → create DRAFT row    (POST /api/ledger/expenses, status=draft)
//
// GOLDEN RULE: this never auto-posts. "บันทึก (ร่าง)" writes status=draft for an
// accountant to finalise in the web review pane. We surface per-field confidence
// so the staffer knows which fields the AI was unsure about, and we re-run the
// server's Recheck so math mismatches are visible before saving.
//
// All backend calls go by fetch to the /api/ledger/* routes — we do NOT import
// server code here (keeps the surface self-contained). The OCR step degrades to
// manual entry if AI is unavailable, so the flow never dead-ends.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LedgerLogo, LedgerMascot } from "@/components/ledger/Brand";
import { BranchPicker } from "@/app/(admin)/ledger/_components/BranchPicker";

type Phase = "capture" | "parsing" | "review" | "saving" | "done" | "error";

interface CompanyOpt {
  id: string;
  code: string;
  name: string;
}
interface BranchOpt {
  id: string;
  code: string;
  name: string;
  businessType: string;
}
interface CategoryOpt {
  id: string;
  name: string;
  color: string | null;
}

type BatchFileStatus = "ok" | "dup" | "fail";
interface BatchResult {
  name: string;
  status: BatchFileStatus;
  error?: string;
}
interface BatchState {
  total: number;
  done: number;
  current: string;
  results: BatchResult[];
  finished: boolean;
}

interface ParsedFields {
  vendor: string;
  vendorTaxId: string;
  docDate: string; // YYYY-MM-DD
  subtotal: string; // kept as strings for controlled inputs
  vat: string;
  total: string;
  paymentMethod: string;
  suggestedCategory: string; // free-text suggestion from AI (display/fallback)
  categoryId: string; // resolved real category id (when matched / chosen)
  confidence: Record<string, number | undefined>;
}

const EMPTY: ParsedFields = {
  vendor: "",
  vendorTaxId: "",
  docDate: "",
  subtotal: "",
  vat: "",
  total: "",
  paymentMethod: "",
  suggestedCategory: "",
  categoryId: "",
  confidence: {},
};

const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: "", label: "— เลือก —" },
  { value: "cash", label: "เงินสด" },
  { value: "transfer", label: "โอน" },
  { value: "qr", label: "QR พร้อมเพย์" },
  { value: "credit_card", label: "บัตรเครดิต" },
  { value: "other", label: "อื่น ๆ" },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function uploadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function num(s: string): number {
  const n = Number(String(s).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// SHA-256 of the raw file → sent to the server for dedup (same image won't
// double-create). Uses the Web Crypto SubtleCrypto API (available in LIFF
// webviews over https). Falls back to null when unavailable.
async function sha256Of(file: File): Promise<string | null> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

// Client-side mirror of lib/ledger/recheck (the authoritative one runs on the
// server and is shown via `serverWarnings`). Catches the obvious mismatch live
// while the staffer edits, before they hit save.
function mathMismatch(f: ParsedFields): boolean {
  const sub = num(f.subtotal);
  const vat = num(f.vat);
  const total = num(f.total);
  if (total <= 0) return false;
  if (sub <= 0 && vat <= 0) return false; // not enough data to check
  return Math.abs(sub + vat - total) > 1;
}

function confColor(c?: number): string {
  if (c == null) return "text-zinc-500";
  if (c >= 0.85) return "text-emerald-700";
  if (c >= 0.6) return "text-amber-700";
  return "text-red-700";
}
function confLabel(c?: number): string | null {
  if (c == null) return null;
  if (c >= 0.85) return "มั่นใจ";
  if (c >= 0.6) return "ควรตรวจ";
  return "เช็ก!";
}

export function LedgerCaptureApp({
  companies,
  initialBranches,
  initialCategories,
}: {
  companies: CompanyOpt[];
  initialBranches: BranchOpt[];
  initialCategories: CategoryOpt[];
}) {
  const [phase, setPhase] = useState<Phase>("capture");
  const [preview, setPreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [sha256, setSha256] = useState<string | null>(null);
  const [fields, setFields] = useState<ParsedFields>(EMPTY);
  // ฟิลด์ AI ที่ ParsedFields ไม่ได้เก็บ แต่ต้อง forward ให้ครบเท่า LINE/email
  // (buyerTaxIdOnDoc/docType/items → เกรดภาษีซื้อ + line items) — bug-class path ที่ 3 ลืม field.
  const [aiExtra, setAiExtra] = useState<{
    buyerTaxIdOnDoc?: string | null;
    docType?: string | null;
    vendorDocNumber?: string | null;
    vendorAddress?: string | null;
    wht?: number | null;
    discount?: number | null;
    items?: Array<Record<string, unknown>>;
    raw?: string | null;
  }>({});
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [errMsg, setErrMsg] = useState<string>("");
  const [serverWarnings, setServerWarnings] = useState<string[]>([]);
  const [isPdf, setIsPdf] = useState(false);
  // Batch upload (เลือกหลายไฟล์พร้อมกัน) — runs headless: ทุกไฟล์ขึ้นเป็น "ร่าง"
  // ให้บัญชีตรวจทีหลัง (เหมือนหน้าเว็บ). null = โหมดถ่ายทีละใบปกติ.
  const [batch, setBatch] = useState<BatchState | null>(null);

  // Company / branch context (the API is company-scoped).
  const [companyId, setCompanyId] = useState<string>(companies[0]?.id ?? "");
  const [branchId, setBranchId] = useState<string>("");
  const [branches, setBranches] = useState<BranchOpt[]>(initialBranches);
  const [categories, setCategories] = useState<CategoryOpt[]>(initialCategories);

  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useRef<string>(uploadId());

  const activeCompany = useMemo(
    () => companies.find((c) => c.id === companyId) ?? companies[0],
    [companies, companyId],
  );

  function set<K extends keyof ParsedFields>(key: K, value: ParsedFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  // Refresh branches + categories when the user switches company (skip the
  // initial render — those came from the server already).
  const didMount = useRef(false);
  const loadMeta = useCallback(async (cid: string) => {
    try {
      const res = await fetch(`/api/ledger/meta?companyId=${encodeURIComponent(cid)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { branches?: BranchOpt[]; categories?: CategoryOpt[] };
      setBranches(data.branches ?? []);
      setCategories(data.categories ?? []);
    } catch {
      // keep previous options on failure
    }
  }, []);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    setBranchId("");
    void loadMeta(companyId);
  }, [companyId, loadMeta]);

  function reset() {
    setPhase("capture");
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return null;
    });
    setImageUrl(null);
    setSha256(null);
    setFields(EMPTY);
    setAiExtra({});
    setSavedCode(null);
    setDuplicate(false);
    setErrMsg("");
    setServerWarnings([]);
    setIsPdf(false);
    upload.current = uploadId();
    if (fileRef.current) fileRef.current.value = "";
  }

  // Try to map the AI's free-text category suggestion onto a real category id.
  function matchCategory(suggested: string | null | undefined): string {
    if (!suggested) return "";
    const s = suggested.trim().toLowerCase();
    const hit = categories.find(
      (c) => c.name.toLowerCase() === s || c.name.toLowerCase().includes(s) || s.includes(c.name.toLowerCase()),
    );
    return hit?.id ?? "";
  }

  // ── Batch upload (หลายไฟล์พร้อมกัน) ─────────────────────────────────────────
  // One file → presign → PUT R2 → OCR (non-fatal) → create DRAFT. Never reviews
  // each one here (the accountant reviews on /my or web); this is the "ส่งเข้าระบบ
  // ทีละกอง" path. Mirrors the web UploadReceiptButton multi flow.
  async function processOneToDraft(file: File): Promise<BatchResult> {
    const name = file.name || "ไฟล์";
    try {
      const contentType =
        file.type || (name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      const hash = await sha256Of(file);

      // 1) presign + PUT → R2
      const ps = await fetch("/api/ledger/r2/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, uploadId: uploadId(), contentType }),
      });
      if (!ps.ok) throw new Error("ขอที่อัปโหลดไม่สำเร็จ");
      const ud = (await ps.json()) as { url?: string; publicUrl?: string };
      if (!ud.url) throw new Error("ขอที่อัปโหลดไม่สำเร็จ");
      const put = await fetch(ud.url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": contentType },
      });
      if (!put.ok) throw new Error("อัปโหลดไฟล์ไม่สำเร็จ");
      const uploadedUrl = ud.publicUrl ?? null;

      // 2) OCR (non-fatal — อ่านไม่ออกก็ขึ้นร่างเปล่าให้กรอกเอง)
      let parsed: {
        vendor?: string | null;
        vendorTaxId?: string | null;
        buyerTaxIdOnDoc?: string | null;
        docDate?: string | null;
        docType?: string | null;
        vendorDocNumber?: string | null;
        vendorAddress?: string | null;
        subtotal?: number | null;
        discount?: number | null;
        vat?: number | null;
        wht?: number | null;
        total?: number | null;
        paymentMethod?: string | null;
        suggestedCategory?: string | null;
        purchaseType?: string | null;
        items?: Array<Record<string, unknown>>;
        raw?: string | null;
        confidence?: Record<string, number> | null;
      } = {};
      try {
        if (uploadedUrl) {
          const ocrRes = await fetch("/api/ledger/ocr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageUrl: uploadedUrl }),
          });
          if (ocrRes.ok) {
            const b = (await ocrRes.json()) as { parsed?: typeof parsed };
            parsed = b.parsed ?? {};
          }
        }
      } catch {
        /* ignore — blank draft */
      }

      // 3) create DRAFT (never auto-post)
      const res = await fetch("/api/ledger/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          branchId: branchId || null,
          source: "line",
          vendor: parsed.vendor ?? null,
          vendorTaxId: parsed.vendorTaxId ?? null,
          buyerTaxIdOnDoc: parsed.buyerTaxIdOnDoc ?? null, // → เกรดภาษีซื้อ
          docDate: parsed.docDate ?? null,
          docType: parsed.docType ?? undefined,
          vendorDocNumber: parsed.vendorDocNumber ?? null,
          vendorAddress: parsed.vendorAddress ?? null,
          subtotal: parsed.subtotal ?? 0,
          discount: parsed.discount ?? 0,
          vat: parsed.vat ?? 0,
          wht: parsed.wht ?? 0,
          total: parsed.total ?? 0,
          items: parsed.items ?? undefined,
          categoryId: matchCategory(parsed.suggestedCategory) || null,
          suggestedCategoryName: parsed.suggestedCategory ?? null, // ghost เมื่อไม่ match
          rawText: parsed.raw ?? null,
          purchaseType: parsed.purchaseType ?? null,
          paymentMethod: parsed.paymentMethod ?? null,
          originalUrl: uploadedUrl,
          thumbUrl: uploadedUrl,
          sha256: hash,
          ocrModel: "gemini-flash",
          ocrConfidence: parsed.confidence ?? null,
          note: parsed.suggestedCategory && !matchCategory(parsed.suggestedCategory)
            ? parsed.suggestedCategory
            : null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "บันทึกไม่สำเร็จ");
      }
      const j = (await res.json().catch(() => ({}))) as { id?: string; duplicate?: boolean };
      // Drive archive (fire-and-forget · no-op ถ้ายังไม่เชื่อม Drive)
      if (j.id && !j.duplicate) {
        void fetch("/api/ledger/drive/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: j.id, companyId }),
        }).catch(() => {});
      }
      return { name, status: j.duplicate ? "dup" : "ok" };
    } catch (e) {
      return { name, status: "fail", error: e instanceof Error ? e.message : "ล้มเหลว" };
    }
  }

  async function runBatch(fileList: File[]) {
    if (!companyId) {
      setErrMsg("เลือกบริษัทก่อนอัปโหลด");
      setPhase("error");
      return;
    }
    const valid = fileList.filter(
      (f) =>
        (f.type.startsWith("image/") ||
          f.type === "application/pdf" ||
          f.name.toLowerCase().endsWith(".pdf")) &&
        f.size <= 15 * 1024 * 1024,
    );
    if (valid.length === 0) {
      setErrMsg("ไฟล์ไม่รองรับ หรือใหญ่เกิน 15MB (รับรูปภาพและ PDF)");
      setPhase("error");
      return;
    }
    setErrMsg("");
    const results: BatchResult[] = [];
    setBatch({ total: valid.length, done: 0, current: valid[0].name || "ไฟล์", results: [], finished: false });
    for (let i = 0; i < valid.length; i++) {
      setBatch((b) => (b ? { ...b, current: valid[i].name || "ไฟล์", done: i } : b));
      const r = await processOneToDraft(valid[i]);
      results.push(r);
      setBatch((b) => (b ? { ...b, done: i + 1, results: [...results] } : b));
    }
    setBatch((b) => (b ? { ...b, finished: true } : b));
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    // หลายไฟล์ → โหมด batch (ส่งเข้าระบบทีละกอง ขึ้นเป็นร่าง)
    if (fileList.length > 1) {
      const arr = Array.from(fileList);
      e.target.value = "";
      await runBatch(arr);
      return;
    }

    const file = fileList[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setErrMsg("ไฟล์ใหญ่เกินไป · ต้องไม่เกิน 15MB");
      setPhase("error");
      return;
    }
    const pdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!file.type.startsWith("image/") && !pdf) {
      setErrMsg("รองรับเฉพาะรูปภาพและ PDF");
      setPhase("error");
      return;
    }
    setIsPdf(pdf);
    if (!companyId) {
      setErrMsg("เลือกบริษัทก่อนถ่ายใบเสร็จ");
      setPhase("error");
      return;
    }
    // Revoke any previous preview blob before overwriting (retake → no leak).
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return URL.createObjectURL(file);
    });
    setPhase("parsing");
    setErrMsg("");
    setServerWarnings([]);

    // Compute the image hash up front (for dedup on save).
    const hash = await sha256Of(file);
    setSha256(hash);

    try {
      // 1) presign + upload to R2 (company-scoped key). Falls back to inline
      //    multipart OCR if R2 isn't reachable.
      let uploadedUrl: string | null = null;
      try {
        const ps = await fetch("/api/ledger/r2/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            uploadId: upload.current,
            contentType: file.type || "image/jpeg",
          }),
        });
        if (ps.ok) {
          const data = (await ps.json()) as { url?: string; publicUrl?: string };
          if (data.url) {
            const put = await fetch(data.url, {
              method: "PUT",
              body: file,
              headers: { "Content-Type": file.type || "image/jpeg" },
            });
            if (put.ok) uploadedUrl = data.publicUrl ?? null;
          }
        }
      } catch {
        // R2 unavailable → OCR via multipart only.
      }
      setImageUrl(uploadedUrl);

      // 2) AI parse — send the uploaded URL when present, else raw file multipart.
      let ocrRes: Response;
      if (uploadedUrl) {
        ocrRes = await fetch("/api/ledger/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: uploadedUrl }),
        });
      } else {
        const fd = new FormData();
        fd.append("file", file);
        ocrRes = await fetch("/api/ledger/ocr", { method: "POST", body: fd });
      }

      if (!ocrRes.ok) {
        // OCR unavailable → let the staffer key it in manually (no dead end).
        setFields({ ...EMPTY, docDate: todayISO() });
        setAiExtra({});
        setPhase("review");
        return;
      }

      // OCR route returns { parsed, recheck } where parsed is camelCase.
      const body = (await ocrRes.json()) as {
        parsed?: {
          vendor?: string | null;
          vendorTaxId?: string | null;
          buyerTaxIdOnDoc?: string | null;
          docDate?: string | null;
          docType?: string | null;
          vendorDocNumber?: string | null;
          vendorAddress?: string | null;
          subtotal?: number | null;
          discount?: number | null;
          vat?: number | null;
          wht?: number | null;
          total?: number | null;
          paymentMethod?: string | null;
          suggestedCategory?: string | null;
          items?: Array<Record<string, unknown>>;
          raw?: string | null;
          confidence?: Record<string, number> | null;
        } | null;
        recheck?: { ok?: boolean; warnings?: string[] } | null;
        error?: string;
      };

      const parsed = body.parsed ?? {};
      setServerWarnings(body.recheck?.warnings ?? []);
      setFields({
        vendor: parsed.vendor ?? "",
        vendorTaxId: parsed.vendorTaxId ?? "",
        docDate: parsed.docDate ?? todayISO(),
        subtotal: parsed.subtotal != null ? String(parsed.subtotal) : "",
        vat: parsed.vat != null ? String(parsed.vat) : "",
        total: parsed.total != null ? String(parsed.total) : "",
        paymentMethod: parsed.paymentMethod ?? "",
        suggestedCategory: parsed.suggestedCategory ?? "",
        categoryId: matchCategory(parsed.suggestedCategory),
        confidence: parsed.confidence ?? {},
      });
      // เก็บฟิลด์ AI ที่ฟอร์มไม่ได้โชว์ ไว้ forward ตอนบันทึก (เกรดภาษีซื้อ + items)
      setAiExtra({
        buyerTaxIdOnDoc: parsed.buyerTaxIdOnDoc ?? null,
        docType: parsed.docType ?? null,
        vendorDocNumber: parsed.vendorDocNumber ?? null,
        vendorAddress: parsed.vendorAddress ?? null,
        wht: parsed.wht ?? null,
        discount: parsed.discount ?? null,
        items: parsed.items,
        raw: parsed.raw ?? null,
      });
      setPhase("review");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "อ่านใบเสร็จไม่สำเร็จ");
      setPhase("error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onConfirm() {
    if (!companyId) {
      setErrMsg("เลือกบริษัทก่อนบันทึก");
      setPhase("error");
      return;
    }
    if (num(fields.total) <= 0) {
      setErrMsg("กรอกยอดรวมก่อนบันทึก");
      setPhase("error");
      return;
    }
    setPhase("saving");
    setErrMsg("");
    try {
      const res = await fetch("/api/ledger/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          branchId: branchId || null,
          source: "line",
          // status is forced to "draft" server-side (golden rule); we never send
          // "confirmed" from the field.
          vendor: fields.vendor || null,
          vendorTaxId: fields.vendorTaxId || null,
          buyerTaxIdOnDoc: aiExtra.buyerTaxIdOnDoc ?? null, // → เกรดภาษีซื้อ (ขอคืนได้?)
          docDate: fields.docDate || null,
          docType: aiExtra.docType ?? undefined,
          vendorDocNumber: aiExtra.vendorDocNumber ?? null,
          vendorAddress: aiExtra.vendorAddress ?? null,
          subtotal: num(fields.subtotal),
          discount: aiExtra.discount ?? 0,
          vat: num(fields.vat),
          wht: aiExtra.wht ?? 0,
          total: num(fields.total),
          items: aiExtra.items ?? undefined,
          categoryId: fields.categoryId || null,
          suggestedCategoryName: fields.categoryId ? null : fields.suggestedCategory || null, // ghost เมื่อยังไม่เลือก
          rawText: aiExtra.raw ?? null,
          paymentMethod: fields.paymentMethod || null,
          originalUrl: imageUrl,
          thumbUrl: imageUrl,
          sha256,
          ocrModel: "gemini-flash",
          ocrConfidence: fields.confidence,
          note: fields.categoryId ? null : fields.suggestedCategory || null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
      }
      const j = (await res.json().catch(() => ({}))) as {
        id?: string;
        docCode?: string;
        duplicate?: boolean;
      };
      setSavedCode(j.docCode ?? null);
      setDuplicate(!!j.duplicate);
      setPhase("done");
      // Fire-and-forget: archive the original into Google Drive (เดือน/สาขา/หมวด)
      // so the accountant gets the shareable original. No-ops if Drive isn't
      // configured; never blocks the capture flow.
      if (j.id && !j.duplicate) {
        void fetch("/api/ledger/drive/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: j.id, companyId }),
        }).catch(() => {});
      }
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      setPhase("error");
    }
  }

  const showContextPicker = phase === "capture";

  // ── Batch overlay (หลายไฟล์) — แทนหน้าถ่ายปกติระหว่าง/หลังอัปโหลดเป็นกอง ──
  if (batch) {
    const okCount = batch.results.filter((r) => r.status === "ok").length;
    const dupCount = batch.results.filter((r) => r.status === "dup").length;
    const failCount = batch.results.filter((r) => r.status === "fail").length;
    const pct = batch.total > 0 ? Math.round((batch.done / batch.total) * 100) : 0;
    return (
      <div className="min-h-screen bg-zinc-50 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-5">
        <header className="mb-5">
          <LedgerLogo height={20} className="mb-3 opacity-90" priority />
          <h1 className="text-xl font-bold text-zinc-900">อัปโหลดหลายไฟล์</h1>
        </header>

        {!batch.finished ? (
          <div className="animate-fade-in rounded-2xl bg-white p-5 ring-1 ring-zinc-200" role="status" aria-live="polite">
            <div className="mb-1 flex items-center gap-2">
              <div className="size-5 animate-spin rounded-full border-[3px] border-[var(--color-brand-200)] border-t-[var(--color-brand-600)]" />
              <span className="text-base font-bold text-zinc-900">กำลังอัปโหลด</span>
            </div>
            <p className="mb-4 text-sm text-zinc-600">AI กำลังอ่านใบเสร็จทีละใบ · อย่าเพิ่งปิดหน้านี้</p>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold tabular-nums text-zinc-900">
                {batch.done}
                <span className="text-base font-medium text-zinc-500"> / {batch.total}</span>
              </span>
              <span className="text-xs font-medium tabular-nums text-zinc-500">{pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-[var(--color-brand-600)] transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 truncate text-xs text-zinc-500">{batch.current}</p>
          </div>
        ) : (
          <div className="animate-fade-up space-y-4">
            <div className="rounded-2xl bg-white p-5 text-center ring-1 ring-zinc-200">
              <div className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-emerald-100 text-3xl text-emerald-700">
                ✓
              </div>
              <h2 className="text-lg font-bold text-zinc-900">
                {okCount > 0 ? `เพิ่ม ${okCount} ใบ (ร่าง) แล้ว` : "เสร็จสิ้น"}
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                ส่งให้ฝ่ายบัญชีตรวจ · ดูได้ที่ “ใบของฉัน”
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {okCount > 0 && (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                    สำเร็จ {okCount}
                  </span>
                )}
                {dupCount > 0 && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                    ซ้ำ (ข้าม) {dupCount}
                  </span>
                )}
                {failCount > 0 && (
                  <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                    ล้มเหลว {failCount}
                  </span>
                )}
              </div>
            </div>

            {failCount > 0 && (
              <ul className="space-y-1 rounded-2xl bg-white p-3 text-sm text-zinc-700 ring-1 ring-zinc-200">
                {batch.results
                  .filter((r) => r.status === "fail")
                  .map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span aria-hidden>⚠️</span>
                      <span className="min-w-0">
                        <span className="font-medium text-zinc-900">{r.name}</span> · {r.error}
                      </span>
                    </li>
                  ))}
              </ul>
            )}

            <button
              type="button"
              onClick={() => {
                setBatch(null);
                reset();
              }}
              className="press h-12 w-full rounded-xl bg-[var(--color-brand-600)] text-base font-semibold text-white transition active:bg-[var(--color-brand-700)]"
            >
              อัปโหลดเพิ่ม
            </button>
            <Link
              href="/liff/ledger/my"
              className="press flex h-12 w-full items-center justify-center rounded-xl border border-zinc-300 bg-white text-base font-semibold text-zinc-800 transition active:bg-zinc-50"
            >
              📋 ดูใบของฉัน
            </Link>
          </div>
        )}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-50 px-4 pb-32 pt-5">
      <header className="mb-4">
        <LedgerLogo height={20} className="mb-3 opacity-90" priority />
        {/* Mascot greets on the capture hero — warm, not scary text-only. Only on
            the capture screen so it doesn't crowd the review/done states. */}
        {phase === "capture" ? (
          <div className="flex animate-fade-in items-center gap-3">
            <LedgerMascot size={56} priority className="shrink-0" />
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-zinc-900">ถ่ายใบเสร็จ</h1>
              <p className="mt-0.5 text-sm text-zinc-600">
                ถ่ายรูป · AI อ่านให้ · คุณตรวจแล้วบันทึก
              </p>
            </div>
          </div>
        ) : (
          <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-900">
            <span aria-hidden>📸</span> ถ่ายใบเสร็จ
          </h1>
        )}
      </header>

      {/* Company / branch context — shown on the capture screen so every receipt
          is filed to the right book. Hidden once a photo is in flight. */}
      {showContextPicker && (
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-2xl bg-white p-3 ring-1 ring-zinc-200">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600">บริษัท</span>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base font-medium text-zinc-900 outline-none focus:border-[var(--color-brand-500)]"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="mb-1 block text-xs font-medium text-zinc-600">สาขา (ถ้ามี)</span>
            <BranchPicker
              branches={branches}
              value={branchId}
              onChange={setBranchId}
              placeholder="— ทั้งบริษัท —"
            />
          </div>
        </div>
      )}

      {/* Context chip on non-capture screens (so the staffer always sees the book). */}
      {!showContextPicker && activeCompany && (
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand-50)] px-3 py-1 text-xs font-medium text-[var(--color-brand-700)]">
          <span aria-hidden>🏢</span>
          {activeCompany.name}
          {branchId && branches.find((b) => b.id === branchId) && (
            <span className="text-[var(--color-brand-500)]">· {branches.find((b) => b.id === branchId)!.name}</span>
          )}
        </div>
      )}

      {/* Receipt preview (PDF → document card; images can't render a PDF) */}
      {preview && (
        <div className="mb-4 overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200">
          {isPdf ? (
            <div className="flex flex-col items-center justify-center gap-2 bg-zinc-50 px-4 py-8 text-center">
              <span className="text-4xl" aria-hidden>📄</span>
              <span className="text-sm font-medium text-zinc-600">ไฟล์ PDF</span>
            </div>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="รูปใบเสร็จที่ถ่าย"
                className="max-h-64 w-full bg-zinc-100 object-contain"
              />
            </>
          )}
        </div>
      )}

      {/* Phase: capture */}
      {phase === "capture" && (
        <div className="animate-fade-up space-y-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="แตะเพื่อถ่ายหรือเลือกรูปใบเสร็จ"
            className="press flex min-h-[44px] h-44 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--color-brand-300)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] transition active:bg-[var(--color-brand-100)]"
          >
            <span className="text-4xl" aria-hidden>📷</span>
            <span className="text-base font-semibold">แตะเพื่อถ่าย หรือเลือกรูป · PDF</span>
            <span className="text-xs text-[var(--color-brand-700)]">เลือกหลายไฟล์พร้อมกันได้ · รับรูป · บิล · สลิป · PDF</span>
          </button>
          <p className="px-1 text-center text-xs text-zinc-500">
            เคล็ดลับ: ปิด Live Photo บน iPhone เพื่อให้ AI อ่านแม่นขึ้น
          </p>
        </div>
      )}

      {/* Phase: parsing */}
      {phase === "parsing" && (
        <div
          className="flex animate-fade-in flex-col items-center justify-center gap-3 py-10 text-center"
          role="status"
          aria-live="polite"
        >
          <div className="size-12 animate-spin rounded-full border-4 border-[var(--color-brand-200)] border-t-[var(--color-brand-600)]" />
          <p className="text-base font-semibold text-zinc-800">AI กำลังอ่านใบเสร็จ...</p>
          <p className="text-sm text-zinc-500">สักครู่ · อย่าเพิ่งปิดหน้านี้</p>
        </div>
      )}

      {/* Phase: review (edit fields) */}
      {phase === "review" && (
        <div className="animate-fade-up space-y-4">
          {/* Server Recheck warnings — authoritative math/format check. */}
          {serverWarnings.length > 0 && (
            <div
              className="rounded-2xl border border-amber-200 bg-amber-50 p-3"
              role="alert"
            >
              <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-amber-800">
                <span aria-hidden>⚠️</span> ตรวจตัวเลขก่อนบันทึก
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700">
                {serverWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <Field label="ยอดรวม (บาท)" conf={fields.confidence.total}>
              <input
                inputMode="decimal"
                value={fields.total}
                onChange={(e) => set("total", e.target.value)}
                placeholder="0.00"
                aria-label="ยอดรวม"
                className="h-12 w-full rounded-xl border border-zinc-200 px-3 text-xl font-bold tabular-nums outline-none focus:border-[var(--color-brand-500)]"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="ยอดก่อน VAT" conf={fields.confidence.subtotal}>
                <input
                  inputMode="decimal"
                  value={fields.subtotal}
                  onChange={(e) => set("subtotal", e.target.value)}
                  placeholder="0.00"
                  aria-label="ยอดก่อน VAT"
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-base tabular-nums outline-none focus:border-[var(--color-brand-500)]"
                />
              </Field>
              <Field label="VAT" conf={fields.confidence.vat}>
                <input
                  inputMode="decimal"
                  value={fields.vat}
                  onChange={(e) => set("vat", e.target.value)}
                  placeholder="0.00"
                  aria-label="VAT"
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-base tabular-nums outline-none focus:border-[var(--color-brand-500)]"
                />
              </Field>
            </div>

            {mathMismatch(fields) && serverWarnings.length === 0 && (
              <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800" role="alert">
                ⚠️ ยอดก่อน VAT + VAT ไม่เท่ากับยอดรวม · ตรวจอีกครั้ง
              </div>
            )}

            <Field label="ร้านค้า / ผู้ขาย" conf={fields.confidence.vendor}>
              <input
                value={fields.vendor}
                onChange={(e) => set("vendor", e.target.value)}
                placeholder="ชื่อร้าน"
                aria-label="ร้านค้า"
                className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-base outline-none focus:border-[var(--color-brand-500)]"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="วันที่" conf={fields.confidence.doc_date}>
                <input
                  type="date"
                  value={fields.docDate}
                  onChange={(e) => set("docDate", e.target.value)}
                  aria-label="วันที่ในเอกสาร"
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-base outline-none focus:border-[var(--color-brand-500)]"
                />
              </Field>
              <Field label="เลขภาษี 13 หลัก" conf={fields.confidence.vendor_tax_id}>
                <input
                  inputMode="numeric"
                  value={fields.vendorTaxId}
                  onChange={(e) =>
                    set("vendorTaxId", e.target.value.replace(/\D/g, "").slice(0, 13))
                  }
                  placeholder="0000000000000"
                  aria-label="เลขประจำตัวผู้เสียภาษี"
                  className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-base tabular-nums outline-none focus:border-[var(--color-brand-500)]"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="หมวด" conf={fields.confidence.category}>
                {categories.length > 0 ? (
                  <select
                    value={fields.categoryId}
                    onChange={(e) => set("categoryId", e.target.value)}
                    aria-label="หมวดค่าใช้จ่าย"
                    className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base outline-none focus:border-[var(--color-brand-500)]"
                  >
                    <option value="">
                      {fields.suggestedCategory ? `AI: ${fields.suggestedCategory}` : "— เลือกหมวด —"}
                    </option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={fields.suggestedCategory}
                    onChange={(e) => set("suggestedCategory", e.target.value)}
                    placeholder="เช่น ค่าน้ำมัน/ขนส่ง"
                    aria-label="หมวด (AI แนะนำ)"
                    className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-base outline-none focus:border-[var(--color-brand-500)]"
                  />
                )}
              </Field>
              <Field label="วิธีชำระ" conf={fields.confidence.payment_method}>
                <select
                  value={fields.paymentMethod}
                  onChange={(e) => set("paymentMethod", e.target.value)}
                  aria-label="วิธีชำระเงิน"
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base outline-none focus:border-[var(--color-brand-500)]"
                >
                  {PAYMENT_METHODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <p className="px-1 text-center text-sm text-zinc-500">
            บันทึกเป็น “ฉบับร่าง” · ฝ่ายบัญชียืนยันทีหลัง (ไม่ลงบัญชีอัตโนมัติ)
          </p>
        </div>
      )}

      {/* Phase: saving */}
      {phase === "saving" && (
        <div
          className="flex animate-fade-in flex-col items-center justify-center gap-3 py-10 text-center"
          role="status"
          aria-live="polite"
        >
          <div className="size-12 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
          <p className="text-base font-semibold text-zinc-800">กำลังบันทึก...</p>
        </div>
      )}

      {/* Phase: done */}
      {phase === "done" && (
        <div className="animate-fade-up space-y-5 py-8 text-center" role="status" aria-live="polite">
          <div className="relative inline-flex">
            <div className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-30" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-4xl text-white">
              ✓
            </div>
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-900">
              {duplicate ? "ใบเสร็จนี้บันทึกไว้แล้ว" : "บันทึกแล้ว"}
            </h2>
            <p className="mt-1 px-4 text-sm text-zinc-600">
              {duplicate
                ? "ระบบเจอรูปเดิม จึงไม่บันทึกซ้ำ"
                : `ส่งให้ฝ่ายบัญชีตรวจ · ยอด ฿${num(fields.total).toLocaleString("th-TH")}`}
            </p>
          </div>
          {savedCode && (
            <div className="mx-auto inline-block rounded-2xl bg-white px-6 py-4 ring-1 ring-zinc-200">
              <div className="text-xs font-medium text-zinc-500">เลขเอกสาร</div>
              <div className="mt-0.5 font-mono text-lg font-bold tracking-wider text-zinc-900">
                {savedCode}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={reset}
            className="press h-12 w-full rounded-xl bg-[var(--color-brand-600)] text-base font-semibold text-white transition active:bg-[var(--color-brand-700)]"
          >
            ถ่ายใบเสร็จอื่น
          </button>
          {/* discoverability: jump to the staffer's own receipt list */}
          <Link
            href="/liff/ledger/my"
            className="press flex h-12 w-full items-center justify-center rounded-xl border border-zinc-300 bg-white text-base font-semibold text-zinc-800 transition active:bg-zinc-50"
          >
            📋 ดูใบของฉัน
          </Link>
        </div>
      )}

      {/* Phase: error */}
      {phase === "error" && (
        <div className="animate-fade-up space-y-4 py-8 text-center" role="alert">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-red-100 text-2xl">
            ⚠️
          </div>
          <p className="text-lg font-bold text-zinc-900">เกิดข้อผิดพลาด</p>
          <p className="break-words rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-left text-sm text-zinc-700">
            {errMsg}
          </p>
          <div className="space-y-2">
            {preview && (
              <button
                type="button"
                onClick={() => setPhase("review")}
                className="press h-12 w-full rounded-xl bg-zinc-900 text-base font-semibold text-white transition active:bg-zinc-800"
              >
                กรอกเอง
              </button>
            )}
            <button
              type="button"
              onClick={reset}
              className="press h-12 w-full rounded-xl border border-zinc-300 bg-white text-base font-semibold text-zinc-800 transition active:bg-zinc-50"
            >
              เริ่มใหม่
            </button>
          </div>
        </div>
      )}

      {/* Sticky confirm bar (review phase) */}
      {phase === "review" && (
        <div className="fixed inset-x-0 bottom-0 z-20 animate-slide-up-soft border-t border-zinc-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex max-w-md gap-2">
            <button
              type="button"
              onClick={reset}
              className="press h-12 flex-1 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 transition active:bg-zinc-50"
            >
              ยกเลิก
            </button>
            {/* ถ่ายใหม่ — รูปเบลอ/AI อ่านผิด กดถ่ายใหม่ได้เลย (เก็บบริษัท/สาขาไว้ ผ่าน onPick เดิม). */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="press flex h-12 flex-1 items-center justify-center gap-1 rounded-xl border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-sm font-semibold text-[var(--color-brand-700)] transition active:bg-white"
            >
              📷 ถ่ายใหม่
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="press h-12 flex-[2] rounded-xl bg-[var(--color-brand-600)] text-base font-semibold text-white shadow-lg transition active:bg-[var(--color-brand-700)]"
            >
              บันทึก (ร่าง)
            </button>
          </div>
        </div>
      )}

      {/* รับรูปภาพ + PDF · multiple = เลือกหลายไฟล์พร้อมกันได้ (โหมด batch)
          ไม่ใส่ capture เพื่อให้เลือกไฟล์/PDF จากเครื่องได้ (OS ยังเสนอกล้องให้อยู่) */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={onPick}
      />
    </div>
  );
}

function Field({
  label,
  conf,
  children,
}: {
  label: string;
  conf?: number;
  children: React.ReactNode;
}) {
  const lbl = confLabel(conf);
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-700">{label}</span>
        {lbl && (
          <span className={`text-xs font-semibold ${confColor(conf)}`}>
            {conf != null && <span className="tabular-nums">{Math.round(conf * 100)}% </span>}
            {lbl}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}
