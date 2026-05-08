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
// ────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Save,
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
  CheckCircle2,
  Link as LinkIcon,
  Copy,
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

const DEFAULT_RECT: PlacementRect = {
  xRatio: 0.1,
  yRatio: 0.1,
  widthRatio: 0.28,
  heightRatio: 0.08,
};

function roleLabel(role: SignerRole): string {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
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
  const [placements, setPlacements] =
    useState<PlacementVm[]>(initialPlacements);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
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

    // Center the box on the click point
    const w = DEFAULT_RECT.widthRatio;
    const h = DEFAULT_RECT.heightRatio;
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
          signerRole: "owner",
          ordering: pagePlacements.length,
        }),
      });
      const data = (await res.json()) as {
        placement?: PlacementVm;
        error?: string;
      };
      if (!res.ok || !data.placement) {
        toast.error(data.error || "เพิ่มจุดเซ็นไม่สำเร็จ");
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
        signerRole: data.placement.signerRole as SignerRole,
        signerUserId: data.placement.signerUserId ?? null,
        signerName: data.placement.signerName ?? null,
        signerUser: null,
        label: data.placement.label ?? null,
        ordering: data.placement.ordering,
        signedAt: null,
        signedImageKey: null,
        signedFileKey: null,
      };
      setPlacements((prev) => [...prev, created]);
      setSelectedId(created.id);
    } catch (err) {
      console.error(err);
      toast.error("เพิ่มจุดเซ็นไม่สำเร็จ");
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
      toast.success("บันทึกจุดเซ็นแล้ว");
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
      toast.success("ลบจุดเซ็นแล้ว");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    } finally {
      setDeletingBusy(false);
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

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone="brand">
            {signedCount}/{placements.length} ลงนามแล้ว
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
                แตะพื้นที่ว่างบนเอกสารเพื่อเพิ่มจุดเซ็น · ลากเพื่อย้าย ·
                ลากปุ่มมุมขวาล่างเพื่อปรับขนาด
              </p>
            </CardBody>
          </Card>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          <Section number="01" label="SELECTED" title="จุดเซ็นที่เลือก">
            {selected ? (
              <Card>
                <CardBody className="space-y-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 font-bold mb-1.5">
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
                    <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 font-bold mb-1.5">
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
                    <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 font-bold mb-1.5">
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

                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 font-bold mb-1.5">
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

                  {selected.signedAt ? (
                    <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                      <CheckCircle2 className="size-4" />
                      ลงนามแล้ว
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
                  )}
                </CardBody>
              </Card>
            ) : (
              <Card>
                <CardBody className="text-sm text-zinc-500 text-center py-6">
                  เลือกจุดเซ็นจากเอกสารด้านซ้าย
                  <br />
                  หรือแตะพื้นที่ว่างเพื่อเพิ่มจุดใหม่
                </CardBody>
              </Card>
            )}
          </Section>

          <Section number="02" label="LIST" title={`ทุกจุดเซ็น (${placements.length})`}>
            <Card>
              <CardBody className="space-y-1.5">
                {placements.length === 0 && (
                  <p className="text-sm text-zinc-500 py-4 text-center">
                    ยังไม่มีจุดเซ็น · แตะหน้าเอกสารเพื่อเพิ่ม
                  </p>
                )}
                {placements.map((p) => {
                  const isSel = selectedId === p.id;
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
                        <span className="truncate">
                          หน้า {p.pageNumber} · {roleLabel(p.signerRole)}
                          {p.signerUser?.name
                            ? ` — ${p.signerUser.name}`
                            : p.signerName
                              ? ` — ${p.signerName}`
                              : ""}
                        </span>
                      </span>
                      {!p.signedAt && (
                        <LinkIcon className="size-3.5 text-zinc-400 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </CardBody>
            </Card>
          </Section>

          <p className="text-xs text-zinc-500 leading-relaxed">
            <strong className="text-zinc-700">ระบบพิกัด:</strong> ตำแหน่งจุดเซ็นเก็บเป็นสัดส่วน 0-1
            ของหน้า ทำให้แสดงตรงกันที่ทุกขนาดจอ และเมื่อทุกคนเซ็นครบ ระบบจะรวมลายเซ็นลง PDF
            อัตโนมัติ
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
            ลบจุดเซ็น
            {pendingDeletePlacement
              ? ` (หน้า ${pendingDeletePlacement.pageNumber} · ${roleLabel(pendingDeletePlacement.signerRole)})`
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
