"use client";

// ตารางเต็มแบบ Excel — มิเรอร์สไตล์ hotel-excel-grid (ตรึงหัว+คอลัมน์ซ้าย, ช่องทางแยกทุกช่อง,
// ช่องสูตร ƒ สีฟ้า, ส่วนต่าง POS↔TRC แดงถ้า≠0, แถวรวมท้าย). 1 วัน = 1 แถว.
import { formatBaht } from "@/lib/utils/format";
import type { SavedAmazonDay, ReconcileStatus } from "@/lib/cashhub/amazon-data";
import {
  computeDaySettlement,
  type ChannelConfig,
} from "@/lib/cashhub/amazon-settlement";

const num = (v: number | null | undefined) =>
  v == null ? "" : Math.abs(v) < 0.005 ? "0" : formatBaht(v);

type Col = {
  label: string;
  get: (d: SavedAmazonDay) => number | null;
  f?: boolean; // ช่องคำนวณ (สูตร VAT)
  diff?: boolean; // ไฮไลต์แดงถ้า ≠ 0 (ส่วนต่าง POS↔TRC)
  cvar?: string; // เป็นคอลัมน์ช่องทาง (อ่านจาก channels[cvar])
  settle?: boolean; // เงินเข้าจริง (ไฮไลต์เขียว)
};

// ช่องทางชำระ (ตามลำดับสมุดบัญชี) → คอลัมน์
const CHANNELS: Array<{ label: string; cvar: string }> = [
  { label: "เงินสด", cvar: "c1" },
  { label: "QR", cvar: "c2" },
  { label: "QR Manual", cvar: "c13" },
  { label: "Grab", cvar: "c20" },
  { label: "Lineman", cvar: "c21" },
  { label: "ShopeeFood", cvar: "c22" },
  { label: "Redeem", cvar: "c11" },
  { label: "เครดิต EDC", cvar: "c12" },
  { label: "ส่วนลด AIS", cvar: "c7" },
  { label: "ส่วนลด TRUE", cvar: "c8" },
  { label: "คูปอง", cvar: "c9" },
  { label: "blueplus wallet", cvar: "c14" },
  { label: "blueplus credit", cvar: "c15" },
];

const ch = (cvar: string) => (d: SavedAmazonDay) => d.channels?.[cvar] ?? null;

const BASE_COLS: Col[] = [
  { label: "ยอดขาย POS", get: (d) => d.gross },
  { label: "ก่อน VAT", get: (d) => d.total, f: true },
  { label: "VAT 7%", get: (d) => d.vat, f: true },
  ...CHANNELS.map((c) => ({ label: c.label, get: ch(c.cvar), cvar: c.cvar })),
  { label: "ยอด IV (TRC)", get: (d) => d.iv_gross },
  {
    label: "ส่วนต่าง",
    get: (d) => (d.iv_gross != null ? d.iv_gross - d.gross : null),
    diff: true,
  },
];

type Props = {
  savedDays: SavedAmazonDay[];
  canSend: boolean;
  allowForce: boolean;
  busy: string | null;
  onCreate: (day: SavedAmazonDay) => void;
  onForce: (day: SavedAmazonDay) => void;
  configs: ChannelConfig[];
  reconcile: ReconcileStatus;
};

