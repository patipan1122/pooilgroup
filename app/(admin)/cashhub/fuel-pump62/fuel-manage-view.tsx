"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  Copy,
  Check,
  AlertTriangle,
  Clock3,
  Filter,
} from "lucide-react";

export interface FuelRow {
  report_date: string;
  shift: "morning" | "evening";
  liters: number | string | null;
  total_sales: number | string | null;
  fuel_sales: number | string | null;
  engine_oil_sales: number | string | null;
  cash_submitted: number | string | null;
  cash_banked: number | string | null;
  cash_diff_sheet: number | string | null;
  cash_diff_calc: number | string | null;
  credit: number | string | null;
  transfer_total: number | string | null;
  card_total: number | string | null;
  grand_total_both: number | string | null;
  staff_name: string | null;
  note: string | null;
  recon_status: "ok" | "pending_deposit" | "shortage" | "overage" | "mismatch";
  anomaly_codes: string[];
  bank_breakdown: Record<string, Record<string, number | null>> | null;
  sheet_tab: string;
  source_fetched_at: string | null;
}

const n = (x: number | string | null): number | null =>
  x === null || x === undefined || x === "" ? null : Number(x);
const baht = (x: number | string | null) => {
  const v = n(x);
  return v === null ? "—" : "฿" + v.toLocaleString("th-TH", { maximumFractionDigits: 2 });
};
const numTH = (x: number | string | null) => {
  const v = n(x);
  return v === null ? "—" : v.toLocaleString("th-TH", { maximumFractionDigits: 2 });
};

const STATUS: Record<
  FuelRow["recon_status"],
  { label: string; cls: string; dot: string }
> = {
  ok: { label: "ปกติ", cls: "text-[var(--ch-text-2)]", dot: "bg-[var(--ch-ok)]" },
  pending_deposit: {
    label: "รอเงินเข้า",
    cls: "text-[#a16207] bg-[var(--ch-pending,#fef9c3)]",
    dot: "bg-[#eab308]",
  },
  shortage: {
    label: "เงินขาด",
    cls: "text-[var(--ch-danger)] bg-[var(--ch-danger-bg,#fef2f2)]",
    dot: "bg-[var(--ch-danger)]",
  },
  overage: {
    label: "เงินเกิน",
    cls: "text-[#a16207] bg-[var(--ch-pending,#fef9c3)]",
    dot: "bg-[#eab308]",
  },
  mismatch: {
    label: "ตัวเลขไม่ตรง",
    cls: "text-[var(--ch-danger)] bg-[var(--ch-danger-bg,#fef2f2)]",
    dot: "bg-[var(--ch-danger)]",
  },
};

const ANOMALY_TH: Record<string, string> = {
  sales_no_liters: "มียอดขายแต่ลิตรเป็น 0",
  liters_no_sales: "มีลิตรแต่ยอดขายเป็น 0",
  negative_value: "มีค่าติดลบผิดปกติ",
  bank_total_mismatch: "QR+บัตรแยกบัญชี ไม่เท่ายอดรวมต่อกะ",
  missing_shift: "วันนี้มีกะเดียว",
};

function reasonOf(r: FuelRow): string[] {
  const out: string[] = [];
  if (r.recon_status === "pending_deposit") out.push("ส่งเงินแล้วยังไม่เข้าบัญชี (รอนำฝาก)");
  if (r.recon_status === "shortage")
    out.push(`เงินขาด ${baht(Math.abs(n(r.cash_diff_calc) ?? 0))}`);
  if (r.recon_status === "overage")
    out.push(`เงินเกิน ${baht(n(r.cash_diff_calc) ?? 0)}`);
  if (r.recon_status === "mismatch")
    out.push(
      `ส่วนต่างในชีต (${numTH(r.cash_diff_sheet)}) ไม่ตรงคำนวณ (${numTH(r.cash_diff_calc)})`,
    );
  for (const c of r.anomaly_codes ?? []) out.push(ANOMALY_TH[c] ?? c);
  return out;
}

const isFlagged = (r: FuelRow) =>
  r.recon_status === "shortage" ||
  r.recon_status === "overage" ||
  r.recon_status === "mismatch" ||
  (r.anomaly_codes?.length ?? 0) > 0;

