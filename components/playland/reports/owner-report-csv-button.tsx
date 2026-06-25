"use client";

// Playland · รายงานเจ้าของ — ปุ่มส่งออก Excel (CSV)
// สร้าง CSV ฝั่ง client จากแถวที่ server คิดมาแล้ว (รวมแถวรวมท้ายตาราง)
// ใช้ BOM (﻿) เพื่อให้ Excel เปิดภาษาไทยไม่เพี้ยน

const baht = (cents: number) => (cents / 100).toFixed(2);

export interface CsvDayRow {
  day: string;        // YYYY-MM-DD
  revenue: number;    // cents
  entry: number;
  product: number;
  snack: number;      // cents — ขนม
  goods: number;      // cents — ของ
  cash: number;
  transfer: number;
  customers: number;
  newCustomers: number;
  returningCustomers: number;
  kids: number;
  adults: number;
  cost: number;       // cents (allocated to that day)
  profit: number;     // cents
  marginPct: number;  // %
  avgBill: number;    // cents
  bills: number;      // จำนวนบิล
}

interface Props {
  rows: CsvDayRow[];
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  branchName: string;
  mode: "min" | "full"; // ย่อ / ขยาย — ส่งออกให้ตรงกับที่เห็นบนจอ
}

// หัวคอลัมน์ตามโหมด (ตรงกับตารางบนหน้าจอ)
const HEADERS_MIN = ["วันที่", "ยอดขายรวม", "ค่าเข้าเวลา", "ขนม", "ของ", "ลูกค้า", "เด็ก", "ผู้ใหญ่", "บิล", "บิลเฉลี่ย"];
const HEADERS_FULL = [
  "วันที่", "ยอดขายรวม", "ค่าเข้าเวลา", "ขนม", "ของ", "เงินสด", "เงินโอน",
  "ลูกค้า", "ใหม่", "เก่า", "เด็ก", "ผู้ใหญ่", "บิล", "บิลเฉลี่ย", "ต้นทุน", "กำไรสุทธิ", "มาร์จิน%",
];

function rowToCellsMin(r: CsvDayRow): (string | number)[] {
  return [r.day, baht(r.revenue), baht(r.entry), baht(r.snack), baht(r.goods), r.customers, r.kids, r.adults, r.bills, baht(r.avgBill)];
}
function rowToCellsFull(r: CsvDayRow): (string | number)[] {
  return [
    r.day, baht(r.revenue), baht(r.entry), baht(r.snack), baht(r.goods), baht(r.cash), baht(r.transfer),
    r.customers, r.newCustomers, r.returningCustomers, r.kids, r.adults,
    r.bills, baht(r.avgBill), baht(r.cost), baht(r.profit), r.marginPct.toFixed(1),
  ];
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function OwnerReportCsvButton({ rows, from, to, branchName, mode }: Props) {
  function download() {
    const isMin = mode === "min";
    const HEADERS = isMin ? HEADERS_MIN : HEADERS_FULL;
    const rowToCells = isMin ? rowToCellsMin : rowToCellsFull;

    const lines: string[] = [];
    lines.push(`รายงานเจ้าของ · กำไร-ขาดทุน,${csvEscape(branchName)},${from} ถึง ${to}`);
    lines.push(HEADERS.map(csvEscape).join(","));

    for (const r of rows) lines.push(rowToCells(r).map(csvEscape).join(","));

    // แถวรวมท้ายตาราง
    const t = rows.reduce(
      (acc, r) => ({
        revenue: acc.revenue + r.revenue, entry: acc.entry + r.entry, product: acc.product + r.product,
        snack: acc.snack + r.snack, goods: acc.goods + r.goods,
        cash: acc.cash + r.cash, transfer: acc.transfer + r.transfer, customers: acc.customers + r.customers,
        newCustomers: acc.newCustomers + r.newCustomers, returningCustomers: acc.returningCustomers + r.returningCustomers,
        kids: acc.kids + r.kids, adults: acc.adults + r.adults, cost: acc.cost + r.cost, profit: acc.profit + r.profit, bills: acc.bills + r.bills,
      }),
      { revenue: 0, entry: 0, product: 0, snack: 0, goods: 0, cash: 0, transfer: 0, customers: 0, newCustomers: 0, returningCustomers: 0, kids: 0, adults: 0, cost: 0, profit: 0, bills: 0 },
    );
    const totMargin = t.revenue > 0 ? (t.profit / t.revenue) * 100 : 0;
    const totAvgBill = t.bills > 0 ? Math.round(t.revenue / t.bills) : 0;
    const totalRow = isMin
      ? ["รวม", baht(t.revenue), baht(t.entry), baht(t.snack), baht(t.goods), t.customers, t.kids, t.adults, t.bills, baht(totAvgBill)]
      : [
          "รวม", baht(t.revenue), baht(t.entry), baht(t.snack), baht(t.goods), baht(t.cash), baht(t.transfer),
          t.customers, t.newCustomers, t.returningCustomers, t.kids, t.adults,
          t.bills, baht(totAvgBill), baht(t.cost), baht(t.profit), totMargin.toFixed(1),
        ];
    lines.push(totalRow.map(csvEscape).join(","));

    const csv = "﻿" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `playland-owner-report_${from}_${to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={download}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none", borderRadius: 9,
        padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
        background: "#1F8A5B", color: "#fff", border: "none", fontFamily: "var(--font-mitr), 'Mitr', sans-serif",
      }}
      title="ส่งออกตารางเป็นไฟล์ Excel (CSV)"
    >
      ⬇ ส่งออก Excel (CSV)
    </button>
  );
}