export function AmazonExcelGrid({
  savedDays,
  canSend,
  allowForce,
  busy,
  onCreate,
  onForce,
  configs,
  reconcile,
}: Props) {
  const data = savedDays;
  // คำนวณค่าธรรมเนียม/เงินเข้าจริงต่อวัน จาก config
  const configByCvar = new Map(configs.map((c) => [c.cvar, c]));
  const settleByDate = new Map<string, { fee: number; net: number }>();
  for (const d of data) {
    const s = computeDaySettlement(d.channels, configByCvar);
    settleByDate.set(d.sales_date, { fee: s.totalFee, net: s.totalNet });
  }
  const COLS: Col[] = [
    ...BASE_COLS,
    { label: "ค่าธรรมเนียม", get: (d) => settleByDate.get(d.sales_date)?.fee ?? null },
    { label: "เงินเข้าจริง", get: (d) => settleByDate.get(d.sales_date)?.net ?? null, settle: true },
  ];
  const totals = COLS.map((c) =>
    c.diff ? null : data.reduce((s, d) => s + (c.get(d) ?? 0), 0),
  );

  const cell = (c: Col, d: SavedAmazonDay) => {
    const v = c.get(d);
    const bad = c.diff && v != null && Math.abs(v) >= 1;
    const rc = reconcile.byDate[d.sales_date];
    const hasVal = v != null && Math.abs(v) >= 0.005;
    // ช่องทางที่บัญชีแมตช์ยอด+ยืนยันแล้ว → สีรุ้งเหลือบมุก (ช่องที่ยังไม่แมตช์จะเด่นออกมาเอง)
    const matched = !!c.cvar && hasVal && (rc?.matchedCvars?.includes(c.cvar) ?? false);
    // คอลัมน์ "เงินเข้าจริง" → รุ้งเมื่อวันนั้นแมตช์ครบทุกช่อง
    const settleMatched = !!c.settle && !!rc && rc.n > 0 && rc.nMatched >= rc.n;
    return (
      <td
        key={c.label}
        className={`px-1.5 py-1 text-right tabular-nums whitespace-nowrap ${
          bad
            ? "bg-red-100 font-bold text-red-800"
            : matched || settleMatched
              ? "cell-matched-iridescent"
              : c.settle
                ? "bg-emerald-50 font-semibold text-emerald-700"
                : c.f
                  ? "bg-blue-50/40 text-zinc-700"
                  : "text-zinc-700"
        }`}
      >
        {num(v)}
      </td>
    );
  };

  const matchCell = (d: SavedAmazonDay) => {
    if (d.match_state === "match")
      return <span className="font-semibold text-emerald-600">✅</span>;
    if (d.match_state === "mismatch")
      return <span className="font-semibold text-red-600">⚠️</span>;
    return <span className="text-zinc-300">—</span>;
  };

  // สถานะกระทบยอดธนาคาร (ไหลกลับจาก ledger_revenue_entry)
  const reconcileCell = (d: SavedAmazonDay) => {
    const rc = reconcile.byDate[d.sales_date];
    if (!rc || rc.n === 0) return <span className="text-zinc-300">—</span>; // ยังไม่ส่ง
    if (rc.nMatched >= rc.n)
      return <span className="text-matched-iridescent">✦ แมตช์แล้ว</span>;
    if (rc.nMatched > 0)
      return (
        <span className="font-semibold text-amber-600">
          🟡 {rc.nMatched}/{rc.n}
        </span>
      );
    return <span className="text-blue-500">⏳ รอแมตช์</span>; // ส่งแล้ว รอบัญชีแมตช์
  };

  return (
    <div className="space-y-2">
      <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
        <div className="overflow-auto max-h-[72vh]">
          <table className="text-[11px] border-collapse">
            <thead className="sticky top-0 z-20">
              <tr className="bg-zinc-100 text-zinc-600">
                <th className="sticky left-0 z-30 bg-zinc-100 px-2 py-1.5 text-left font-semibold border-b border-zinc-200">
                  วันที่
                </th>
                {COLS.map((c) => (
                  <th
                    key={c.label}
                    className="px-1.5 py-1.5 text-right font-semibold whitespace-nowrap border-b border-zinc-200"
                  >
                    {c.f && <span className="text-blue-500">ƒ </span>}
                    {c.label}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-center font-semibold border-b border-zinc-200 whitespace-nowrap">
                  ตรง?
                </th>
                <th className="px-2 py-1.5 text-left font-semibold border-b border-zinc-200 whitespace-nowrap">
                  IV (TRCloud)
                </th>
                <th className="px-2 py-1.5 text-center font-semibold border-b border-zinc-200 whitespace-nowrap">
                  กระทบยอด
                </th>
                <th className="px-2 py-1.5 text-center font-semibold border-b border-zinc-200 whitespace-nowrap">
                  จัดการ
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => {
                const rowBad = d.match_state === "mismatch" || !d.balanced;
                return (
                  <tr
                    key={d.sales_date}
                    className={`border-b border-zinc-50 hover:bg-amber-50/40 ${
                      d.match_state === "mismatch"
                        ? "bg-red-50/40"
                        : !d.balanced
                          ? "bg-amber-50/40"
                          : ""
                    }`}
                  >
                    <td className="sticky left-0 z-10 bg-white px-2 py-1 font-semibold text-zinc-800 border-r border-zinc-100 whitespace-nowrap">
                      {d.sales_date.slice(5)}
                      {rowBad && <span className="ml-1 text-red-500">●</span>}
                    </td>
                    {COLS.map((c) => cell(c, d))}
                    <td className="px-2 py-1 text-center">{matchCell(d)}</td>
                    <td className="px-2 py-1 text-left text-zinc-500 whitespace-nowrap">
                      {d.iv_doc_no ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-center whitespace-nowrap">
                      {reconcileCell(d)}
                    </td>
                    <td className="px-2 py-1 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        {!d.balanced ? (
                          <span className="text-amber-600" title={d.block_reason ?? ""}>
                            ⚠️ ไม่ครบ
                          </span>
                        ) : d.match_state === "match" || d.iv_status === "posted" ? (
                          <span className="text-emerald-600">มีแล้ว</span>
                        ) : canSend ? (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => onCreate(d)}
                            className="rounded-lg bg-[var(--ch-brand,#1e3aff)] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
                          >
                            {busy === `push-${d.sales_date}` ? "…" : "ส่ง TRCloud"}
                          </button>
                        ) : (
                          <span className="text-zinc-400">🔒</span>
                        )}
                        {/* ⚠️ ส่งซ้ำ (ทดสอบ) — ซ่อนใน prod · เปิดเฉพาะ env CASHHUB_AMAZON_FORCE=1 (ได้ใบซ้ำจริง) */}
                        {allowForce && d.balanced && (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => onForce(d)}
                            title="ส่งซ้ำ (ทดสอบ) — จะได้ใบกำกับซ้ำจริง · ต้องพิมพ์ยืนยัน"
                            className="rounded-lg border border-amber-300 bg-amber-50 px-1.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-40"
                          >
                            {busy === `force-${d.sales_date}` ? "…" : "🔁"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {/* แถวรวม */}
              <tr className="sticky bottom-0 bg-zinc-900 text-white font-bold border-t-2 border-zinc-700">
                <td className="sticky left-0 z-10 bg-zinc-900 px-2 py-1.5 whitespace-nowrap">
                  รวมเดือน
                </td>
                {totals.map((t, i) => (
                  <td
                    key={i}
                    className="px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap"
                  >
                    {t != null && t !== 0 ? formatBaht(t) : ""}
                  </td>
                ))}
                <td colSpan={4} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-zinc-500">
        <span className="text-blue-500 font-semibold">ƒ</span> = ช่องคำนวณอัตโนมัติ ·
        ก่อน VAT = ยอดขาย÷1.07 · VAT = ยอดขาย−ก่อน VAT · ส่วนต่าง = ยอด IV−ยอด POS (≠0
        = แดง) · ● = ต้องตรวจสอบ ·{" "}
        <span className="cell-matched-iridescent rounded px-1">ช่องสีรุ้ง</span> = กระทบยอดธนาคาร
        +ยืนยันแล้ว (ช่องที่ยังไม่สีรุ้ง = ยังไม่แมตช์) · เลื่อนซ้าย-ขวาดูช่องทางครบทุกช่อง
      </p>
    </div>
  );
}
