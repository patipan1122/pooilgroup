"use client";

// SignerInterface — mobile-first signing flow
// ────────────────────────────────────────────────────────────────────
// Renders the document with ONLY this placement highlighted, auto-scrolls
// to the placement, lets the user open a fullscreen signature pad, and
// submits the captured PNG to the sign endpoint.
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
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import {
  SignaturePlacementBox,
  type PlacementRect,
} from "./signature-placement-box";
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

export function SignerInterface({
  documentId,
  documentName,
  pdfUrl,
  placement,
  signerDisplayName,
}: SignerInterfaceProps) {
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

  // Auto-scroll to the page wrap when PDF loads
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

  async function handleSubmit() {
    if (!padRef.current) {
      toast.error("กรุณาเซ็นในช่อง");
      return;
    }
    if (padRef.current.isEmpty()) {
      toast.error("กรุณาเซ็นก่อนส่ง");
      return;
    }
    setSubmitting(true);
    try {
      // Trim whitespace + export PNG (data URL)
      const canvas = padRef.current.getTrimmedCanvas();
      const dataUrl = canvas.toDataURL("image/png");
      const res = await fetch(
        `/api/docuflow/${documentId}/signatures/${placement.id}/sign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageDataUrl: dataUrl }),
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

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 font-bold">
            เซ็นเอกสาร
          </p>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight font-display line-clamp-2">
            {documentName}
          </h1>
          <p className="text-sm text-zinc-600">
            {done ? (
              <span className="inline-flex items-center gap-1.5 text-green-700 font-medium">
                <CheckCircle2 className="size-4" /> ลงนามแล้ว ({signerDisplayName})
              </span>
            ) : (
              <>กรุณาเซ็นในช่องที่ระบุไว้บนหน้าเอกสาร — สวัสดี {signerDisplayName}</>
            )}
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

      {/* Action button — sticky on mobile */}
      <div className="sticky bottom-3 z-20 px-1">
        {done ? (
          <Button
            variant="outline"
            size="xl"
            fullWidth
            onClick={() => setOpenPad(false)}
            disabled
          >
            <CheckCircle2 className="size-5" />
            ลงนามเรียบร้อย
          </Button>
        ) : (
          <Button
            variant="primary"
            size="xl"
            fullWidth
            onClick={() => setOpenPad(true)}
          >
            <PenLine className="size-5" />
            แตะเพื่อเซ็น
          </Button>
        )}
      </div>

      {/* Fullscreen signature pad */}
      {openPad && !done && (
        <SignatureFullscreenPad
          padRef={padRef}
          submitting={submitting}
          onClose={() => setOpenPad(false)}
          onSubmit={handleSubmit}
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
  onClose: () => void;
  onSubmit: () => void;
}

function SignatureFullscreenPad({
  padRef,
  submitting,
  onClose,
  onSubmit,
}: FullscreenPadProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

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
      <div className="bg-white border-t border-zinc-200 p-3 safe-bottom flex items-center gap-2">
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
          onClick={onSubmit}
        >
          <CheckCircle2 className="size-5" />
          ส่งลายเซ็น
        </Button>
      </div>
    </div>
  );
}
