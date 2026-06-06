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
import { DocTag, PaymentTag } from "@/components/ledger/_kit/StatusTags";
import { LedgerEmptyState } from "@/components/ledger/Brand";
import { expenseConfirmability } from "@/lib/ledger/confirmability";
import { bulkConfirm, sendExpensesToTrcloud } from "../../_actions";
import type { ExpenseTab } from "../page";
import { FilterSheet } from "./FilterSheet";
import type { ExpenseRow, LedgerStatusValue } from "@/components/ledger/_kit/types";

// D4 source tabs — where did the receipt come from? Driven by ?tab=. Counts are
// DB-accurate (computed server-side in page.tsx, passed via tabCounts), not the
// 300-row cap, so the badges never under-report.
const SOURCE_TABS: Array<{ value: ExpenseTab; label: string }> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "line", label: "สแกนจาก LINE" },
  { value: "web", label: "เพิ่มเอง" },
  { value: "mine", label: "ส่วนตัว" },
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
  tab,
  tabCounts,
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
  /** D4 source tab (?tab=) — all | line | web | mine. */
  tab: ExpenseTab;
  /** DB-accurate per-tab counts (from page.tsx) for the badge on each source tab. */
  tabCounts: Record<ExpenseTab, number>;
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

  // Clear all four list filters in ONE push (sequential setParam calls each re-push
  // from the same baseParams snapshot, so only the last would actually apply).
  function clearFilters() {
    const sp = new URLSearchParams(baseParams);
    sp.delete("status");
    sp.delete("tr");
    sp.delete("cc");
    sp.delete("category");
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
        {/* D4 source tabs — ทั้งหมด / สแกนจาก LINE / เพิ่มเอง / ส่วนตัว, with
            DB-accurate count badges. WAI-ARIA tablist per project convention. */}
        <div
          className="flex flex-wrap gap-1"
          role="tablist"
          aria-label="กรองตามที่มาของใบเสร็จ"
        >
          {SOURCE_TABS.map((t) => {
            const active = tab === t.value;
            const count = tabCounts[t.value];
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setParam("tab", t.value === "all" ? "" : t.value)}
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-300)] " +
                  (active
                    ? "bg-[var(--color-brand-600)] text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200")
                }
              >
                {t.label}
                <span
                  className={
                    "inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums " +
                    (active ? "bg-white/25 text-white" : "bg-white text-zinc-500")
                  }
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* S2 — status / TRCloud / VAT-colour / category filters. Inline on lg+;
            on a phone they collapse into one "ตัวกรอง (n)" bottom-sheet so the
            list never stacks 4 dropdowns. cc (VAT 🟢🟡🔴) also lives in the
            SummaryStrip above, but stays reachable here too. */}
        <FilterSheet
          status={status}
          tr={tr}
          cc={cc}
          categoryId={categoryId}
          categories={categories}
          onSet={setParam}
          onClear={clearFilters}
        />

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
            {q || status || categoryId || tr || cc || tab !== "all" ? (
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
            // D1 surfacing — show legacy/incomplete rows missing สาขา/หมวด so they
            // can be remediated (some were confirmed before the gate existed).
            const gate = expenseConfirmability({
              branchId: r.branchId,
              categoryId: r.categoryId,
            });
            const confirmedByAcct = !!r.confirmedBy;
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
                {/* Column: clickable row (→ detail) + a non-nested chip-rail beneath.
                    The category chip is its own <Link>, so it CANNOT live inside the
                    row <Link> (nested <a> is invalid) — hence the rail is a sibling. */}
                <div className="min-w-0 flex-1">
                  <Link
                    href={rowHref(r.id)}
                    aria-current={active ? "true" : undefined}
                    className={
                      "flex min-w-0 items-center justify-between gap-2 px-3 pb-1 pt-2.5 transition-colors hover:bg-zinc-50 " +
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
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <div className="text-sm font-semibold tabular-nums text-zinc-900">
                        {baht(r.total)}
                      </div>
                      <StatusBadge status={r.status} className="text-[10px]" />
                    </div>
                  </Link>

                  {/* D3 chip-rail / "green zone" — one compact line of status signals.
                      Every coloured chip also carries a text label (a11y). */}
                  <div
                    className={
                      "flex flex-wrap items-center gap-1 px-3 pb-2 " +
                      (active ? "bg-[var(--color-brand-50)]" : "")
                    }
                  >
                    {/* ป้ายเอกสาร/ภาษีซื้อ (D3 pills · รู้จักใบเสนอราคา) + ป้ายจ่ายเงิน.
                        DocTag คืน null เองถ้า undecided (ใบเก่า) → ไม่รก. */}
                    <DocTag
                      docType={r.docType}
                      vat={r.vat}
                      completenessStatus={r.completenessStatus}
                      missing={r.completenessMissing}
                    />
                    {r.paymentStatus && r.paymentStatus !== "paid" && (
                      <PaymentTag status={r.paymentStatus} />
                    )}

                    {/* TRCloud send state */}
                    {pushed && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700"
                        title={r.trcloudDocNo ? `TRCloud: ${r.trcloudDocNo}` : "ส่งเข้า TRCloud แล้ว"}
                      >
                        <CloudCheck className="size-3" /> ส่ง TRCloud แล้ว
                      </span>
                    )}
                    {pushErr && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"
                        title={r.trcloudError ?? "ส่ง TRCloud ไม่สำเร็จ"}
                      >
                        <AlertTriangle className="size-3" /> ส่ง TRCloud พลาด
                      </span>
                    )}

                    {/* ยืนยันโดย — บัญชีรับรองแล้ว (confirmedBy present) */}
                    {confirmedByAcct && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <CheckCircle2 className="size-3" /> ยืนยันแล้ว
                      </span>
                    )}

                    {/* D1 confirm-gate warning — สาขา/หมวด ยังไม่ครบ (รวมใบเก่าที่
                        ยืนยันไว้ทั้งที่ยังว่าง → เห็นเพื่อตามแก้) */}
                    {!gate.ok && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        <AlertTriangle className="size-3" />
                        {gate.missing.includes("branch") && gate.missing.includes("category")
                          ? "ต้องระบุสาขา/หมวด"
                          : gate.missing.includes("branch")
                            ? "ต้องระบุสาขา"
                            : "ต้องระบุหมวด"}
                      </span>
                    )}

                    {/* Category chip — links into the category-ledger drill.
                        Its own <Link>, kept OUTSIDE the row <Link> above. */}
                    {r.categoryId && r.categoryName && (
                      <Link
                        href={`/ledger/categories/${r.categoryId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 hover:bg-zinc-200"
                        title={`ดูบัญชีแยกประเภท: ${r.categoryName}`}
                      >
                        {r.categoryName}
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
