"use client";

// Left pane of the รายจ่าย workspace: status/category/search filters, a scrollable
// receipt list, and a bulk-confirm bar for selected drafts.
// All filters are URL-driven (GET form / router.push) so the server page re-reads
// scope on every change.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Loader2, CheckCircle2 } from "lucide-react";
import { StatusBadge } from "@/components/ledger/_kit/StatusBadge";
import { Badge } from "@/components/ui/badge";
import type { ExpenseRow, LedgerStatusValue } from "@/components/ledger/_kit/types";
import { bulkConfirm } from "../../_actions";

const STATUS_TABS: Array<{ value: LedgerStatusValue | ""; label: string }> = [
  { value: "", label: "ทั้งหมด" },
  { value: "draft", label: "รอยืนยัน" },
  { value: "confirmed", label: "ยืนยันแล้ว" },
  { value: "locked", label: "ล็อก" },
  { value: "void", label: "ยกเลิก" },
];

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

export function ExpenseList({
  rows,
  categories,
  selectedId,
  baseParams,
  status,
  categoryId,
  q,
  draftIds,
}: {
  rows: ExpenseRow[];
  categories: Array<{ id: string; name: string; color: string | null; sort: number }>;
  selectedId?: string;
  baseParams: string;
  status?: LedgerStatusValue;
  categoryId?: string;
  q?: string;
  draftIds: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  // Build a link to a row keeping company/branch/filter context.
  function rowHref(id: string) {
    const sp = new URLSearchParams(baseParams);
    sp.set("selected", id);
    return `${pathname}?${sp.toString()}`;
  }

  function setStatus(next: string) {
    const sp = new URLSearchParams(baseParams);
    sp.delete("status");
    if (next) sp.set("status", next);
    if (selectedId) sp.set("selected", selectedId);
    router.push(`${pathname}?${sp.toString()}`);
  }

  function setCategory(next: string) {
    const sp = new URLSearchParams(baseParams);
    sp.delete("category");
    if (next) sp.set("category", next);
    if (selectedId) sp.set("selected", selectedId);
    router.push(`${pathname}?${sp.toString()}`);
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function selectAllDrafts() {
    setChecked((prev) =>
      prev.size === draftIds.length ? new Set() : new Set(draftIds),
    );
  }

  function runBulk() {
    if (checked.size === 0) return;
    setMsg(null);
    startTransition(async () => {
      const res = await bulkConfirm(Array.from(checked));
      if (res.ok) {
        setMsg(`ยืนยัน ${res.confirmed ?? 0} ใบ · ข้าม ${res.skipped ?? 0} ใบ (ยอดไม่ตรง)`);
        setChecked(new Set());
        router.refresh();
      } else {
        setMsg(res.error ?? "ยืนยันไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white">
      {/* Sticky filter header */}
      <div className="sticky top-14 z-20 space-y-2 rounded-t-2xl border-b border-zinc-200 bg-white p-3 sm:top-16">
        {/* Status tabs */}
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map((t) => {
            const active = (status ?? "") === t.value;
            return (
              <button
                key={t.value || "all"}
                onClick={() => setStatus(t.value)}
                className={
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors " +
                  (active
                    ? "bg-[var(--color-brand-600)] text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200")
                }
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2">
          <select
            aria-label="กรองตามหมวด"
            value={categoryId ?? ""}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
          >
            <option value="">ทุกหมวด</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Search (GET form to keep it simple/server-driven) */}
        <form method="GET" className="flex gap-2">
          {baseParams
            .split("&")
            .filter(Boolean)
            .map((kv) => {
              const [k, v] = kv.split("=");
              if (k === "q") return null;
              return <input key={k} type="hidden" name={k} value={decodeURIComponent(v ?? "")} />;
            })}
          {selectedId && <input type="hidden" name="selected" value={selectedId} />}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="ค้นหา ผู้ขาย / เลขที่ / เลขภาษี"
            className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
          />
          <button
            type="submit"
            className="h-9 shrink-0 rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-800"
          >
            ค้นหา
          </button>
        </form>

        {/* Bulk-confirm bar */}
        {draftIds.length > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-2 py-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
              <input
                type="checkbox"
                checked={checked.size > 0 && checked.size === draftIds.length}
                onChange={selectAllDrafts}
                className="size-3.5 accent-amber-600"
              />
              เลือกร่างทั้งหมด ({checked.size}/{draftIds.length})
            </label>
            <button
              onClick={runBulk}
              disabled={pending || checked.size === 0}
              className="inline-flex h-7 items-center gap-1 rounded-lg bg-emerald-600 px-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-zinc-300"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3.5" />
              )}
              ยืนยันที่เลือก
            </button>
          </div>
        )}
        {msg && <p className="text-xs text-emerald-700">{msg}</p>}
      </div>

      {/* List */}
      <ul className="max-h-[calc(100dvh-20rem)] divide-y divide-zinc-100 overflow-y-auto">
        {rows.length === 0 ? (
          <li className="px-3 py-12 text-center text-sm text-zinc-400">
            {q || status || categoryId ? "ไม่พบรายการตามเงื่อนไข" : "ยังไม่มีรายจ่าย"}
          </li>
        ) : (
          rows.map((r) => {
            const active = selectedId === r.id;
            const isDraft = r.status === "draft";
            return (
              <li key={r.id} className="flex items-stretch">
                {isDraft && (
                  <label className="flex shrink-0 items-center pl-3">
                    <input
                      type="checkbox"
                      checked={checked.has(r.id)}
                      onChange={() => toggle(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="size-4 accent-emerald-600"
                      aria-label={`เลือก ${r.docCode}`}
                    />
                  </label>
                )}
                <Link
                  href={rowHref(r.id)}
                  aria-current={active ? "true" : undefined}
                  className={
                    "flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-zinc-50 " +
                    (active ? "bg-[var(--color-brand-50)]" : "")
                  }
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-zinc-800">
                      {r.vendor || "ไม่ระบุผู้ขาย"}
                    </div>
                    <div className="flex items-center gap-1.5 truncate text-xs text-zinc-400">
                      <span className="font-mono">{r.docCode}</span>
                      {r.categoryName && (
                        <Badge tone="neutral" className="text-[10px]">
                          {r.categoryName}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums text-zinc-900">
                      {baht(r.total)}
                    </div>
                    <StatusBadge status={r.status} className="mt-0.5 text-[10px]" />
                  </div>
                </Link>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
