"use client";

// Left pane of the รายจ่าย workspace: status/category/TRCloud/search filters, a
// scrollable receipt list, and a context-aware bulk bar (ยืนยันร่าง · ส่งเข้า TRCloud).
// All filters are URL-driven (GET form / router.push) so the server page re-reads
// scope on every change.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Loader2, CheckCircle2, AlertTriangle, Send, CloudCheck } from "lucide-react";
import { StatusBadge } from "@/components/ledger/_kit/StatusBadge";
import { CompletenessDot } from "@/components/ledger/_kit/CompletenessDot";
import { LedgerEmptyState } from "@/components/ledger/Brand";
import { Badge } from "@/components/ui/badge";
import type { ExpenseRow, LedgerStatusValue } from "@/components/ledger/_kit/types";
import { bulkConfirm, sendExpensesToTrcloud } from "../../_actions";

const STATUS_TABS: Array<{ value: LedgerStatusValue | ""; label: string }> = [
  { value: "", label: "ทั้งหมด" },
  { value: "draft", label: "รอยืนยัน" },
  { value: "confirmed", label: "ยืนยันแล้ว" },
  { value: "locked", label: "ล็อก" },
  { value: "void", label: "ยกเลิก" },
];

// ภาษีซื้อ (input-VAT) color filter — mirrors STATUS_TABS, driven by ?cc=.
// Each tab carries a tiny color swatch so the meaning is obvious without a legend.
const CC_TABS: Array<{ value: "" | "green" | "yellow" | "red"; label: string; dot: string }> = [
  { value: "", label: "ทุกสถานะใบ", dot: "" },
  { value: "green", label: "ขอคืนได้", dot: "bg-emerald-500" },
  { value: "yellow", label: "ขอใบใหม่", dot: "bg-amber-500" },
  { value: "red", label: "ขอคืนไม่ได้", dot: "bg-rose-500" },
];

