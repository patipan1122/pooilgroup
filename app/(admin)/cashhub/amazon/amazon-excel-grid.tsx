"use client";

// ตารางเต็มแบบ Excel — มิเรอร์สไตล์ hotel-excel-grid (ตรึงหัว+คอลัมน์ซ้าย, ช่องทางแยกทุกช่อง,
// ช่องสูตร ƒ สีฟ้า, ส่วนต่าง POS↔TRC แดงถ้า≠0, แถวรวมท้าย). 1 วัน = 1 แถว.
import { useState } from "react";
import { formatBaht } from "@/lib/utils/format";
import type { SavedAmazonDay, ReconcileStatus } from "@/lib/cashhub/amazon-data";
import {
  computeDaySettlement,
  type ChannelConfig,
} from "@/lib/cashhub/amazon-settlement";
import { reconDiffKind, reconDiffPillClass } from "@/lib/cashhub/recon-diff";

const num = (v: number | null | undefined) =>
  v == null ? "" : Math.abs(v) < 0.005 ? "0" : formatBaht(v);

type Col = {
  label: string;
  get: (d: SavedAmazonDay) => number | null;
  f?: boolean; // ช่องคำนวณ (สูตร VAT)
  diff?: boolean; // ไฮไลต์แดงถ้า ≠ 0 (ส่วนต่าง POS↔TRC)
  cvar?: string; // เป็นคอลัมน์ช่องทาง (อ่านจาก channels[cvar])
  settle?: boolean; // เงินเข้าจริง (ไฮไลต์เขียว)
  // ยอดฝั่ง "ใบกำกับ TRCloud" ของคอลัมน์นี้ (ไส้ใน) — ถ้า ≠ POS → ทาเหลือง · null = ยังไม่ตรวจไส้ใน
  ivGet?: (d: SavedAmazonDay) => number | null;
};

const IV_TOL = 1; // ทน ±1 บาท (special_note เก็บเป็นจำนวนเต็ม)
// vat ในใบ = ยอดรวม − ยอดก่อน VAT (ใบ tax_option=ex)
const ivVat = (d: SavedAmazonDay) =>
  d.iv_gross != null && d.iv_pre_vat != null ? d.iv_gross - d.iv_pre_vat : null;
