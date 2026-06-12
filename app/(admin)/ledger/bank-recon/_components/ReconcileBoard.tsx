"use client";

// ReconcileBoard — PEAK-parity 2-column bank reconciliation.
//   รอกระทบยอด: LEFT รายการบันทึกบัญชี (book) | RIGHT รายการเคลื่อนไหว (bank)
//     → ติ๊กเลือกทั้ง 2 ฝั่ง (รองรับหลายต่อหลาย) → "จับคู่" → ไปรอยืนยัน
//   รอยืนยัน: กลุ่มที่จับคู่แล้ว → "กระทบยอดทั้งหมด" → เสร็จ
// Auto-match (PEAK step 1) + manual select (PEAK manual) + เพิ่มรายการ/รายได้.

import { useState, useMemo, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles, Plus, Link2, Ban, X, Check, Trash2, RefreshCw, Search,
  MoreVertical, ArrowLeftRight, FilePlus2, Pencil, CalendarClock, ArrowDownWideNarrow,
} from "lucide-react";
import {
  createMatchGroupAction, autoMatchAccountAction, confirmAllGroupsAction,
  removeGroupAction, addBankMovementAction, addRevenueEntryAction,
  excludeTxnAction, syncRevenueRangeAction,
} from "../_actions";
import {
  transferMovementAction, createRevenueFromMovementAction, createExpenseFromMovementAction,
  editMovementAction, deleteMovementAction, listTransferTargetsAction,
} from "../_movement-actions";

const todayISO = () => new Date().toISOString().slice(0, 10);
type SortMode = "date" | "high" | "low";

interface BookEntry {
  bookId: string; bookType: "revenue" | "expense" | "payment";
  date: string; docNo: string; contact: string; detail: string; amountSatang: number; sub: string;
}
interface BankMovement {
  id: string; date: string; description: string; txnType: string; ref1: string | null; amountSatang: number;
}
interface GroupItem {
  kind: "bank" | "book"; bankTxnId: string | null; bookType: string | null;
  bookId: string | null; bookDocNo: string | null; label: string; date: string | null; amountSatang: number;
}
interface MatchGroup {
  id: string; status: string; matchKind: string;
  bankTotalSatang: number; bookTotalSatang: number; deltaSatang: number; items: GroupItem[];
}

interface Props {
  bankAccountId: string;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  bookEntries: BookEntry[];
  bankMovements: BankMovement[];
  suggestedGroups: MatchGroup[];
}