const TR_TABS: Array<{ value: "" | "unsent" | "sent"; label: string }> = [
  { value: "", label: "ทุกการส่ง" },
  { value: "unsent", label: "ยังไม่ส่ง TRCloud" },
  { value: "sent", label: "ส่งแล้ว" },
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
  tr,
  cc,
  q,
  draftIds,
  sendableIds,
  companyId,
}: {
  rows: ExpenseRow[];
  categories: Array<{ id: string; name: string; color: string | null; sort: number }>;
  selectedId?: string;
  baseParams: string;
  status?: LedgerStatusValue;
  categoryId?: string;
  tr?: "sent" | "unsent";
  /** ภาษีซื้อ color filter (?cc=) — green/yellow/red. */
  cc?: "green" | "yellow" | "red";
  q?: string;
  draftIds: string[];
  /** Confirmed/locked rows not yet pushed to TRCloud — eligible for bulk send. */
  sendableIds: string[];
  /** Active company scope — passed to bulk actions so they can't cross companies. */
  companyId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const draftSet = new Set(draftIds);
  const sendableSet = new Set(sendableIds);
  const selDrafts = [...checked].filter((id) => draftSet.has(id));
  const selSendable = [...checked].filter((id) => sendableSet.has(id));
  const actionableIds = [...draftIds, ...sendableIds];

  // Build a link to a row keeping company/branch/filter context.
  function rowHref(id: string) {
    const sp = new URLSearchParams(baseParams);
    sp.set("selected", id);
    return `${pathname}?${sp.toString()}`;
  }

  function setParam(key: string, next: string) {
    const sp = new URLSearchParams(baseParams);
    sp.delete(key);
    if (next) sp.set(key, next);
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

  function selectAllActionable() {
    setChecked((prev) =>
      prev.size === actionableIds.length ? new Set() : new Set(actionableIds),
    );
  }

  function runBulkConfirm() {
    if (selDrafts.length === 0) return;
    setMsg(null);
    startTransition(async () => {
      const res = await bulkConfirm(selDrafts, companyId);
      if (res.ok) {
        setMsg({ kind: "ok", text: `ยืนยัน ${res.confirmed ?? 0} ใบ · ข้าม ${res.skipped ?? 0} ใบ (ยอดไม่ตรง)` });
        setChecked(new Set());
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error ?? "ยืนยันไม่สำเร็จ" });
      }
    });
  }

  function runBulkSend() {
    if (selSendable.length === 0) return;
    setMsg(null);
    startTransition(async () => {
      const res = await sendExpensesToTrcloud(selSendable, companyId);
      if (res.ok) {
        const parts = [`ส่งเข้า TRCloud ${res.sent ?? 0} ใบ`];
        if (res.skipped) parts.push(`ข้าม ${res.skipped}`);
        if (res.failed) parts.push(`พลาด ${res.failed}`);
        setMsg({ kind: res.failed ? "err" : "ok", text: parts.join(" · ") });
        setChecked(new Set());
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error ?? "ส่งเข้า TRCloud ไม่สำเร็จ" });
      }
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white">
      {/* Sticky filter header */}
      <div className="sticky top-14 z-20 space-y-2 rounded-t-2xl border-b border-zinc-200 bg-white p-3 sm:top-16">
        {/* Status tabs */}
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="กรองตามสถานะ">
          {STATUS_TABS.map((t) => {
            const active = (status ?? "") === t.value;
            return (
              <button
                key={t.value || "all"}
                role="tab"
                aria-selected={active}
                onClick={() => setParam("status", t.value)}
                className={
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-300)] " +
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

        {/* TRCloud send filter */}
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="กรองตามการส่ง TRCloud">
          {TR_TABS.map((t) => {
            const active = (tr ?? "") === t.value;
            return (
              <button
                key={t.value || "all-tr"}
                role="tab"
                aria-selected={active}
                onClick={() => setParam("tr", t.value)}
                className={
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-300)] " +
                  (active
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200")
                }
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* ภาษีซื้อ color filter — กรองตามสถานะใบกำกับ (เขียว/เหลือง/แดง) */}
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="กรองตามสถานะใบกำกับ (ภาษีซื้อ)">
          {CC_TABS.map((t) => {
            const active = (cc ?? "") === t.value;
            return (
              <button
                key={t.value || "all-cc"}
                role="tab"
                aria-selected={active}
                onClick={() => setParam("cc", t.value)}
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-300)] " +
                  (active
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200")
                }
              >
                {t.dot && (
                  <span className={"size-2 rounded-full " + t.dot} aria-hidden />
                )}
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2">
          <select
            aria-label="กรองตามหมวด"
            value={categoryId ?? ""}
            onChange={(e) => setParam("category", e.target.value)}
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

        {/* Context-aware bulk bar — appears when there are actionable rows */}
        {actionableIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-2 py-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-700">
              <input
                type="checkbox"
                checked={checked.size > 0 && checked.size === actionableIds.length}
                onChange={selectAllActionable}
                className="size-3.5 accent-zinc-700"
              />
              เลือก ({checked.size})
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {selDrafts.length > 0 && (
                <button
                  onClick={runBulkConfirm}
                  disabled={pending}
                  className="inline-flex h-7 items-center gap-1 rounded-lg bg-emerald-600 px-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-zinc-300"
                >
                  {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                  ยืนยัน ({selDrafts.length})
                </button>
              )}
              {selSendable.length > 0 && (
                <button
                  onClick={runBulkSend}
                  disabled={pending}
                  className="inline-flex h-7 items-center gap-1 rounded-lg bg-blue-600 px-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-zinc-300"
                >
                  {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  ส่งเข้า TRCloud ({selSendable.length})
                </button>
              )}
            </div>
          </div>
        )}
        {msg && (
          <p
            className={"text-xs " + (msg.kind === "ok" ? "text-emerald-700" : "text-rose-700")}
            role="status"
            aria-live="polite"
          >
            {msg.text}
          </p>
        )}
      </div>

      {/* List */}
      <ul className="max-h-[calc(100dvh-23rem)] divide-y divide-zinc-100 overflow-y-auto">
        {rows.length === 0 ? (
          <li>
            {q || status || categoryId || tr ? (
              <LedgerEmptyState
                title="ไม่พบรายการตามเงื่อนไข"
                hint="ลองล้างตัวกรอง หรือเปลี่ยนคำค้น"
              />
            ) : (
              <LedgerEmptyState
                title="ยังไม่มีรายจ่าย"
                hint="ส่งรูปใบเสร็จใน LINE หรือกดอัปโหลด แล้วน้องใบเสร็จจะจดให้"
              />
            )}
          </li>
        ) : (
          rows.map((r) => {
            const active = selectedId === r.id;
            const isDraft = r.status === "draft";
            const isSendable = sendableSet.has(r.id);
            const selectable = isDraft || isSendable;
            const pushed = !!r.trcloudDocId;
            const pushErr = !pushed && !!r.trcloudError;
            return (
              <li key={r.id} className="flex items-stretch">
                {selectable && (
                  <label className="flex shrink-0 items-center pl-3">
                    <input
                      type="checkbox"
                      checked={checked.has(r.id)}
                      onChange={() => toggle(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      className={"size-4 " + (isDraft ? "accent-emerald-600" : "accent-blue-600")}
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
                    <div className="flex items-center gap-1.5">
                      {/* จุดสีภาษีซื้อ — โชว์ก็ต่อเมื่อตรวจแล้ว (undecided = ใบเก่า ไม่รก) */}
                      {r.completenessStatus !== "undecided" && (
                        <CompletenessDot
                          status={r.completenessStatus}
                          missing={r.completenessMissing}
                        />
                      )}
                      {isDraft && r.needsReview && (
                        <AlertTriangle
                          className="size-3.5 shrink-0 text-amber-500"
                          aria-label="ต้องตรวจ"
                        />
                      )}
                      <span className="truncate text-sm font-medium text-zinc-800">
                        {r.vendor || "ไม่ระบุผู้ขาย"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 truncate text-xs text-zinc-400">
                      <span className="font-mono">{r.docCode}</span>
                      {r.docDate && (
                        <span className="tabular-nums">· {r.docDate.slice(5)}</span>
                      )}
                      {r.categoryName && (
                        <Badge tone="neutral" className="text-[10px]">
                          {r.categoryName}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <div className="text-sm font-semibold tabular-nums text-zinc-900">
                      {baht(r.total)}
                    </div>
                    <div className="flex items-center gap-1">
                      {pushed && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1 py-0.5 text-[10px] font-semibold text-blue-700"
                          title={r.trcloudDocNo ? `TRCloud: ${r.trcloudDocNo}` : "ส่งเข้า TRCloud แล้ว"}
                        >
                          <CloudCheck className="size-3" /> TR
                        </span>
                      )}
                      {pushErr && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded bg-rose-50 px-1 py-0.5 text-[10px] font-semibold text-rose-700"
                          title={r.trcloudError ?? "ส่ง TRCloud ไม่สำเร็จ"}
                        >
                          <AlertTriangle className="size-3" /> TR
                        </span>
                      )}
                      <StatusBadge status={r.status} className="text-[10px]" />
                    </div>
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
