"use client";

// SignaturePlacementEditor — admin editor for placing signature boxes
// onto a PDF, page by page.
// ────────────────────────────────────────────────────────────────────
// react-pdf is loaded via dynamic import (next/dynamic) with ssr: false
// because it pulls in a Web Worker + browser-only APIs.
//
// Coordinate system: every box is stored as 0..1 normalized ratios with
// TOP-LEFT origin (matches the rendered page). We translate to bottom-
// left at embed time (lib/docuflow/signature.ts).
//
// Placement types (Item 4):
//   ✍️ signature  — captured at sign time
//   📅 date       — auto-filled with today's date at embed time
//   📝 name       — auto-filled with signer name at embed time
//   ✏️ text       — admin-provided literal value, stamped at embed time
// ────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Save,
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
  CheckCircle2,
  Link as LinkIcon,
  Copy,
  PenLine,
  Calendar,
  User as UserIcon,
  Pencil,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";
import {
  SignaturePlacementBox,
  type PlacementRect,
  type PlacementType,
} from "./signature-placement-box";
import { configurePdfJs } from "@/lib/docuflow/pdfjs-config";

/* ============================================================
   Dynamic react-pdf imports (client-only)
   ============================================================ */

// react-pdf must NOT be evaluated during SSR — it imports DOM-only APIs.
// next/dynamic with ssr:false defers loading until the browser.
const ReactPdfDocument = dynamic(
  () => import("react-pdf").then((m) => m.Document),
  { ssr: false, loading: () => <PdfSkeleton /> },
);
const ReactPdfPage = dynamic(
  () => import("react-pdf").then((m) => m.Page),
  { ssr: false },
);

/* ============================================================
   Types (mirror /api/docuflow/[id]/signatures GET shape)
   ============================================================ */

export type SignerRole = "owner" | "employee" | "counterparty" | "other";

export interface PlacementVm {
  id: string;
  documentId: string;
  pageNumber: number;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  placementType: PlacementType;
  autoFillValue: string | null;
  signerRole: SignerRole;
  signerUserId: string | null;
  signerName: string | null;
  signerUser: { id: string; name: string; role: string } | null;
  label: string | null;
  ordering: number;
  signedAt: string | null;
  signedImageKey: string | null;
  signedFileKey: string | null;
}

export interface UserOption {
  id: string;
  name: string;
  role: string;
}

export interface SignaturePlacementEditorProps {
  documentId: string;
  documentName: string;
  /** Fresh signed download URL (1h) for the original PDF. */
  pdfUrl: string;
  /** Existing placements (server-rendered initial state). */
  initialPlacements: PlacementVm[];
  /** Org-scoped user list for the signer picker. */
  users: UserOption[];
  /** Origin used to build /sign/[placementId] share links. */
  origin: string;
}

const ROLE_OPTIONS: { value: SignerRole; label: string; emoji: string }[] = [
  { value: "owner", label: "เจ้าของ", emoji: "👑" },
  { value: "employee", label: "พนักงาน", emoji: "👤" },
  { value: "counterparty", label: "คู่ค้า", emoji: "🤝" },
  { value: "other", label: "อื่น ๆ", emoji: "✍️" },
];

interface TypeOption {
  value: PlacementType;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Default rect when creating a new box of this type. */
  defaultRect: PlacementRect;
}

const TYPE_OPTIONS: TypeOption[] = [
  {
    value: "signature",
    label: "เซ็น",
    Icon: PenLine,
    defaultRect: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.28, heightRatio: 0.08 },
  },
  {
    value: "date",
    label: "วันที่",
    Icon: Calendar,
    // Date strings are short — narrow box matches numeric date width.
    defaultRect: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.16, heightRatio: 0.04 },
  },
  {
    value: "name",
    label: "ชื่อ",
    Icon: UserIcon,
    defaultRect: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.22, heightRatio: 0.04 },
  },
  {
    value: "text",
    label: "ข้อความ",
    Icon: Pencil,
    defaultRect: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.22, heightRatio: 0.04 },
  },
];

function roleLabel(role: SignerRole): string {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
}

