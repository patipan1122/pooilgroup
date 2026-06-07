// "เซฟเล่ม" shelf — saved analytics books for /ledger/ledger-book.
//
// A chip rail of saved books (tap = reopen that view) + a "บันทึกเป็นเล่ม" button
// that names the CURRENT filter set and saves it (shared per company). Creator/
// admin get a ⋯ menu to rename/delete. URL-driven open (href precomputed by the
// server so this client island never imports the prisma-backed saved-books lib).
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookMarked, Plus, MoreVertical, Check, X, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { SavedBookConfig } from "@/lib/ledger/saved-books";
import { createSavedBook, renameSavedBook, deleteSavedBook } from "../_actions";

export interface SavedBookChip {
  id: string;
  name: string;
  /** Precomputed /ledger/ledger-book?... link that restores this book's filters. */
  href: string;
  /** Creator or admin → may rename/delete (books are shared per company). */
  canManage: boolean;
}

const chipBase =
  "inline-flex min-h-[36px] items-center rounded-full border px-3 text-sm font-medium transition-colors";

export function SavedBooks({
  books,
  companyId,
  currentConfig,
}: {
  books: SavedBookChip[];
  companyId: string;
  currentConfig: SavedBookConfig;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => router.refresh();

  const onSave = () => {
    const n = name.trim();
    if (!n) return;
    start(async () => {
      const r = await createSavedBook({ companyId, name: n, config: currentConfig });
      if (r.ok) {
        setSaving(false);
        setName("");
        setErr(null);
        refresh();
      } else setErr(r.error);
    });
  };

  const onRename = (id: string) => {
    const n = editName.trim();
    if (!n) return;
    start(async () => {
      const r = await renameSavedBook({ companyId, id, name: n });
      if (r.ok) {
        setEditingId(null);
        setErr(null);
        refresh();
      } else setErr(r.error);
    });
  };

  const onDelete = (id: string) => {
    start(async () => {
      const r = await deleteSavedBook({ companyId, id });
      if (r.ok) {
        setMenuId(null);
        setErr(null);
        refresh();
      } else setErr(r.error);
    });
  };

  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-zinc-500">
        <BookMarked className="size-3.5" aria-hidden /> เล่มที่บันทึก
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {books.map((b) =>
          editingId === b.id ? (
            <span
              key={b.id}
              className={cn(chipBase, "gap-1 border-[var(--color-brand-300)] bg-white pr-1")}
            >
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onRename(b.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                maxLength={60}
                className="w-32 bg-transparent text-sm outline-none"
                aria-label="ชื่อเล่มใหม่"
              />
              <button
                type="button"
                onClick={() => onRename(b.id)}
                disabled={pending}
                aria-label="บันทึกชื่อ"
                className="grid size-7 place-items-center rounded-full text-emerald-600 hover:bg-emerald-50"
              >
                <Check className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                aria-label="ยกเลิก"
                className="grid size-7 place-items-center rounded-full text-zinc-400 hover:bg-zinc-100"
              >
                <X className="size-4" aria-hidden />
              </button>
            </span>
          ) : (
            <span key={b.id} className="relative inline-flex items-center">
              <Link
                href={b.href}
                className={cn(
                  chipBase,
                  "border-zinc-200 bg-white text-zinc-700 hover:border-[var(--color-brand-200)] hover:bg-[var(--color-brand-50)]",
                  b.canManage && "rounded-r-none",
                )}
              >
                {b.name}
              </Link>
              {b.canManage && (
                <button
                  type="button"
                  onClick={() => setMenuId(menuId === b.id ? null : b.id)}
                  aria-label="จัดการเล่ม"
                  aria-expanded={menuId === b.id}
                  className="grid min-h-[36px] w-8 place-items-center rounded-r-full border border-l-0 border-zinc-200 bg-white text-zinc-400 hover:bg-zinc-50"
                >
                  <MoreVertical className="size-4" aria-hidden />
                </button>
              )}
              {menuId === b.id && (
                <div className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(b.id);
                      setEditName(b.name);
                      setMenuId(null);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    <Pencil className="size-4 text-zinc-400" aria-hidden /> เปลี่ยนชื่อ
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(b.id)}
                    disabled={pending}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="size-4" aria-hidden /> ลบเล่ม
                  </button>
                </div>
              )}
            </span>
          ),
        )}

        {/* save current view as a new book */}
        {saving ? (
          <span className={cn(chipBase, "gap-1 border-[var(--color-brand-300)] bg-white pr-1")}>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSave();
                if (e.key === "Escape") setSaving(false);
              }}
              maxLength={60}
              placeholder="ชื่อเล่ม เช่น ค่าไฟ JPSYNC"
              className="w-40 bg-transparent text-sm outline-none placeholder:text-zinc-400"
              aria-label="ชื่อเล่มใหม่"
            />
            <button
              type="button"
              onClick={onSave}
              disabled={pending}
              aria-label="บันทึกเล่ม"
              className="grid size-7 place-items-center rounded-full text-emerald-600 hover:bg-emerald-50"
            >
              <Check className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => {
                setSaving(false);
                setName("");
              }}
              aria-label="ยกเลิก"
              className="grid size-7 place-items-center rounded-full text-zinc-400 hover:bg-zinc-100"
            >
              <X className="size-4" aria-hidden />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setSaving(true);
              setErr(null);
            }}
            className={cn(
              chipBase,
              "border-dashed border-[var(--color-brand-300)] text-[var(--color-brand-600)] hover:bg-[var(--color-brand-50)]",
            )}
          >
            <Plus className="mr-1 size-4" aria-hidden /> บันทึกเป็นเล่ม
          </button>
        )}
      </div>

      {err && <p className="mt-1 text-[11px] text-red-600">{err}</p>}
    </div>
  );
}
