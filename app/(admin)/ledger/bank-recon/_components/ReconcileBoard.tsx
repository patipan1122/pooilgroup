"use client";

// ReconcileBoard — PEAK-parity 2-column bank reconciliation.
//   รอกระทบยอด: LEFT รายการบันทึกบัญชี (book) | RIGHT รายการเคลื่อนไหว (bank)
//     → ติ๊กเลือกทั้ง 2 ฝั่ง (รองรับหลายต่อหลาย) → "จับคู่" → ไปรอยืนยัน
//   รอยืนยัน: กลุ่มที่จับคู่แล้ว → "กระทบยอดทั้งหมด" → ถามยืนยัน + สรุป → เสร็จ
// Auto-match (PEAK step 1) + manual select (PEAK manual) + เพิ่มรายการ/รายได้.
// Design: brand tokens, .tabular-num money, focus-visible rings, real modals
// (ไม่ใช้ window.prompt/confirm), confirm+summary ก่อนลงบัญชี, success state.

import { useState, useMemo, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles, Plus, Link2, Ban, X, Check, CheckCircle2, AlertTriangle, Trash2, RefreshCw, Search,
  MoreVertical, ArrowLeftRight, FilePlus2, Pencil, CalendarClock, ArrowDownWideNarrow, CheckSquare, Square,
  HelpCircle, Upload, SlidersHorizontal, ChevronDown,
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

// shared focus ring (mirrors --ring-focus token)
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-1";

const todayISO = () => new Date().toISOString().slice(0, 10);
type SortMode = "date" | "high" | "low";

interface BookEntry {
  bookId: string; bookType: "revenue" | "expense" | "payment";
  date: string; docNo: string; contact: string; detail: string; amountSatang: number; sub: string; channel: string;
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

// ทิศทางส่วนต่าง: delta = ฝั่งธนาคาร − ฝั่งบัญชี (บอกชัดว่าฝั่งไหนเกิน เพื่อให้นักบัญชีตามแก้ได้)
function deltaDirection(deltaSatang: number): string {
  if (deltaSatang === 0) return "ยอดตรงกัน";
  return deltaSatang > 0 ? `ธนาคารเกิน ฿${baht(deltaSatang)}` : `บัญชีเกิน ฿${baht(deltaSatang)}`;
}

// ป้าย "ประเภท" ต่อคู่ที่จับ — ให้ดูง่ายตอนยืนยัน (เดาจาก suffix c-var ของ docNo · fallback ชื่อธนาคาร)
const CVAR_TYPE: Record<string, { label: string; cls: string }> = {
  c1: { label: "เงินสด", cls: "bg-emerald-100 text-emerald-700" },
  c2: { label: "QR", cls: "bg-violet-100 text-violet-700" },
  qr: { label: "QR", cls: "bg-violet-100 text-violet-700" },
  c12: { label: "บัตร EDC", cls: "bg-orange-100 text-orange-700" },
  c13: { label: "QR", cls: "bg-violet-100 text-violet-700" },
  c14: { label: "Wallet", cls: "bg-sky-100 text-sky-700" },
  c15: { label: "Credit", cls: "bg-orange-100 text-orange-700" },
  c20: { label: "Grab", cls: "bg-green-100 text-green-700" },
  c21: { label: "Lineman", cls: "bg-lime-100 text-lime-700" },
  c22: { label: "ShopeeFood", cls: "bg-rose-100 text-rose-700" },
};
function groupType(g: MatchGroup): { label: string; cls: string } | null {
  const doc = g.items.find((i) => i.kind === "book")?.bookDocNo ?? "";
  const m = doc.match(/-(c\d+|qr)$/i);
  if (m && CVAR_TYPE[m[1].toLowerCase()]) return CVAR_TYPE[m[1].toLowerCase()];
  const bank = (g.items.find((i) => i.kind === "bank")?.label ?? "").toLowerCase();
  if (bank.includes("แกร็บ")) return CVAR_TYPE.c20;
  if (bank.includes("ช้อปปี้") || bank.includes("shopee")) return CVAR_TYPE.c22;
  if (bank.includes("amz_sd") || bank.includes("ผ่อนชำระ")) return CVAR_TYPE.c12;
  if (bank.includes("thai qr") || bank.includes("พร้อมเพย์")) return CVAR_TYPE.qr;
  if (bank.includes("ฝากเงินสด")) return CVAR_TYPE.c1;
  return null;
}

const SOURCE_LABEL: Record<string, string> = {
  TRCLOUD_IV: "TRCloud", CHAIROPS: "ChairOps", CLAWFLEET: "ClawFleet",
  FUELOS: "FuelOS", WEBHOOK: "Webhook", MANUAL: "บันทึกเอง",
  revenue: "รายได้", expense: "ค่าใช้จ่าย", payment: "จ่ายเงิน",
};

// "ธุรกิจ" (source_type → ชื่อธุรกิจที่คนเข้าใจ) สำหรับ detail + filter เวลาบัญชีปนธุรกิจ
const BIZ_LABEL: Record<string, string> = {
  CASHHUB_HOTEL: "โรงแรม", FUELOS: "ปั๊มน้ำมัน", CHAIROPS: "เก้าอี้นวด", CLAWFLEET: "ตู้คีบ",
  TRCLOUD_IV: "TRCloud", CASHHUB_AMAZON: "คาเฟ่ Amazon", CASHHUB_TEA: "ร้านชา",
  WEBHOOK: "Webhook", MANUAL: "บันทึกเอง",
};
const bizLabel = (s: string) => BIZ_LABEL[s] ?? SOURCE_LABEL[s] ?? s;

// "ประเภท" รับเงิน (payment_channel) — ป้ายสี + filter
const CHANNEL_LABEL: Record<string, string> = {
  cash: "เงินสด", transfer: "เงินโอน", qr: "QR", card: "บัตร", mixed: "ผสม", other: "อื่นๆ",
};
const chLabel = (c: string) => CHANNEL_LABEL[c] ?? c;
const CHANNEL_STYLE: Record<string, string> = {
  cash: "bg-emerald-50 text-emerald-600", transfer: "bg-blue-50 text-blue-600",
  qr: "bg-violet-50 text-violet-600", card: "bg-amber-50 text-amber-600",
  mixed: "bg-zinc-100 text-zinc-500", other: "bg-zinc-100 text-zinc-500",
};

const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, val: string) =>
  setter((p) => { const n = new Set(p); if (n.has(val)) n.delete(val); else n.add(val); return n; });

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
  const [success, setSuccess] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "bank" | "revenue" | { kind: "transfer" | "edit"; m: BankMovement }>(null);
  const [excludeIds, setExcludeIds] = useState<string[] | null>(null);   // exclude reason modal
  const [deleteId, setDeleteId] = useState<string | null>(null);         // delete confirm modal
  const [confirmBulk, setConfirmBulk] = useState(false);                 // P0: confirm before posting to GL
  const [qBook, setQBook] = useState("");
  const [qBank, setQBank] = useState("");
  const [todayBook, setTodayBook] = useState(false);
  const [todayBank, setTodayBank] = useState(false);
  const [sortBook, setSortBook] = useState<SortMode>("date");
  const [sortBank, setSortBank] = useState<SortMode>("date");
  const [showHelp, setShowHelp] = useState(false);   // คำแนะนำการใช้งาน (PEAK-style help)
  // ตัวกรองฝั่งบัญชี (แก้ปัญหาบัญชีปนธุรกิจ): รายรับ/จ่าย · ธุรกิจ · สาขา · ประเภท · ช่วงวันที่ · ช่วงยอด
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());   // 'in'=รายรับ · 'out'=รายจ่าย
  const [bizFilter, setBizFilter] = useState<Set<string>>(new Set());     // ธุรกิจ (source_type)
  const [branchFilter, setBranchFilter] = useState<Set<string>>(new Set()); // สาขา (จาก contact)
  const [chFilter, setChFilter] = useState<Set<string>>(new Set());       // ประเภทรับเงิน
  const [amtMin, setAmtMin] = useState("");
  const [amtMax, setAmtMax] = useState("");
  const [showBookFilters, setShowBookFilters] = useState(false);

  const bookKey = (b: { bookType: string; bookId: string }) => `${b.bookType}:${b.bookId}`;
  const today = todayISO();

  const sortRows = <T extends { amountSatang: number; date: string }>(rows: T[], mode: SortMode): T[] => {
    if (mode === "high") return [...rows].sort((a, b) => Math.abs(b.amountSatang) - Math.abs(a.amountSatang));
    if (mode === "low") return [...rows].sort((a, b) => Math.abs(a.amountSatang) - Math.abs(b.amountSatang));
    return rows;
  };

  // search + วันนี้ filter + sort (PEAK: ค้นหา · ฟิลเตอร์วันนี้ · ดูยอดมาก/น้อย)
  // ทิศ: รายรับ (revenue) vs รายจ่าย (expense/payment)
  const bookDir = (b: BookEntry) => (b.bookType === "revenue" ? "in" : "out");
  // ตัวเลือกตัวกรองที่ "มีจริง" ในงวดนี้ (โผล่เฉพาะที่เกี่ยวข้อง) — รูปแบบ {value,label} สำหรับ dropdown
  const opt = (vals: string[], fmt: (v: string) => string) =>
    [...new Set(vals.filter(Boolean))].sort().map((v) => ({ value: v, label: fmt(v) }));
  const typeOptions = useMemo(() => opt(bookEntries.map(bookDir), (v) => (v === "in" ? "รายรับ" : "รายจ่าย")), [bookEntries]);
  const bizOptions = useMemo(() => opt(bookEntries.map((b) => b.sub), bizLabel), [bookEntries]);
  const branchOptions = useMemo(() => opt(bookEntries.map((b) => b.contact), (v) => v), [bookEntries]);
  const chOptions = useMemo(() => opt(bookEntries.map((b) => b.channel), chLabel), [bookEntries]);
  const bookFilterCount = typeFilter.size + bizFilter.size + branchFilter.size + chFilter.size
    + (amtMin ? 1 : 0) + (amtMax ? 1 : 0);

  const fBook = useMemo(() => {
    const q = qBook.trim().toLowerCase();
    let r = bookEntries;
    if (q) r = r.filter((b) => `${b.docNo} ${b.contact} ${b.detail} ${bizLabel(b.sub)} ${chLabel(b.channel)} ${b.amountSatang / 100}`.toLowerCase().includes(q));
    if (todayBook) r = r.filter((b) => b.date === today);
    if (typeFilter.size) r = r.filter((b) => typeFilter.has(bookDir(b)));
    if (bizFilter.size) r = r.filter((b) => bizFilter.has(b.sub));
    if (branchFilter.size) r = r.filter((b) => branchFilter.has(b.contact));
    if (chFilter.size) r = r.filter((b) => chFilter.has(b.channel));
    const min = amtMin ? Math.round(parseFloat(amtMin) * 100) : null;
    const max = amtMax ? Math.round(parseFloat(amtMax) * 100) : null;
    if (min != null && !isNaN(min)) r = r.filter((b) => Math.abs(b.amountSatang) >= min);
    if (max != null && !isNaN(max)) r = r.filter((b) => Math.abs(b.amountSatang) <= max);
    return sortRows(r, sortBook);
  }, [qBook, bookEntries, todayBook, sortBook, today, typeFilter, bizFilter, branchFilter, chFilter, amtMin, amtMax]);
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

  // สรุปก่อนกระทบยอดทั้งหมด (P0 confirm) — โชว์ทั้ง 2 ฝั่ง + ยอดต่างรวม ให้ผู้อนุมัติชั่งน้ำหนักก่อนลงบัญชี
  const bulkStats = useMemo(() => {
    const n = suggestedGroups.length;
    const matched = suggestedGroups.filter((g) => g.deltaSatang === 0).length;
    const bookTotal = suggestedGroups.reduce((s, g) => s + Math.abs(g.bookTotalSatang), 0);
    const bankTotal = suggestedGroups.reduce((s, g) => s + Math.abs(g.bankTotalSatang), 0);
    const residual = suggestedGroups.reduce((s, g) => s + Math.abs(g.deltaSatang), 0);
    return { n, matched, diff: n - matched, bookTotal, bankTotal, residual };
  }, [suggestedGroups]);

  function toggleBank(id: string) {
    setSelBank((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleBook(k: string) {
    setSelBook((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }
  function clearSel() { setSelBank(new Set()); setSelBook(new Set()); }

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setErr(null); setSuccess(null);
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

  // P0: กระทบยอดทั้งหมด — ลงสมุดบัญชีจริง ย้อนไม่ได้ → ต้องยืนยัน + สรุปก่อนเสมอ.
  // idempotent: action re-query เฉพาะ status="suggested" → กดซ้ำเร็ว ๆ ไม่ลงซ้ำ (และปุ่ม disabled ตอน pending).
  const doConfirmAll = () => {
    setErr(null); setSuccess(null);
    startTransition(async () => {
      const r = await confirmAllGroupsAction(bankAccountId);
      if (r.ok) {
        setConfirmBulk(false);
        setSuccess(`กระทบยอด ${r.confirmed} กลุ่มเรียบร้อย — ลงบันทึกบัญชีแล้ว`);
        router.refresh();
      } else { setConfirmBulk(false); setErr(r.error ?? "กระทบยอดไม่สำเร็จ"); }
    });
  };
  const handleRemove = (gid: string) => run(() => removeGroupAction(gid));

  // ข้าม / ไม่มีคู่ — ผ่าน modal (แทน window.prompt) · รองรับทั้งรายตัวและหลายรายการ.
  // แต่ละรายการเป็น transaction แยก (per-txn) → ถ้าพังกลางคันต้องบอกชัดว่าข้ามไปกี่รายการแล้ว
  // + refresh ให้ตารางตรงกับความจริง (กัน user เข้าใจผิดว่า "ไม่มีอะไรเกิดขึ้น")
  const doExclude = (ids: string[], reason: string) => {
    setErr(null); setSuccess(null);
    startTransition(async () => {
      let done = 0;
      for (const id of ids) {
        const r = await excludeTxnAction({ bankTxnId: id, reason: reason.trim() });
        if (!r.ok) {
          setExcludeIds(null); setSelBank(new Set()); router.refresh();
          setErr(done > 0
            ? `ข้ามสำเร็จ ${done} จาก ${ids.length} รายการ · รายการถัดไปไม่สำเร็จ: ${r.error ?? "ผิดพลาด"}`
            : (r.error ?? "ข้ามรายการไม่สำเร็จ"));
          return;
        }
        done++;
      }
      setExcludeIds(null); setSelBank(new Set());
      if (ids.length > 1) setSuccess(`ข้าม ${done} รายการเรียบร้อย`);
      router.refresh();
    });
  };
  const handleSync = () => run(() => syncRevenueRangeAction({ companyId, periodStart, periodEnd }).then((r) => ({ ok: r.ok, error: r.error })));

  // per-movement actions (PEAK "ทำรายการ")
  const handleCreateRevenue = (id: string) => run(() => createRevenueFromMovementAction({ bankTxnId: id }));
  const handleCreateExpense = (id: string) => run(() => createExpenseFromMovementAction({ bankTxnId: id }));

  const matchTotal = bankMovements.length + bookEntries.length;

  return (
    <div>
      {/* Tabs */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-zinc-100 p-1">
          <button
            type="button"
            onClick={() => setTab("match")}
            className={`press inline-flex min-h-11 items-center rounded-lg px-4 py-1.5 text-sm font-medium sm:min-h-0 ${FOCUS} ${tab === "match" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"}`}
          >
            รอกระทบยอด
            <span className="ml-1.5 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] tabular-num text-brand-600">{bankMovements.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("confirm")}
            className={`press inline-flex min-h-11 items-center rounded-lg px-4 py-1.5 text-sm font-medium sm:min-h-0 ${FOCUS} ${tab === "confirm" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"}`}
          >
            รอยืนยัน
            <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] tabular-num text-amber-600">{suggestedGroups.length}</span>
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={handleSync} disabled={pending}
            className={`inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 ${FOCUS}`}>
            <RefreshCw size={12} className={pending ? "animate-spin motion-reduce:animate-none" : ""} /> ดึงรายได้ TRCloud
          </button>
          <button type="button" onClick={handleAuto} disabled={pending}
            className={`press inline-flex min-h-10 items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50 sm:min-h-0 ${FOCUS}`}>
            <Sparkles size={12} /> จับคู่อัตโนมัติ
          </button>
          <button type="button" aria-label="คำแนะนำการใช้งาน" aria-expanded={showHelp ? "true" : "false"} onClick={() => setShowHelp((v) => !v)}
            className={`press grid size-9 shrink-0 place-items-center rounded-lg border border-zinc-200 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 sm:size-8 ${FOCUS} ${showHelp ? "bg-zinc-50 text-zinc-600" : ""}`}>
            <HelpCircle size={16} />
          </button>
        </div>
      </div>

      {/* คำแนะนำการใช้งาน (PEAK-style help) — กดปุ่ม ? เพื่อเปิด/ปิด */}
      {showHelp && (
        <div className="mb-3 rounded-xl border border-brand-100 bg-brand-50/60 p-3 text-sm text-zinc-600">
          <p className="mb-1.5 font-medium text-zinc-700">กระทบยอดธนาคารใน 3 ขั้น</p>
          <ol className="space-y-1 text-xs">
            <li><b className="text-brand-600">1.</b> นำเข้า/ดึงรายการเข้ามาทั้ง 2 ฝั่ง (ฝั่งบัญชี = ที่เราคีย์ · ฝั่งธนาคาร = statement จริง)</li>
            <li><b className="text-brand-600">2.</b> ติ๊กรายการที่ตรงกันทั้งซ้าย-ขวา แล้วกด <b>“จับคู่”</b> — หรือกด <b>“จับคู่อัตโนมัติ”</b> ให้ระบบช่วยจับให้</li>
            <li><b className="text-brand-600">3.</b> ไปแท็บ <b>“รอยืนยัน”</b> ตรวจส่วนต่าง แล้วกด <b>“กระทบยอดทั้งหมด”</b> (ลงบัญชีจริง ย้อนไม่ได้)</li>
          </ol>
        </div>
      )}

      {success && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 size={16} className="shrink-0" />
          <span className="flex-1">{success}</span>
          <button type="button" aria-label="ปิด" onClick={() => setSuccess(null)} className={`rounded text-emerald-500 hover:text-emerald-700 ${FOCUS}`}><X size={15} /></button>
        </div>
      )}
      {err && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}

      {tab === "match" ? (
        <>
          {/* ตัวกรองฝั่งบัญชี — รวมไว้ที่เดียวด้านบน (ไม่ซ้ำซ้อนในคอลัมน์) */}
          <BookFilters
            count={bookFilterCount} open={showBookFilters} onToggle={() => setShowBookFilters((v) => !v)}
            menus={[
              { label: "รายรับ/จ่าย", options: typeOptions, selected: typeFilter, onToggle: (s) => toggleSet(setTypeFilter, s) },
              { label: "ธุรกิจ", options: bizOptions, selected: bizFilter, onToggle: (s) => toggleSet(setBizFilter, s) },
              { label: "สาขา", options: branchOptions, selected: branchFilter, onToggle: (s) => toggleSet(setBranchFilter, s) },
              { label: "ประเภท", options: chOptions, selected: chFilter, onToggle: (s) => toggleSet(setChFilter, s) },
            ]}
            amtMin={amtMin} amtMax={amtMax} setAmtMin={setAmtMin} setAmtMax={setAmtMax}
            onClear={() => {
              setTypeFilter(new Set()); setBizFilter(new Set()); setBranchFilter(new Set()); setChFilter(new Set());
              setAmtMin(""); setAmtMax("");
            }}
          />
          {matchTotal === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-14 text-center">
              <Upload size={26} className="mx-auto mb-2 text-zinc-300" />
              <p className="text-sm font-medium text-zinc-600">ยังไม่มีรายการในงวดนี้</p>
              <p className="mt-1 text-xs text-zinc-400">นำเข้า statement ธนาคาร หรือกด “ดึงรายได้ TRCloud” ด้านบนก่อน</p>
              <a href={`/ledger/bank-recon/${bankAccountId}?company=${companyId}`}
                className={`press mt-4 inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 ${FOCUS}`}>
                <Upload size={14} /> นำเข้า statement
              </a>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* LEFT — book */}
              <Column
                title="รายการบันทึกบัญชี"
                subtitle="ยอดที่เราบันทึก/คีย์ไว้เอง"
                count={fBook.length}
                selTotal={selBookTotal}
                accent="brand"
                onAdd={() => setModal("revenue")}
                addLabel="เพิ่มรายได้"
                search={qBook}
                onSearch={setQBook}
                searchPlaceholder="ค้นหา สาขา / ผู้ติดต่อ / เลขเอกสาร"
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
                      title={b.contact || bizLabel(b.sub) || b.docNo || "—"}
                      subtitle={b.docNo}
                      detail={b.detail}
                      tag={b.sub ? bizLabel(b.sub) : (SOURCE_LABEL[b.bookType] ?? b.bookType)}
                      channel={b.channel}
                      amountSatang={b.amountSatang}
                    />
                  );
                })}
                {fBook.length === 0 && <Empty text={bookFilterCount > 0 ? "ไม่มีรายการตามตัวกรอง — ลองล้างตัวกรอง" : "ไม่มีรายการบัญชีค้าง"} />}
              </Column>

              {/* RIGHT — bank */}
              <Column
                title="รายการเคลื่อนไหว (ธนาคาร)"
                subtitle="ยอดจริงที่เข้า-ออกในธนาคาร"
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
                        onExclude={() => setExcludeIds([m.id])}
                        onEdit={() => setModal({ kind: "edit", m })}
                        onDelete={() => setDeleteId(m.id)}
                      />
                    }
                  />
                ))}
                {fBank.length === 0 && <Empty text="ไม่มีรายการธนาคารค้าง" />}
              </Column>
            </div>
          )}

          {/* sticky action bar — โผล่เมื่อเลือกฝั่งใดฝั่งหนึ่ง */}
          {(selBank.size > 0 || selBook.size > 0) && (
            <div className="safe-bottom sticky bottom-3 mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-lg">
              <span className="text-sm text-zinc-600">
                เลือก: บัญชี <b className="tabular-num">{selBook.size}</b> · ธนาคาร <b className="tabular-num">{selBank.size}</b>
              </span>
              {!hasSelection && (
                <span className="text-[11px] text-amber-600">เลือกอีกฝั่งให้ครบทั้งซ้าย-ขวา เพื่อจับคู่</span>
              )}
              {hasSelection && (
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium tabular-num ${delta === 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                  {delta === 0 ? "ยอดตรงกัน" : deltaDirection(delta)}
                </span>
              )}
              {hasSelection && delta !== 0 && (
                <span className="text-[11px] text-zinc-400">ลองตรวจค่าธรรมเนียม / ภาษีหัก ณ ที่จ่าย / โอนภายใน</span>
              )}
              <div className="ml-auto flex gap-2">
                <button type="button" onClick={clearSel} className={`press inline-flex min-h-11 items-center rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50 sm:min-h-0 ${FOCUS}`}>
                  ล้าง
                </button>
                {selBank.size > 0 && (
                  <button type="button" onClick={() => setExcludeIds([...selBank])} disabled={pending}
                    className={`press inline-flex min-h-11 items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 sm:min-h-0 ${FOCUS}`}>
                    <Ban size={14} /> ข้าม {selBank.size} รายการ
                  </button>
                )}
                <button type="button" onClick={handleMatch} disabled={pending || !hasSelection}
                  className={`press inline-flex min-h-11 items-center gap-1 rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50 sm:min-h-0 ${FOCUS}`}>
                  <Link2 size={14} /> จับคู่ → รอยืนยัน
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* ── รอยืนยัน ── */
        <div>
          {suggestedGroups.length > 0 && (
            <div className="mb-3 flex justify-end">
              <button type="button" onClick={() => setConfirmBulk(true)} disabled={pending}
                className={`press inline-flex min-h-11 items-center gap-1 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50 sm:min-h-0 ${FOCUS}`}>
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
                  {/* แถบหัว: ประเภท (เห็นปุ๊บรู้เลย) + ส่วนต่าง + นำออก */}
                  <div className="mb-2.5 flex flex-wrap items-center gap-2">
                    {(() => {
                      const t = groupType(g);
                      return t ? (
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.cls}`}>{t.label}</span>
                      ) : null;
                    })()}
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium tabular-num ${g.deltaSatang === 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {g.deltaSatang === 0 ? "ยอดตรงกัน" : `ต่างกัน ฿${baht(g.deltaSatang)}`}
                    </span>
                    {g.matchKind === "auto" && <span className="text-[11px] text-violet-500">จับคู่อัตโนมัติ</span>}
                    <button type="button" onClick={() => handleRemove(g.id)} disabled={pending}
                      className={`ml-auto inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 ${FOCUS}`}>
                      <Trash2 size={12} /> นำออก
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <GroupSide title="บัญชี (ที่เราบันทึก)" items={g.items.filter((i) => i.kind === "book")} accent="brand" />
                    <GroupSide title="ธนาคาร (เงินเข้าจริง)" items={g.items.filter((i) => i.kind === "bank")} accent="emerald" />
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

      {/* P0 — ยืนยันก่อนลงบัญชี (ย้อนไม่ได้) */}
      {confirmBulk && (
        <Modal title="ยืนยันกระทบยอด" onClose={() => !pending && setConfirmBulk(false)}>
          <div className="space-y-2 rounded-xl bg-zinc-50 p-3 text-sm">
            <Stat label="กลุ่มที่จะกระทบยอด" value={`${bulkStats.n} กลุ่ม`} />
            <Stat label="ยอดตรงกัน" value={`${bulkStats.matched} กลุ่ม`} good />
            {bulkStats.diff > 0 && <Stat label="ยังมีส่วนต่าง" value={`${bulkStats.diff} กลุ่ม · รวม ฿${baht(bulkStats.residual)}`} warn />}
            <div className="space-y-2 border-t border-zinc-200 pt-2">
              <Stat label="มูลค่ารวม (ฝั่งบัญชี)" value={`฿${baht(bulkStats.bookTotal)}`} />
              <Stat label="มูลค่ารวม (ฝั่งธนาคาร)" value={`฿${baht(bulkStats.bankTotal)}`} />
            </div>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-amber-600">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            การกระทบยอดจะ<b>ลงบันทึกในสมุดบัญชีและย้อนกลับไม่ได้</b> — ตรวจส่วนต่างก่อนยืนยัน
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setConfirmBulk(false)} disabled={pending}
              className={`rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 disabled:opacity-50 ${FOCUS}`}>ยกเลิก</button>
            <button type="button" onClick={doConfirmAll} disabled={pending}
              className={`press inline-flex min-h-11 items-center gap-1 rounded-lg bg-brand-500 px-5 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50 sm:min-h-0 ${FOCUS}`}>
              {pending ? "กำลังกระทบยอด…" : <><Check size={14} /> ยืนยันกระทบยอด</>}
            </button>
          </div>
        </Modal>
      )}

      {/* ข้าม / ไม่มีคู่ — modal แทน window.prompt */}
      {excludeIds && (
        <ExcludeModal count={excludeIds.length} pending={pending}
          onClose={() => !pending && setExcludeIds(null)}
          onSubmit={(reason) => doExclude(excludeIds, reason)} />
      )}

      {/* ลบรายการที่เพิ่มเอง — modal แทน window.confirm */}
      {deleteId && (
        <ConfirmDangerModal
          title="ลบรายการที่เพิ่มเอง?"
          body="ลบรายการเคลื่อนไหวที่เพิ่มเองนี้ออกจากการกระทบยอด"
          confirmLabel="ลบรายการ"
          pending={pending}
          onClose={() => !pending && setDeleteId(null)}
          onConfirm={() => run(() => deleteMovementAction(deleteId), () => setDeleteId(null))} />
      )}
    </div>
  );
}

// ── building blocks ───────────────────────────────────────────────────────────
const SORT_LABEL: Record<SortMode, string> = { date: "วันที่", high: "ยอดมาก→น้อย", low: "ยอดน้อย→มาก" };
const nextSort: Record<SortMode, SortMode> = { date: "high", high: "low", low: "date" };
type Accent = "brand" | "emerald";
const accentText = (a: Accent) => (a === "brand" ? "text-brand-600" : "text-emerald-600");

function Column({
  title, subtitle, count, selTotal, accent, onAdd, addLabel, search, onSearch, searchPlaceholder,
  allSelected, onToggleAll, today, onToday, sort, onSort, extraFilter, children,
}: {
  title: string; subtitle?: string; count: number; selTotal: number; accent: Accent;
  onAdd?: () => void; addLabel: string;
  search: string; onSearch: (v: string) => void; searchPlaceholder: string;
  allSelected: boolean; onToggleAll: () => void;
  today: boolean; onToday: () => void; sort: SortMode; onSort: (s: SortMode) => void;
  extraFilter?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-100 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-50 px-4 py-2.5">
        <div>
          <div>
            <span className="text-sm font-semibold text-zinc-700">{title}</span>
            <span className="ml-1.5 text-xs tabular-num text-zinc-400">({count})</span>
          </div>
          {subtitle && <p className="text-[11px] text-zinc-400">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {selTotal !== 0 && (
            <span className={`text-xs font-medium tabular-num ${accentText(accent)}`}>
              เลือก ฿{baht(selTotal)}
            </span>
          )}
          {onAdd && (
            <button type="button" onClick={onAdd} className={`inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 ${FOCUS}`}>
              <Plus size={12} /> {addLabel}
            </button>
          )}
        </div>
      </div>
      {/* search */}
      <div className="px-3 pt-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2 py-1 focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-200">
          <Search size={13} className="text-zinc-400" />
          <input
            aria-label={searchPlaceholder}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent text-xs text-zinc-700 outline-none placeholder:text-zinc-400"
          />
        </div>
      </div>
      {extraFilter}
      {/* filter chips: select-all · วันนี้ · sort */}
      <div className="flex items-center gap-1.5 border-b border-zinc-50 px-3 py-1.5">
        <button type="button" onClick={onToggleAll} aria-pressed={allSelected ? "true" : "false"}
          className={`press inline-flex min-h-9 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] sm:min-h-0 ${FOCUS} ${allSelected ? "border-brand-200 bg-brand-50 text-brand-600" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>
          {allSelected ? <CheckSquare size={12} aria-hidden /> : <Square size={12} aria-hidden />}
          เลือกทั้งหมด
        </button>
        <button type="button" onClick={onToday}
          className={`press inline-flex min-h-9 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] sm:min-h-0 ${FOCUS} ${today ? "border-brand-200 bg-brand-50 text-brand-600" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>
          <CalendarClock size={11} /> วันนี้
        </button>
        <button type="button" aria-label={`เรียงลำดับ: ${SORT_LABEL[sort]}`} onClick={() => onSort(nextSort[sort])}
          className={`press inline-flex min-h-9 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] sm:min-h-0 ${FOCUS} ${sort !== "date" ? "border-brand-200 bg-brand-50 text-brand-600" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>
          <ArrowDownWideNarrow size={11} /> {SORT_LABEL[sort]}
        </button>
      </div>
      <div className="max-h-[68vh] divide-y divide-zinc-50 overflow-y-auto">{children}</div>
    </div>
  );
}

// ── dropdown ตัวกรองแบบกดติ๊ก (multi-select) ───────────────────────────────────
type FilterOption = { value: string; label: string };
function FilterMenu({ label, options, selected, onToggle }: {
  label: string; options: FilterOption[]; selected: Set<string>; onToggle: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);
  const n = options.filter((o) => selected.has(o.value)).length;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open ? "true" : "false"}
        className={`press inline-flex min-h-9 items-center gap-1 rounded-full border px-3 py-1 text-[11px] sm:min-h-0 ${FOCUS} ${n > 0 ? "border-brand-300 bg-brand-100 text-brand-700" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>
        {label}{n > 0 ? ` (${n})` : ""}
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-30 max-h-56 w-48 overflow-auto rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
          {options.map((o) => (
            <button key={o.value} type="button" onClick={() => onToggle(o.value)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-50 ${FOCUS}`}>
              <span className={`grid size-4 shrink-0 place-items-center rounded border ${selected.has(o.value) ? "border-brand-500 bg-brand-500 text-white" : "border-zinc-300"}`}>
                {selected.has(o.value) && <Check size={11} />}
              </span>
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ตัวกรองฝั่งบัญชี (การ์ดด้านบน · ยุบเก็บได้ — แก้ปัญหาบัญชีปนธุรกิจ): รายรับ/จ่าย · ธุรกิจ · สาขา · ประเภท · ช่วงยอด ──
function BookFilters({
  count, open, onToggle, menus, amtMin, amtMax, setAmtMin, setAmtMax, onClear,
}: {
  count: number; open: boolean; onToggle: () => void;
  menus: { label: string; options: FilterOption[]; selected: Set<string>; onToggle: (v: string) => void }[];
  amtMin: string; amtMax: string; setAmtMin: (v: string) => void; setAmtMax: (v: string) => void;
  onClear: () => void;
}) {
  const activeMenus = menus.filter((m) => m.options.length > 0);
  if (activeMenus.length === 0) return null; // ไม่มีอะไรให้กรอง → ไม่ต้องโชว์ (คงความสะอาด)
  const amtCls = `w-20 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] tabular-num ${FOCUS}`;
  return (
    <div className="mb-3 rounded-2xl border border-zinc-100 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onToggle} aria-expanded={open ? "true" : "false"}
          className={`press inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs sm:min-h-0 ${FOCUS} ${count > 0 ? "border-brand-200 bg-brand-50 text-brand-600" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>
          <SlidersHorizontal size={13} /> ตัวกรองรายการบัญชี{count > 0 ? ` (${count})` : ""}
          <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {count > 0 && (
          <button type="button" onClick={onClear} className={`press min-h-8 rounded-lg px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-600 sm:min-h-0 ${FOCUS}`}>ล้างตัวกรอง</button>
        )}
      </div>
      {open && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {activeMenus.map((m) => (
            <FilterMenu key={m.label} label={m.label} options={m.options} selected={m.selected} onToggle={m.onToggle} />
          ))}
          <span className="ml-1 text-[10px] text-zinc-400">ยอด</span>
          <input type="number" inputMode="decimal" aria-label="ยอดต่ำสุด" value={amtMin} onChange={(e) => setAmtMin(e.target.value)} placeholder="ต่ำสุด" className={amtCls} />
          <span className="text-zinc-300">–</span>
          <input type="number" inputMode="decimal" aria-label="ยอดสูงสุด" value={amtMax} onChange={(e) => setAmtMax(e.target.value)} placeholder="สูงสุด" className={amtCls} />
        </div>
      )}
    </div>
  );
}

function Row({ checked, onToggle, disabled, date, title, subtitle, detail, tag, channel, amountSatang, menu }: {
  checked: boolean; onToggle: () => void; disabled?: boolean;
  date: string; title: string; subtitle?: string; detail?: string; tag?: string; channel?: string; amountSatang: number; menu?: React.ReactNode;
}) {
  const credit = amountSatang > 0;
  return (
    <div className={`flex items-start gap-2 px-3 py-2 ${checked ? "bg-brand-50" : "hover:bg-zinc-50"}`}>
      {/* checkbox = the keyboard-operable control (labelled by row title); the body click is a mouse-only convenience */}
      <input type="checkbox" checked={checked} onChange={onToggle} disabled={disabled}
        aria-label={`เลือก ${title}${date ? ` (${date})` : ""}`}
        className={`mt-0.5 size-5 shrink-0 cursor-pointer rounded border-zinc-300 disabled:opacity-40 ${FOCUS}`} />
      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => !disabled && onToggle()}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] tabular-num text-zinc-400">{date}</span>
          {tag && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">{tag}</span>}
          {channel && <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CHANNEL_STYLE[channel] ?? "bg-zinc-100 text-zinc-500"}`}>{chLabel(channel)}</span>}
        </div>
        <p className="truncate text-sm text-zinc-700">{title}</p>
        {subtitle && <p className="truncate text-xs text-zinc-500">{subtitle}</p>}
        {detail && <p className="truncate text-[11px] text-zinc-400">{detail}</p>}
      </div>
      <div className="flex shrink-0 items-start gap-1">
        <p className={`text-sm font-semibold tabular-num ${credit ? "text-emerald-600" : "text-rose-600"}`}>
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
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);
  const item = (icon: React.ReactNode, label: string, fn: () => void, danger?: boolean) => (
    <button type="button" disabled={pending}
      onClick={() => { setOpen(false); fn(); }}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-zinc-50 disabled:opacity-50 ${FOCUS} ${danger ? "text-rose-600" : "text-zinc-700"}`}>
      {icon} {label}
    </button>
  );
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label="ทำรายการ" onClick={() => setOpen((v) => !v)}
        className={`press grid size-9 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 sm:size-7 ${FOCUS}`}>
        <MoreVertical size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-48 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
          {item(<FilePlus2 size={13} className="text-brand-500" />, isCredit ? "บันทึกเป็นรายได้" : "บันทึกเป็นค่าใช้จ่าย", onCreateBook)}
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

function GroupSide({ title, items, accent }: { title: string; items: GroupItem[]; accent: Accent }) {
  return (
    <div>
      <p className={`mb-1 text-[11px] font-semibold ${accentText(accent)}`}>{title}</p>
      <div className="space-y-1">
        {items.map((i, idx) => (
          <div key={idx} className="flex items-center justify-between rounded-lg bg-zinc-50 px-2.5 py-1.5">
            <span className="truncate text-xs text-zinc-600">{i.date ? `${i.date} · ` : ""}{i.label}</span>
            <span className={`ml-2 shrink-0 text-xs font-medium tabular-num ${i.amountSatang > 0 ? "text-emerald-600" : "text-rose-600"}`}>
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

function Stat({ label, value, good, warn }: { label: string; value: string; good?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className={`font-medium tabular-num ${good ? "text-emerald-600" : warn ? "text-amber-600" : "text-zinc-800"}`}>{value}</span>
    </div>
  );
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
      <SegIO dir={dir} setDir={setDir} />
      <Field label="วันที่"><input aria-label="วันที่" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
      <Field label="จำนวนเงิน (บาท)"><input aria-label="จำนวนเงิน" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${inputCls} tabular-num`} /></Field>
      <Field label="รายละเอียด"><input aria-label="รายละเอียด" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="เช่น ค่าธรรมเนียม" className={inputCls} /></Field>
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
      <Field label="วันที่"><input aria-label="วันที่" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
      <Field label="จำนวนเงิน (บาท)"><input aria-label="จำนวนเงิน" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${inputCls} tabular-num`} /></Field>
      <Field label="รายละเอียด"><input aria-label="รายละเอียด" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="เช่น ขายหน้าร้าน" className={inputCls} /></Field>
      <Field label="ลูกค้า (ถ้ามี)"><input aria-label="ลูกค้า" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="ชื่อลูกค้า" className={inputCls} /></Field>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <ModalActions pending={pending} onClose={onClose} onSubmit={submit} />
    </Modal>
  );
}

// ── ข้าม / ไม่มีคู่ (reason) — แทน window.prompt ──────────────────────────────
function ExcludeModal({ count, pending, onClose, onSubmit }: {
  count: number; pending: boolean; onClose: () => void; onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const presets = ["ค่าธรรมเนียมธนาคาร", "ดอกเบี้ย", "โอนภายใน", "ภาษีหัก ณ ที่จ่าย"];
  const submit = () => {
    if (!reason.trim()) { setErr("กรอกเหตุผลที่ข้าม"); return; }
    onSubmit(reason);
  };
  return (
    <Modal title={count > 1 ? `ข้าม ${count} รายการ` : "ข้ามรายการ (ไม่มีคู่)"} onClose={onClose}>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button key={p} type="button" onClick={() => setReason(p)}
            className={`rounded-full border px-2.5 py-1 text-[11px] ${FOCUS} ${reason === p ? "border-brand-200 bg-brand-50 text-brand-600" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>
            {p}
          </button>
        ))}
      </div>
      <Field label="เหตุผล"><input aria-label="เหตุผลที่ข้าม" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ค่าธรรมเนียม / ดอกเบี้ย / โอนภายใน" className={inputCls} /></Field>
      <p className="text-[11px] text-zinc-400">รายการที่ข้ามจะถูกนำออกจากการกระทบยอด (ไม่นับเป็นรายรับ/รายจ่าย)</p>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <ModalActions pending={pending} onClose={onClose} onSubmit={submit} submitLabel="ยืนยันข้าม" />
    </Modal>
  );
}

function ConfirmDangerModal({ title, body, confirmLabel, pending, onClose, onConfirm }: {
  title: string; body: string; confirmLabel: string; pending: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-zinc-600">{body}</p>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} disabled={pending} className={`rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 disabled:opacity-50 ${FOCUS}`}>ยกเลิก</button>
        <button type="button" onClick={onConfirm} disabled={pending} className={`inline-flex items-center gap-1 rounded-lg bg-rose-600 px-5 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50 ${FOCUS}`}>
          {pending ? "กำลังลบ…" : <><Trash2 size={14} /> {confirmLabel}</>}
        </button>
      </div>
    </Modal>
  );
}

const inputCls = "w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus-visible:border-brand-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-200";

function SegIO({ dir, setDir }: { dir: "in" | "out"; setDir: (d: "in" | "out") => void }) {
  return (
    <div className="mb-2 flex gap-1 rounded-lg bg-zinc-100 p-1">
      <button type="button" onClick={() => setDir("in")} className={`flex-1 rounded-md py-1.5 text-sm ${FOCUS} ${dir === "in" ? "bg-white shadow-sm text-emerald-600 font-medium" : "text-zinc-500"}`}>เงินเข้า</button>
      <button type="button" onClick={() => setDir("out")} className={`flex-1 rounded-md py-1.5 text-sm ${FOCUS} ${dir === "out" ? "bg-white shadow-sm text-rose-600 font-medium" : "text-zinc-500"}`}>เงินออก</button>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="safe-bottom w-full max-w-md space-y-3 rounded-t-2xl bg-white p-5 sm:rounded-2xl sm:pb-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-800">{title}</h3>
          <button type="button" aria-label="ปิด" onClick={onClose} className={`rounded text-zinc-400 hover:text-zinc-600 ${FOCUS}`}><X size={20} /></button>
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
      <button type="button" onClick={onClose} disabled={pending} className={`press min-h-11 rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 disabled:opacity-50 sm:min-h-0 ${FOCUS}`}>ยกเลิก</button>
      <button type="button" onClick={onSubmit} disabled={pending} className={`press min-h-11 rounded-lg bg-brand-500 px-5 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50 sm:min-h-0 ${FOCUS}`}>{pending ? "กำลังบันทึก…" : (submitLabel ?? "บันทึก")}</button>
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
        <p className="text-xs tabular-num text-zinc-400">{mv.date}</p>
        <p className="text-zinc-700">{mv.description}</p>
        <p className={`mt-1 font-semibold tabular-num ${out ? "text-rose-600" : "text-emerald-600"}`}>{out ? "−" : "+"}฿{baht(mv.amountSatang)}</p>
      </div>
      <Field label={out ? "โอนไปบัญชี" : "รับโอนจากบัญชี"}>
        <select aria-label="บัญชีปลายทาง" value={target} onChange={(e) => setTarget(e.target.value)}
          className={inputCls}>
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
      <SegIO dir={dir} setDir={setDir} />
      <Field label="วันที่"><input aria-label="วันที่" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
      <Field label="จำนวนเงิน (บาท)"><input aria-label="จำนวนเงิน" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} tabular-num`} /></Field>
      <Field label="รายละเอียด"><input aria-label="รายละเอียด" value={desc} onChange={(e) => setDesc(e.target.value)} className={inputCls} /></Field>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <ModalActions pending={pending} onClose={onClose} onSubmit={submit} />
    </Modal>
  );
}