function baht(satang: number): string {
  return (Math.abs(satang) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const SOURCE_LABEL: Record<string, string> = {
  TRCLOUD_IV: "TRCloud", CHAIROPS: "ChairOps", CLAWFLEET: "ClawFleet",
  FUELOS: "FuelOS", WEBHOOK: "Webhook", MANUAL: "บันทึกเอง",
  revenue: "รายได้", expense: "ค่าใช้จ่าย", payment: "จ่ายเงิน",
};

export function ReconcileBoard({
  bankAccountId, companyId, periodStart, periodEnd,
  bookEntries, bankMovements, suggestedGroups,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"match" | "confirm">("match");
  const [selBank, setSelBank] = useState<Set<string>>(new Set());
  const [selBook, setSelBook] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "bank" | "revenue" | { kind: "transfer" | "edit"; m: BankMovement }>(null);
  const [qBook, setQBook] = useState("");
  const [qBank, setQBank] = useState("");
  const [todayBook, setTodayBook] = useState(false);
  const [todayBank, setTodayBank] = useState(false);
  const [sortBook, setSortBook] = useState<SortMode>("date");
  const [sortBank, setSortBank] = useState<SortMode>("date");

  const bookKey = (b: { bookType: string; bookId: string }) => `${b.bookType}:${b.bookId}`;
  const today = todayISO();

  const sortRows = <T extends { amountSatang: number; date: string }>(rows: T[], mode: SortMode): T[] => {
    if (mode === "high") return [...rows].sort((a, b) => Math.abs(b.amountSatang) - Math.abs(a.amountSatang));
    if (mode === "low") return [...rows].sort((a, b) => Math.abs(a.amountSatang) - Math.abs(b.amountSatang));
    return rows;
  };

  // search + วันนี้ filter + sort (PEAK: ค้นหา · ฟิลเตอร์วันนี้ · ดูยอดมาก/น้อย)
  const fBook = useMemo(() => {
    const q = qBook.trim().toLowerCase();
    let r = bookEntries;
    if (q) r = r.filter((b) => `${b.docNo} ${b.contact} ${b.detail} ${b.amountSatang / 100}`.toLowerCase().includes(q));
    if (todayBook) r = r.filter((b) => b.date === today);
    return sortRows(r, sortBook);
  }, [qBook, bookEntries, todayBook, sortBook, today]);
  const fBank = useMemo(() => {
    const q = qBank.trim().toLowerCase();
    let r = bankMovements;
    if (q) r = r.filter((m) => `${m.description} ${m.txnType} ${m.ref1 ?? ""} ${m.amountSatang / 100}`.toLowerCase().includes(q));
    if (todayBank) r = r.filter((m) => m.date === today);
    return sortRows(r, sortBank);
  }, [qBank, bankMovements, todayBank, sortBank, today]);

  // select-all (เลือกทั้งหมดที่กรองอยู่)
  const allBookSelected = fBook.length > 0 && fBook.every((b) => selBook.has(bookKey(b)));
  const allBankSelected = fBank.length > 0 && fBank.every((m) => selBank.has(m.id));
  const toggleAllBook = () => setSelBook((p) => {
    const n = new Set(p);
    if (allBookSelected) fBook.forEach((b) => n.delete(bookKey(b)));
    else fBook.forEach((b) => n.add(bookKey(b)));
    return n;
  });
  const toggleAllBank = () => setSelBank((p) => {
    const n = new Set(p);
    if (allBankSelected) fBank.forEach((m) => n.delete(m.id));
    else fBank.forEach((m) => n.add(m.id));
    return n;
  });

  const selBankTotal = useMemo(
    () => bankMovements.filter((m) => selBank.has(m.id)).reduce((s, m) => s + m.amountSatang, 0),
    [selBank, bankMovements],
  );
  const selBookTotal = useMemo(
    () => bookEntries.filter((b) => selBook.has(bookKey(b))).reduce((s, b) => s + b.amountSatang, 0),
    [selBook, bookEntries],
  );
  const delta = selBankTotal - selBookTotal;
  const hasSelection = selBank.size > 0 && selBook.size > 0;

  function toggleBank(id: string) {
    setSelBank((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleBook(k: string) {
    setSelBook((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }
  function clearSel() { setSelBank(new Set()); setSelBook(new Set()); }

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setErr(null);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) { after?.(); router.refresh(); }
      else setErr(r.error ?? "ทำรายการไม่สำเร็จ");
    });
  };

  const handleMatch = () => run(
    () => createMatchGroupAction({
      bankAccountId,
      bankTxnIds: [...selBank],
      bookRefs: bookEntries.filter((b) => selBook.has(bookKey(b))).map((b) => ({ bookType: b.bookType, bookId: b.bookId })),
    }),
    clearSel,
  );
  const handleAuto = () => run(() => autoMatchAccountAction(bankAccountId, companyId, periodStart, periodEnd).then((r) => ({ ok: r.ok, error: r.error })));
  const handleConfirmAll = () => run(() => confirmAllGroupsAction(bankAccountId).then((r) => ({ ok: r.ok, error: r.error })));
  const handleRemove = (gid: string) => run(() => removeGroupAction(gid));
  const handleExclude = (txnId: string) => {
    const reason = window.prompt("เหตุผลที่ข้าม (ค่าธรรมเนียม/ดอกเบี้ย/โอนภายใน):");
    if (!reason?.trim()) return;
    run(() => excludeTxnAction({ bankTxnId: txnId, reason: reason.trim() }));
  };
  const handleSync = () => run(() => syncRevenueRangeAction({ companyId, periodStart, periodEnd }).then((r) => ({ ok: r.ok, error: r.error })));

  // per-movement actions (PEAK "ทำรายการ")
  const handleCreateRevenue = (id: string) => run(() => createRevenueFromMovementAction({ bankTxnId: id }));
  const handleCreateExpense = (id: string) => run(() => createExpenseFromMovementAction({ bankTxnId: id }));
  const handleDeleteMovement = (id: string) => {
    if (!window.confirm("ลบรายการที่เพิ่มเองนี้?")) return;
    run(() => deleteMovementAction(id));
  };

  const matchTotal = bankMovements.length + bookEntries.length;
  const isLocked = false; // lock reworking for date-range mode (handled in overview)

  return (
    <div>
      {/* Tabs */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-zinc-100 p-1">
          <button
            onClick={() => setTab("match")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium ${tab === "match" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"}`}
          >
            รอกระทบยอด
            <span className="ml-1.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-600">{bankMovements.length}</span>
          </button>
          <button
            onClick={() => setTab("confirm")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium ${tab === "confirm" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"}`}
          >
            รอยืนยัน
            <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-600">{suggestedGroups.length}</span>
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!isLocked && (
            <>
              <button onClick={handleSync} disabled={pending}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50">
                <RefreshCw size={12} className={pending ? "animate-spin" : ""} /> ดึงรายได้ TRCloud
              </button>
              <button onClick={handleAuto} disabled={pending}
                className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50">
                <Sparkles size={12} /> จับคู่อัตโนมัติ
              </button>
            </>
          )}
        </div>
      </div>

      {err && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}

      {tab === "match" ? (
        <>
          {matchTotal === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-16 text-center">
              <Check size={28} className="mx-auto mb-2 text-emerald-400" />
              <p className="text-sm text-zinc-600">กระทบยอดครบทุกรายการแล้ว</p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* LEFT — book */}
              <Column
                title="รายการบันทึกบัญชี"
                count={fBook.length}
                selTotal={selBookTotal}
                accent="blue"
                onAdd={() => setModal("revenue")}
                addLabel="เพิ่มรายได้"
                search={qBook}
                onSearch={setQBook}
                searchPlaceholder="ค้นหาเลขเอกสาร / ผู้ติดต่อ"
                allSelected={allBookSelected}
                onToggleAll={toggleAllBook}
                today={todayBook}
                onToday={() => setTodayBook((v) => !v)}
                sort={sortBook}
                onSort={setSortBook}
              >
                {fBook.map((b) => {
                  const k = bookKey(b);
                  return (
                    <Row
                      key={k}
                      checked={selBook.has(k)}
                      onToggle={() => toggleBook(k)}
                      date={b.date}
                      title={b.contact || b.docNo || SOURCE_LABEL[b.sub] || "—"}
                      subtitle={b.docNo}
                      detail={b.detail}
                      tag={SOURCE_LABEL[b.bookType] ?? b.bookType}
                      amountSatang={b.amountSatang}
                    />
                  );
                })}
                {fBook.length === 0 && <Empty text="ไม่มีรายการบัญชีค้าง" />}
              </Column>

              {/* RIGHT — bank */}
              <Column
                title="รายการเคลื่อนไหว (ธนาคาร)"
                count={fBank.length}
                selTotal={selBankTotal}
                accent="emerald"
                onAdd={() => setModal("bank")}
                addLabel="เพิ่มรายการ"
                search={qBank}
                onSearch={setQBank}
                searchPlaceholder="ค้นหาหมายเหตุ / ref"
                allSelected={allBankSelected}
                onToggleAll={toggleAllBank}
                today={todayBank}
                onToday={() => setTodayBank((v) => !v)}
                sort={sortBank}
                onSort={setSortBank}
              >
                {fBank.map((m) => (
                  <Row
                    key={m.id}
                    checked={selBank.has(m.id)}
                    onToggle={() => toggleBank(m.id)}
                    date={m.date}
                    title={m.description || "รายการธนาคาร"}
                    subtitle={[m.txnType, m.ref1].filter(Boolean).join(" · ")}
                    amountSatang={m.amountSatang}
                    menu={
                      <RowMenu
                        isCredit={m.amountSatang > 0}
                        pending={pending}
                        onTransfer={() => setModal({ kind: "transfer", m })}
                        onCreateBook={() => (m.amountSatang > 0 ? handleCreateRevenue(m.id) : handleCreateExpense(m.id))}
                        onExclude={() => handleExclude(m.id)}
                        onEdit={() => setModal({ kind: "edit", m })}
                        onDelete={() => handleDeleteMovement(m.id)}
                      />
                    }
                  />
                ))}
                {fBank.length === 0 && <Empty text="ไม่มีรายการธนาคารค้าง" />}
              </Column>
            </div>
          )}

          {/* sticky action bar */}
          {hasSelection && !isLocked && (
            <div className="sticky bottom-3 mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-lg">
              <span className="text-sm text-zinc-600">
                เลือก: บัญชี <b>{selBook.size}</b> · ธนาคาร <b>{selBank.size}</b>
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${delta === 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {delta === 0 ? "ยอดตรงกัน" : `ต่างกัน ฿${baht(delta)}`}
              </span>
              <div className="ml-auto flex gap-2">
                <button onClick={clearSel} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50">
                  ล้าง
                </button>
                <button onClick={handleMatch} disabled={pending}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  <Link2 size={14} /> จับคู่ → รอยืนยัน
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* ── รอยืนยัน ── */
        <div>
          {suggestedGroups.length > 0 && !isLocked && (
            <div className="mb-3 flex justify-end">
              <button onClick={handleConfirmAll} disabled={pending}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                <Check size={14} /> กระทบยอดทั้งหมด ({suggestedGroups.length})
              </button>
            </div>
          )}
          {suggestedGroups.length === 0 ? (
            <Empty text="ไม่มีรายการรอยืนยัน — จับคู่จากแท็บ ‘รอกระทบยอด’ ก่อน" big />
          ) : (
            <div className="space-y-3">
              {suggestedGroups.map((g) => (
                <div key={g.id} className="rounded-2xl border border-zinc-100 bg-white p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <GroupSide title="บัญชี" items={g.items.filter((i) => i.kind === "book")} accent="blue" />
                    <GroupSide title="ธนาคาร" items={g.items.filter((i) => i.kind === "bank")} accent="emerald" />
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-zinc-50 pt-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${g.deltaSatang === 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {g.deltaSatang === 0 ? "ยอดตรงกัน" : `ต่างกัน ฿${baht(g.deltaSatang)}`}
                    </span>
                    {g.matchKind === "auto" && <span className="text-[11px] text-violet-500">จับคู่อัตโนมัติ</span>}
                    {!isLocked && (
                      <button onClick={() => handleRemove(g.id)} disabled={pending}
                        className="ml-auto inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-500 hover:bg-zinc-50">
                        <Trash2 size={12} /> นำออก
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {modal === "bank" && (
        <AddBankModal bankAccountId={bankAccountId} companyId={companyId}
          periodStart={periodStart} periodEnd={periodEnd}
          onClose={() => setModal(null)} onDone={() => { setModal(null); router.refresh(); }} />
      )}
      {modal === "revenue" && (
        <AddRevenueModal companyId={companyId}
          onClose={() => setModal(null)} onDone={() => { setModal(null); router.refresh(); }} />
      )}
      {modal && typeof modal === "object" && modal.kind === "transfer" && (
        <TransferModal mv={modal.m} companyId={companyId} bankAccountId={bankAccountId}
          onClose={() => setModal(null)} onDone={() => { setModal(null); router.refresh(); }} />
      )}
      {modal && typeof modal === "object" && modal.kind === "edit" && (
        <EditMovementModal mv={modal.m}
          onClose={() => setModal(null)} onDone={() => { setModal(null); router.refresh(); }} />
      )}
    </div>
  );
}

// ── building blocks ───────────────────────────────────────────────────────────
const SORT_LABEL: Record<SortMode, string> = { date: "วันที่", high: "ยอดมาก→น้อย", low: "ยอดน้อย→มาก" };
const nextSort: Record<SortMode, SortMode> = { date: "high", high: "low", low: "date" };

function Column({
  title, count, selTotal, accent, onAdd, addLabel, search, onSearch, searchPlaceholder,
  allSelected, onToggleAll, today, onToday, sort, onSort, children,
}: {
  title: string; count: number; selTotal: number; accent: "blue" | "emerald";
  onAdd?: () => void; addLabel: string;
  search: string; onSearch: (v: string) => void; searchPlaceholder: string;
  allSelected: boolean; onToggleAll: () => void;
  today: boolean; onToday: () => void; sort: SortMode; onSort: (s: SortMode) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-100 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-50 px-4 py-3">
        <div>
          <span className="text-sm font-semibold text-zinc-700">{title}</span>
          <span className="ml-1.5 text-xs text-zinc-400">({count})</span>
        </div>
        <div className="flex items-center gap-2">
          {selTotal !== 0 && (
            <span className={`text-xs font-medium ${accent === "blue" ? "text-blue-600" : "text-emerald-600"}`}>
              เลือก ฿{baht(selTotal)}
            </span>
          )}
          {onAdd && (
            <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50">
              <Plus size={12} /> {addLabel}
            </button>
          )}
        </div>
      </div>
      {/* search */}
      <div className="px-3 pt-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2 py-1">
          <Search size={13} className="text-zinc-400" />
          <input
            aria-label={searchPlaceholder}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent text-xs text-zinc-700 outline-none"
          />
        </div>
      </div>
      {/* filter chips: select-all · วันนี้ · sort */}
      <div className="flex items-center gap-1.5 border-b border-zinc-50 px-3 py-2">
        <button type="button" onClick={onToggleAll}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50">
          <input type="checkbox" readOnly checked={allSelected} className="size-3 rounded border-zinc-300" aria-hidden />
          เลือกทั้งหมด
        </button>
        <button type="button" onClick={onToday}
          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${today ? "border-blue-200 bg-blue-50 text-blue-600" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>
          <CalendarClock size={11} /> วันนี้
        </button>
        <button type="button" onClick={() => onSort(nextSort[sort])}
          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${sort !== "date" ? "border-blue-200 bg-blue-50 text-blue-600" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>
          <ArrowDownWideNarrow size={11} /> {SORT_LABEL[sort]}
        </button>
      </div>
      <div className="max-h-[54vh] divide-y divide-zinc-50 overflow-y-auto">{children}</div>
    </div>
  );
}

function Row({ checked, onToggle, disabled, date, title, subtitle, detail, tag, amountSatang, menu }: {
  checked: boolean; onToggle: () => void; disabled?: boolean;
  date: string; title: string; subtitle?: string; detail?: string; tag?: string; amountSatang: number; menu?: React.ReactNode;
}) {
  const credit = amountSatang > 0;
  return (
    <div className={`flex items-start gap-2 px-3 py-2.5 ${checked ? "bg-blue-50/60" : "hover:bg-zinc-50"}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} disabled={disabled}
        className="mt-0.5 size-4 shrink-0 rounded border-zinc-300 disabled:opacity-40" />
      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => !disabled && onToggle()}>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-zinc-400">{date}</span>
          {tag && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">{tag}</span>}
        </div>
        <p className="truncate text-sm text-zinc-700">{title}</p>
        {subtitle && <p className="truncate text-xs text-zinc-500">{subtitle}</p>}
        {detail && <p className="truncate text-[11px] text-zinc-400">{detail}</p>}
      </div>
      <div className="flex shrink-0 items-start gap-1">
        <p className={`text-sm font-semibold ${credit ? "text-emerald-600" : "text-rose-600"}`}>
          {credit ? "+" : "−"}฿{baht(amountSatang)}
        </p>
        {menu}
      </div>
    </div>
  );
}

// ── per-movement action menu (PEAK "ทำรายการ") ────────────────────────────────
function RowMenu({ isCredit, pending, onTransfer, onCreateBook, onExclude, onEdit, onDelete }: {
  isCredit: boolean; pending: boolean;
  onTransfer: () => void; onCreateBook: () => void; onExclude: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const item = (icon: React.ReactNode, label: string, fn: () => void, danger?: boolean) => (
    <button type="button" disabled={pending}
      onClick={() => { setOpen(false); fn(); }}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-zinc-50 disabled:opacity-50 ${danger ? "text-rose-600" : "text-zinc-700"}`}>
      {icon} {label}
    </button>
  );
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label="ทำรายการ" onClick={() => setOpen((v) => !v)}
        className="grid size-6 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
        <MoreVertical size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-20 w-48 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
          {item(<FilePlus2 size={13} className="text-blue-500" />, isCredit ? "บันทึกเป็นรายได้" : "บันทึกเป็นค่าใช้จ่าย", onCreateBook)}
          {item(<ArrowLeftRight size={13} className="text-violet-500" />, "โอนเงิน (ระหว่างบัญชี)", onTransfer)}
          {item(<Ban size={13} className="text-amber-500" />, "ข้าม / ไม่มีคู่", onExclude)}
          <div className="my-1 border-t border-zinc-100" />
          {item(<Pencil size={13} className="text-zinc-400" />, "แก้ไข (เฉพาะเพิ่มเอง)", onEdit)}
          {item(<Trash2 size={13} />, "ลบ (เฉพาะเพิ่มเอง)", onDelete, true)}
        </div>
      )}
    </div>
  );
}

function GroupSide({ title, items, accent }: { title: string; items: GroupItem[]; accent: "blue" | "emerald" }) {
  return (
    <div>
      <p className={`mb-1 text-[11px] font-semibold ${accent === "blue" ? "text-blue-600" : "text-emerald-600"}`}>{title}</p>
      <div className="space-y-1">
        {items.map((i, idx) => (
          <div key={idx} className="flex items-center justify-between rounded-lg bg-zinc-50 px-2.5 py-1.5">
            <span className="truncate text-xs text-zinc-600">{i.date ? `${i.date} · ` : ""}{i.label}</span>
            <span className={`ml-2 shrink-0 text-xs font-medium ${i.amountSatang > 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {i.amountSatang > 0 ? "+" : "−"}฿{baht(i.amountSatang)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty({ text, big }: { text: string; big?: boolean }) {
  return <p className={`text-center text-sm text-zinc-400 ${big ? "py-16" : "py-8"}`}>{text}</p>;
}

// ── modals ────────────────────────────────────────────────────────────────────
function AddBankModal({ bankAccountId, companyId, periodStart, periodEnd, onClose, onDone }: {
  bankAccountId: string; companyId: string; periodStart: string; periodEnd: string;
  onClose: () => void; onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [dir, setDir] = useState<"in" | "out">("out");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    const n = Math.round(parseFloat(amount) * 100);
    if (!date || isNaN(n) || n <= 0) { setErr("กรอกวันที่และจำนวนเงินให้ถูกต้อง"); return; }
    start(async () => {
      const r = await addBankMovementAction({
        bankAccountId, companyId, periodStart, periodEnd,
        date, amountSatang: dir === "in" ? n : -n, description: desc,
      });
      if (r.ok) onDone(); else setErr(r.error ?? "บันทึกไม่สำเร็จ");
    });
  };
  return (
    <Modal title="เพิ่มรายการเคลื่อนไหว (ธนาคาร)" onClose={onClose}>
      <div className="mb-2 flex gap-1 rounded-lg bg-zinc-100 p-1">
        <button onClick={() => setDir("in")} className={`flex-1 rounded-md py-1.5 text-sm ${dir === "in" ? "bg-white shadow-sm text-emerald-600 font-medium" : "text-zinc-500"}`}>เงินเข้า</button>
        <button onClick={() => setDir("out")} className={`flex-1 rounded-md py-1.5 text-sm ${dir === "out" ? "bg-white shadow-sm text-rose-600 font-medium" : "text-zinc-500"}`}>เงินออก</button>
      </div>
      <Field label="วันที่"><input aria-label="วันที่" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></Field>
      <Field label="จำนวนเงิน (บาท)"><input aria-label="จำนวนเงิน" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></Field>
      <Field label="รายละเอียด"><input aria-label="รายละเอียด" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="เช่น ค่าธรรมเนียม" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></Field>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <ModalActions pending={pending} onClose={onClose} onSubmit={submit} />
    </Modal>
  );
}

function AddRevenueModal({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [customer, setCustomer] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    const n = Math.round(parseFloat(amount) * 100);
    if (!date || isNaN(n) || n <= 0) { setErr("กรอกวันที่และจำนวนเงินให้ถูกต้อง"); return; }
    start(async () => {
      const r = await addRevenueEntryAction({ companyId, entryDate: date, amountSatang: n, description: desc, customerName: customer || undefined });
      if (r.ok) onDone(); else setErr(r.error ?? "บันทึกไม่สำเร็จ");
    });
  };
  return (
    <Modal title="เพิ่มรายได้ (บันทึกบัญชี)" onClose={onClose}>
      <Field label="วันที่"><input aria-label="วันที่" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></Field>
      <Field label="จำนวนเงิน (บาท)"><input aria-label="จำนวนเงิน" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></Field>
      <Field label="รายละเอียด"><input aria-label="รายละเอียด" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="เช่น ขายหน้าร้าน" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></Field>
      <Field label="ลูกค้า (ถ้ามี)"><input aria-label="ลูกค้า" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="ชื่อลูกค้า" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></Field>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <ModalActions pending={pending} onClose={onClose} onSubmit={submit} />
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-5 sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-800">{title}</h3>
          <button type="button" aria-label="ปิด" onClick={onClose} className="text-zinc-400 hover:text-zinc-600"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-500">{label}</span>{children}</label>;
}
function ModalActions({ pending, onClose, onSubmit, submitLabel }: { pending: boolean; onClose: () => void; onSubmit: () => void; submitLabel?: string }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" onClick={onClose} disabled={pending} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 disabled:opacity-50">ยกเลิก</button>
      <button type="button" onClick={onSubmit} disabled={pending} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "กำลังบันทึก…" : (submitLabel ?? "บันทึก")}</button>
    </div>
  );
}

// ── โอนเงิน (transfer between accounts) ───────────────────────────────────────
function TransferModal({ mv, companyId, bankAccountId, onClose, onDone }: {
  mv: BankMovement; companyId: string; bankAccountId: string; onClose: () => void; onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [targets, setTargets] = useState<{ id: string; bankCode: string; accountNo: string; accountName: string }[]>([]);
  const [target, setTarget] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    listTransferTargetsAction(companyId, bankAccountId).then((t) => { setTargets(t); if (t[0]) setTarget(t[0].id); });
  }, [companyId, bankAccountId]);
  const out = mv.amountSatang < 0;
  const submit = () => {
    if (!target) { setErr("เลือกบัญชีปลายทาง"); return; }
    start(async () => {
      const r = await transferMovementAction({ bankTxnId: mv.id, targetAccountId: target });
      if (r.ok) onDone(); else setErr(r.error ?? "ไม่สำเร็จ");
    });
  };
  return (
    <Modal title="โอนเงินระหว่างบัญชี" onClose={onClose}>
      <div className="rounded-xl bg-zinc-50 p-3 text-sm">
        <p className="text-xs text-zinc-400">{mv.date}</p>
        <p className="text-zinc-700">{mv.description}</p>
        <p className={`mt-1 font-semibold ${out ? "text-rose-600" : "text-emerald-600"}`}>{out ? "−" : "+"}฿{baht(mv.amountSatang)}</p>
      </div>
      <Field label={out ? "โอนไปบัญชี" : "รับโอนจากบัญชี"}>
        <select aria-label="บัญชีปลายทาง" value={target} onChange={(e) => setTarget(e.target.value)}
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none">
          {targets.length === 0 && <option value="">— ไม่มีบัญชีอื่น —</option>}
          {targets.map((t) => <option key={t.id} value={t.id}>{t.bankCode} …{t.accountNo.slice(-4)} · {t.accountName}</option>)}
        </select>
      </Field>
      <p className="text-[11px] text-zinc-400">รายการนี้จะถูกทำเครื่องหมายเป็น “โอนภายใน” และนำออกจากการกระทบยอด (ไม่ใช่รายรับ/รายจ่าย)</p>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <ModalActions pending={pending} onClose={onClose} onSubmit={submit} submitLabel="ยืนยันโอน" />
    </Modal>
  );
}

// ── แก้ไขรายการเคลื่อนไหวที่เพิ่มเอง ──────────────────────────────────────────
function EditMovementModal({ mv, onClose, onDone }: { mv: BankMovement; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [date, setDate] = useState(mv.date);
  const [amount, setAmount] = useState((Math.abs(mv.amountSatang) / 100).toString());
  const [dir, setDir] = useState<"in" | "out">(mv.amountSatang < 0 ? "out" : "in");
  const [desc, setDesc] = useState(mv.description);
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    const n = Math.round(parseFloat(amount) * 100);
    if (!date || isNaN(n) || n <= 0) { setErr("กรอกวันที่และจำนวนเงินให้ถูกต้อง"); return; }
    start(async () => {
      const r = await editMovementAction({ bankTxnId: mv.id, date, amountSatang: dir === "in" ? n : -n, description: desc });
      if (r.ok) onDone(); else setErr(r.error ?? "แก้ไขไม่สำเร็จ");
    });
  };
  return (
    <Modal title="แก้ไขรายการเคลื่อนไหว" onClose={onClose}>
      <div className="mb-2 flex gap-1 rounded-lg bg-zinc-100 p-1">
        <button type="button" onClick={() => setDir("in")} className={`flex-1 rounded-md py-1.5 text-sm ${dir === "in" ? "bg-white shadow-sm text-emerald-600 font-medium" : "text-zinc-500"}`}>เงินเข้า</button>
        <button type="button" onClick={() => setDir("out")} className={`flex-1 rounded-md py-1.5 text-sm ${dir === "out" ? "bg-white shadow-sm text-rose-600 font-medium" : "text-zinc-500"}`}>เงินออก</button>
      </div>
      <Field label="วันที่"><input aria-label="วันที่" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></Field>
      <Field label="จำนวนเงิน (บาท)"><input aria-label="จำนวนเงิน" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></Field>
      <Field label="รายละเอียด"><input aria-label="รายละเอียด" value={desc} onChange={(e) => setDesc(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm" /></Field>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <ModalActions pending={pending} onClose={onClose} onSubmit={submit} />
    </Modal>
  );
}
