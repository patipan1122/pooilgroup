// Telegram message templates for CashHub — uses HTML mode
// Sent on report submit + edited after approve/reject

import { htmlEscape } from "./send";
import type { InlineButton } from "./send";

const SHIFT_LABEL: Record<string, string> = {
  morning: "🌅 กะเช้า",
  midday: "☀️ กะกลางวัน",
  evening: "🌙 กะเย็น",
  all: "ทั้งวัน",
};

const TYPE_EMOJI: Record<string, string> = {
  fuel_station: "⛽",
  lpg_station: "🔵",
  lpg_retail: "🛒",
  bottling_plant: "🏭",
  hotel: "🏨",
  convenience_store: "🏪",
  ev_station: "⚡",
  cafe: "☕",
  cafe_punthai: "☕",
  massage_chair: "💆",
  claw_machine: "🎮",
  training_center: "🎓",
};

export interface ReportApprovalMessage {
  reportId: string;
  branchCode: string;
  branchName: string;
  businessType: string;
  reportDate: string; // YYYY-MM-DD
  shift: string;
  totalSales: number;
  qty1?: number | null;
  qty1Unit?: string | null;
  cash: number;
  transfer: number;
  card: number;
  credit: number;
  shortage: number;
  submittedByName: string;
  reconcileOk: boolean;
  autoCheckSummary: string;
}

const baht = (n: number) =>
  `฿${Math.round(n).toLocaleString("th-TH")}`;

export function buildApprovalMessage(m: ReportApprovalMessage): string {
  const e = TYPE_EMOJI[m.businessType] ?? "📋";
  const lines: string[] = [];
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("📋 <b>รายงานรออนุมัติ</b>");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push(
    `${e} <b>${htmlEscape(m.branchCode)}</b> · ${htmlEscape(m.branchName)}`,
  );
  lines.push(`📅 ${m.reportDate} · ${SHIFT_LABEL[m.shift] ?? m.shift}`);
  lines.push(`👤 ${htmlEscape(m.submittedByName)}`);
  lines.push("");
  lines.push(`💰 ยอดขาย: <b>${baht(m.totalSales)}</b>`);
  if (m.qty1 != null && m.qty1 > 0) {
    lines.push(
      `📦 ${m.qty1.toLocaleString("th-TH")} ${m.qty1Unit ?? ""}`.trim(),
    );
  }
  if (m.cash > 0) lines.push(`💵 เงินสด: ${baht(m.cash)}`);
  if (m.transfer > 0) lines.push(`🏦 โอน: ${baht(m.transfer)}`);
  if (m.card > 0) lines.push(`💳 บัตร: ${baht(m.card)}`);
  if (m.credit > 0) lines.push(`📝 เครดิต: ${baht(m.credit)}`);
  if (m.shortage > 0) lines.push(`🔴 เงินขาด: ${baht(m.shortage)}`);
  lines.push("");
  lines.push(
    m.reconcileOk
      ? "✅ Reconcile: ตรงพอดี"
      : "🔴 Reconcile: ไม่ตรง — ตรวจดูอีกครั้ง",
  );
  lines.push(`🤖 Auto-check: ${m.autoCheckSummary}`);
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  return lines.join("\n");
}

export function approvalKeyboard(reportId: string, webBaseUrl: string): InlineButton[][] {
  return [
    [
      { text: "✅ อนุมัติ", callback_data: `approve:${reportId}` },
      { text: "❌ ปฏิเสธ", callback_data: `reject:${reportId}` },
    ],
    [
      {
        text: "👁 ดูในเว็บ",
        url: `${webBaseUrl}/cashhub/reports/${reportId}`,
      },
    ],
  ];
}

export function buildApprovedAcknowledgement(m: {
  branchCode: string;
  approvedByName: string;
  reportDate: string;
  totalSales: number;
  approvedAtTH: string;
}): string {
  return [
    "✅ <b>อนุมัติแล้ว</b>",
    `${htmlEscape(m.branchCode)} · ${m.reportDate}`,
    `ยอด ${baht(m.totalSales)}`,
    `โดย ${htmlEscape(m.approvedByName)} · ${m.approvedAtTH}`,
  ].join("\n");
}

export function buildRejectedAcknowledgement(m: {
  branchCode: string;
  rejectedByName: string;
  reportDate: string;
  reason: string;
  rejectedAtTH: string;
}): string {
  return [
    "❌ <b>ปฏิเสธ — ส่งกลับให้แก้</b>",
    `${htmlEscape(m.branchCode)} · ${m.reportDate}`,
    `เหตุผล: ${htmlEscape(m.reason)}`,
    `โดย ${htmlEscape(m.rejectedByName)} · ${m.rejectedAtTH}`,
  ].join("\n");
}

export function buildMorningBrief(m: {
  yesterdayDate: string;
  yesterdayTotal: number;
  vsPrevDayPct: number | null;
  topBranches: Array<{ code: string; total: number; emoji: string }>;
  pendingCount: number;
  alertLines: string[];
  webBaseUrl: string;
}): string {
  const lines: string[] = [];
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("📊 <b>POOLGROUP — สรุปเมื่อวาน</b>");
  lines.push(`📅 ${m.yesterdayDate}`);
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push(`💰 ยอดรวม: <b>${baht(m.yesterdayTotal)}</b>`);
  if (m.vsPrevDayPct !== null) {
    const arrow = m.vsPrevDayPct >= 0 ? "📈" : "📉";
    lines.push(
      `${arrow} ${m.vsPrevDayPct >= 0 ? "+" : ""}${m.vsPrevDayPct.toFixed(1)}% เทียบวันก่อน`,
    );
  }
  if (m.topBranches.length > 0) {
    lines.push("");
    lines.push("🏆 <b>สาขา Top วันนี้</b>");
    m.topBranches.slice(0, 3).forEach((b, i) => {
      lines.push(
        `${i + 1}. ${b.emoji} ${htmlEscape(b.code)} — ${baht(b.total)}`,
      );
    });
  }
  if (m.alertLines.length > 0) {
    lines.push("");
    lines.push("⚠️ <b>ต้องดูแล</b>");
    m.alertLines.slice(0, 5).forEach((a) => lines.push(`• ${htmlEscape(a)}`));
  }
  lines.push("");
  lines.push(`📋 รออนุมัติ: <b>${m.pendingCount}</b> รายงาน`);
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  return lines.join("\n");
}

export function buildEveningCheck(m: {
  todayDate: string;
  submittedCount: number;
  expectedCount: number;
  pendingCount: number;
  lateBranches: string[];
}): string {
  const lines: string[] = [];
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("📋 <b>สถานะรายงานวันนี้</b>");
  lines.push(`📅 ${m.todayDate}`);
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push(`✅ ส่งแล้ว: <b>${m.submittedCount}/${m.expectedCount}</b> สาขา`);
  if (m.pendingCount > 0)
    lines.push(`⏳ รออนุมัติ: <b>${m.pendingCount}</b>`);
  const missing = m.expectedCount - m.submittedCount;
  if (missing > 0) {
    lines.push("");
    lines.push(`⚠️ <b>ยังไม่กรอก ${missing} สาขา</b>`);
    m.lateBranches.slice(0, 8).forEach((b) => lines.push(`• ${htmlEscape(b)}`));
  }
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  return lines.join("\n");
}
