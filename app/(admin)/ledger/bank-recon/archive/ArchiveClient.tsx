"use client";

// คลัง (รายการที่กระทบยอดแล้ว) — searchable archive of confirmed + reversed match groups.
// • type-to-find box (submits ?q= so the server re-queries; also filters client-side live)
// • each card: account · status · totals + diff · matched items (book vs bank) · timestamps
// • confirmed groups → "ย้อนกลับ" (super_admin) / "ขออนุมัติแก้" (others)

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Search,
  Undo2,
  FileSignature,
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
  Info,
  CheckSquare,
  Square,
  X,
} from "lucide-react";
import type { ArchiveGroup } from "@/lib/ledger/recon-controls";
import {
  revertConfirmedGroupAction,
  requestRevertAction,
  bulkRevertGroupsAction,
} from "../_recon-controls-actions";
import { Money, thDate, StatusBadge, ReasonModal, FeedbackBar } from "../_components/recon-controls-ui";

interface Props {
  groups: ArchiveGroup[];
  initialQuery: string;
  companyId: string;
  isSuper: boolean;
}

// ── ความมั่นใจ (เหมือนแท็บรอยืนยัน) — คลังดูจาก "ยอดต่าง" เป็นหลัก (ที่ยืนยันแล้ว = ชื่อผ่านตาคนแล้ว) ──
//   🟢 มั่นใจสูง = ยอดตรงเป๊ะ · 🟡 ควรตรวจสอบ = ต่าง ≤฿500 · 🔴 มั่นใจน้อย = ต่าง >฿500
type Band = "high" | "review" | "low";
const REVIEW_DELTA_SATANG = 50000; // ฿500 — ตรงกับเกณฑ์แท็บรอยืนยัน
const BAND_META: Record<Band, { label: string; dot: string; pill: string; chip: string }> = {
  high:   { label: "มั่นใจสูง",    dot: "bg-emerald-500", pill: "bg-emerald-100 text-emerald-700", chip: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  review: { label: "ควรตรวจสอบ", dot: "bg-amber-500",   pill: "bg-amber-100 text-amber-700",     chip: "border-amber-300 bg-amber-50 text-amber-700" },
  low:    { label: "มั่นใจน้อย",   dot: "bg-rose-500",    pill: "bg-rose-100 text-rose-700",       chip: "border-rose-300 bg-rose-50 text-rose-700" },
};
function confidenceBand(deltaSatang: number): Band {
  const abs = Math.abs(deltaSatang);
  if (abs > REVIEW_DELTA_SATANG) return "low";
  if (abs === 0) return "high";
  return "review";
}

export function ArchiveClient({ groups, initialQuery, companyId, isSuper }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery);
  const [pending, startTransition] = useTransition();

  // revert modal state
  const [target, setTarget] = useState<ArchiveGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  // เลือกหลายรายการเพื่อย้อนพร้อมกัน (เฉพาะ super_admin)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bandFilter, setBandFilter] = useState<"all" | Band>("all"); // กรองตามความมั่นใจ
  const toggleOne = (id: string) =>
    setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // submit search → server re-query (keeps deep-linkable ?q=)
  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const sp = new URLSearchParams();
    sp.set("company", companyId);
    if (query.trim()) sp.set("q", query.trim());
    router.push(`${pathname}?${sp.toString()}`);
  }

  // live client-side narrowing on top of the server result (instant feel)
  const q = query.trim().toLowerCase();
  const visible = q
    ? groups.filter((g) => {
        const hay = `${g.accountLabel ?? ""} ${g.reversalReason ?? ""} ${g.items
          .map((i) => i.label)
          .join(" ")} ${(Math.abs(g.bankTotalSatang) / 100).toFixed(2)}`.toLowerCase();
        return hay.includes(q);
      })
    : groups;

  async function doRevert(reason: string) {
    if (!target) return;
    setBusy(true);
    const action = isSuper
      ? revertConfirmedGroupAction({ groupId: target.id, reason })
      : requestRevertAction({ groupId: target.id, reason });
    const res = await action;
    setBusy(false);
    if (res.ok) {
      setFeedback({
        kind: "ok",
        message: isSuper
          ? "ย้อนรายการแล้ว — รายการกลับไปรอจับคู่ใหม่ และสีรุ้งใน CashHub ถูกปลดด้วย"
          : "ส่งคำขออนุมัติแก้แล้ว — รอ super admin อนุมัติ",
      });
      setTarget(null);
      startTransition(() => router.refresh());
    } else {
      setFeedback({ kind: "error", message: res.error ?? "ทำรายการไม่สำเร็จ" });
    }
  }

  // กรองตามความมั่นใจ (ทับบนผลค้นหา) + นับจำนวนต่อระดับ
  const bandCounts = { all: visible.length, high: 0, review: 0, low: 0 };
  for (const g of visible) bandCounts[confidenceBand(g.deltaSatang)]++;
  const shown = bandFilter === "all" ? visible : visible.filter((g) => confidenceBand(g.deltaSatang) === bandFilter);

  // เลือกได้เฉพาะรายการที่ "ยืนยันอยู่" (ย้อนได้) — ที่ย้อนแล้วเลือกไม่ได้
  const confirmedVisible = shown.filter((g) => g.status === "confirmed");
  const allSelected = confirmedVisible.length > 0 && confirmedVisible.every((g) => selected.has(g.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(confirmedVisible.map((g) => g.id)));

  async function doBulkRevert(reason: string) {
    setBusy(true);
    const res = await bulkRevertGroupsAction({ groupIds: [...selected], reason });
    setBusy(false);
    setBulkOpen(false);
    if (res.ok) {
      setFeedback({
        kind: "ok",
        message: `ย้อน ${res.reverted} รายการแล้ว${res.skipped ? ` · ข้าม ${res.skipped} (ล็อกงวด/ย้อนไม่ได้)` : ""} — กลับไปรอจับคู่ใหม่ + ปลดสีรุ้ง CashHub`,
      });
      setSelected(new Set());
      startTransition(() => router.refresh());
    } else {
      setFeedback({ kind: "error", message: res.error ?? "ทำรายการไม่สำเร็จ" });
    }
  }

  return (
    <div className="space-y-4">
      {/* search */}
      <form onSubmit={submitSearch} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหา 2 ขา: บัญชี · รายการบัญชี/ธนาคาร · ผู้ขาย/ลูกค้า · จำนวนเงิน · เหตุผล"
            className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          />
        </div>
        <button
          type="submit"
          className="press min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          ค้นหา
        </button>
      </form>

      {/* note about CashHub สีรุ้ง */}
      <div className="flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-2.5 text-xs text-sky-800">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          การ “ย้อนกลับ” จะปลดการจับคู่ — รายการกลับไปรอจับคู่ใหม่ และ <strong>สีรุ้งใน CashHub
          จะถูกปลดออก</strong> ด้วย (ยอดนั้นจะกลับเป็น “ยังไม่แมตช์”)
        </span>
      </div>

      {feedback && (
        <FeedbackBar kind={feedback.kind} message={feedback.message} onDismiss={() => setFeedback(null)} />
      )}

      {/* กรองความมั่นใจ — ดูว่ามั่นใจแค่ไหน + กดดูทีละระดับ (ยอดตรงเป๊ะ = มั่นใจสูง) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-zinc-400">ความมั่นใจ:</span>
        <BandChip active={bandFilter === "all"} onClick={() => setBandFilter("all")} label="ทั้งหมด" count={bandCounts.all} />
        <BandChip active={bandFilter === "high"} onClick={() => setBandFilter("high")} band="high" count={bandCounts.high} />
        <BandChip active={bandFilter === "review"} onClick={() => setBandFilter("review")} band="review" count={bandCounts.review} />
        <BandChip active={bandFilter === "low"} onClick={() => setBandFilter("low")} band="low" count={bandCounts.low} />
      </div>

      {/* result count + เลือกทั้งหมด (super_admin) */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-zinc-400">
          {shown.length} รายการ{shown.length !== groups.length ? ` (จากทั้งหมด ${groups.length})` : ""}
        </p>
        {isSuper && confirmedVisible.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="press inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-brand-300 sm:min-h-0"
          >
            {allSelected ? <CheckSquare size={14} className="text-brand-600" /> : <Square size={14} />}
            {allSelected ? "ยกเลิกเลือกทั้งหมด" : `เลือกทั้งหมด (${confirmedVisible.length})`}
          </button>
        )}
      </div>

      {/* list */}
      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-14 text-center">
          <Landmark size={28} className="mx-auto mb-2 text-zinc-300" />
          <p className="text-sm font-medium text-zinc-600">{bandFilter === "all" ? "ยังไม่มีรายการในคลัง" : "ไม่มีรายการในระดับความมั่นใจนี้"}</p>
          <p className="text-xs text-zinc-400">{bandFilter === "all" ? "รายการที่ยืนยัน/ย้อนแล้วจะมาแสดงที่นี่" : "ลองเลือกระดับอื่นด้านบน"}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((g) => (
            <ArchiveCard
              key={g.id}
              group={g}
              isSuper={isSuper}
              onRevert={() => {
                setFeedback(null);
                setTarget(g);
              }}
              disabled={pending}
              selectable={isSuper && g.status === "confirmed"}
              checked={selected.has(g.id)}
              onToggle={() => toggleOne(g.id)}
            />
          ))}
        </ul>
      )}

      {/* แถบล่าง: เลือกหลายรายการแล้วย้อนพร้อมกัน (เฉพาะ super_admin) */}
      {isSuper && selected.size > 0 && (
        <div className="safe-bottom sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-lg">
          <span className="text-sm text-zinc-700">เลือก <b className="tabular-num">{selected.size}</b> รายการ</span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="press inline-flex min-h-11 items-center gap-1 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-500 hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-brand-300 sm:min-h-0 sm:py-2"
            >
              <X size={14} /> ล้าง
            </button>
            <button
              type="button"
              disabled={pending || busy}
              onClick={() => { setFeedback(null); setBulkOpen(true); }}
              className="press inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-rose-300 sm:min-h-0 sm:py-2"
            >
              <Undo2 size={15} /> ย้อนกลับที่เลือก ({selected.size})
            </button>
          </div>
        </div>
      )}

      <ReasonModal
        open={!!target || bulkOpen}
        busy={busy}
        title={
          bulkOpen
            ? `ย้อนกลับ ${selected.size} รายการที่เลือก`
            : isSuper ? "ย้อนรายการที่ยืนยันแล้ว" : "ขออนุมัติแก้รายการ"
        }
        description={
          bulkOpen
            ? `ระบุเหตุผล — จะย้อน ${selected.size} รายการที่เลือกพร้อมกัน (กลับไปรอจับคู่ใหม่ + ปลดสีรุ้ง CashHub) · ที่ล็อกงวดจะถูกข้าม`
            : isSuper
              ? "ระบุเหตุผลที่ย้อน — รายการจะกลับไปรอจับคู่ใหม่ทันที (และปลดสีรุ้ง CashHub)"
              : "ระบุเหตุผล — จะส่งให้ super admin อนุมัติก่อนจึงย้อนได้"
        }
        confirmLabel={bulkOpen ? `ย้อน ${selected.size} รายการ` : isSuper ? "ย้อนกลับ" : "ส่งคำขอ"}
        confirmTone={bulkOpen || isSuper ? "rose" : "brand"}
        placeholder="เช่น จับคู่ผิดบัญชี / ยอดไม่ตรง / ต้องแก้ใบ..."
        onConfirm={bulkOpen ? doBulkRevert : doRevert}
        onClose={() => { setTarget(null); setBulkOpen(false); }}
      />
    </div>
  );
}

