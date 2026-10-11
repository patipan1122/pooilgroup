"use client";

// PdfPreview — branded in-page PDF viewer for ViewerTabs' Preview tab.
// ────────────────────────────────────────────────────────────────────
// CEO feedback 2026-10-11: before this, the Preview tab was a plain
// <iframe src={downloadUrl}> with no `sandbox` — Chrome's own native
// PDF.js plugin rendered inside, with its own full UI (dark surrounding
// chrome, thumbnail sidebar, unrelated toolbar/zoom controls DocuFlow's
// CSS has zero reach into, since it's a separate browsing context). She
// found it confusing ("ดูเอกสารแล้วงง... สีดำเยอะขนาดนี้").
//
// This replaces it with react-pdf (already wired up elsewhere in DocuFlow
// for the e-signature flow — see lib/docuflow/pdfjs-config.ts,
// use-responsive-pdf-width.ts, signer-document-preview.tsx) so the PDF
// renders on a plain white canvas inside DocuFlow's own card chrome, with
// simple page-nav controls styled with the module's own `--df-*` tokens
// — no new dependency, no native-viewer surface DocuFlow can't style.
// ────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { configurePdfJs } from "@/lib/docuflow/pdfjs-config";
import { useResponsivePdfWidth } from "@/lib/docuflow/use-responsive-pdf-width";

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
    <div
      style={{
        width: "100%",
        height: 480,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fff",
        borderRadius: 6,
      }}
    >
      <Loader2
        size={24}
        className="animate-spin"
        style={{ color: "var(--df-muted)" }}
      />
    </div>
  );
}

interface Props {
  /** Signed R2 download URL — fresh per page load. */
  pdfUrl: string;
  docName: string;
}

export function PdfPreview({ pdfUrl, docName }: Props) {
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  // See signer-document-preview.tsx for why this key-remount retry
  // pattern exists — react-pdf gives no built-in retry, and its default
  // error fallback is a bare English string with no next step.
  const [retryKey, setRetryKey] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const width = useResponsivePdfWidth(containerRef, 720);

  useEffect(() => {
    void configurePdfJs();
  }, []);

  // Reset to page 1 whenever a different document is opened in the same
  // mounted tab (navigating between docs without a full page reload).
  // Adjusted during render rather than in an effect — see
  // react-hooks/set-state-in-effect — same pattern as
  // document-search-input.tsx.
  const [prevPdfUrl, setPrevPdfUrl] = useState(pdfUrl);
  if (pdfUrl !== prevPdfUrl) {
    setPrevPdfUrl(pdfUrl);
    setPageNumber(1);
    setPageCount(null);
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <button
          type="button"
          onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
          disabled={pageNumber <= 1}
          style={navButtonStyle(pageNumber <= 1)}
        >
          <ChevronLeft size={14} /> หน้าก่อน
        </button>
        <span
          style={{
            fontSize: 13,
            color: "var(--df-muted)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          หน้า {pageNumber}
          {pageCount ? ` / ${pageCount}` : ""}
        </span>
        <button
          type="button"
          onClick={() =>
            setPageNumber((p) => (pageCount ? Math.min(pageCount, p + 1) : p + 1))
          }
          disabled={pageCount !== null && pageNumber >= pageCount}
          style={navButtonStyle(pageCount !== null && pageNumber >= pageCount)}
        >
          หน้าถัดไป <ChevronRight size={14} />
        </button>
      </div>

      <div
        ref={containerRef}
        style={{
          width: "100%",
          overflow: "auto",
          borderRadius: 6,
          background: "#fff",
          boxShadow: "0 10px 40px -10px rgba(0,0,0,0.25)",
        }}
      >
        <ReactPdfDocument
          key={retryKey}
          file={pdfUrl}
          onLoadSuccess={({ numPages }: { numPages: number }) =>
            setPageCount(numPages)
          }
          loading={<PdfSkeleton />}
          error={
            <div
              style={{
                width: "100%",
                minHeight: 320,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                padding: "40px 24px",
                textAlign: "center",
              }}
            >
              <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                เปิดไฟล์ PDF ไม่สำเร็จ
              </p>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--df-muted)",
                  maxWidth: "32ch",
                  margin: 0,
                }}
              >
                อาจเป็นเพราะอินเทอร์เน็ตไม่เสถียร ลองกดปุ่มด้านล่างเพื่อโหลดใหม่
              </p>
              <button
                type="button"
                onClick={() => setRetryKey((k) => k + 1)}
                style={navButtonStyle(false)}
              >
                <RotateCcw size={14} /> ลองโหลดใหม่
              </button>
            </div>
          }
        >
          <ReactPdfPage
            pageNumber={pageNumber}
            width={width}
            renderAnnotationLayer={false}
            renderTextLayer={false}
          />
        </ReactPdfDocument>
      </div>
      <p className="sr-only">{docName}</p>
    </div>
  );
}

function navButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "7px 12px",
    borderRadius: 999,
    border: "1px solid var(--df-line)",
    background: "var(--df-surface)",
    color: disabled ? "var(--df-muted-2)" : "var(--df-ink)",
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
