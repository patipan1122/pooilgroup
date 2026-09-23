"use client";

// SignerInterface — mobile-first signing flow
// ────────────────────────────────────────────────────────────────────
// Two-step flow (state machine: "preview" | "confirm"):
//   1. "preview" — full-document read-only preview (SignerDocumentPreview)
//      showing every signature position on every page, so the signer sees
//      the whole document's signing plan before committing to anything.
//      A single "ถัดไป → ยืนยันลายเซ็น" button advances to step 2.
//   2. "confirm" — decision surface:
//        - Has a saved signature: one-tap "ใช้ลายเซ็นนี้" (submits via
//          the useSavedSignature API path, no drawing needed), or
//          "วาดใหม่" / "ใช้ลายเซ็นอื่นสำหรับครั้งนี้" (both open the same
//          fullscreen draw pad — copy/intent differs, not code).
//        - No saved signature: opens the fullscreen draw pad directly.
//      The draw pad always carries a "บันทึกลายเซ็นนี้ไว้ใช้ครั้งต่อไป"
//      checkbox — defaulted CHECKED when the signer has no saved signature
//      yet (first-time save), defaulted UNCHECKED when they already have
//      one (drawing fresh here is "just for this time" unless they
//      explicitly opt back in to overwrite it).
//
// If `placement.signedAt` is already set (this signer already signed),
// we skip both steps entirely and render the original single-page "done"
// view unchanged from before this restructure.
//
// react-pdf is loaded via next/dynamic to avoid SSR issues. The signature
// canvas component (react-signature-canvas) is also dynamic for the same
// reason — it relies on browser canvas APIs.
// ────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  PenLine,
  Loader2,
  CheckCircle2,
  X,
  RotateCcw,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import {
  SignaturePlacementBox,
  type PlacementRect,
} from "./signature-placement-box";
import {
  SignerDocumentPreview,
  type SignerPreviewPlacementVm,
} from "./signer-document-preview";
import { configurePdfJs } from "@/lib/docuflow/pdfjs-config";

const ReactPdfDocument = dynamic(
  () => import("react-pdf").then((m) => m.Document),
  { ssr: false, loading: () => <PdfSkeleton /> },
);
const ReactPdfPage = dynamic(
  () => import("react-pdf").then((m) => m.Page),
  { ssr: false },
);
// react-signature-canvas — also browser-only (canvas, pointer events)
const SignatureCanvas = dynamic(
  () => import("react-signature-canvas").then((m) => m.default ?? m),
  { ssr: false, loading: () => <Loader2 className="size-6 animate-spin" /> },
);

function PdfSkeleton() {
  return (
    <div className="w-full h-[480px] flex items-center justify-center bg-zinc-50 rounded-xl">
      <Loader2 className="size-6 animate-spin text-zinc-400" />
    </div>
  );
}

export interface SignerPlacementVm {
  id: string;
  documentId: string;
  pageNumber: number;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  /** signature | date | name | text — auto-fill types are stamped at embed time. */
  placementType?: "signature" | "date" | "name" | "text";
  autoFillValue?: string | null;
  signerRole: string;
  label: string | null;
  signedAt: string | null;
  signerName: string | null;
}

export interface SignerInterfaceProps {
  documentId: string;
  documentName: string;
  pdfUrl: string;
  placement: SignerPlacementVm;
  /** ALL placements on the document (not just this one) — for the preview step. */
  placements: SignerPreviewPlacementVm[];
  /** Signed-in user's saved signature preview URL, or null if none saved. */
  savedSignatureUrl: string | null;
  /** Best-effort display name shown in the header. */
  signerDisplayName: string;
}

/** Minimal interface for the bits we actually call on the canvas ref. */
type SignaturePadHandle = {
  toDataURL: (type?: string) => string;
  clear: () => void;
  isEmpty: () => boolean;
  getTrimmedCanvas: () => HTMLCanvasElement;
};

type Step = "preview" | "confirm";