// นับช่อง "ไส้ใน" ที่เพี้ยน (รายช่องทาง + ก่อน VAT + VAT) — เฉพาะวันที่ตรวจไส้ในแล้ว
const innerMismatchCount = (d: SavedAmazonDay): number => {
  if (!d.iv_channels) return 0;
  let cnt = 0;
  const keys = new Set([...Object.keys(d.channels ?? {}), ...Object.keys(d.iv_channels)]);
  for (const k of keys)
    if (Math.abs((d.iv_channels[k] ?? 0) - (d.channels?.[k] ?? 0)) >= IV_TOL) cnt++;
  const v = ivVat(d);
  if (v != null && Math.abs(v - (d.vat ?? 0)) >= IV_TOL) cnt++;
  return cnt;
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
  { label: "ก่อน VAT", get: (d) => d.total, f: true, ivGet: (d) => d.iv_pre_vat },
  { label: "VAT 7%", get: (d) => d.vat, f: true, ivGet: ivVat },
  ...CHANNELS.map((c) => ({
    label: c.label,
    get: ch(c.cvar),
    cvar: c.cvar,
    // ฝั่งใบ: ถ้าตรวจไส้ในแล้ว (iv_channels) → ยอดช่องนี้ในใบ (ไม่มี=0) · ยังไม่ตรวจ → null
    ivGet: (d: SavedAmazonDay) => (d.iv_channels ? (d.iv_channels[c.cvar] ?? 0) : null),
  })),
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
  // สวิตช์เปิด/ปิด "ดูไส้ใน" (เหลืองรายช่องทาง) — ปิดได้เวลาอยากดูแบบสะอาด ไม่ลายตา
  const [showInner, setShowInner] = useState(true);
  // มีไส้ในให้ดูไหม (ตรวจ TRCloud แล้วอย่างน้อย 1 วัน) → ค่อยโชว์สวิตช์
  const hasInnerData = data.some((d) => d.iv_channels != null);
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
    // ── ไส้ใน: ยอดช่องนี้ในใบกำกับ TRCloud ≠ POS → ตัวหนังสือเหลือง (ไม่ถมพื้น ไม่ลายตา) · ปิดได้ด้วยสวิตช์ ──
    const ivv = c.ivGet ? c.ivGet(d) : null; // null = ยังไม่ตรวจไส้ใน
    const ivBad = showInner && ivv != null && Math.abs(ivv - (v ?? 0)) >= IV_TOL;
    const ivDiff = ivBad ? (ivv ?? 0) - (v ?? 0) : 0;
    return (
      <td
        key={c.label}
        className={`px-1.5 py-1 text-right tabular-nums whitespace-nowrap ${
          bad
            ? "bg-red-100 font-bold text-red-800"
            : ivBad
              ? // ไส้ในไม่ตรง = ตัวหนังสือเหลืองเข้ม (ไม่ถมพื้น) → อ่านได้บนพื้นขาว/สีรุ้ง · iridescent ถูกข้าม
                "text-yellow-700 font-bold"
              : matched || settleMatched
                ? "cell-matched-iridescent"
                : c.settle
                  ? "bg-emerald-50 font-semibold text-emerald-700"
                  : c.f
                    ? "bg-blue-50/40 text-zinc-700"
                    : "text-zinc-700"
        }`}
      >
        {ivBad ? (
          <div className="flex flex-col items-end leading-tight">
            <span>{num(v)}</span>
            <span className="text-[9px] font-semibold text-yellow-600 whitespace-nowrap">
              IV {num(ivv)} ({ivDiff > 0 ? "+" : "−"}
              {num(Math.abs(ivDiff))})
            </span>
          </div>
        ) : (
          num(v)
        )}
      </td>
    );
  };

  // คอลัมน์ "ตรง?" — แยก 4 สถานะให้ชัด (เลิกใช้ขีด "—" กำกวมที่ทำให้ "ไม่มีใบ" กับ "ยังไม่เทียบ" ดูเหมือนกัน)
  const matchCell = (d: SavedAmazonDay) => {
    if (d.match_state === "match") {
      // ยอดรวมตรง แต่ "ไส้ใน" รายช่องทางเพี้ยน → เตือน (จุดที่เทียบยอดรวมจับไม่ได้) · ปิดสวิตช์ = ข้าม
      const inner = showInner ? innerMismatchCount(d) : 0;
      if (inner > 0)
        return (
          <span className="inline-flex flex-col items-center gap-0.5 leading-tight">
            <span className="font-semibold text-emerald-600">✅ ยอดรวมตรง</span>
            <span className="text-[10px] font-bold text-yellow-700 whitespace-nowrap">
              ⚠ ไส้ใน {inner} ช่องเพี้ยน
            </span>
          </span>
        );
      // ตรวจไส้ในแล้วตรงทุกช่อง = ตรงจริง · ยังไม่ตรวจไส้ใน/ปิดสวิตช์ = ตรงแค่ยอดรวม
      return d.iv_channels && showInner ? (
        <span className="font-semibold text-emerald-600" title="ยอดรวม + ไส้ในทุกช่องตรง POS">
          ✅ ตรงทุกช่อง
        </span>
      ) : (
        <span
          className="font-semibold text-emerald-600"
          title="ยอดรวมตรง — ยังไม่ได้ตรวจไส้ใน (กด 'เทียบกับ TRCloud')"
        >
          ✅ ตรง
        </span>
      );
    }
    if (d.match_state === "mismatch") {
      const diff = d.iv_gross != null ? d.iv_gross - d.gross : null;
      return (
        <span className="inline-flex flex-col items-center gap-0.5 font-bold text-red-700">
          <span className="rounded bg-red-100 px-1.5 py-0.5">🔴 ไม่ตรง</span>
          {diff != null && (
            <span className="text-[10px] font-semibold text-red-600 whitespace-nowrap">
              IV {num(d.iv_gross)} ({diff > 0 ? "+" : "−"}
              {num(Math.abs(diff))})
            </span>
          )}
        </span>
      );
    }
    if (d.match_state === "no_iv")
      return (
        <span className="text-zinc-400" title="ยังไม่มีใบกำกับใน TRCloud (รอสร้าง IV)">
          ⚪ ยังไม่มีใบ
        </span>
      );
    // match_state == null → ยังไม่เคยเทียบ (เพิ่งอัปไฟล์ใหม่ หรือ TRCloud จำกัดการเรียกชั่วคราว)
    return (
      <span
        className="font-medium text-amber-600"
        title="ยังไม่ได้เทียบกับ TRCloud — กดปุ่ม '🔄 เทียบกับ TRCloud' อีกครั้ง"
      >
        🔄 ยังไม่เทียบ
      </span>
    );
  };

  // สถานะกระทบยอดธนาคาร (ไหลกลับจาก ledger_revenue_entry)
  const reconcileCell = (d: SavedAmazonDay) => {
    const rc = reconcile.byDate[d.sales_date];
    if (!rc || rc.n === 0) return <span className="text-zinc-300">—</span>; // ยังไม่ส่ง
    // มีคู่แมตช์แล้ว → โชว์ "ส่วนต่าง" เงินเข้าจริง vs ที่ควรได้ (เป๊ะ=สีรุ้ง · ขาด=แดง · เกิน=ส้ม)
    if (rc.diffBaht != null) {
      const kind = reconDiffKind(rc.diffBaht);
      if (kind === "exact")
        return <span className="text-matched-iridescent font-bold">✦ เป๊ะ</span>;
      return (
        <span className={reconDiffPillClass(kind)}>
          {kind === "short" ? "🔴 ขาด" : "🟠 เกิน"} ฿{formatBaht(Math.abs(rc.diffBaht))}
        </span>
      );
    }
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
      {/* สวิตช์เปิด/ปิด "ดูไส้ใน" (เหลืองรายช่องทาง) — กดปิดได้เวลาอยากดูตารางแบบสะอาด */}
      {hasInnerData && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-[11px] text-zinc-500">เทียบไส้ใน (รายช่องทาง):</span>
          <button
            type="button"
            onClick={() => setShowInner((s) => !s)}
            title="เปิด = โชว์ช่องที่ใบกำกับไม่ตรง POS เป็นตัวเลขเหลือง · ปิด = ดูตารางแบบสะอาด"
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
              showInner
                ? "bg-yellow-100 text-yellow-800 ring-1 ring-inset ring-yellow-400"
                : "bg-zinc-100 text-zinc-400 ring-1 ring-inset ring-zinc-200"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${showInner ? "bg-yellow-500" : "bg-zinc-300"}`}
            />
            {showInner ? "เปิดอยู่" : "ปิดอยู่"}
          </button>
        </div>
      )}
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
                // วันที่มี IV ใน TRCloud แล้ว (ตรง/โพสต์) = เรียบร้อย — ไม่นับเป็น "ติดปัญหา"
                // (ด่าน "ไม่ครบ" ใช้ตอนจะ "สร้าง IV ใหม่" เท่านั้น · IV มีอยู่แล้วไม่เกี่ยว)
                const hasIv = d.match_state === "match" || d.iv_status === "posted";
                const rowBad = d.match_state === "mismatch" || (!d.balanced && !hasIv);
                return (
                  <tr
                    key={d.sales_date}
                    className={`border-b border-zinc-50 hover:bg-amber-50/40 ${
                      d.match_state === "mismatch"
                        ? "bg-red-50/40"
                        : !d.balanced && !hasIv
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
                        {hasIv ? (
                          <span className="text-emerald-600 font-medium">✅ มี IV แล้ว</span>
                        ) : !d.balanced ? (
                          <span className="text-amber-600" title={d.block_reason ?? ""}>
                            ⚠️ ไม่ครบ
                          </span>
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
                        {/* ฝืนส่ง (super admin) — ทุกแถว · มี IV แล้ว=ส่งซ้ำ(ใบซ้ำ) · ต้องพิมพ์ยืนยัน */}
                        {allowForce && (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => onForce(d)}
                            title={
                              hasIv
                                ? "ฝืนส่งซ้ำ — จะได้ใบกำกับซ้ำจริง (VAT ซ้ำใน ภ.พ.30) · ต้องพิมพ์ยืนยัน"
                                : "ฝืนส่ง (super admin) — ข้ามด่านตรวจ · ต้องพิมพ์ยืนยัน"
                            }
                            className="rounded-lg border border-amber-300 bg-amber-50 px-1.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-40"
                          >
                            {busy === `force-${d.sales_date}`
                              ? "…"
                              : hasIv
                                ? "ส่งซ้ำ"
                                : "ฝืนส่ง"}
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
        = แดง) · ● = ต้องตรวจสอบ · คอลัมน์ <b>ตรง?</b>:{" "}
        <span className="text-emerald-600 font-semibold">✅ ตรง</span> = ยอด IV=POS ·{" "}
        <span className="text-red-700 font-bold">🔴 ไม่ตรง</span> = IV≠POS (โชว์ส่วนต่าง) ·{" "}
        <span className="text-zinc-400">⚪ ยังไม่มีใบ</span> = ยังไม่มี IV ใน TRCloud ·{" "}
        <span className="text-amber-600">🔄 ยังไม่เทียบ</span> = ยังไม่ได้กดเทียบ/TRCloud
        จำกัดชั่วคราว (กดปุ่ม &ldquo;เทียบกับ TRCloud&rdquo; อีกครั้ง) ·{" "}
        <span className="font-bold text-yellow-700">ตัวเลขสีเหลือง</span> = ยอดช่องนั้นในใบกำกับ
        TRCloud <b>ไม่ตรง</b> POS (เลขบน = POS · เลขล่าง = IV+ส่วนต่าง · เปิด/ปิดได้ที่สวิตช์
        &ldquo;เทียบไส้ใน&rdquo; เหนือตาราง · ต้องกด &ldquo;เทียบกับ TRCloud&rdquo; ก่อนถึงเห็นไส้ใน) ·{" "}
        <span className="cell-matched-iridescent rounded px-1">ช่องสีรุ้ง</span> = กระทบยอดธนาคาร
        +ยืนยันแล้ว (ช่องที่ยังไม่สีรุ้ง = ยังไม่แมตช์) · คอลัมน์ <b>กระทบยอด</b>:{" "}
        <span className="text-matched-iridescent font-bold">✦ เป๊ะ</span> = เงินเข้าตรง (±฿1) ·{" "}
        <span className="text-red-700 font-bold">🔴 ขาด</span> = เงินเข้าน้อยกว่าที่ควร ·{" "}
        <span className="text-amber-700 font-bold">🟠 เกิน</span> = เงินเข้ามากกว่า · เลื่อนซ้าย-ขวาดูช่องทางครบทุกช่อง
      </p>
    </div>
  );
}
