"use client";

// สลิปลอย — บัญชีจับคู่สลิปกับบิลที่ค้างจ่าย. การกันจ่ายซ้ำเกิดตอนรับสลิปแล้ว
// (QR transRef / sha256) → หน้านี้แค่ "ผูกสลิป↔บิล" + flip บิลเป็นจ่ายแล้ว.

import { useMemo, useState, useTransition } from "react";
import { Banknote, Loader2, Link2, ImageOff } from "lucide-react";
import { matchFloatingSlip } from "../../_actions";

interface Slip {
  id: string;
  amount: number;
  sendingBank: string | null;
  transRef: string | null;
  slipUrl: string | null;
  slipThumbUrl: string | null;
  qrDecoded: boolean;
  paidAt: string | null;
  createdAt: string;
}
interface Bill {
  id: string;
  docCode: string;
  vendor: string | null;
  total: number;
  docDate: string | null;
}

const baht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function SlipCard({ slip, bills, canMatch }: { slip: Slip; bills: Bill[]; canMatch: boolean }) {
  // บิลยอดตรงเป๊ะขึ้นก่อน (ตัวช่วยให้บัญชีเลือกถูกเร็ว) — แต่เลือกบิลไหนก็ได้.
  const sortedBills = useMemo(() => {
    const exact = bills.filter((b) => Math.abs(b.total - slip.amount) < 0.005);
    const rest = bills.filter((b) => Math.abs(b.total - slip.amount) >= 0.005);
    return [...exact, ...rest];
  }, [bills, slip.amount]);

  const [billId, setBillId] = useState(sortedBills[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function match() {
    if (!billId) return;
    setErr(null);
    start(async () => {
      const res = await matchFloatingSlip(slip.id, billId);
      if (res.ok) setDone(true);
      else setErr(res.error ?? "จับคู่ไม่สำเร็จ");
    });
  }

  if (done) {
    return (
      <li className="animate-scale-in rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
        ✅ จับคู่สลิป {baht(slip.amount)} บาทเรียบร้อย บิลถูกตั้งเป็น “จ่ายแล้ว”
      </li>
    );
  }

  return (
    <li className="animate-fade-up rounded-xl border border-zinc-200 bg-white p-3 transition-shadow hover:shadow-sm">
      <div className="flex gap-3">
        {slip.slipThumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={slip.slipThumbUrl}
            alt="สลิป"
            className="size-16 shrink-0 rounded-lg border border-zinc-200 object-cover"
          />
        ) : (
          <div className="grid size-16 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-400">
            <ImageOff className="size-5" aria-hidden />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800">
            <Banknote className="size-4 text-emerald-600" aria-hidden />
            {baht(slip.amount)} บาท
          </p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {slip.sendingBank ? `ธนาคาร ${slip.sendingBank} · ` : ""}
            {slip.transRef ? `อ้างอิง ${slip.transRef}` : slip.qrDecoded ? "อ่าน QR แล้ว" : "ไม่มี QR (อ่านยอดด้วย AI)"}
          </p>
        </div>
      </div>

      {canMatch ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={billId}
            onChange={(e) => setBillId(e.target.value)}
            disabled={pending}
            aria-label="เลือกบิลที่จะจับคู่"
            className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
          >
            {sortedBills.length === 0 && <option value="">— ไม่มีบิลค้างจ่าย —</option>}
            {sortedBills.map((b) => (
              <option key={b.id} value={b.id}>
                {b.docCode} · {b.vendor ?? "ไม่ระบุร้าน"} · {baht(b.total)}
                {Math.abs(b.total - slip.amount) < 0.005 ? " ✓ยอดตรง" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={match}
            disabled={pending || !billId}
            className="press inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--color-brand-600)] px-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-brand-700)] disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
            จับคู่ + ตั้งจ่ายแล้ว
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">เฉพาะบัญชี/ผู้ดูแลจับคู่สลิปได้</p>
      )}
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
    </li>
  );
}

export function FloatingSlipList({
  slips,
  bills,
  canMatch,
}: {
  slips: Slip[];
  bills: Bill[];
  canMatch: boolean;
}) {
  if (slips.length === 0) {
    return (
      <div className="animate-fade-in rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500">
        ไม่มีสลิปลอย ระบบจับคู่สลิปกับบิลให้อัตโนมัติเมื่อยอดตรงและเจอบิลเดียว
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      {slips.map((s) => (
        <SlipCard key={s.id} slip={s} bills={bills} canMatch={canMatch} />
      ))}
    </ul>
  );
}