export function SignerInterface({
  documentId,
  documentName,
  pdfUrl,
  placement,
  placements,
  savedSignatureUrl,
  signerDisplayName,
}: SignerInterfaceProps) {
  const [step, setStep] = useState<Step>("preview");
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [openPad, setOpenPad] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(!!placement.signedAt);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [overlaySize, setOverlaySize] = useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });
  const padRef = useRef<SignaturePadHandle | null>(null);
  const pageWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void configurePdfJs();
  }, []);

  // Only relevant for the "done" single-page view below.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) setOverlaySize({ width, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [pageCount]);

  // Auto-scroll to the page wrap when the "done" view's PDF loads
  useEffect(() => {
    if (!pageCount) return;
    const el = pageWrapRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [pageCount]);

  const rect: PlacementRect = useMemo(
    () => ({
      xRatio: placement.xRatio,
      yRatio: placement.yRatio,
      widthRatio: placement.widthRatio,
      heightRatio: placement.heightRatio,
    }),
    [placement],
  );

  async function submitAndFinish(payload: Record<string, unknown>) {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/docuflow/${documentId}/signatures/${placement.id}/sign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        remaining?: number;
      };
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setOpenPad(false);
      setDone(true);
      if ((data.remaining ?? 1) === 0) {
        toast.success("เซ็นสำเร็จ! เอกสารฉบับเซ็นแล้วถูกสร้างเรียบร้อย");
      } else {
        toast.success("เซ็นสำเร็จ ขอบคุณค่ะ");
      }
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "ส่งลายเซ็นไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitDrawn(saveAsDefault: boolean) {
    if (!padRef.current) {
      toast.error("กรุณาเซ็นในช่อง");
      return;
    }
    if (padRef.current.isEmpty()) {
      toast.error("กรุณาเซ็นก่อนส่ง");
      return;
    }
    // Trim whitespace + export PNG (data URL)
    const canvas = padRef.current.getTrimmedCanvas();
    const dataUrl = canvas.toDataURL("image/png");
    await submitAndFinish({ imageDataUrl: dataUrl, saveAsDefault });
  }

  async function handleSubmitSaved() {
    await submitAndFinish({ useSavedSignature: true });
  }

  /* ============================================================
     Done — unchanged from before this restructure.
     ============================================================ */
  if (done) {
    return (
      <div className="space-y-4">
        <Card>
          <CardBody className="space-y-2">
            <p className="text-xs font-bold text-zinc-500">เซ็นเอกสาร</p>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight font-display line-clamp-2">
              {documentName}
            </h1>
            <p className="text-sm text-zinc-600">
              <span className="inline-flex items-center gap-1.5 text-green-700 font-medium">
                <CheckCircle2 className="size-4" /> ลงนามแล้ว ({signerDisplayName})
              </span>
            </p>
          </CardBody>
        </Card>

        {/* PDF preview with placement highlighted */}
        <Card>
          <CardBody className="p-2 sm:p-4">
            <div
              ref={pageWrapRef}
              className="relative mx-auto bg-zinc-50 rounded-xl border border-zinc-200 overflow-hidden"
              style={{ maxWidth: 720 }}
            >
              <ReactPdfDocument
                file={pdfUrl}
                onLoadSuccess={({ numPages }: { numPages: number }) =>
                  setPageCount(numPages)
                }
                onLoadError={(err: Error) => {
                  console.error("PDF load error", err);
                  toast.error("เปิดไฟล์ PDF ไม่สำเร็จ");
                }}
                loading={<PdfSkeleton />}
              >
                <div className="relative">
                  <ReactPdfPage
                    pageNumber={placement.pageNumber}
                    width={720}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                  />
                  <div ref={overlayRef} className="absolute inset-0">
                    <SignaturePlacementBox
                      id={placement.id}
                      rect={rect}
                      label={placement.label}
                      roleLabel={placement.signerRole}
                      placementType={placement.placementType ?? "signature"}
                      autoFillValue={placement.autoFillValue}
                      signed={done}
                      selected
                      containerWidth={overlaySize.width || 720}
                      containerHeight={overlaySize.height || 0}
                      readOnly
                    />
                  </div>
                </div>
              </ReactPdfDocument>
            </div>
            <p className="mt-2 text-xs text-zinc-500 text-center">
              หน้า {placement.pageNumber}
              {pageCount ? ` / ${pageCount}` : ""}
            </p>
          </CardBody>
        </Card>

        <div className="sticky bottom-3 z-20 px-1">
          <Button variant="outline" size="xl" fullWidth disabled>
            <CheckCircle2 className="size-5" />
            ลงนามเรียบร้อย
          </Button>
        </div>
      </div>
    );
  }

  /* ============================================================
     Step "preview" — full-document read-only preview.
     ============================================================ */
  if (step === "preview") {
    return (
      <div className="space-y-4">
        <Card>
          <CardBody className="space-y-2">
            <p className="text-xs font-bold text-zinc-500">เซ็นเอกสาร</p>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight font-display line-clamp-2">
              {documentName}
            </h1>
            <p className="text-sm text-zinc-600">
              กรุณาตรวจดูเอกสารทั้งหมดก่อนเซ็น — สวัสดี {signerDisplayName}
            </p>
          </CardBody>
        </Card>

        <SignerDocumentPreview
          pdfUrl={pdfUrl}
          placements={placements}
          currentPlacementId={placement.id}
        />

        <div className="sticky bottom-3 z-20 px-1">
          <Button
            variant="primary"
            size="xl"
            fullWidth
            onClick={() => setStep("confirm")}
          >
            ถัดไป → ยืนยันลายเซ็น
          </Button>
        </div>
      </div>
    );
  }

  /* ============================================================
     Step "confirm" — one-tap saved signature, or draw fresh.
     ============================================================ */
  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-2">
          <button
            type="button"
            onClick={() => setStep("preview")}
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700"
          >
            <ArrowLeft className="size-3.5" />
            กลับไปดูเอกสาร
          </button>
          <p className="text-xs font-bold text-zinc-500">ยืนยันลายเซ็น</p>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight font-display line-clamp-2">
            {documentName}
          </h1>
          <p className="text-sm text-zinc-600">
            เลือกวิธีเซ็น — สวัสดี {signerDisplayName}
          </p>
        </CardBody>
      </Card>

      {savedSignatureUrl ? (
        <Card>
          <CardBody className="space-y-4">
            <p className="text-sm font-semibold text-zinc-800">
              ลายเซ็นที่บันทึกไว้ของคุณ
            </p>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 flex items-center justify-center min-h-[120px]">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed R2 URL, no next/image remote-pattern config needed */}
              <img
                src={savedSignatureUrl}
                alt="ลายเซ็นที่บันทึกไว้"
                className="max-h-28 max-w-full object-contain"
              />
            </div>
            <div className="space-y-2">
              <Button
                variant="primary"
                size="xl"
                fullWidth
                loading={submitting}
                onClick={handleSubmitSaved}
              >
                <CheckCircle2 className="size-5" />
                ใช้ลายเซ็นนี้
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="lg"
                  disabled={submitting}
                  onClick={() => setOpenPad(true)}
                >
                  <PenLine className="size-4" />
                  วาดใหม่
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  disabled={submitting}
                  onClick={() => setOpenPad(true)}
                >
                  ใช้ลายเซ็นอื่น
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="sticky bottom-3 z-20 px-1">
          <Button
            variant="primary"
            size="xl"
            fullWidth
            onClick={() => setOpenPad(true)}
          >
            <PenLine className="size-5" />
            แตะเพื่อเซ็น
          </Button>
        </div>
      )}

      {/* Fullscreen signature pad */}
      {openPad && (
        <SignatureFullscreenPad
          padRef={padRef}
          submitting={submitting}
          // Default-checked only for a signer who has never saved one
          // before; defaults unchecked (but still opt-in-able) when a
          // saved signature already exists, so drawing fresh here doesn't
          // silently overwrite it.
          initialSaveAsDefault={!savedSignatureUrl}
          onClose={() => setOpenPad(false)}
          onSubmit={handleSubmitDrawn}
        />
      )}
    </div>
  );
}