const monthKey = (d: string) => d.slice(0, 7);
const THMON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const monthLabel = (k: string) => {
  const [y, m] = k.split("-");
  return `${THMON[Number(m) - 1]} ${y}`;
};

function relative(iso: string | null): string {
  if (!iso) return "—";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "เมื่อสักครู่";
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  return new Date(iso).toLocaleDateString("th-TH");
}

export function FuelManageView({
  rows,
  fetchedAt,
}: {
  rows: FuelRow[];
  fetchedAt: string | null;
}) {
  const months = useMemo(
    () => Array.from(new Set(rows.map((r) => monthKey(r.report_date)))).sort().reverse(),
    [rows],
  );
  const [month, setMonth] = useState(months[0] ?? "");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [copied, setCopied] = useState(false);

  const monthRows = useMemo(
    () => rows.filter((r) => monthKey(r.report_date) === month),
    [rows, month],
  );

  const kpi = useMemo(() => {
    let sales = 0,
      banked = 0,
      pendingCnt = 0,
      pendingAmt = 0,
      realDiffCnt = 0;
    for (const r of monthRows) {
      sales += n(r.total_sales) ?? 0;
      banked += n(r.cash_banked) ?? 0;
      if (r.recon_status === "pending_deposit") {
        pendingCnt++;
        pendingAmt += n(r.cash_submitted) ?? 0;
      }
      if (["shortage", "overage", "mismatch"].includes(r.recon_status)) realDiffCnt++;
    }
    return { sales, banked, pendingCnt, pendingAmt, realDiffCnt };
  }, [monthRows]);

  const flagged = useMemo(() => monthRows.filter(isFlagged), [monthRows]);

  // group by day for the table
  const days = useMemo(() => {
    const map = new Map<string, FuelRow[]>();
    for (const r of monthRows) {
      const arr = map.get(r.report_date) ?? [];
      arr.push(r);
      map.set(r.report_date, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [monthRows]);

  function copyFlagged() {
    const lines = flagged.map((r) => {
      const d = new Date(r.report_date).toLocaleDateString("th-TH");
      const sh = r.shift === "morning" ? "เช้า" : "ค่ำ";
      return `• ${d} (${sh})${r.staff_name ? " " + r.staff_name : ""}: ${reasonOf(r).join(" · ")}`;
    });
    const text = `แถวที่ต้องตรวจ ปั๊ม 62 — ${monthLabel(month)}\n${lines.join("\n")}`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-5">
      {/* month switcher */}
      <div className="flex flex-wrap items-center gap-2">
        {months.map((m) => (
          <button
            key={m}
            onClick={() => setMonth(m)}
            className={
              "rounded-full px-3 py-1.5 text-sm font-semibold border transition-all " +
              (m === month
                ? "bg-[var(--ch-brand)] text-white border-[var(--ch-brand)]"
                : "bg-white text-[var(--ch-text-2)] border-[var(--ch-border)] hover:border-[var(--ch-brand)]")
            }
          >
            {monthLabel(m)}
          </button>
        ))}
        <span className="ml-auto text-xs text-[var(--ch-text-2)] inline-flex items-center gap-1">
          <Clock3 className="size-3" /> ดึงล่าสุด {relative(fetchedAt)}
        </span>
      </div>

      {/* ZONE 1 — KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="ยอดขายรวมเดือนนี้" value={baht(kpi.sales)} tone="brand" />
        <Kpi label="เงินเข้าธนาคารแล้ว" value={baht(kpi.banked)} tone="ok" />
        <Kpi
          label="รอเงินเข้า 🟡"
          value={`${kpi.pendingCnt} กะ`}
          sub={baht(kpi.pendingAmt)}
          tone="pending"
        />
        <Kpi
          label="ส่วนต่างต้องตรวจ 🔴"
          value={`${kpi.realDiffCnt} กะ`}
          tone={kpi.realDiffCnt > 0 ? "danger" : "muted"}
        />
      </div>

      {/* ZONE 2 — rows to check */}
      {flagged.length > 0 && (
        <div className="rounded-2xl border border-[var(--ch-border)] bg-white overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 bg-[var(--ch-bg-2)] border-b border-[var(--ch-border)]">
            <div className="font-bold text-[var(--ch-text)] flex items-center gap-2">
              <AlertTriangle className="size-4 text-[var(--ch-danger)]" />
              🔎 แถวที่ต้องตรวจ ({flagged.length})
            </div>
            <button
              onClick={copyFlagged}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ch-border)] bg-white px-2.5 py-1.5 text-xs font-semibold hover:border-[var(--ch-brand)]"
            >
              {copied ? <Check className="size-3.5 text-[var(--ch-ok)]" /> : <Copy className="size-3.5" />}
              {copied ? "คัดลอกแล้ว" : "คัดลอกให้คนปั๊มแก้"}
            </button>
          </div>
          <ul className="divide-y divide-[var(--ch-border)]">
            {flagged.map((r, i) => {
              const st = STATUS[r.recon_status];
              return (
                <li key={i} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                  <span className={"mt-1 size-2 rounded-full shrink-0 " + st.dot} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-semibold">
                        {new Date(r.report_date).toLocaleDateString("th-TH")}
                      </span>
                      <span className="text-[var(--ch-text-2)]">
                        {r.shift === "morning" ? "เช้า" : "ค่ำ"}
                      </span>
                      <span className={"rounded px-1.5 py-0.5 text-[11px] font-semibold " + st.cls}>
                        {st.label}
                      </span>
                      {r.staff_name && (
                        <span className="text-[var(--ch-text-2)] text-xs">· {r.staff_name}</span>
                      )}
                    </div>
                    <p className="text-[var(--ch-text-2)] text-xs mt-0.5">
                      {reasonOf(r).join(" · ")}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ZONE 3 — sheet-like table */}
      <details className="rounded-2xl border border-[var(--ch-border)] bg-white overflow-hidden group" open>
        <summary className="flex items-center justify-between gap-2 px-4 py-3 bg-[var(--ch-bg-2)] cursor-pointer list-none">
          <span className="font-bold text-[var(--ch-text)]">📋 ตารางเหมือนในชีต — {monthLabel(month)}</span>
          <span className="flex items-center gap-3">
            <button
              onClick={(e) => {
                e.preventDefault();
                setOnlyFlagged((v) => !v);
              }}
              className={
                "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold " +
                (onlyFlagged
                  ? "bg-[var(--ch-brand)] text-white border-[var(--ch-brand)]"
                  : "bg-white text-[var(--ch-text-2)] border-[var(--ch-border)]")
              }
            >
              <Filter className="size-3" /> ผิดปกติเท่านั้น
            </button>
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[820px]">
            <thead className="sticky top-14 sm:top-16 z-20 bg-[var(--ch-bg-2)]">
              <tr className="text-[var(--ch-text-2)] text-xs">
                <Th>วัน</Th>
                <Th>กะ</Th>
                <Th right>ลิตร</Th>
                <Th right>ยอดขาย</Th>
                <Th right>เงินสดส่ง</Th>
                <Th right>เข้าบัญชี</Th>
                <Th right>ส่วนต่าง</Th>
                <Th right>เครดิต</Th>
                <Th>พนักงาน</Th>
                <Th>สถานะ</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {days.map(([date, drows]) => {
                const visible = onlyFlagged ? drows.filter(isFlagged) : drows;
                if (visible.length === 0) return null;
                return visible.map((r, idx) => (
                  <FuelTr key={date + r.shift} r={r} dayHead={idx === 0 ? date : null} />
                ));
              })}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-[11px] text-[var(--ch-text-2)] border-t border-[var(--ch-border)]">
          กดลูกศรท้ายแถวเพื่อดูรายละเอียด QR/บัตรเครดิต แยก 3 ธนาคาร
        </p>
      </details>
    </div>
  );
}

function FuelTr({
  r,
  dayHead,
}: {
  r: FuelRow;
  dayHead: string | null;
}) {
  const [open, setOpen] = useState(false);
  const st = STATUS[r.recon_status];
  const diff = n(r.cash_diff_calc);
  const diffTone =
    r.recon_status === "pending_deposit"
      ? "text-[#a16207]"
      : r.recon_status === "shortage" || r.recon_status === "mismatch"
        ? "text-[var(--ch-danger)]"
        : r.recon_status === "overage"
          ? "text-[#a16207]"
          : "text-[var(--ch-text-2)]";
  const flagged = isFlagged(r);
  const bb = r.bank_breakdown ?? {};
  return (
    <>
      <tr
        className="border-t border-[var(--ch-border)]"
        style={flagged ? { boxShadow: "inset 3px 0 0 var(--ch-danger)" } : undefined}
      >
        <td className="px-2 py-1.5 align-top text-[var(--ch-text-2)]">
          {dayHead ? (
            <span className="font-semibold text-[var(--ch-text)]">
              {new Date(dayHead).getDate()}
            </span>
          ) : (
            ""
          )}
        </td>
        <td className="px-2 py-1.5">{r.shift === "morning" ? "เช้า" : "ค่ำ"}</td>
        <td className="px-2 py-1.5 text-right ch-tnum">{numTH(r.liters)}</td>
        <td className="px-2 py-1.5 text-right ch-tnum font-medium">{baht(r.total_sales)}</td>
        <td className="px-2 py-1.5 text-right ch-tnum">{baht(r.cash_submitted)}</td>
        <td className="px-2 py-1.5 text-right ch-tnum">
          {r.cash_banked === null ? (
            <span className="text-[#a16207]">รอลงแบงก์</span>
          ) : (
            baht(r.cash_banked)
          )}
        </td>
        <td className={"px-2 py-1.5 text-right ch-tnum " + diffTone}>
          {diff === null ? "—" : numTH(diff)}
        </td>
        <td className="px-2 py-1.5 text-right ch-tnum">{baht(r.credit)}</td>
        <td className="px-2 py-1.5 text-[var(--ch-text-2)] text-xs">{r.staff_name ?? "—"}</td>
        <td className="px-2 py-1.5">
          <span className={"inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold " + st.cls}>
            <span className={"size-1.5 rounded-full " + st.dot} />
            {st.label}
          </span>
        </td>
        <td className="px-2 py-1.5 text-right">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="ดูรายละเอียดธนาคาร"
            className="text-[var(--ch-text-2)] hover:text-[var(--ch-brand)]"
          >
            <ChevronDown className={"size-4 transition-transform " + (open ? "rotate-180" : "")} />
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-[var(--ch-bg-2)]">
          <td colSpan={11} className="px-4 py-3">
            <div className="grid sm:grid-cols-3 gap-3 text-xs">
              {[
                { name: "TTB YM 0649", acc: bb.ttb_0649 },
                { name: "กสิกร 2345", acc: bb.kbank_2345 },
                { name: "ทหารไทย 609", acc: bb.ttb_609 },
              ].map(({ name, acc }) => (
                <div key={name} className="rounded-lg border border-[var(--ch-border)] bg-white p-2.5">
                  <div className="font-semibold text-[var(--ch-text)] mb-1">{name}</div>
                  <Bd label="QR เช้า" v={acc?.qrAM} />
                  <Bd label="QR หลังตัดรอบ" v={acc?.qrLate} />
                  <Bd label="บัตร เช้า" v={acc?.cardAM} />
                  <Bd label="บัตร หลังตัดรอบ" v={acc?.cardLate} />
                </div>
              ))}
            </div>
            {(r.note || n(r.engine_oil_sales)) && (
              <div className="mt-2 text-xs text-[var(--ch-text-2)]">
                {n(r.engine_oil_sales) ? <>น้ำมันเครื่อง {baht(r.engine_oil_sales)} · </> : null}
                {r.note ? <>หมายเหตุ: {r.note}</> : null}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Bd({ label, v }: { label: string; v: number | null | undefined }) {
  if (v === null || v === undefined) return null;
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[var(--ch-text-2)]">{label}</span>
      <span className="ch-tnum">{baht(v)}</span>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={"px-2 py-2 font-semibold " + (right ? "text-right" : "text-left")}>
      {children}
    </th>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "brand" | "ok" | "pending" | "danger" | "muted";
}) {
  const color =
    tone === "brand"
      ? "text-[var(--ch-brand)]"
      : tone === "ok"
        ? "text-[var(--ch-ok)]"
        : tone === "pending"
          ? "text-[#a16207]"
          : tone === "danger"
            ? "text-[var(--ch-danger)]"
            : "text-[var(--ch-text-2)]";
  return (
    <div className="rounded-2xl border border-[var(--ch-border)] bg-white p-3.5">
      <div className="text-[11px] text-[var(--ch-text-2)]">{label}</div>
      <div className={"text-xl font-extrabold ch-tnum mt-1 " + color}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--ch-text-2)] ch-tnum">{sub}</div>}
    </div>
  );
}
