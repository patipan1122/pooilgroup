"use client";

// EditDocumentButton — fix a document's name/description after upload.
// ────────────────────────────────────────────────────────────────────
// CEO feedback 2026-10-11: she sometimes mistypes the document name or
// enters wrong info while attaching a file and had no way to correct it
// without re-uploading. PATCH /api/docuflow/[id] already accepts
// name/description (admin-tier gated, same as every other write on this
// page) — this is just the missing UI trigger, following the exact same
// Dialog pattern as MoveDocumentButton (bottom sheet on mobile).
// ────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

interface Props {
  documentId: string;
  initialName: string;
  initialDescription: string | null;
}

export function EditDocumentButton({
  documentId,
  initialName,
  initialDescription,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [saving, setSaving] = useState(false);

  function handleOpen() {
    setName(initialName);
    setDescription(initialDescription ?? "");
    setOpen(true);
  }

  function handleClose() {
    if (saving) return;
    setOpen(false);
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("กรุณากรอกชื่อเอกสาร");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/docuflow/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "บันทึกไม่สำเร็จ");
      }
      toast.success("แก้ไขเอกสารแล้ว");
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleOpen}
        title="แก้ไขชื่อ/รายละเอียด"
        aria-label="แก้ไขชื่อ/รายละเอียด"
      >
        <Pencil className="size-3.5" />
        <span>แก้ไข</span>
      </Button>

      <Dialog open={open} onClose={handleClose} title="แก้ไขเอกสาร">
        <div className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-zinc-500 tracking-wide">
              ชื่อเอกสาร
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              autoFocus
              maxLength={255}
              className="h-10 w-full rounded-xl border-2 border-zinc-200 bg-white px-3 text-sm focus:border-[var(--color-brand-500)] focus:outline-none disabled:bg-zinc-50"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-zinc-500 tracking-wide">
              รายละเอียด (ถ้ามี)
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              maxLength={2000}
              rows={3}
              className="w-full rounded-xl border-2 border-zinc-200 bg-white px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none disabled:bg-zinc-50 resize-none"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={saving}
            >
              ยกเลิก
            </Button>
            <Button type="button" onClick={handleSave} loading={saving}>
              <Save className="size-4" />
              บันทึก
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