function typeLabel(type: PlacementType): string {
  return TYPE_OPTIONS.find((t) => t.value === type)?.label ?? type;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
}

function PdfSkeleton() {
  return (
    <div className="w-full h-[640px] flex items-center justify-center bg-zinc-50 rounded-xl border border-zinc-200">
      <Loader2 className="size-6 animate-spin text-zinc-400" />
    </div>
  );
}

/* ============================================================
   Component
   ============================================================ */

export function SignaturePlacementEditor({
  documentId,
  pdfUrl,
  initialPlacements,
  users,
  origin,
}: SignaturePlacementEditorProps) {
  const router = useRouter();
  const [placements, setPlacements] =
    useState<PlacementVm[]>(initialPlacements);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<PlacementType>("signature");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  // ID of the placement awaiting delete-confirmation. null = no dialog open.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [overlaySize, setOverlaySize] = useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });

  // Configure pdfjs worker on mount (client-only)
  useEffect(() => {
    void configurePdfJs();
  }, []);

  // Page-aware placement filter
  const pagePlacements = useMemo(
    () => placements.filter((p) => p.pageNumber === pageNumber),
    [placements, pageNumber],
  );

  const selected = useMemo(
    () => placements.find((p) => p.id === selectedId) ?? null,
    [placements, selectedId],
  );

  // Track overlay container size so we can convert ratios → pixels.
  // ResizeObserver watches the page wrapper.
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

  // Mark a placement as dirty (need to flush to server)
  const markDirty = useCallback((id: string) => {
    setDirtyIds((s) => {
      const next = new Set(s);
      next.add(id);
      return next;
    });
  }, []);

  // Update a placement in local state (drag/resize/edit fields)
  const updatePlacement = useCallback(
    (id: string, patch: Partial<PlacementVm>) => {
      setPlacements((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      );
      markDirty(id);
    },
    [markDirty],
  );

  // Click on empty overlay area → create new placement at click position
  async function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (creating) return;
    if (!overlayRef.current) return;
    // Don't create if click bubbled from a child box
    if (e.target !== e.currentTarget) return;

    const rect = overlayRef.current.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const yRatio = (e.clientY - rect.top) / rect.height;

    const def =
      TYPE_OPTIONS.find((t) => t.value === activeType)?.defaultRect ??
      TYPE_OPTIONS[0].defaultRect;
    const w = def.widthRatio;
    const h = def.heightRatio;
    // Center the box on the click point
    const x = Math.max(0, Math.min(1 - w, xRatio - w / 2));
    const y = Math.max(0, Math.min(1 - h, yRatio - h / 2));

    setCreating(true);
    try {
      const res = await fetch(`/api/docuflow/${documentId}/signatures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageNumber,
          xRatio: x,
          yRatio: y,
          widthRatio: w,
          heightRatio: h,
          placementType: activeType,
          autoFillValue: activeType === "text" ? "" : null,
          signerRole: "owner",
          ordering: pagePlacements.length,
        }),
      });
      const data = (await res.json()) as {
        placement?: PlacementVm;
        error?: string;
      };
      if (!res.ok || !data.placement) {
        toast.error(data.error || "เพิ่มจุดไม่สำเร็จ");
        return;
      }
      // Server returns the row directly (not in our extended VM shape) —
      // patch to fit. The signerUser join is null on first create.
      const created: PlacementVm = {
        id: data.placement.id,
        documentId: data.placement.documentId,
        pageNumber: data.placement.pageNumber,
        xRatio: data.placement.xRatio,
        yRatio: data.placement.yRatio,
        widthRatio: data.placement.widthRatio,
        heightRatio: data.placement.heightRatio,
        placementType:
          (data.placement.placementType as PlacementType) ?? "signature",
        autoFillValue: data.placement.autoFillValue ?? null,
        signerRole: data.placement.signerRole as SignerRole,
        signerUserId: data.placement.signerUserId ?? null,
        signerName: data.placement.signerName ?? null,
        signerUser: null,
        label: data.placement.label ?? null,
        ordering: data.placement.ordering,
        signedAt: data.placement.signedAt ?? null,
        signedImageKey: null,
        signedFileKey: null,
      };
      setPlacements((prev) => [...prev, created]);
      setSelectedId(created.id);
    } catch (err) {
      console.error(err);
      toast.error("เพิ่มจุดไม่สำเร็จ");
    } finally {
      setCreating(false);
    }
  }

  // Save all dirty placements (bulk PATCH)
  async function handleSave() {
    if (dirtyIds.size === 0) {
      toast("ไม่มีการเปลี่ยนแปลง");
      return;
    }
    setSaving(true);
    try {
      const updates = placements
        .filter((p) => dirtyIds.has(p.id))
        .map((p) => ({
          id: p.id,
          pageNumber: p.pageNumber,
          xRatio: p.xRatio,
          yRatio: p.yRatio,
          widthRatio: p.widthRatio,
          heightRatio: p.heightRatio,
          placementType: p.placementType,
          autoFillValue: p.autoFillValue,
          signerRole: p.signerRole,
          signerUserId: p.signerUserId,
          signerName: p.signerName,
          label: p.label,
          ordering: p.ordering,
        }));
      const res = await fetch(`/api/docuflow/${documentId}/signatures`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setDirtyIds(new Set());
      toast.success("บันทึกแล้ว");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  // Open the inline confirm dialog (no native confirm — Brand DNA gate).
  function handleDelete(id: string) {
    setPendingDeleteId(id);
  }

  async function performDelete(id: string) {
    setDeletingBusy(true);
    try {
      const res = await fetch(
        `/api/docuflow/${documentId}/signatures?placementId=${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setPlacements((prev) => prev.filter((p) => p.id !== id));
      setDirtyIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      if (selectedId === id) setSelectedId(null);
      setPendingDeleteId(null);
      toast.success("ลบแล้ว");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    } finally {
      setDeletingBusy(false);
    }
  }

  async function handleResetSignature(id: string) {
    setResettingId(id);
    try {
      const res = await fetch(
        `/api/docuflow/${documentId}/signatures/${id}/reset`,
        { method: "POST" },
      );
      const data = (await res.json()) as { error?: string; success?: boolean };
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Local optimistic clear so the UI flips back to "ส่งให้เซ็น"
      setPlacements((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, signedAt: null, signedImageKey: null }
            : p,
        ),
      );
      toast.success("ขอเซ็นใหม่แล้ว — แชร์ลิงก์ให้ผู้เซ็นได้อีกครั้ง");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "ขอเซ็นใหม่ไม่สำเร็จ",
      );
    } finally {
      setResettingId(null);
    }
  }

  const pendingDeleteIndex = pendingDeleteId
    ? placements.findIndex((p) => p.id === pendingDeleteId)
    : -1;
  const pendingDeletePlacement =
    pendingDeleteIndex >= 0 ? placements[pendingDeleteIndex] : null;

  function copyShareLink(id: string) {
    const url = `${origin}/sign/${id}`;
    void navigator.clipboard.writeText(url);
    toast.success("คัดลอกลิงก์เซ็นแล้ว");
  }

  const signedCount = placements.filter((p) => p.signedAt).length;
  const activeTypeMeta =
    TYPE_OPTIONS.find((t) => t.value === activeType) ?? TYPE_OPTIONS[0];

  return (
    <div className="space-y-6">
      {/* Header — type toolbar + save */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone="brand">
            {signedCount}/{placements.length} เสร็จ
          </Badge>
          {dirtyIds.size > 0 && (
            <Badge tone="warning">มีการเปลี่ยนแปลงรอบันทึก</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={handleSave}
            disabled={dirtyIds.size === 0 || saving}
            loading={saving}
          >
            <Save className="size-4" />
            บันทึก
          </Button>
        </div>
      </div>

      {/* Placement-type toolbar */}
      <div className="rounded-xl border border-zinc-200 bg-white p-2 flex items-center gap-1 flex-wrap">
        <span className="text-xs font-bold text-zinc-500 pl-2 pr-3">
          เพิ่มจุด
        </span>
        {TYPE_OPTIONS.map((t) => {
          const Icon = t.Icon;
          const active = activeType === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setActiveType(t.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 h-9 text-sm font-medium border transition-colors",
                active
                  ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                  : "border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700",
              )}
              aria-pressed={active}
            >
              <Icon className="size-4" />
              {t.label}
            </button>
          );
        })}
        <span className="ml-auto pr-2 text-[11px] text-zinc-500">
          กำลังเพิ่ม:{" "}
          <strong className="text-zinc-800">{activeTypeMeta.label}</strong> —
          แตะหน้าเอกสารเพื่อวาง
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        {/* PDF + overlay */}
        <div className="lg:col-span-2 space-y-3">
          <Card>
            <CardBody className="p-3 sm:p-4 space-y-3">
              {/* Page nav */}
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
                    {/* Overlay catches clicks (create new box) and hosts boxes */}
                    <div
                      ref={overlayRef}
                      onClick={handleOverlayClick}
                      className={cn(
                        "absolute inset-0",
                        creating ? "cursor-wait" : "cursor-crosshair",
                      )}
                    >
                      {pagePlacements.map((p) => (
                        <SignaturePlacementBox
                          key={p.id}
                          id={p.id}
                          rect={{
                            xRatio: p.xRatio,
                            yRatio: p.yRatio,
                            widthRatio: p.widthRatio,
                            heightRatio: p.heightRatio,
                          }}
                          label={p.label}
                          placementType={p.placementType}
                          autoFillValue={p.autoFillValue}
                          roleLabel={`${
                            ROLE_OPTIONS.find(
                              (r) => r.value === p.signerRole,
                            )?.emoji ?? "✍️"
                          } ${roleLabel(p.signerRole)}`}
                          signed={!!p.signedAt}
                          selected={selectedId === p.id}
                          containerWidth={overlaySize.width || 720}
                          containerHeight={overlaySize.height || 0}
                          onSelect={() => setSelectedId(p.id)}
                          onChange={(rect) =>
                            updatePlacement(p.id, {
                              xRatio: rect.xRatio,
                              yRatio: rect.yRatio,
                              widthRatio: rect.widthRatio,
                              heightRatio: rect.heightRatio,
                            })
                          }
                          onDelete={() => handleDelete(p.id)}
                        />
                      ))}
                    </div>
                  </div>
                </ReactPdfDocument>
              </div>

              <p className="text-xs text-zinc-500 text-center">
                แตะพื้นที่ว่างเพื่อวาง “{activeTypeMeta.label}” · ลากเพื่อย้าย ·
                ลากปุ่มมุมขวาล่างเพื่อปรับขนาด
              </p>
            </CardBody>
          </Card>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          <Section number="01" label="SELECTED" title="จุดที่เลือก">
            {selected ? (
              <Card>
                <CardBody className="space-y-4">
                  {/* Type chooser */}
                  <div>
                    <p className="text-xs font-bold text-zinc-500 mb-1.5">
                      ประเภทจุด
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {TYPE_OPTIONS.map((t) => {
                        const Icon = t.Icon;
                        const isSel = selected.placementType === t.value;
                        return (
                          <button
                            key={t.value}
                            type="button"
                            onClick={() =>
                              updatePlacement(selected.id, {
                                placementType: t.value,
                              })
                            }
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm border transition-colors",
                              isSel
                                ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] font-medium"
                                : "border-zinc-200 bg-white hover:bg-zinc-50",
                            )}
                          >
                            <Icon className="size-4" />
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Auto-fill preview / value */}
                  {selected.placementType === "date" && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      ระบบจะ stamp <strong>วันที่วันเซ็น</strong> ลงตรงนี้
                      อัตโนมัติ (รูปแบบ: 08/05/2569)
                    </div>
                  )}
                  {selected.placementType === "name" && (
                    <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                      ระบบจะ stamp{" "}
                      <strong>
                        ชื่อ{" "}
                        {selected.signerUser?.name ||
                          selected.signerName ||
                          "ผู้เซ็น"}
                      </strong>{" "}
                      อัตโนมัติ
                    </div>
                  )}
                  {selected.placementType === "text" && (
                    <div>
                      <p className="text-xs font-bold text-zinc-500 mb-1.5">
                        ข้อความที่จะ stamp
                      </p>
                      <input
                        type="text"
                        value={selected.autoFillValue ?? ""}
                        onChange={(e) =>
                          updatePlacement(selected.id, {
                            autoFillValue: e.target.value,
                          })
                        }
                        placeholder="เช่น Pooilgroup Co., Ltd."
                        className="w-full h-10 px-3 text-sm rounded-xl border border-zinc-200 bg-white"
                      />
                      <p className="mt-1.5 text-[11px] text-zinc-500">
                        แนะนำใช้อักษรอังกฤษ/ตัวเลข — ฟอนต์ Thai
                        ในเอกสาร PDF ยังไม่รองรับเต็ม
                      </p>
                    </div>
                  )}

                  {/* Signer role + user — only meaningful for signature/name types */}
                  {(selected.placementType === "signature" ||
                    selected.placementType === "name") && (
                    <>
                      <div>
                        <p className="text-xs font-bold text-zinc-500 mb-1.5">
                          บทบาทผู้เซ็น
                        </p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {ROLE_OPTIONS.map((r) => (
                            <button
                              key={r.value}
                              type="button"
                              onClick={() =>
                                updatePlacement(selected.id, {
                                  signerRole: r.value,
                                })
                              }
                              className={cn(
                                "text-sm rounded-lg px-3 py-2 border transition-colors",
                                selected.signerRole === r.value
                                  ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] font-medium"
                                  : "border-zinc-200 bg-white hover:bg-zinc-50",
                              )}
                            >
                              <span className="mr-1">{r.emoji}</span>
                              {r.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-bold text-zinc-500 mb-1.5">
                          ผู้เซ็น (ในระบบ)
                        </p>
                        <select
                          value={selected.signerUserId ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            const u = users.find((u) => u.id === v);
                            updatePlacement(selected.id, {
                              signerUserId: v && isUuid(v) ? v : null,
                              signerUser: u
                                ? { id: u.id, name: u.name, role: u.role }
                                : null,
                            });
                          }}
                          className="w-full h-10 px-3 text-sm rounded-xl border border-zinc-200 bg-white"
                        >
                          <option value="">— ไม่ระบุ (ใช้ลิงก์เซ็น) —</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({u.role})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <p className="text-xs font-bold text-zinc-500 mb-1.5">
                          ชื่อผู้เซ็น (ถ้าไม่อยู่ในระบบ)
                        </p>
                        <input
                          type="text"
                          value={selected.signerName ?? ""}
                          onChange={(e) =>
                            updatePlacement(selected.id, {
                              signerName: e.target.value || null,
                            })
                          }
                          placeholder="เช่น คู่ค้า นาย ก."
                          className="w-full h-10 px-3 text-sm rounded-xl border border-zinc-200 bg-white"
                        />
                      </div>
                    </>
                  )}

                  <div>
                    <p className="text-xs font-bold text-zinc-500 mb-1.5">
                      คำอธิบาย (เห็นบนกล่อง)
                    </p>
                    <input
                      type="text"
                      value={selected.label ?? ""}
                      onChange={(e) =>
                        updatePlacement(selected.id, {
                          label: e.target.value || null,
                        })
                      }
                      placeholder="เช่น เซ็นที่ลายเซ็น"
                      className="w-full h-10 px-3 text-sm rounded-xl border border-zinc-200 bg-white"
                    />
                  </div>

                  {/* Status / actions */}
                  {selected.placementType === "signature" ? (
                    selected.signedAt ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                          <CheckCircle2 className="size-4" />
                          ลงนามแล้ว
                        </div>
                        <button
                          type="button"
                          onClick={() => handleResetSignature(selected.id)}
                          disabled={resettingId === selected.id}
                          className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 text-sm rounded-xl bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50 font-medium disabled:opacity-60"
                        >
                          {resettingId === selected.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <RotateCcw className="size-4" />
                          )}
                          ขอเซ็นใหม่
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => copyShareLink(selected.id)}
                        className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 text-sm rounded-xl bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50 font-medium"
                      >
                        <Copy className="size-4" />
                        คัดลอกลิงก์ส่งให้ผู้เซ็น
                      </button>
                    )
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                      <CheckCircle2 className="size-4 text-zinc-500" />
                      เติมอัตโนมัติตอนรวม PDF — ไม่ต้องเซ็นเอง
                    </div>
                  )}
                </CardBody>
              </Card>
            ) : (
              <Card>
                <CardBody className="text-sm text-zinc-500 text-center py-6">
                  เลือกจุดจากเอกสารด้านซ้าย
                  <br />
                  หรือแตะพื้นที่ว่างเพื่อเพิ่มจุดใหม่
                </CardBody>
              </Card>
            )}
          </Section>

          <Section
            number="02"
            label="LIST"
            title={`ทุกจุด (${placements.length})`}
          >
            <Card>
              <CardBody className="space-y-1.5">
                {placements.length === 0 && (
                  <p className="text-sm text-zinc-500 py-4 text-center">
                    ยังไม่มีจุด · เลือกประเภทจาก toolbar แล้วแตะหน้าเอกสาร
                  </p>
                )}
                {placements.map((p) => {
                  const isSel = selectedId === p.id;
                  const TypeIcon =
                    TYPE_OPTIONS.find((t) => t.value === p.placementType)
                      ?.Icon ?? PenLine;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPageNumber(p.pageNumber);
                        setSelectedId(p.id);
                      }}
                      className={cn(
                        "w-full text-left rounded-lg px-3 py-2 text-sm border transition-colors flex items-center justify-between gap-2",
                        isSel
                          ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)]"
                          : "border-zinc-200 hover:bg-zinc-50",
                      )}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        {p.signedAt ? (
                          <CheckCircle2 className="size-4 text-green-600 shrink-0" />
                        ) : (
                          <Plus className="size-4 text-zinc-400 shrink-0" />
                        )}
                        <TypeIcon className="size-3.5 text-zinc-500 shrink-0" />
                        <span className="truncate">
                          หน้า {p.pageNumber} · {typeLabel(p.placementType)}
                          {p.placementType === "signature" ||
                          p.placementType === "name"
                            ? ` · ${roleLabel(p.signerRole)}`
                            : ""}
                          {p.signerUser?.name
                            ? ` — ${p.signerUser.name}`
                            : p.signerName
                              ? ` — ${p.signerName}`
                              : ""}
                        </span>
                      </span>
                      {p.placementType === "signature" && !p.signedAt && (
                        <LinkIcon className="size-3.5 text-zinc-400 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </CardBody>
            </Card>
          </Section>

          <p className="text-xs text-zinc-500 leading-relaxed">
            <strong className="text-zinc-700">ระบบพิกัด:</strong> ตำแหน่งจุด
            เก็บเป็นสัดส่วน 0-1 ของหน้า
            ทำให้แสดงตรงกันที่ทุกขนาดจอ ·{" "}
            <strong className="text-zinc-700">เติมอัตโนมัติ:</strong>
            วันที่/ชื่อ/ข้อความ จะถูก stamp ตอน embed PDF — ไม่ต้องเซ็นเอง
          </p>
        </div>
      </div>

      {/* Confirm delete dialog — replaces window.confirm */}
      <Dialog
        open={pendingDeleteId !== null}
        onClose={() => {
          if (!deletingBusy) setPendingDeleteId(null);
        }}
        title="ยืนยันลบ"
      >
        <div className="space-y-5">
          <p className="text-sm text-zinc-700 leading-relaxed">
            ลบจุด
            {pendingDeletePlacement
              ? ` (หน้า ${pendingDeletePlacement.pageNumber} · ${typeLabel(pendingDeletePlacement.placementType)})`
              : ""}{" "}
            นี้?
          </p>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
            <Button
              variant="ghost"
              onClick={() => setPendingDeleteId(null)}
              disabled={deletingBusy}
            >
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingDeleteId) void performDelete(pendingDeleteId);
              }}
              loading={deletingBusy}
            >
              ลบ
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
