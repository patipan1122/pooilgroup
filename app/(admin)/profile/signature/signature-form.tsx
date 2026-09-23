"use client";

// SignatureSettingsForm — draw + save/replace/delete "ลายเซ็นของฉัน"
// ────────────────────────────────────────────────────────────────────
// react-signature-canvas is browser-only (canvas + pointer events), so
// it's dynamic-imported with ssr:false — the exact pattern already proven
// in components/docuflow/signer-interface.tsx (SignatureFullscreenPad) and
// app/(admin)/chairops/(maid)/m/contract/contract-flow.tsx.
//
// Note on duplication: signer-interface.tsx's pad is being restructured by
// a parallel agent in this same build wave (Item 14 of the DocuFlow-
// redesign plan) — to avoid two agents racing to create/edit the same
// shared file, the ~70-line draw-canvas UI here is a small self-contained
// duplicate rather than an extracted `components/docuflow/signature-pad.tsx`.
// The plan doc flags this extraction as a nice-to-have, not a hard
// requirement, given exactly this concurrency risk.
// ────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  PenLine,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

const SignatureCanvas = dynamic(
  () => import("react-signature-canvas").then((m) => m.default ?? m),
  { ssr: false, loading: () => <Loader2 className="size-6 animate-spin" /> },
);

/** Minimal interface for the bits we actually call on the canvas ref. */
type SignaturePadHandle = {
  clear: () => void;
  isEmpty: () => boolean;
  getTrimmedCanvas: () => HTMLCanvasElement;
};

export interface SignatureSettingsFormProps {
  currentSignatureUrl: string | null;
}

export function SignatureSettingsForm({
  currentSignatureUrl,
}: SignatureSettingsFormProps) {
  const router = useRouter();
  const [drawing, setDrawing] = useState(!currentSignatureUrl);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const padRef = useRef<SignaturePadHandle | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!drawing) return;
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
  }, [drawing]);

  function handleClear() {
    padRef.current?.clear();
  }

  async function handleSave() {
    if (!padRef.current || padRef.current.isEmpty()) {
      toast.error("กรุณาวาดลายเซ็นก่อนบันทึก");
      return;
    }
    setSaving(true);
    try {
      const canvas = padRef.current.getTrimmedCanvas();
      const dataUrl = canvas.toDataURL("image/png");
      const res = await fetch("/api/profile/signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      toast.success("บันทึกลายเซ็นแล้ว");
      setDrawing(false);
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "บันทึกลายเซ็นไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("ลบลายเซ็นที่บันทึกไว้? ครั้งต่อไปที่เซ็นเอกสารจะต้องวาดใหม่")) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch("/api/profile/signature", {
        method: "DELETE",
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      toast.success("ลบลายเซ็นแล้ว");
      setDrawing(true);
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "ลบลายเซ็นไม่สำเร็จ");
    } finally {
      setDeleting(false);
    }
  }

  // Saved-signature preview + actions
  if (!drawing && currentSignatureUrl) {
    return (
      <Card>
        <CardBody className="space-y-4">
          <p className="text-sm font-semibold text-zinc-700">
            ลายเซ็นที่บันทึกไว้
          </p>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived presigned R2 URL, not a static/optimizable asset */}
            <img
              src={currentSignatureUrl}
              alt="ลายเซ็นของฉัน"
              className="max-h-32 object-contain"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setDrawing(true)}
              disabled={deleting}
            >
              <PenLine className="size-4" />
              วาดใหม่
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              loading={deleting}
            >
              <Trash2 className="size-4" />
              ลบ
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  // Draw pad (first-time save, or "วาดใหม่")
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-zinc-700">
            วาดลายเซ็นของคุณ
          </p>
          {currentSignatureUrl && (
            <button
              type="button"
              onClick={() => setDrawing(false)}
              className="p-2 -m-2 rounded-lg hover:bg-zinc-100 text-zinc-500"
              aria-label="ยกเลิก"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <div
          ref={containerRef}
          className="relative h-48 rounded-xl border-2 border-dashed border-zinc-300 bg-white overflow-hidden touch-none"
        >
          {size.width > 0 && size.height > 0 && (
            <SignatureCanvas
              // @ts-expect-error — dynamic-imported component still accepts ref
              ref={padRef}
              // near-black; matches text-zinc-950 for ink-on-paper feel.
              penColor="#0a0a0a"
              canvasProps={{
                width: size.width,
                height: size.height,
                className: "block w-full h-full touch-none",
                style: { width: size.width, height: size.height },
              }}
            />
          )}
          <div className="pointer-events-none absolute left-6 right-6 bottom-8 border-b border-dashed border-zinc-300 text-[11px] text-zinc-400 text-center pb-1">
            ลายเซ็นของท่าน
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleClear}
            disabled={saving}
          >
            <RotateCcw className="size-4" />
            เคลียร์
          </Button>
          <Button
            variant="primary"
            fullWidth
            loading={saving}
            onClick={handleSave}
          >
            <CheckCircle2 className="size-4" />
            บันทึก
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
