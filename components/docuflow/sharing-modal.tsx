"use client";

// SharingModal — add new branches to a document's share list.
// ────────────────────────────────────────────────────────────────────
// Capability E · Cross-branch Document Sharing UI
//   - Filter pattern: ประเภทธุรกิจ → สาขา (HARD RULE — biztype first)
//   - Multi-select with checkboxes via reusable <BranchPicker>
//   - Save → POST /api/docuflow/[id]/share → toast + router.refresh
// ────────────────────────────────────────────────────────────────────

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  BranchPicker,
  type BranchOption,
} from "@/components/users/branch-picker";

interface Props {
  documentId: string;
  /** All branches in the org — passed pre-loaded from the server page. */
  allBranches: BranchOption[];
  /** Branch IDs already shared — these are excluded from the picker. */
  alreadySharedIds: string[];
}

export function SharingAddButton({
  documentId,
  allBranches,
  alreadySharedIds,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  // Hide branches already linked — admin can't add a duplicate row anyway
  const availableBranches = useMemo(() => {
    const skip = new Set(alreadySharedIds);
    return allBranches.filter((b) => !skip.has(b.id));
  }, [allBranches, alreadySharedIds]);

  function reset() {
    setSelected(new Set());
  }

  function close() {
    if (busy) return;
    setOpen(false);
    reset();
  }

  async function handleSave() {
    if (selected.size === 0) {
      toast.error("กรุณาเลือกอย่างน้อย 1 สาขา");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/docuflow/${documentId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchIds: Array.from(selected) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "เพิ่มสาขาไม่สำเร็จ");
      }
      const data = (await res.json().catch(() => ({}))) as {
        added?: number;
      };
      toast.success(`เพิ่มสาขาเรียบร้อย (${data.added ?? selected.size} รายการ)`);
      setOpen(false);
      reset();
      startTransition(() => router.refresh());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "เพิ่มสาขาไม่สำเร็จ";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        เพิ่มสาขา
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="เพิ่มสาขาที่ใช้เอกสารนี้"
        className="sm:max-w-2xl"
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 leading-relaxed">
            เลือกประเภทธุรกิจก่อน แล้วเลือกสาขา · เลือกได้หลายรายการ
          </p>

          {availableBranches.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50/40 p-6 text-center text-sm text-zinc-500">
              ทุกสาขาในระบบใช้เอกสารนี้แล้ว
            </div>
          ) : (
            <BranchPicker
              branches={availableBranches}
              selected={selected}
              onChange={setSelected}
            />
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
            <Button variant="ghost" onClick={close} disabled={busy}>
              ยกเลิก
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={busy}
              disabled={selected.size === 0 || availableBranches.length === 0}
            >
              บันทึก ({selected.size})
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/* ============================================================
   RemoveShareButton — inline delete for one branch chip
   ============================================================ */

interface RemoveProps {
  documentId: string;
  branchId: string;
  branchLabel: string;
}

export function RemoveShareButton({
  documentId,
  branchId,
  branchLabel,
}: RemoveProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  async function performRemove() {
    try {
      const res = await fetch(
        `/api/docuflow/${documentId}/share?branchId=${encodeURIComponent(branchId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "เอาออกไม่สำเร็จ");
      }
      toast.success("เอาสาขาออกเรียบร้อย");
      startTransition(() => router.refresh());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "เอาออกไม่สำเร็จ";
      toast.error(msg);
      throw e; // keep dialog open on failure
    }
  }

  return (
    <ConfirmDialog
      title="ยืนยันลบ"
      body={
        <>
          เอาสาขา <strong className="text-zinc-900">{branchLabel}</strong>{" "}
          ออกจากการแชร์เอกสารนี้?
        </>
      }
      confirmLabel="ลบ"
      onConfirm={performRemove}
      trigger={
        <button
          type="button"
          className="ml-1 -mr-0.5 inline-flex items-center justify-center size-4 rounded-full text-zinc-400 hover:text-red-600 hover:bg-red-50"
          aria-label={`เอาสาขา ${branchLabel} ออก`}
        >
          <span aria-hidden className="text-xs leading-none">
            ×
          </span>
        </button>
      }
    />
  );
}