/* ============================================================
   Fullscreen signature pad modal — mobile-first
   ============================================================ */

interface FullscreenPadProps {
  padRef: React.MutableRefObject<SignaturePadHandle | null>;
  submitting: boolean;
  initialSaveAsDefault: boolean;
  onClose: () => void;
  onSubmit: (saveAsDefault: boolean) => void;
}

function SignatureFullscreenPad({
  padRef,
  submitting,
  initialSaveAsDefault,
  onClose,
  onSubmit,
}: FullscreenPadProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [saveAsDefault, setSaveAsDefault] = useState(initialSaveAsDefault);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) setSize({ width, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Lock body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  function handleClear() {
    padRef.current?.clear();
  }

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/70 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-zinc-200">
        <button
          type="button"
          onClick={onClose}
          className="p-3 -m-3 rounded-lg hover:bg-zinc-100"
          aria-label="ปิด"
        >
          <X className="size-5" />
        </button>
        <p className="text-sm font-semibold">เซ็นชื่อในกรอบด้านล่าง</p>
        <button
          type="button"
          onClick={handleClear}
          className="p-3 -m-3 rounded-lg hover:bg-zinc-100 text-zinc-600"
          aria-label="เคลียร์"
        >
          <RotateCcw className="size-5" />
        </button>
      </div>
      <div
        ref={containerRef}
        className="flex-1 bg-white relative overflow-hidden"
      >
        {size.width > 0 && size.height > 0 && (
          <SignatureCanvas
            // @ts-expect-error — dynamic-imported component still accepts ref
            ref={padRef}
            // near-black; matches text-zinc-950 for ink-on-paper feel.
            // CSS-var approach is overkill since SignaturePad expects a JS string.
            penColor="#0a0a0a"
            canvasProps={{
              width: size.width,
              height: size.height,
              className: "block w-full h-full touch-none",
              style: { width: size.width, height: size.height },
            }}
          />
        )}
        {/* Bottom guideline */}
        <div className="pointer-events-none absolute left-6 right-6 bottom-16 border-b border-dashed border-zinc-300 text-[11px] text-zinc-400 text-center pb-1">
          ลายเซ็นของท่าน
        </div>
      </div>
      <div className="bg-white border-t border-zinc-200 p-3 safe-bottom space-y-2.5">
        <label className="flex items-center gap-2 px-1 text-sm text-zinc-700 select-none">
          <input
            type="checkbox"
            checked={saveAsDefault}
            onChange={(e) => setSaveAsDefault(e.target.checked)}
            className="size-4 rounded border-zinc-300 text-[var(--color-brand-600)] focus:ring-[var(--color-brand-500)]"
          />
          บันทึกลายเซ็นนี้ไว้ใช้ครั้งต่อไป
        </label>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={onClose}
            disabled={submitting}
          >
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
            onClick={() => onSubmit(saveAsDefault)}
          >
            <CheckCircle2 className="size-5" />
            ส่งลายเซ็น
          </Button>
        </div>
      </div>
    </div>
  );
}