function ArchiveCard({
  group: g,
  isSuper,
  onRevert,
  disabled,
  selectable,
  checked,
  onToggle,
}: {
  group: ArchiveGroup;
  isSuper: boolean;
  onRevert: () => void;
  disabled: boolean;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const bookItems = g.items.filter((i) => i.kind === "book");
  const bankItems = g.items.filter((i) => i.kind === "bank");
  const hasDelta = g.deltaSatang !== 0;
  const band = confidenceBand(g.deltaSatang);
  const meta = BAND_META[band];

  return (
    <li className={`overflow-hidden rounded-2xl border bg-white shadow-soft ${checked ? "border-rose-300 ring-1 ring-rose-200" : "border-zinc-100"}`}>
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2">
        {selectable && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-label="เลือกรายการนี้เพื่อย้อนกลับ"
            className="size-4 shrink-0 cursor-pointer rounded border-zinc-300 text-rose-600 focus-visible:ring-2 focus-visible:ring-rose-300"
          />
        )}
        <StatusBadge status={g.status} />
        {g.matchType !== "transfer" && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.pill}`}>
            <span className={`size-1.5 rounded-full ${meta.dot}`} aria-hidden /> {meta.label}
          </span>
        )}
        <span className="text-sm font-medium text-zinc-700">{g.accountLabel ?? "ทุกบัญชี"}</span>
        {g.matchType === "transfer" && (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
            โยกเงิน
          </span>
        )}
        <span className="ml-auto text-xs text-zinc-400">
          {g.status === "reversed"
            ? `ย้อนเมื่อ ${thDate(g.reversedAt)}`
            : `ยืนยันเมื่อ ${thDate(g.confirmedAt)}`}
        </span>
      </div>

      {/* totals */}
      <div className="grid grid-cols-3 divide-x divide-zinc-100 border-b border-zinc-100 text-center">
        <div className="px-3 py-1.5">
          <p className="text-[11px] text-zinc-400">ฝั่งบัญชี (book)</p>
          <p className="tabular-num text-sm font-semibold text-zinc-800">฿{(Math.abs(g.bookTotalSatang) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="px-3 py-1.5">
          <p className="text-[11px] text-zinc-400">ฝั่งธนาคาร (bank)</p>
          <p className="tabular-num text-sm font-semibold text-zinc-800">฿{(Math.abs(g.bankTotalSatang) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="px-3 py-1.5">
          <p className="text-[11px] text-zinc-400">ส่วนต่าง</p>
          <p className={`tabular-num text-sm font-semibold ${hasDelta ? "text-amber-600" : "text-emerald-600"}`}>
            ฿{(Math.abs(g.deltaSatang) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* matched items: book vs bank */}
      <div className="grid gap-2 px-4 py-2.5 sm:grid-cols-2">
        <ItemColumn title="รายการบัญชี" icon="book" items={bookItems} />
        <ItemColumn title="รายการธนาคาร" icon="bank" items={bankItems} />
      </div>

      {/* reversal reason */}
      {g.status === "reversed" && g.reversalReason && (
        <div className="border-t border-zinc-100 bg-zinc-50/60 px-4 py-2 text-xs text-zinc-500">
          เหตุผลที่ย้อน: <span className="text-zinc-700">{g.reversalReason}</span>
        </div>
      )}

      {/* actions */}
      {g.status === "confirmed" && (
        <div className="border-t border-zinc-100 px-4 py-2">
          <button
            type="button"
            onClick={onRevert}
            disabled={disabled}
            className={`press inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium focus-visible:ring-2 disabled:opacity-50 sm:min-h-0 sm:py-2 ${
              isSuper
                ? "border-rose-200 text-rose-700 hover:bg-rose-50 focus-visible:ring-rose-300"
                : "border-amber-200 text-amber-700 hover:bg-amber-50 focus-visible:ring-amber-300"
            }`}
          >
            {isSuper ? <Undo2 size={15} /> : <FileSignature size={15} />}
            {isSuper ? "ย้อนกลับ" : "ขออนุมัติแก้"}
          </button>
        </div>
      )}
    </li>
  );
}

// ชิปกรองความมั่นใจ (สี/จุดตามระดับ) — ไม่มี band = ชิป "ทั้งหมด"
function BandChip({ active, onClick, label, count, band }: {
  active: boolean; onClick: () => void; label?: string; count: number; band?: Band;
}) {
  const meta = band ? BAND_META[band] : null;
  const cls = active
    ? (meta ? meta.chip : "border-zinc-800 bg-zinc-900 text-white")
    : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active ? "true" : "false"}
      className={`press inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-brand-300 sm:min-h-0 ${cls}`}
    >
      <span className={`size-2 rounded-full ${meta ? meta.dot : "bg-zinc-300"}`} aria-hidden />
      {label ?? meta?.label}
      <span className="tabular-num opacity-70">{count}</span>
    </button>
  );
}

function ItemColumn({
  title,
  icon,
  items,
}: {
  title: string;
  icon: "book" | "bank";
  items: ArchiveGroup["items"];
}) {
  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50/40 p-2.5">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-zinc-300">—</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2">
              {it.amountSatang >= 0 ? (
                <ArrowDownLeft size={14} className="shrink-0 text-emerald-500" />
              ) : (
                <ArrowUpRight size={14} className="shrink-0 text-rose-500" />
              )}
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-700">{it.label}</span>
              <span className="shrink-0 text-[11px] text-zinc-400">{thDate(it.date)}</span>
              <Money satang={it.amountSatang} className="shrink-0 text-xs" />
            </li>
          ))}
        </ul>
      )}
      {icon === "book" && items.some((i) => i.paymentChannel) && (
        <p className="mt-1.5 text-[10px] text-zinc-400">
          {Array.from(new Set(items.map((i) => i.paymentChannel).filter(Boolean))).join(" · ")}
        </p>
      )}
    </div>
  );
}
