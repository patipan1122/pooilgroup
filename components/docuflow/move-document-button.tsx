"use client";

// MoveDocumentButton — "ย้ายไปที่..." (Workshop Must #5, 2026-10-10).
// Button-driven move, NOT drag-and-drop (team ruled drag-and-drop out this
// phase — mobile touch conflicts with scroll, see Section 3 debate #3 of
// docs/WORKSHOP_docuflow-org-structure-2026-10-10.md). Mounted from two
// places: the document detail page's "กลุ่มเอกสาร" card, and each row's
// action slot on the main document list (components/docuflow/document-card.tsx)
// — same component both places via the `compact` prop, same server action
// (lib/docuflow/move-document.ts), no duplicated logic.
//
// Search-first single-select list, adapted from TagCombobox's interaction
// pattern (components/docuflow/tag-combobox.tsx) — filter-as-you-type, click
// a row to select — but always-expanded inside the Dialog rather than a
// floating dropdown (simpler + more reliable on mobile where this dialog
// already renders as a bottom sheet, see components/ui/dialog.tsx). No
// "+ create new" row here on purpose — this feature moves a document into an
// EXISTING group only; creating a new group is QuickCreateDocumentGroupButton's
// job, not this one's.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Move, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";
import { moveDocumentToGroup } from "@/lib/docuflow/move-document";

export interface MoveDocumentGroupOption {
  id: string;
  name: string;
}

interface Props {
  documentId: string;
  currentGroupId: string | null;
  currentGroupName: string | null;
  /** Active DocumentGroup rows for this org (already excludes soft-deleted
   *  ones — same list listDocumentGroups() hands to the upload form). */
  groups: MoveDocumentGroupOption[];
  /** Icon-only trigger for tight spaces (document-card.tsx's per-row action
   *  slot) instead of the full "ย้ายไปที่..." labeled button. */
  compact?: boolean;
}

export function MoveDocumentButton({
  documentId,
  currentGroupId,
  currentGroupName,
  groups,
  compact,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleOpen(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(null);
    setQuery("");
    setOpen(true);
  }

  function handleClose() {
    if (pending) return;
    setOpen(false);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Moving a document INTO the group it's already in is a no-op the
    // server action rejects anyway — hide it from the picker so the list
    // only ever shows real destinations.
    const pool = groups.filter((g) => g.id !== currentGroupId);
    if (!q) return pool;
    return pool.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, currentGroupId, query]);

  function confirm() {
    if (!selectedId) {
      toast.error("เลือกกลุ่มปลายทางก่อน");
      return;
    }
    startTransition(async () => {
      const res = await moveDocumentToGroup({
        documentId,
        toGroupId: selectedId,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`ย้ายเอกสารไปกลุ่ม "${res.toGroupName}" แล้ว`);
      setOpen(false);
      // Re-render server components in place (same "no full reload" pattern
      // as DeleteDocumentButton / QuickCreateDocumentGroupButton in this
      // module) — picks up the new documentGroupId everywhere it's shown.
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleOpen}
        title="ย้ายไปที่..."
        aria-label="ย้ายไปที่..."
        className={compact ? "!px-2" : undefined}
      >
        <Move className="size-3.5" />
        {!compact && <span>ย้ายไปที่...</span>}
      </Button>

      <Dialog open={open} onClose={handleClose} title="ย้ายเอกสารไปกลุ่มอื่น">
        <div className="space-y-3">
          <p className="text-sm text-zinc-600">
            กลุ่มปัจจุบัน:{" "}
            <span className="font-semibold text-zinc-900">
              {currentGroupName ?? "ยังไม่ได้จัดกลุ่ม"}
            </span>
          </p>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Prevent falling through to any outer form on Enter — same
                // reasoning as TagCombobox/QuickCreateDocGroupDialog.
                if (e.key === "Enter") e.preventDefault();
              }}
              disabled={pending}
              placeholder="ค้นหากลุ่มเอกสาร…"
              autoFocus
              className="w-full h-10 pl-9 pr-3 text-sm rounded-xl border-2 border-zinc-200 bg-white focus:border-[var(--color-brand-500)] focus:outline-none disabled:bg-zinc-50"
            />
          </div>

          <div className="max-h-56 overflow-y-auto rounded-xl border-2 border-zinc-200">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-xs text-zinc-500 text-center">
                {groups.length === 0
                  ? "องค์กรนี้ยังไม่มีกลุ่มเอกสาร — สร้างกลุ่มก่อนย้ายเอกสารเข้าได้"
                  : "ไม่พบกลุ่มเอกสารที่ค้นหา"}
              </p>
            ) : (
              filtered.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  disabled={pending}
                  onClick={() => setSelectedId(g.id)}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm border-b border-zinc-50 last:border-b-0 transition-colors",
                    selectedId === g.id
                      ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)] font-semibold"
                      : "hover:bg-zinc-50 text-zinc-800",
                  )}
                >
                  <span className="truncate">{g.name}</span>
                  {selectedId === g.id && (
                    <span className="text-xs shrink-0">เลือกแล้ว</span>
                  )}
                </button>
              ))
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={pending}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              onClick={confirm}
              loading={pending}
              disabled={!selectedId}
            >
              <Move className="size-4" />
              ยืนยันย้าย
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
