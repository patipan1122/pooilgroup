"use client";

// Bills list — interactive layer over the server-rendered table:
//   • per-row checkboxes + "เลือกทั้งชั้น" (floor group) + select/clear all
//   • "พิมพ์หลายห้อง" → opens /rentspace/bills/print?ids=…
//   • "เตือนค้างชำระทั้งงวด" → actRemindOverdue, shows a copy-able link list
//   • "คำอธิบายสถานะบิล" legend popover
// Display-only: amounts come straight from the server rows (no recompute).

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Receipt, Printer, BellRing, Info, Copy, ExternalLink, X, Search, CalendarDays, Trash2 } from "lucide-react";
import { actRemindOverdue, actDeleteBillsBulk } from "../../_actions";
import { formatBaht, thaiDateLong, periodLabel, BILL_STATUS } from "@/lib/rentspace/format";
import { RsMobileCard, RsField, RsBadge } from "@/components/rentspace/ui";

export type BillRow = {
  id: string;
  billNo: string;
  period: string;
  unitCode: string;
  unitName: string | null;
  floorKey: string; // grouping key, e.g. "A · ชั้น 2" or "ชั้น 1" or "ไม่ระบุชั้น"
  tenantName: string;
  total: number;
  paid: number;
  remaining: number;
  dueDateISO: string | null;
  displayStatus: string; // already overdue-adjusted by the server
};

type RemindItem = { billId: string; code: string; tenantName: string; outstanding: number; url: string };

/**
 * เลือกเดือน (จุด 2) — native month picker that lets the admin jump to ANY month,
 * not only the recent-6 period chips. Navigates to ?period=YYYY-MM, preserving the
 * active status filter. Clearing it (native ✕) drops back to "ทุกเดือน".
 */
export function MonthPicker({ value, statusQS }: { value: string; statusQS?: string }) {
  const router = useRouter();
  function go(month: string) {
    const params = new URLSearchParams();
    if (statusQS) params.set("status", statusQS);
    if (/^\d{4}-\d{2}$/.test(month)) params.set("period", month);
    const qs = params.toString();
    router.push(qs ? `/rentspace/bills?${qs}` : "/rentspace/bills");
  }
  return (
    <label
      className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 min-h-[36px] text-[12.5px] font-medium cursor-pointer"
      style={{ background: "var(--rs-bg-2)", color: "var(--rs-text-2)", border: "1px solid var(--rs-border)" }}
      title="เลือกเดือนที่ต้องการดู"
    >
      <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
      เลือกเดือน
      <input
        type="month"
        aria-label="เลือกเดือนของบิล"
        value={value}
        onChange={(e) => go(e.target.value)}
        className="bg-transparent outline-none cursor-pointer"
        style={{ color: "var(--rs-text)", maxWidth: 130 }}
      />
    </label>
  );
}

