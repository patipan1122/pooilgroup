"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckSquare, Square, Loader2, Sparkles } from "lucide-react";
import { bulkCreateFacebookChannels } from "@/lib/inbox/channel-actions";
import type { InboxBusiness } from "@/lib/inbox/business";

interface PageRow {
  id: string;
  name: string;
  category: string | null;
  accessTokenEnc: string;
}

interface Selection {
  selected: boolean;
  businessTag: string;
}

const DEFAULT_BUSINESS = "other";

export function FacebookImportForm({
  pages,
  businesses,
}: {
  pages: PageRow[];
  businesses: InboxBusiness[];
}) {
  const [sel, setSel] = useState<Record<string, Selection>>(() => {
    const init: Record<string, Selection> = {};
    for (const p of pages) {
      init[p.id] = { selected: true, businessTag: DEFAULT_BUSINESS };
    }
    return init;
  });
  const [bulkTag, setBulkTag] = useState<string>("");
  const [submitting, startSubmit] = useTransition();
  const router = useRouter();

  const selectedCount = useMemo(
    () => Object.values(sel).filter((s) => s.selected).length,
    [sel],
  );

  function toggleAll(value: boolean) {
    setSel((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        next[id] = { ...next[id], selected: value };
      }
      return next;
    });
  }

  function applyBulkTag() {
    if (!bulkTag) return;
    setSel((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (next[id].selected) next[id] = { ...next[id], businessTag: bulkTag };
      }
      return next;
    });
    toast.success(`ตั้งธุรกิจให้ ${selectedCount} เพจที่ติ๊กไว้`);
  }

  function submit() {
    const chosen = pages
      .filter((p) => sel[p.id]?.selected)
      .map((p) => ({
        id: p.id,
        name: p.name,
        accessTokenEnc: p.accessTokenEnc,
        businessTag: sel[p.id]?.businessTag || DEFAULT_BUSINESS,
      }));
    if (chosen.length === 0) {
      toast.error("ติ๊กอย่างน้อย 1 เพจก่อน");
      return;
    }
    startSubmit(async () => {
      try {
        const res = await bulkCreateFacebookChannels({ pages: chosen });
        const parts: string[] = [];
        if (res.created) parts.push(`สร้างใหม่ ${res.created}`);
        if (res.updated) parts.push(`อัปเดต ${res.updated}`);
        if (res.subscribed) parts.push(`subscribe webhook ${res.subscribed}`);
        toast.success(parts.join(" · ") || "เสร็จแล้ว");
        if (res.errors.length > 0) {
          toast.warning(`มี ${res.errors.length} เพจที่ไม่สำเร็จ — ดู console`);
          console.warn("[fb-import errors]", res.errors);
        }
        router.push("/inbox/settings/channels");
      } catch (e) {
        toast.error((e as Error).message || "นำเข้าไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3">
        <div className="flex items-center gap-1.5 text-sm">
          <button
            type="button"
            onClick={() => toggleAll(true)}
            className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
          >
            เลือกทั้งหมด
          </button>
          <button
            type="button"
            onClick={() => toggleAll(false)}
            className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
          >
            ล้าง
          </button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={bulkTag}
            onChange={(e) => setBulkTag(e.target.value)}
            className="h-8 rounded-lg border border-zinc-300 bg-white px-2 text-xs"
          >
            <option value="">เลือกธุรกิจ...</option>
            {businesses.map((b) => (
              <option key={b.tag} value={b.tag}>
                {b.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={applyBulkTag}
            disabled={!bulkTag || selectedCount === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-800 hover:bg-zinc-200 disabled:opacity-40"
            title="ตั้งธุรกิจให้เพจที่ติ๊กไว้ทั้งหมด"
          >
            <Sparkles className="size-3.5" />
            ตั้งธุรกิจให้ที่ติ๊กไว้
          </button>
        </div>
        <span className="basis-full text-[11px] text-zinc-500">
          ติ๊กไว้แล้ว {selectedCount} / {pages.length} เพจ
        </span>
      </div>

      {/* Page list */}
      <div className="rounded-xl border border-zinc-200 bg-white">
        <ul className="divide-y divide-zinc-100">
          {pages.map((p) => {
            const s = sel[p.id] || { selected: false, businessTag: DEFAULT_BUSINESS };
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 px-3 py-2.5"
              >
                <button
                  type="button"
                  onClick={() =>
                    setSel((prev) => ({
                      ...prev,
                      [p.id]: { ...s, selected: !s.selected },
                    }))
                  }
                  aria-pressed={s.selected}
                  className="text-[var(--color-brand-600)]"
                  aria-label={s.selected ? "ยกเลิกเลือก" : "เลือก"}
                >
                  {s.selected ? (
                    <CheckSquare className="size-5" />
                  ) : (
                    <Square className="size-5 text-zinc-300" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-zinc-900">
                    {p.name}
                  </p>
                  <p className="truncate text-[11px] text-zinc-500">
                    Page ID: {p.id}
                    {p.category ? ` · ${p.category}` : ""}
                  </p>
                </div>
                <select
                  value={s.businessTag}
                  onChange={(e) =>
                    setSel((prev) => ({
                      ...prev,
                      [p.id]: { ...s, businessTag: e.target.value },
                    }))
                  }
                  disabled={!s.selected}
                  className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-xs disabled:opacity-50"
                >
                  {businesses.map((b) => (
                    <option key={b.tag} value={b.tag}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || selectedCount === 0}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--color-brand-600)] px-4 text-sm font-bold text-white hover:bg-[var(--color-brand-700)] disabled:opacity-40"
        >
          {submitting && <Loader2 className="size-4 animate-spin" />}
          นำเข้า {selectedCount} เพจ
        </button>
      </div>
    </div>
  );
}
