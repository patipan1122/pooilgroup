"use client";

// SignerDocumentPreview — read-only, full-document "look before you sign"
// ────────────────────────────────────────────────────────────────────
// Renders every page of the PDF (page-nav controls, same shape as
// SignaturePlacementEditor's admin editor) with every placement on the
// document overlaid via SignaturePlacementBox (readOnly). The signer's
// own placement (`currentPlacementId`) is visually emphasized using the
// box's existing `selected` styling (brand border/ring); every other
// signer's placement is dimmed + labeled so the viewer can see the whole
// document's signing plan, not just their own box.
//
// This is a READ-ONLY sibling of SignaturePlacementEditor's page-nav UI
// shape — it does not reuse any of that component's drag/resize/create
// logic, only the ReactPdfDocument/ReactPdfPage dynamic-import pattern
// and the prev/next page-nav chrome.
// ────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import {
  SignaturePlacementBox,
  type PlacementRect,
  type PlacementType,
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

function PdfSkeleton() {
  return (
    <div className="w-full h-[480px] flex items-center justify-center bg-zinc-50 rounded-xl">
      <Loader2 className="size-6 animate-spin text-zinc-400" />
    </div>
  );
}

export interface SignerPreviewPlacementVm {
  id: string;
  pageNumber: number;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  signerName: string | null;
  signerUserId: string | null;
  signedAt: string | null;
  /** Optional — drives which icon/tint SignaturePlacementBox renders. Defaults to 'signature'. */
  placementType?: PlacementType;
}

export interface SignerDocumentPreviewProps {
  /** Fresh signed download URL for the original PDF. */
  pdfUrl: string;
  /** ALL placements on the document — not just the caller's. */
  placements: SignerPreviewPlacementVm[];
  /** The placement id this sign-link points at — visually emphasized. */
  currentPlacementId: string;
}

export function SignerDocumentPreview({
  pdfUrl,
  placements,
  currentPlacementId,
}: SignerDocumentPreviewProps) {
  const currentPlacement = useMemo(
    () => placements.find((p) => p.id === currentPlacementId) ?? null,
    [placements, currentPlacementId],
  );
  // Land on the page that holds the signer's own placement so they don't
  // have to hunt for it before seeing it.
  const [pageNumber, setPageNumber] = useState(
    currentPlacement?.pageNumber ?? 1,
  );
  const [pageCount, setPageCount] = useState<number | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [overlaySize, setOverlaySize] = useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });

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
  }, [pageNumber, pageCount]);

  const pagePlacements = useMemo(
    () => placements.filter((p) => p.pageNumber === pageNumber),
    [placements, pageNumber],
  );

  return (
    <Card>
      <CardBody className="p-3 sm:p-4 space-y-3">
        {/* Page nav — mirrors SignaturePlacementEditor's admin chrome */}
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
          >
            <ChevronLeft className="size-4" />
            หน้าก่อน
          </Button>
          <p className="text-sm text-zinc-700 tabular-nums">
            หน้า {pageNumber}
            {pageCount ? ` / ${pageCount}` : ""}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setPageNumber((p) =>
                pageCount ? Math.min(pageCount, p + 1) : p + 1,
              )
            }
            disabled={pageCount !== null && pageNumber >= pageCount}
          >
            หน้าถัดไป
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div
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
                pageNumber={pageNumber}
                width={720}
                renderAnnotationLayer={false}
                renderTextLayer={false}
              />
              <div ref={overlayRef} className="absolute inset-0">
                {pagePlacements.map((p) => {
                  const isCurrent = p.id === currentPlacementId;
                  const rect: PlacementRect = {
                    xRatio: p.xRatio,
                    yRatio: p.yRatio,
                    widthRatio: p.widthRatio,
                    heightRatio: p.heightRatio,
                  };
                  const otherName = p.signerName?.trim() || "ผู้เซ็นอื่น";
                  return (
                    // Non-positioned wrapper — safe to dim without disturbing
                    // the box's own `position: absolute` (resolves against
                    // the nearest positioned ancestor, i.e. `overlayRef`).
                    <div
                      key={p.id}
                      className={isCurrent ? undefined : "opacity-60"}
                    >
                      <SignaturePlacementBox
                        id={p.id}
                        rect={rect}
                        placementType={p.placementType ?? "signature"}
                        label={
                          isCurrent
                            ? null
                            : p.signedAt
                              ? `เซ็นแล้ว: ${otherName}`
                              : `รอ: ${otherName}`
                        }
                        roleLabel={isCurrent ? "จุดของคุณ" : otherName}
                        signed={!!p.signedAt}
                        selected={isCurrent}
                        containerWidth={overlaySize.width || 720}
                        containerHeight={overlaySize.height || 0}
                        readOnly
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </ReactPdfDocument>
        </div>

        <p className="text-xs text-zinc-500 text-center">
          จุดของคุณไฮไลต์สีน้ำเงิน · จุดของผู้เซ็นคนอื่นแสดงจาง ๆ พร้อมชื่อ
        </p>
      </CardBody>
    </Card>
  );
}
