"use client";

// Inline action panel for a ticket — change status, assign tech, set ETA, add
// comment, add part, upload photo. Compact + collapsible on mobile.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  changeStatus,
  assignTechnician,
  addComment,
  addPart,
  setEta,
  addPhoto,
  updatePartStatus,
} from "@/lib/repair/actions";
import { STATUS_LABELS, STATUS_TRANSITIONS } from "@/lib/repair/types";
import type { RepairTicketStatus, RepairPhotoPhase, RepairPartStatus } from "@/lib/generated/prisma/enums";
import { Loader2, Plus, Camera, MessageSquare, Wrench, PackageSearch, Clock, AlertCircle } from "lucide-react";

// Status transitions that warrant a confirm dialog (irreversible or near-so)
const CONFIRM_TRANSITIONS: Partial<Record<RepairTicketStatus, string>> = {
  CLOSED: "ปิดถาวรแล้วจะ reopen ไม่ได้ · ยืนยัน?",
  CANCELLED: "ยกเลิกใบนี้?",
};

interface Technician { id: string; name: string; kind: "INTERNAL" | "VENDOR"; isActive: boolean }

interface Props {
  ticketId: string;
  currentStatus: RepairTicketStatus;
  currentTechId: string | null;
  currentEta: string | null;
  technicians: Technician[];
  canAdmin: boolean;
}

async function compressImage(file: File, maxEdge = 1024, quality = 0.65): Promise<string> {
  const bmp = await createImageBitmap(file);
  const ratio = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * ratio));
  const h = Math.max(1, Math.round(bmp.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bmp, 0, 0, w, h);
  let url = canvas.toDataURL("image/webp", quality);
  if (!url.startsWith("data:image/webp")) url = canvas.toDataURL("image/jpeg", quality);
  return url;
}

