"use client";

// UserSignatureAdminPanel — admin sets/replaces/clears ANOTHER user's saved
// signature (e.g. during onboarding, or when the user can't do it
// themselves) from the admin user-edit page (app/(admin)/users/[id]/edit/).
// Distinct from the self-service draw pad at
// app/(admin)/profile/signature/signature-form.tsx (which only ever
// touches the CALLER's own signature via session) — this one posts to
// /api/users/[id]/signature instead of /api/profile/signature, and is
// clearly labelled as "someone else's" signature so it's never confused
// with the admin's own at /profile/signature.
//
// IMPORTANT: components/ui/button.tsx does NOT default its `type` prop, so
// a <Button> inside a <form> silently behaves like a native
// type="submit" button. To avoid this panel's "บันทึก"/"ลบ" buttons
// accidentally double-submitting the surrounding user-edit <form>, every
// button below is explicit `type="button"`, AND (belt-and-suspenders)
// this panel is rendered as a sibling AFTER edit-form.tsx's </form>, not
// inside it.
//
// Note on duplication: the ~70-line canvas draw-pad logic below is
// intentionally duplicated from signature-form.tsx rather than extracted
// into a shared components/docuflow/signature-pad.tsx — that file's own
// header documents the same call for the self-service pad (parallel-agent
// file-ownership risk during this build wave); same reasoning applies here.
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
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

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

export interface UserSignatureAdminPanelProps {
  userId: string;
  userName: string;
  currentSignatureUrl: string | null;
}

export function UserSignatureAdminPanel({
  userId,
  userName,
  currentSignatureUrl,
}: UserSignatureAdminPanelProps) {
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
      const res = await fetch(`/api/users/${userId}/signature`, {
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
      toast.success(`บันทึกลายเซ็นของ ${userName} แล้ว`);
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
    if (
      !confirm(
        `ลบลายเซ็นที่บันทึกไว้ของ ${userName}? ครั้งต่อไปที่เซ็นเอกสารจะต้องวาดใหม่`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/users/${userId}/signature`, {
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

  return (
    <Card className="mt-4 animate-fade-up delay-250">
      <CardHeader>
        <CardTitle>ลายเซ็นของผู้ใช้งานนี้ (ตั้งค่าแทนได้)</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs text-zinc-500">
          ลายเซ็นนี้เป็นของ <strong>{userName}</strong> เก็บไว้ใช้เซ็นเอกสารใน
          DocuFlow — แอดมินตั้งค่าแทนได้กรณีผู้ใช้ทำเองไม่ได้ (เช่น
          ระหว่างเริ่มงาน) ไม่เกี่ยวกับลายเซ็นของคุณเอง (ตั้งค่าที่
          /profile/signature)
        </p>

        {!drawing && currentSignatureUrl ? (
          <>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived presigned R2 URL, not a static/optimizable asset */}
              <img
                src={currentSignatureUrl}
                alt={`ลายเซ็นของ ${userName}`}
                className="max-h-32 object-contain"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDrawing(true)}
                disabled={deleting}
              >
                <PenLine className="size-4" />
                วาดใหม่
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={handleDelete}
                loading={deleting}
              >
                <Trash2 className="size-4" />
                ลบ
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-700">
                วาดลายเซ็นแทน {userName}
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
                ลายเซ็นของ {userName}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleClear}
                disabled={saving}
              >
                <RotateCcw className="size-4" />
                เคลียร์
              </Button>
              <Button
                type="button"
                variant="primary"
                fullWidth
                loading={saving}
                onClick={handleSave}
              >
                <CheckCircle2 className="size-4" />
                บันทึก
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
