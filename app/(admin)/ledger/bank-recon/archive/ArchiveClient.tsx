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
} from "lucide-react";
import type { ArchiveGroup } from "@/lib/ledger/recon-controls";
import {
  revertConfirmedGroupAction,
  requestRevertAction,
} from "../_recon-controls-actions";
import { Money, thDate, StatusBadge, ReasonModal, FeedbackBar } from "../_components/recon-controls-ui";

interface Props {
  groups: ArchiveGroup[];
  initialQuery: string;
  companyId: string;
  isSuper: boolean;
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

  return (
    <div className="space-y-4">
      {/* search */}
      <form onSubmit={submitSearch} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหา: ชื่อบัญชี · ผู้ขาย/ลูกค้า · จำนวนเงิน · เหตุผลที่ย้อน"
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

      {/* result count */}
      <p className="text-xs text-zinc-400">
        {visible.length} รายการ{q ? ` (กรองจากทั้งหมด ${groups.length})` : ""}
      </p>

      {/* list */}
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-14 text-center">
          <Landmark size={28} className="mx-auto mb-2 text-zinc-300" />
          <p className="text-sm font-medium text-zinc-600">ยังไม่มีรายการในคลัง</p>
          <p className="text-xs text-zinc-400">รายการที่ยืนยัน/ย้อนแล้วจะมาแสดงที่นี่</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((g) => (
            <ArchiveCard
              key={g.id}
              group={g}
              isSuper={isSuper}
              onRevert={() => {
                setFeedback(null);
                setTarget(g);
              }}
              disabled={pending}
            />
          ))}
        </ul>
      )}

      <ReasonModal
        open={!!target}
        busy={busy}
        title={isSuper ? "ย้อนรายการที่ยืนยันแล้ว" : "ขออนุมัติแก้รายการ"}
        description={
          isSuper
            ? "ระบุเหตุผลที่ย้อน — รายการจะกลับไปรอจับคู่ใหม่ทันที (และปลดสีรุ้ง CashHub)"
            : "ระบุเหตุผล — จะส่งให้ super admin อนุมัติก่อนจึงย้อนได้"
        }
        confirmLabel={isSuper ? "ย้อนกลับ" : "ส่งคำขอ"}
        confirmTone={isSuper ? "rose" : "brand"}
        placeholder="เช่น จับคู่ผิดบัญชี / ยอดไม่ตรง / ต้องแก้ใบ..."
        onConfirm={doRevert}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}

function ArchiveCard({
  group: g,
  isSuper,
  onRevert,
  disabled,
}: {
  group: ArchiveGroup;
  isSuper: boolean;
  onRevert: () => void;
  disabled: boolean;
}) {
  const bookItems = g.items.filter((i) => i.kind === "book");
  const bankItems = g.items.filter((i) => i.kind === "bank");
  const hasDelta = g.deltaSatang !== 0;

  return (
    <li className="overflow-hidden rounded-2xl border border-zinc-100 bg-white shadow-soft">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-3">
        <StatusBadge status={g.status} />
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
        <div className="px-3 py-2">
          <p className="text-[11px] text-zinc-400">ฝั่งบัญชี (book)</p>
          <p className="tabular-num text-sm font-semibold text-zinc-800">฿{(Math.abs(g.bookTotalSatang) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="px-3 py-2">
          <p className="text-[11px] text-zinc-400">ฝั่งธนาคาร (bank)</p>
          <p className="tabular-num text-sm font-semibold text-zinc-800">฿{(Math.abs(g.bankTotalSatang) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="px-3 py-2">
          <p className="text-[11px] text-zinc-400">ส่วนต่าง</p>
          <p className={`tabular-num text-sm font-semibold ${hasDelta ? "text-amber-600" : "text-emerald-600"}`}>
            ฿{(Math.abs(g.deltaSatang) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* matched items: book vs bank */}
      <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
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
        <div className="border-t border-zinc-100 px-4 py-2.5">
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
