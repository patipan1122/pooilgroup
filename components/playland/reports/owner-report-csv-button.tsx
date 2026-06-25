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
}

interface Props {
  rows: CsvDayRow[];
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  branchName: string;
}

const HEADERS = [
  "วันที่", "ยอดขายรวม", "ค่าเข้าเวลา", "ขายของ", "เงินสด", "เงินโอน",
  "ลูกค้า", "ใหม่", "เก่า", "เด็ก", "ผู้ใหญ่", "ต้นทุน", "กำไรสุทธิ", "มาร์จิน%", "บิลเฉลี่ย",
];

function rowToCells(r: CsvDayRow): (string | number)[] {
  return [
    r.day, baht(r.revenue), baht(r.entry), baht(r.product), baht(r.cash), baht(r.transfer),
    r.customers, r.newCustomers, r.returningCustomers, r.kids, r.adults,
    baht(r.cost), baht(r.profit), r.marginPct.toFixed(1), baht(r.avgBill),
  ];
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function OwnerReportCsvButton({ rows, from, to, branchName }: Props) {
  function download() {
    const lines: string[] = [];
    lines.push(`รายงานเจ้าของ · กำไร-ขาดทุน,${csvEscape(branchName)},${from} ถึง ${to}`);
    lines.push(HEADERS.map(csvEscape).join(","));

    for (const r of rows) lines.push(rowToCells(r).map(csvEscape).join(","));

    // แถวรวมท้ายตาราง
    const t = rows.reduce(
      (acc, r) => ({
        revenue: acc.revenue + r.revenue, entry: acc.entry + r.entry, product: acc.product + r.product,
        cash: acc.cash + r.cash, transfer: acc.transfer + r.transfer, customers: acc.customers + r.customers,
        newCustomers: acc.newCustomers + r.newCustomers, returningCustomers: acc.returningCustomers + r.returningCustomers,
        kids: acc.kids + r.kids, adults: acc.adults + r.adults, cost: acc.cost + r.cost, profit: acc.profit + r.profit,
      }),
      { revenue: 0, entry: 0, product: 0, cash: 0, transfer: 0, customers: 0, newCustomers: 0, returningCustomers: 0, kids: 0, adults: 0, cost: 0, profit: 0 },
    );
    const totalBills = rows.reduce((m, r) => m + (r.avgBill > 0 ? Math.round(r.revenue / r.avgBill) : 0), 0);
    const totMargin = t.revenue > 0 ? (t.profit / t.revenue) * 100 : 0;
    const totAvgBill = totalBills > 0 ? Math.round(t.revenue / totalBills) : 0;
    lines.push(
      [
        "รวม", baht(t.revenue), baht(t.entry), baht(t.product), baht(t.cash), baht(t.transfer),
        t.customers, t.newCustomers, t.returningCustomers, t.kids, t.adults,
        baht(t.cost), baht(t.profit), totMargin.toFixed(1), baht(totAvgBill),
      ].map(csvEscape).join(","),
    );

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