export function BillsToolbar({
  projectId,
  period,
  selectedIds,
  canDelete,
  clearSelection,
}: {
  projectId: string;
  period: string;
  selectedIds: string[];
  canDelete: boolean;
  clearSelection: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [legendOpen, setLegendOpen] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const [items, setItems] = useState<RemindItem[]>([]);

  function openPrint() {
    if (selectedIds.length === 0) return toast.error("ยังไม่ได้เลือกบิล");
    const ids = selectedIds.join(",");
    window.open(`/rentspace/bills/print?ids=${encodeURIComponent(ids)}`, "_blank", "noopener");
  }

  // ลบหลายบิลพร้อมกัน — บิลที่จ่ายแล้วเซิร์ฟเวอร์จะข้ามให้ (ใช้ยกเลิกแทน · กันลบประวัติเงิน)
  function bulkDelete() {
    if (selectedIds.length === 0) return toast.error("ยังไม่ได้เลือกบิล");
    if (
      !confirm(
        `ลบ ${selectedIds.length} บิลที่เลือกถาวร?\n\n• บิลที่ "จ่ายแล้ว" จะถูกข้าม (ให้ใช้ปุ่ม "ยกเลิกบิล" แทน)\n• การลบนี้ย้อนกลับไม่ได้`,
      )
    )
      return;
    startDelete(async () => {
      try {
        const r = await actDeleteBillsBulk(selectedIds);
        const parts = [`ลบ ${r.deleted} บิลแล้ว`];
        if (r.skippedPaid > 0) parts.push(`ข้าม ${r.skippedPaid} ใบที่จ่ายแล้ว`);
        if (r.deleted > 0) toast.success(parts.join(" · "));
        else toast.info(parts.join(" · ") || "ไม่มีบิลที่ลบได้");
        clearSelection();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
      }
    });
  }

  function remind() {
    start(async () => {
      try {
        const r = await actRemindOverdue(projectId, period);
        setItems(r.items);
        setRemindOpen(true);
        if (r.count === 0) toast.info(`ไม่มีบิลค้างชำระในงวด ${periodLabel(period)}`);
        else toast.success(`เตรียมลิงก์เตือน ${r.count} ใบแล้ว`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "เตือนค้างชำระไม่สำเร็จ");
      }
    });
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("คัดลอกลิงก์แล้ว");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <button
        className="rs-btn rs-btn-ghost rs-btn-toolbar"
        onClick={openPrint}
        disabled={selectedIds.length === 0}
        aria-label={
          selectedIds.length === 0
            ? "พิมพ์หลายห้อง — เลือกบิลก่อน"
            : `พิมพ์หลายห้อง ${selectedIds.length} ใบ`
        }
        title={selectedIds.length === 0 ? "เลือกบิลก่อน" : undefined}
      >
        <Printer className="h-4 w-4" aria-hidden="true" /> พิมพ์หลายห้อง{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
      </button>

      {canDelete && (
        <button
          className="rs-btn rs-btn-ghost rs-btn-toolbar"
          onClick={bulkDelete}
          disabled={deleting || selectedIds.length === 0}
          aria-label={selectedIds.length === 0 ? "ลบบิลที่เลือก — เลือกบิลก่อน" : `ลบบิลที่เลือก ${selectedIds.length} ใบ`}
          aria-busy={deleting ? "true" : "false"}
          title={selectedIds.length === 0 ? "เลือกบิลก่อน" : "ลบบิลที่เลือก (บิลที่จ่ายแล้วจะถูกข้าม)"}
          style={{ color: "var(--rs-danger)" }}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" /> {deleting ? "กำลังลบ…" : `ลบที่เลือก${selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}`}
        </button>
      )}

      <button
        className="rs-btn rs-btn-ghost rs-btn-toolbar"
        onClick={remind}
        disabled={pending}
        aria-label={`เตือนค้างชำระทั้งงวด ${periodLabel(period)}`}
        aria-busy={pending ? "true" : "false"}
      >
        <BellRing className="h-4 w-4" aria-hidden="true" /> {pending ? "กำลังเตรียม…" : `เตือนค้างชำระทั้งงวด (${periodLabel(period)})`}
      </button>

      <div className="relative">
        <button
          className="rs-btn rs-btn-ghost rs-btn-toolbar"
          onClick={() => setLegendOpen((v) => !v)}
          aria-label="คำอธิบายสถานะบิล"
          aria-expanded={legendOpen}
          aria-haspopup="true"
        >
          <Info className="h-4 w-4" aria-hidden="true" /> คำอธิบายสถานะบิล
        </button>
        {legendOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setLegendOpen(false)} />
            <div
              className="absolute right-0 z-50 mt-2 w-64 rounded-xl p-3 shadow-lg"
              style={{ background: "#fff", border: "1px solid var(--rs-border)" }}
            >
              <div className="text-[12px] font-semibold mb-2" style={{ color: "var(--rs-text-2)" }}>
                สถานะบิล
              </div>
              <div className="space-y-1.5">
                {Object.entries(BILL_STATUS).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 rounded-full shrink-0"
                      style={{ background: v.color }}
                    />
                    <span className="text-[12.5px]" style={{ color: "var(--rs-text)" }}>
                      {v.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* remind result modal — ready-to-send list */}
      {remindOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onClick={() => setRemindOpen(false)}
        >
          <div
            className="rs-card w-full sm:max-w-lg rounded-b-none sm:rounded-2xl flex flex-col max-h-[88vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--rs-border)" }}>
              <div className="font-bold text-lg" style={{ color: "var(--rs-text)" }}>
                เตือนค้างชำระ · งวด {periodLabel(period)}
              </div>
              <button type="button" aria-label="ปิด" onClick={() => setRemindOpen(false)} className="p-1 rounded-lg hover:bg-black/5">
                <X className="h-5 w-5" style={{ color: "var(--rs-text-2)" }} />
              </button>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1">
              {items.length === 0 ? (
                <div className="py-8 text-center text-[13px]" style={{ color: "var(--rs-text-3)" }}>
                  ไม่มีบิลค้างชำระในงวดนี้ 🎉
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((it) => (
                    <div
                      key={it.billId}
                      className="rounded-xl p-3"
                      style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)" }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-medium truncate" style={{ color: "var(--rs-text)" }}>
                            {it.code} · {it.tenantName}
                          </div>
                          <div className="text-[12.5px]" style={{ color: "var(--rs-danger)" }}>
                            ค้าง {formatBaht(it.outstanding)}
                          </div>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            className="inline-flex items-center justify-center h-8 px-2.5 rounded-lg text-[12px] font-medium"
                            style={{ background: "var(--rs-brand)", color: "#fff" }}
                            onClick={() => copy(it.url)}
                          >
                            <Copy className="h-3.5 w-3.5 mr-1" /> คัดลอกลิงก์
                          </button>
                          <a
                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg"
                            style={{ background: "var(--rs-bg-3)", color: "var(--rs-text-2)" }}
                            href={it.url}
                            target="_blank"
                            rel="noreferrer"
                            title="เปิดดู"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </div>
                      <div className="text-[11px] mt-1.5 break-all" style={{ color: "var(--rs-text-3)" }}>
                        {it.url}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        /* Toolbar buttons must be ≥44px tap targets on phones. rs-btn fixes
           height:42px, so a min-height of 44 wins on small screens; from sm we
           drop back to the compact 42px desktop size. */
        :global(.rs-btn-toolbar) {
          min-height: 44px;
        }
        @media (min-width: 640px) {
          :global(.rs-btn-toolbar) {
            min-height: 0;
          }
        }
        /* Disabled toolbar buttons: the global ".rs-btn:disabled { opacity:.5 }"
           fades near-black text on the light ghost bg below WCAG AA (~3.4:1).
           Replace the faint fade with a slightly stronger opacity + an explicit
           AA-compliant text color (var(--rs-text-2) ≈ 7:1 on the ghost bg). */
        :global(.rs-btn-toolbar:disabled) {
          opacity: 0.75;
          color: var(--rs-text-2);
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

/** Full interactive bills table with selection + floor groups. */
export function BillsTable({
  projectId,
  period,
  rows,
  canDelete = false,
}: {
  projectId: string;
  period: string;
  rows: BillRow[];
  canDelete?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  // ค้นหาห้อง (จุด 4) — filter by room code/name, tenant, or bill number.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.unitCode.toLowerCase().includes(needle) ||
        (r.unitName?.toLowerCase().includes(needle) ?? false) ||
        r.tenantName.toLowerCase().includes(needle) ||
        r.billNo.toLowerCase().includes(needle),
    );
  }, [rows, query]);

  // group rows by floor for "เลือกทั้งชั้น"
  const groups = useMemo(() => {
    const map = new Map<string, BillRow[]>();
    for (const r of filtered) {
      const arr = map.get(r.floorKey) ?? [];
      arr.push(r);
      map.set(r.floorKey, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const allIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  function toggleFloor(floorKey: string, ids: string[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <BillsToolbar
        projectId={projectId}
        period={period}
        selectedIds={Array.from(selected)}
        canDelete={canDelete}
        clearSelection={() => setSelected(new Set())}
      />

      <div className="rs-card overflow-hidden">
        {/* ค้นหาห้อง (จุด 4) */}
        <div className="px-3 py-2.5 border-b print:hidden" style={{ borderColor: "var(--rs-border)" }}>
          <div className="relative w-full sm:max-w-xs">
            <Search
              className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: "var(--rs-text-3)" }}
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาห้อง / ผู้เช่า / เลขบิล"
              aria-label="ค้นหาห้อง ผู้เช่า หรือเลขบิล"
              className="w-full h-9 rounded-lg pl-9 pr-3 text-[13px] outline-none"
              style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)", color: "var(--rs-text)" }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 border-b print:hidden" style={{ borderColor: "var(--rs-border)" }}>
          <label className="inline-flex items-center gap-2 text-[12.5px] font-medium cursor-pointer" style={{ color: "var(--rs-text-2)" }}>
            <input
              type="checkbox"
              aria-label={allSelected ? "ไม่เลือกบิลทั้งหมด" : "เลือกบิลทั้งหมด"}
              checked={allSelected}
              onChange={toggleAll}
              className="rs-chk"
            />
            {allSelected ? "ไม่เลือกทั้งหมด" : "เลือกทั้งหมด"}
          </label>
          <span className="text-[12.5px]" style={{ color: "var(--rs-text-3)" }}>
            {selected.size > 0 ? `เลือกแล้ว ${selected.size} ใบ` : query.trim() ? `พบ ${filtered.length} ใบ` : null}
          </span>
        </div>

        {/* desktop table — hidden on phones (the wide grid crushes <lg) */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="rs-table w-full text-sm">
            <thead>
              <tr style={{ color: "var(--rs-text-2)" }} className="text-left text-[12.5px]">
                <th className="px-3 py-2.5 font-semibold w-9 print:hidden">
                  <span className="sr-only">เลือก</span>
                </th>
                <th className="px-4 py-2.5 font-semibold">เลขที่บิล</th>
                <th className="px-4 py-2.5 font-semibold">ห้อง / ผู้เช่า</th>
                <th className="px-4 py-2.5 font-semibold">งวด</th>
                <th className="px-4 py-2.5 font-semibold text-right">ยอดรวม</th>
                <th className="px-4 py-2.5 font-semibold text-right">จ่ายแล้ว</th>
                <th className="px-4 py-2.5 font-semibold text-right">คงเหลือ</th>
                <th className="px-4 py-2.5 font-semibold">ครบกำหนด</th>
                <th className="px-4 py-2.5 font-semibold">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-[13px]" style={{ color: "var(--rs-text-3)" }}>
                    ไม่พบห้องที่ตรงกับ “{query.trim()}”
                  </td>
                </tr>
              )}
              {groups.map(([floorKey, groupRows]) => {
                const ids = groupRows.map((r) => r.id);
                const floorAllOn = ids.every((id) => selected.has(id));
                return (
                  <FloorGroup
                    key={floorKey}
                    floorKey={floorKey}
                    rows={groupRows}
                    selected={selected}
                    floorAllOn={floorAllOn}
                    onToggleFloor={() => toggleFloor(floorKey, ids)}
                    onToggleRow={toggle}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {/* mobile card stack — same state/selection as the desktop table */}
        <div className="lg:hidden p-3 space-y-2">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-[13px]" style={{ color: "var(--rs-text-3)" }}>
              {query.trim() ? `ไม่พบห้องที่ตรงกับ “${query.trim()}”` : "ไม่มีบิล"}
            </div>
          ) : (
            groups.map(([floorKey, groupRows]) => {
              const ids = groupRows.map((r) => r.id);
              const floorAllOn = ids.every((id) => selected.has(id));
              return (
                <div key={floorKey} className="space-y-2">
                  {/* floor header + เลือกทั้งชั้น */}
                  <button
                    type="button"
                    onClick={() => toggleFloor(floorKey, ids)}
                    aria-pressed={floorAllOn}
                    aria-label={`เลือกทั้งชั้น ${floorKey} (${groupRows.length} ใบ)`}
                    className="flex w-full items-center gap-2 rounded-lg px-2 min-h-[44px] text-left"
                    style={{ background: "var(--rs-bg-2)" }}
                  >
                    <input
                      type="checkbox"
                      tabIndex={-1}
                      aria-hidden="true"
                      checked={floorAllOn}
                      readOnly
                      className="rs-chk pointer-events-none"
                    />
                    <span className="text-[12.5px] font-semibold" style={{ color: "var(--rs-text-2)" }}>
                      {floorKey}
                    </span>
                    <span className="text-[12px] font-normal" style={{ color: "var(--rs-text-3)" }}>
                      · เลือกทั้งชั้น ({groupRows.length})
                    </span>
                  </button>

                  {groupRows.map((b) => (
                    <MobileBillCard
                      key={b.id}
                      bill={b}
                      checked={selected.has(b.id)}
                      onToggle={() => toggle(b.id)}
                    />
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>

      <style jsx>{`
        :global(.rs-chk) {
          /* 16px visual box, but a 40×40 tappable target (WCAG 2.5.8 / touch).
             Negative margin keeps the table rows visually compact. */
          width: 16px;
          height: 16px;
          padding: 12px;
          margin: -12px;
          box-sizing: content-box;
          accent-color: var(--rs-brand);
          cursor: pointer;
        }
        :global(.rs-chk:focus-visible) {
          outline: 2px solid var(--rs-brand);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}

function FloorGroup({
  floorKey,
  rows,
  selected,
  floorAllOn,
  onToggleFloor,
  onToggleRow,
}: {
  floorKey: string;
  rows: BillRow[];
  selected: Set<string>;
  floorAllOn: boolean;
  onToggleFloor: () => void;
  onToggleRow: (id: string) => void;
}) {
  return (
    <>
      <tr style={{ background: "var(--rs-bg-2)" }} className="print:hidden">
        <td className="px-3 py-1.5">
          <input
            type="checkbox"
            aria-label={`เลือกทั้งชั้น ${floorKey}`}
            checked={floorAllOn}
            onChange={onToggleFloor}
            className="rs-chk"
          />
        </td>
        <td colSpan={8} className="px-4 py-1.5">
          <button
            type="button"
            className="text-[12px] font-semibold inline-flex items-center gap-1.5 min-h-[40px]"
            style={{ color: "var(--rs-text-2)" }}
            aria-label={`เลือกทั้งชั้น ${floorKey} (${rows.length} ใบ)`}
            aria-pressed={floorAllOn}
            onClick={onToggleFloor}
          >
            {floorKey}
            <span className="font-normal" style={{ color: "var(--rs-text-3)" }}>
              · เลือกทั้งชั้น ({rows.length})
            </span>
          </button>
        </td>
      </tr>
      {rows.map((b) => (
        <tr
          key={b.id}
          className="border-t hover:bg-[var(--rs-bg-2)] transition"
          style={{ borderColor: "var(--rs-border)" }}
        >
          <td className="px-3 py-3 print:hidden">
            <input
              type="checkbox"
              aria-label={`เลือกบิล ${b.billNo}`}
              checked={selected.has(b.id)}
              onChange={() => onToggleRow(b.id)}
              className="rs-chk"
            />
          </td>
          <td className="px-4 py-3">
            <Link
              href={`/rentspace/bills/${b.id}`}
              className="font-semibold inline-flex items-center gap-1.5"
              style={{ color: "var(--rs-brand)" }}
            >
              <Receipt className="h-3.5 w-3.5" /> {b.billNo}
            </Link>
          </td>
          <td className="px-4 py-3" style={{ color: "var(--rs-text)" }}>
            {b.unitCode}
            <span style={{ color: "var(--rs-text-3)" }}>{" · "}{b.tenantName}</span>
          </td>
          <td className="px-4 py-3 text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
            {periodLabel(b.period)}
          </td>
          <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--rs-text)" }}>
            {formatBaht(b.total)}
          </td>
          <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--rs-text-2)" }}>
            {formatBaht(b.paid)}
          </td>
          <td
            className="px-4 py-3 text-right tabular-nums font-semibold"
            style={{ color: b.remaining > 0 ? "var(--rs-danger)" : "var(--rs-text-3)" }}
          >
            {formatBaht(b.remaining)}
          </td>
          <td
            className="px-4 py-3 text-[12.5px]"
            style={{ color: b.displayStatus === "overdue" ? "var(--rs-danger)" : "var(--rs-text-2)" }}
          >
            {b.dueDateISO ? thaiDateLong(new Date(b.dueDateISO)) : "—"}
          </td>
          <td className="px-4 py-3">
            <StatusChip status={b.displayStatus} />
          </td>
        </tr>
      ))}
    </>
  );
}

/**
 * Mobile bill card — checkbox (≥44px tap, does NOT navigate) on the left, and the
 * rest of the card taps through to the bill detail. Selection drives the SAME
 * `selected` Set as the desktop table, so bulk-delete works on phones too.
 */
function MobileBillCard({
  bill: b,
  checked,
  onToggle,
}: {
  bill: BillRow;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rs-card flex items-stretch gap-1 p-0 overflow-hidden">
      {/* select checkbox — separate tap target, stops navigation */}
      <label
        className="flex shrink-0 items-start justify-center pl-3 pt-3.5 cursor-pointer"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          aria-label={`เลือกบิล ${b.billNo}`}
          checked={checked}
          onChange={onToggle}
          className="rs-chk"
        />
      </label>

      {/* body taps through to the bill */}
      <Link href={`/rentspace/bills/${b.id}`} className="block flex-1 min-w-0 p-3.5 pl-1.5 active:bg-[var(--rs-bg-2)]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[15px] font-semibold" style={{ color: "var(--rs-brand)" }}>
              <Receipt className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{b.billNo}</span>
            </div>
            <div className="mt-0.5 truncate text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
              {b.unitCode}
              {b.tenantName ? <span style={{ color: "var(--rs-text-3)" }}>{" · "}{b.tenantName}</span> : null}
            </div>
          </div>
          <div className="shrink-0 text-right space-y-1">
            <RsBadge kind="bill" status={b.displayStatus} />
            <div className="text-[15px] font-bold tabular-nums" style={{ color: "var(--rs-text)" }}>
              {formatBaht(b.total)}
            </div>
          </div>
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
          <RsField label="งวด" value={periodLabel(b.period)} />
          <RsField
            label="กำหนดชำระ"
            value={b.dueDateISO ? thaiDateLong(new Date(b.dueDateISO)) : "—"}
            align="right"
            tone={b.displayStatus === "overdue" ? "danger" : undefined}
          />
          <RsField label="ชำระแล้ว" value={formatBaht(b.paid)} tone="muted" />
          <RsField
            label="ค้างชำระ"
            value={formatBaht(b.remaining)}
            align="right"
            tone={b.remaining > 0 ? "danger" : "muted"}
          />
        </div>
      </Link>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const t = BILL_STATUS[status] ?? { label: status, color: "var(--rs-text-3)", soft: "var(--rs-bg-3)" };
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
      style={{ background: t.soft, color: t.color }}
    >
      {t.label}
    </span>
  );
}