export function TicketActions({
  ticketId,
  currentStatus,
  currentTechId,
  currentEta,
  technicians,
  canAdmin,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [techId, setTechId] = useState(currentTechId ?? "");
  const [eta, setEtaInput] = useState(currentEta ? currentEta.slice(0, 16) : ""); // YYYY-MM-DDTHH:mm
  const [comment, setComment] = useState("");

  const [partOpen, setPartOpen] = useState(false);
  const [partName, setPartName] = useState("");
  const [partSpec, setPartSpec] = useState("");
  const [partQty, setPartQty] = useState(1);
  const [partUnit, setPartUnit] = useState("ชิ้น");
  const [partPrice, setPartPrice] = useState(0);

  const [photoPhase, setPhotoPhase] = useState<RepairPhotoPhase>("DURING");

  function run<T extends { ok: boolean; error?: string }>(fn: () => Promise<T>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "ผิดพลาด");
      router.refresh();
    });
  }

  // Status change with confirm-on-destructive + 5-second undo toast on cancel.
  function attemptStatusChange(to: RepairTicketStatus) {
    const confirmMsg = CONFIRM_TRANSITIONS[to];
    if (confirmMsg && typeof window !== "undefined" && !window.confirm(confirmMsg)) {
      return;
    }
    setError(null);
    const previous = currentStatus;
    startTransition(async () => {
      const r = await changeStatus({ ticketId, to });
      if (!r.ok) {
        setError(r.error ?? "ผิดพลาด");
        return;
      }
      router.refresh();
      // Offer undo for cancel (state machine allows CANCELLED → NEW)
      if (to === "CANCELLED") {
        toast.success(`ยกเลิกใบ ${ticketId.slice(0, 8)}…`, {
          duration: 6000,
          action: {
            label: "เลิกการยกเลิก",
            onClick: () => {
              startTransition(async () => {
                const back = await changeStatus({ ticketId, to: previous });
                if (back.ok) {
                  toast.success("ใบกลับมาเปิดแล้ว");
                  router.refresh();
                }
              });
            },
          },
        });
      }
    });
  }

  // Assign/unassign with 6-second undo
  function attemptAssign(nextTechId: string | null) {
    setError(null);
    const previousTechId = currentTechId;
    startTransition(async () => {
      const r = await assignTechnician({ ticketId, technicianId: nextTechId });
      if (!r.ok) {
        setError(r.error ?? "ผิดพลาด");
        return;
      }
      router.refresh();
      toast.success(nextTechId ? "มอบหมายช่างแล้ว" : "ปลดช่างแล้ว", {
        duration: 6000,
        action: {
          label: "เลิกทำ",
          onClick: () => {
            startTransition(async () => {
              const back = await assignTechnician({ ticketId, technicianId: previousTechId });
              if (back.ok) {
                setTechId(previousTechId ?? "");
                toast.success("กลับค่าเดิมแล้ว");
                router.refresh();
              }
            });
          },
        },
      });
    });
  }

  const nextStatuses = STATUS_TRANSITIONS[currentStatus] ?? [];

  async function handlePhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    try {
      const dataUrl = await compressImage(f);
      startTransition(async () => {
        const r = await addPhoto({ ticketId, phase: photoPhase, dataUrl });
        if (!r.ok) setError(r.error ?? "อัปโหลดไม่สำเร็จ");
        router.refresh();
      });
    } catch {
      setError("ย่อรูปไม่สำเร็จ");
    }
  }

  return (
    <div className="rounded-xl border-2 border-zinc-200 bg-zinc-50 p-3 sm:p-4 space-y-3">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 flex gap-2 text-red-800 text-xs">
          <AlertCircle className="size-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Status transitions */}
      {nextStatuses.length > 0 && (
        <div>
          <p className="text-xs font-bold text-zinc-500 mb-1.5">
            เปลี่ยนสถานะ
          </p>
          <div className="flex flex-wrap gap-1.5">
            {nextStatuses.map((s) => {
              if (s === "CLOSED" && !canAdmin) return null;
              const isDestructive = s === "CLOSED" || s === "CANCELLED";
              return (
                <button
                  key={s}
                  type="button"
                  disabled={isPending}
                  onClick={() => attemptStatusChange(s)}
                  className={`h-9 px-3 rounded-lg border-2 font-bold text-xs disabled:opacity-50 ${
                    isDestructive
                      ? "bg-white border-red-200 text-red-700 hover:border-red-400"
                      : "bg-white border-zinc-200 text-zinc-800 hover:border-zinc-900"
                  }`}
                >
                  → {STATUS_LABELS[s]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Assign technician */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-xs font-bold text-zinc-500">
            ช่างที่ดูแล
          </label>
          <select
            value={techId}
            onChange={(e) => setTechId(e.target.value)}
            className="mt-1 w-full h-10 px-2 rounded-lg border-2 border-zinc-200 bg-white text-sm font-medium focus:border-[var(--color-brand-500)] outline-none"
          >
            <option value="">— ไม่มอบหมาย —</option>
            {technicians.filter((t) => t.isActive).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.kind === "INTERNAL" ? "ใน" : "นอก"})
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={isPending || techId === (currentTechId ?? "")}
          onClick={() => attemptAssign(techId || null)}
          className="h-10 px-3 rounded-lg bg-zinc-900 text-white font-bold text-xs hover:bg-zinc-700 disabled:opacity-50"
        >
          <Wrench className="size-3.5 inline mr-1" />
          บันทึก
        </button>
      </div>

      {/* ETA */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-xs font-bold text-zinc-500">ETA</label>
          <input
            type="datetime-local"
            value={eta}
            onChange={(e) => setEtaInput(e.target.value)}
            className="mt-1 w-full h-10 px-2 rounded-lg border-2 border-zinc-200 bg-white text-sm font-medium focus:border-[var(--color-brand-500)] outline-none"
          />
        </div>
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => setEta({ ticketId, etaAt: eta || null }))}
          className="h-10 px-3 rounded-lg bg-zinc-900 text-white font-bold text-xs hover:bg-zinc-700 disabled:opacity-50"
        >
          <Clock className="size-3.5 inline mr-1" />
          บันทึก
        </button>
      </div>

      {/* Add comment */}
      <div>
        <label className="text-xs font-bold text-zinc-500">
          เพิ่มคอมเมนต์ / โน้ตภายใน
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          placeholder="โน้ตทีม · เห็นเฉพาะภายในระบบ"
          className="mt-1 w-full px-2 py-1.5 rounded-lg border-2 border-zinc-200 bg-white text-sm focus:border-[var(--color-brand-500)] outline-none resize-y"
        />
        <button
          type="button"
          disabled={isPending || comment.trim().length === 0}
          onClick={() => {
            const body = comment;
            run(async () => {
              const r = await addComment({ ticketId, body });
              if (r.ok) setComment("");
              return r;
            });
          }}
          className="mt-1.5 h-9 px-3 rounded-lg bg-[var(--color-brand-600)] text-white font-bold text-xs hover:bg-[var(--color-brand-700)] disabled:opacity-50"
        >
          <MessageSquare className="size-3.5 inline mr-1" />
          เพิ่ม
        </button>
      </div>

      {/* Add photo */}
      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-xs font-bold text-zinc-500">เพิ่มรูป</label>
        <select
          value={photoPhase}
          onChange={(e) => setPhotoPhase(e.target.value as RepairPhotoPhase)}
          className="h-9 px-2 rounded-lg border-2 border-zinc-200 bg-white text-xs font-bold"
        >
          <option value="BEFORE">ก่อนซ่อม</option>
          <option value="DURING">ระหว่างซ่อม</option>
          <option value="AFTER">หลังซ่อม</option>
          <option value="PART">อะไหล่</option>
          <option value="RECEIPT">บิล/ใบเสร็จ</option>
        </select>
        <label className="cursor-pointer inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white border-2 border-zinc-200 text-zinc-700 font-bold text-xs hover:bg-zinc-50">
          <Camera className="size-3.5" />
          เลือกรูป
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoFile}
            className="hidden"
            disabled={isPending}
          />
        </label>
        {isPending && <Loader2 className="size-4 animate-spin text-zinc-400" />}
      </div>

      {/* Add part */}
      <div>
        {!partOpen ? (
          <button
            type="button"
            onClick={() => setPartOpen(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white border-2 border-zinc-200 text-zinc-700 font-bold text-xs hover:bg-zinc-50"
          >
            <PackageSearch className="size-3.5" />
            <Plus className="size-3.5" />
            เพิ่มอะไหล่
          </button>
        ) : (
          <div className="rounded-lg border-2 border-zinc-200 bg-white p-2.5 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                value={partName}
                onChange={(e) => setPartName(e.target.value)}
                placeholder="ชื่ออะไหล่"
                className="h-9 px-2 rounded-lg border border-zinc-200 text-sm col-span-2"
                required
              />
              <input
                value={partSpec}
                onChange={(e) => setPartSpec(e.target.value)}
                placeholder="spec (เช่น 35µF 440V)"
                className="h-9 px-2 rounded-lg border border-zinc-200 text-sm col-span-2"
              />
              <input
                type="number"
                min={1}
                value={partQty}
                onChange={(e) => setPartQty(Math.max(1, parseInt(e.target.value || "1", 10)))}
                placeholder="จำนวน"
                className="h-9 px-2 rounded-lg border border-zinc-200 text-sm"
              />
              <input
                value={partUnit}
                onChange={(e) => setPartUnit(e.target.value)}
                placeholder="หน่วย"
                className="h-9 px-2 rounded-lg border border-zinc-200 text-sm"
              />
              <input
                type="number"
                min={0}
                step={1}
                value={partPrice}
                onChange={(e) => setPartPrice(Math.max(0, parseInt(e.target.value || "0", 10)))}
                placeholder="ราคา/หน่วย (บาท)"
                className="h-9 px-2 rounded-lg border border-zinc-200 text-sm col-span-2"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isPending || partName.trim().length === 0}
                onClick={() => {
                  run(async () => {
                    const r = await addPart({
                      ticketId,
                      name: partName.trim(),
                      spec: partSpec.trim() || undefined,
                      quantity: partQty,
                      unit: partUnit,
                      unitPriceCents: Math.round(partPrice * 100),
                    });
                    if (r.ok) {
                      setPartName("");
                      setPartSpec("");
                      setPartQty(1);
                      setPartPrice(0);
                      setPartOpen(false);
                    }
                    return r;
                  });
                }}
                className="h-9 px-3 rounded-lg bg-[var(--color-brand-600)] text-white font-bold text-xs hover:bg-[var(--color-brand-700)] disabled:opacity-50"
              >
                บันทึกอะไหล่
              </button>
              <button
                type="button"
                onClick={() => setPartOpen(false)}
                className="h-9 px-3 rounded-lg bg-white border border-zinc-200 text-zinc-700 font-bold text-xs hover:bg-zinc-50"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Exposed for parts queue page — toggle a part's status */
export function PartStatusButtons({
  partId,
  current,
}: {
  partId: string;
  current: RepairPartStatus;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const next: { label: string; to: RepairPartStatus }[] = [];
  if (current === "NEEDED") next.push({ label: "สั่งแล้ว", to: "ORDERED" });
  if (current === "ORDERED") next.push({ label: "ของถึง", to: "DELIVERED" });
  if (current === "DELIVERED") next.push({ label: "ติดตั้ง", to: "INSTALLED" });
  if (current !== "CANCELLED" && current !== "INSTALLED")
    next.push({ label: "ยกเลิก", to: "CANCELLED" });

  if (next.length === 0) return null;
  return (
    <div className="inline-flex gap-1">
      {next.map((n) => (
        <button
          key={n.to}
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await updatePartStatus({ partId, status: n.to });
              router.refresh();
            })
          }
          className="h-9 px-2.5 rounded-md text-xs font-bold border border-zinc-300 text-zinc-700 bg-white hover:bg-zinc-50 disabled:opacity-50"
        >
          → {n.label}
        </button>
      ))}
    </div>
  );
}
