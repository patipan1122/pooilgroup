"use client";

// อัปโหลดใบเสร็จจากเว็บ (back-office) → สร้าง "ร่าง" ให้บัญชีตรวจ.
//
// ขั้นตอน (ทุกอย่างต่อกับ backend ที่มีอยู่แล้ว — ไม่มีปุ่มตาย):
//   1. presign        → POST /api/ledger/r2/presign        (ขอที่อัปโหลดรูปบน R2)
//   2. PUT image       → อัปโหลดรูปตรงเข้า R2
//   3. OCR             → POST /api/ledger/ocr {imageUrl}    (AI อ่านค่า + confidence)
//   4. create draft    → POST /api/ledger/expenses          (status=draft เสมอ · dedup ด้วย sha256)
//   5. เปิดใบนั้นในแพเนลขวาให้บัญชีตรวจ/ยืนยัน
//
// *** ห้าม auto-post *** — ใบที่สร้างเป็น "ร่าง" จนกว่าบัญชีจะกดยืนยันเอง.
import { useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Upload,
  Loader2,
  ScanLine,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Phase = "idle" | "uploading" | "reading" | "saving" | "done" | "error";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "อัปโหลดใบเสร็จ",
  uploading: "กำลังอัปโหลดรูป…",
  reading: "AI กำลังอ่านใบเสร็จ…",
  saving: "กำลังบันทึกร่าง…",
  done: "เสร็จ",
  error: "ลองใหม่",
};

const MAX_BYTES = 8 * 1024 * 1024;

async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export function UploadReceiptButton({
  companyId,
  branchId,
  baseParams,
}: {
  companyId: string;
  branchId?: string | null;
  /** company/branch/filter params to preserve when we navigate to the new draft */
  baseParams: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const busy = phase === "uploading" || phase === "reading" || phase === "saving";

  function pick() {
    setErr(null);
    inputRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setPhase("error");
      setErr("กรุณาเลือกไฟล์รูปภาพ (jpg/png/webp/heic)");
      return;
    }
    if (file.size > MAX_BYTES) {
      setPhase("error");
      setErr("รูปใหญ่เกิน 8 MB");
      return;
    }

    try {
      const bytes = await file.arrayBuffer();
      const sha = await sha256Hex(bytes);

      // 1) presign
      setPhase("uploading");
      const presignRes = await fetch("/api/ledger/r2/presign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId,
          contentType: file.type,
        }),
      });
      if (!presignRes.ok) {
        throw new Error("ขอที่อัปโหลดไม่สำเร็จ");
      }
      const { url, publicUrl } = (await presignRes.json()) as {
        url: string;
        publicUrl: string;
      };

      // 2) PUT image → R2
      const put = await fetch(url, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("อัปโหลดรูปไม่สำเร็จ");

      // 3) OCR (read fields from the uploaded image)
      setPhase("reading");
      let parsed: {
        vendor?: string | null;
        vendorTaxId?: string | null;
        docDate?: string | null;
        subtotal?: number | null;
        vat?: number | null;
        wht?: number | null;
        total?: number | null;
        paymentMethod?: string | null;
        confidence?: Record<string, number>;
        ocrModel?: string;
      } = {};
      try {
        const ocrRes = await fetch("/api/ledger/ocr", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ imageUrl: publicUrl }),
        });
        if (ocrRes.ok) {
          const json = (await ocrRes.json()) as { parsed?: typeof parsed };
          if (json.parsed) parsed = json.parsed;
        }
        // OCR failing is non-fatal — we still create an empty draft to fill in.
      } catch {
        /* ignore — fall through to manual draft */
      }

      // 4) create draft (status=draft — never auto-post)
      setPhase("saving");
      const createRes = await fetch("/api/ledger/expenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId,
          branchId: branchId || null,
          source: "web",
          vendor: parsed.vendor ?? null,
          vendorTaxId: parsed.vendorTaxId ?? null,
          docDate: parsed.docDate ?? null,
          subtotal: parsed.subtotal ?? 0,
          vat: parsed.vat ?? 0,
          wht: parsed.wht ?? 0,
          total: parsed.total ?? 0,
          paymentMethod: parsed.paymentMethod ?? null,
          originalUrl: publicUrl,
          thumbUrl: publicUrl,
          sha256: sha,
          ocrModel: parsed.ocrModel ?? null,
          ocrConfidence: parsed.confidence ?? null,
        }),
      });
      if (!createRes.ok) {
        const j = (await createRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "บันทึกร่างไม่สำเร็จ");
      }
      const created = (await createRes.json()) as { id: string; duplicate?: boolean };

      setPhase("done");
      // 5) open the new draft in the review pane
      const sp = new URLSearchParams(baseParams);
      sp.set("selected", created.id);
      startTransition(() => {
        router.push(`${pathname}?${sp.toString()}`);
        router.refresh();
      });
      // reset the label shortly after
      setTimeout(() => setPhase("idle"), 1500);
    } catch (e) {
      setPhase("error");
      setErr(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={onFile}
        aria-hidden
        tabIndex={-1}
      />
      <Button
        variant="primary"
        onClick={pick}
        disabled={busy || !companyId}
        aria-label="อัปโหลดใบเสร็จ"
      >
        {phase === "uploading" || phase === "saving" ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : phase === "reading" ? (
          <ScanLine className="size-4 animate-pulse" aria-hidden />
        ) : phase === "done" ? (
          <CheckCircle2 className="size-4" aria-hidden />
        ) : (
          <Upload className="size-4" aria-hidden />
        )}
        {PHASE_LABEL[phase]}
      </Button>
      {err && (
        <p className="flex items-center gap-1 text-xs text-rose-600" role="alert">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {err}
        </p>
      )}
    </div>
  );
}
