"use client";

// Month calendar of MaidDailyPay rows. Click a cell → modal to record/edit.
// Right-click row trash → delete. Sun = first col (Thai convention).

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, X, Trash2 } from "lucide-react";
import { recordPay, deletePay } from "../../../actions";
import { baht } from "@/lib/chairops/utils/format";

interface PayCell {
  id: string;
  date: string;
  amount: number;
  note: string | null;
  paidByName: string;
  paidAt: string;
}

export function PayCalendarGrid({
  maidId,
  ym,
  rows,
}: {
  maidId: string;
  ym: string;
  rows: PayCell[];
}) {
  const byDate = useMemo(() => {
    const m = new Map<string, PayCell>();
    for (const r of rows) m.set(r.date, r);
    return m;
  }, [rows]);

  const cells = useMemo(() => buildMonthGrid(ym), [ym]);

  const [editing, setEditing] = useState<{ date: string; existing: PayCell | null } | null>(null);

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 text-center text-[11px] font-semibold uppercase text-zinc-500">
          {["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"].map((d) => (
            <div key={d} className="px-1 py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((c, i) => {
            const row = c.dateYmd ? byDate.get(c.dateYmd) ?? null : null;
            const isToday = c.dateYmd === todayBkkYmd();
            return (
              <button
                key={i}
                type="button"
                onClick={() => c.dateYmd && setEditing({ date: c.dateYmd, existing: row })}
                disabled={!c.dateYmd}
                className={
                  "flex min-h-[72px] flex-col items-stretch border-b border-r border-zinc-100 p-1.5 text-left transition-colors " +
                  (!c.dateYmd
                    ? "bg-zinc-50/60"
                    : row
                      ? row.amount < 0
                        ? "bg-rose-50 hover:bg-rose-100"
                        : "bg-emerald-50 hover:bg-emerald-100"
                      : "hover:bg-zinc-50")
                }
              >
                {c.dateYmd && (
                  <>
                    <div className="text-xs font-medium text-zinc-700">
                      <span
                        className={
                          isToday
                            ? "inline-flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white"
                            : ""
                        }
                      >
                        {c.day}
                      </span>
                    </div>
                    {row && (
                      <div className="mt-auto">
                        <div
                          className={
                            "tabular-nums text-xs font-bold " +
                            (row.amount < 0 ? "text-rose-700" : "text-emerald-800")
                          }
                        >
                          {baht(row.amount, row.amount > 0)}
                        </div>
                        {row.note && (
                          <div className="truncate text-[10px] text-zinc-500">{row.note}</div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {editing && (
        <RecordPayModal
          maidId={maidId}
          date={editing.date}
          existing={editing.existing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function RecordPayModal({
  maidId,
  date,
  existing,
  onClose,
}: {
  maidId: string;
  date: string;
  existing: PayCell | null;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(existing?.amount.toString() ?? "");
  const [note, setNote] = useState(existing?.note ?? "");

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("maidId", maidId);
    fd.set("date", date);
    startTransition(async () => {
      const res = await recordPay(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("บันทึกค่าจ้างแล้ว");
      onClose();
    });
  }

  function onDelete() {
    if (!existing) return;
    if (!window.confirm("ลบรายการนี้?")) return;
    const fd = new FormData();
    fd.set("id", existing.id);
    startTransition(async () => {
      const res = await deletePay(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("ลบรายการแล้ว");
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <form
        onSubmit={onSave}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-zinc-500">บันทึกค่าจ้าง</div>
            <h2 className="text-base font-semibold text-zinc-900">{date}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100"
            aria-label="ปิด"
          >
            <X className="size-4" />
          </button>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-xs text-zinc-600">ยอดเงิน (฿) · ติดลบ = หัก</span>
          <input
            name="amount"
            type="number"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="เช่น 500 หรือ -200 (หักค่าชุด)"
            required
            min={-1000000}
            max={1000000}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-right text-lg font-semibold tabular-nums"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-zinc-600">หมายเหตุ (ไม่บังคับ)</span>
          <input
            name="note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="เช่น 500=ค่าจ้าง 8 ตู้ · -200=หักค่าชุด"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
          />
        </label>

        <div className="flex items-center gap-2">
          {existing && (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40"
            >
              <Trash2 className="size-4" /> ลบ
            </button>
          )}
          <button
            type="submit"
            disabled={pending}
            className="grow inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {pending ? "กำลังบันทึก..." : existing ? "อัพเดต" : "บันทึก"}
          </button>
        </div>
      </form>
    </div>
  );
}

interface CalendarCell {
  day: number;
  dateYmd: string | null; // null for blank padding
}

function buildMonthGrid(ym: string): CalendarCell[] {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const startWeekday = first.getUTCDay(); // 0=Sun
  const daysInMonth = last.getUTCDate();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ day: 0, dateYmd: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(m).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    cells.push({ day: d, dateYmd: `${y}-${mm}-${dd}` });
  }
  while (cells.length % 7 !== 0) cells.push({ day: 0, dateYmd: null });
  return cells;
}

function todayBkkYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
