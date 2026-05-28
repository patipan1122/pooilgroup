// Cron — Monthly Report PDF (วันที่ 1 ของเดือน 08:00)
// ────────────────────────────────────────────────────────────────────
// Spec source: ดีเทลv1/CORE_SYSTEM.md §4.5 (Scheduled PDF Report)
//
// Logic ทุกวันที่ 1 ของเดือน 08:00 น.:
//   1. Compute summary เดือนที่แล้ว (per org):
//      - ยอดรวม + เทียบ vs เดือนก่อนหน้า
//      - Branch ranking (Top 5)
//      - Business type breakdown
//      - Report compliance (สาขาที่กรอกครบ / ไม่ครบ)
//   2. Insert notification ลง notifications table → super_admin + org_admin + admin
//      title="📄 Monthly Report ${month}"
//      link="/cashhub/monthly-report?month=YYYY-MM"
//   3. ส่ง Telegram สรุป + ปุ่มลิงก์เปิดรายงานเต็ม
//   4. PDF จริงยังไม่ generate (placeholder) — link จะพา user ไปหน้า web
//
// Idempotent:
//   - ถ้ามี notification ของ org เดือนนั้นแล้ววันนี้ → skip
//   - ตรวจ notifications.module='core' + title prefix '📄 Monthly Report'
//
// Auth: Bearer ${CRON_SECRET}
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/db/server";
import { sendTelegramMessage, htmlEscape } from "@/lib/telegram/send";
import { getBaseUrl } from "@/lib/utils/base-url";
import { loadBranches, loadReports } from "@/lib/cashhub/data";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { formatInTimeZone } from "date-fns-tz";
import { startOfMonth, subMonths, endOfMonth } from "date-fns";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

import { runWithMonitor } from "@/lib/cron/runner";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runWithMonitor("monthly-report-pdf", () => run(), { req });
}

export async function POST(req: NextRequest) {
  return GET(req);
}

const baht = (n: number) => `฿${Math.round(n).toLocaleString("th-TH")}`;

async function run() {
  const admin = adminClient();
  const now = new Date();

  // Last month window (in TZ)
  const lastMonthAnchor = subMonths(now, 1);
  const lastMonthStart = formatInTimeZone(
    startOfMonth(lastMonthAnchor),
    TZ,
    "yyyy-MM-dd",
  );
  const lastMonthEnd = formatInTimeZone(
    endOfMonth(lastMonthAnchor),
    TZ,
    "yyyy-MM-dd",
  );
  const lastMonthLabel = formatInTimeZone(lastMonthAnchor, TZ, "yyyy-MM");
  const lastMonthThai = formatInTimeZone(lastMonthAnchor, TZ, "MMM yyyy");

  // Month before last (for vs comparison)
  const prevMonthAnchor = subMonths(now, 2);
  const prevMonthStart = formatInTimeZone(
    startOfMonth(prevMonthAnchor),
    TZ,
    "yyyy-MM-dd",
  );
  const prevMonthEnd = formatInTimeZone(
    endOfMonth(prevMonthAnchor),
    TZ,
    "yyyy-MM-dd",
  );

  // Today bounds for idempotency
  const todayStartIso = formatInTimeZone(
    now,
    TZ,
    "yyyy-MM-dd'T'00:00:00XXX",
  );

  const { data: orgs } = await admin
    .from("organizations")
    .select("id, name")
    .eq("is_active", true);
  if (!orgs) return NextResponse.json({ ok: true, processed: 0 });

  let processed = 0;
  let sentTelegram = 0;
  const skipped: string[] = [];

  for (const org of orgs) {
    const orgRow = org as { id: string; name: string };

    // Idempotency check — has this org's monthly notification been created today?
    const titlePrefix = `📄 Monthly Report ${lastMonthLabel}`;
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("org_id", orgRow.id)
      .eq("title", titlePrefix)
      .gte("created_at", todayStartIso)
      .limit(1);
    if ((existing ?? []).length > 0) {
      skipped.push(orgRow.id);
      continue;
    }

    const branches = await loadBranches(orgRow.id, { activeOnly: true });
    if (branches.length === 0) continue;

    const branchById = new Map(branches.map((b) => [b.id, b]));

    const [lastReports, prevReports] = await Promise.all([
      loadReports(orgRow.id, {
        dateFrom: lastMonthStart,
        dateTo: lastMonthEnd,
        statuses: ["approved"],
      }),
      loadReports(orgRow.id, {
        dateFrom: prevMonthStart,
        dateTo: prevMonthEnd,
        statuses: ["approved"],
      }),
    ]);

    // 1. Total revenue + vs prev month
    const lastTotal = lastReports.reduce(
      (s, r) => s + Number(r.total_sales || 0),
      0,
    );
    const prevTotal = prevReports.reduce(
      (s, r) => s + Number(r.total_sales || 0),
      0,
    );
    const vsPrev =
      prevTotal > 0 ? ((lastTotal - prevTotal) / prevTotal) * 100 : null;

    // 2. Branch ranking (Top 5)
    const byBranch = new Map<string, number>();
    for (const r of lastReports) {
      byBranch.set(
        r.branch_id,
        (byBranch.get(r.branch_id) ?? 0) + Number(r.total_sales || 0),
      );
    }
    const ranked = Array.from(byBranch.entries())
      .map(([id, total]) => ({
        id,
        total,
        code: branchById.get(id)?.code ?? "—",
        name: branchById.get(id)?.name ?? "—",
        business_type: branchById.get(id)?.business_type ?? "",
      }))
      .sort((a, b) => b.total - a.total);
    const top5 = ranked.slice(0, 5);

    // 3. Business type breakdown
    const byType = new Map<string, number>();
    for (const r of lastReports) {
      const t = branchById.get(r.branch_id)?.business_type ?? "unknown";
      byType.set(t, (byType.get(t) ?? 0) + Number(r.total_sales || 0));
    }
    const typeBreakdown = Array.from(byType.entries())
      .map(([type, total]) => ({
        type,
        total,
        emoji: BUSINESS_TYPES[type]?.emoji ?? "🏢",
      }))
      .sort((a, b) => b.total - a.total);

    // 4. Report compliance — count distinct (branch_id, report_date) pairs vs expected
    const totalDays =
      (new Date(lastMonthEnd).getTime() -
        new Date(lastMonthStart).getTime()) /
        (1000 * 60 * 60 * 24) +
      1;
    const expectedSubmissions = branches.length * totalDays;
    const dateBranchSet = new Set<string>();
    // include all statuses except draft for compliance counting
    const allLastReports = await loadReports(orgRow.id, {
      dateFrom: lastMonthStart,
      dateTo: lastMonthEnd,
      statuses: ["approved", "submitted", "rejected"],
    });
    for (const r of allLastReports) {
      dateBranchSet.add(`${r.branch_id}|${r.report_date}`);
    }
    const actualSubmissions = dateBranchSet.size;
    const compliancePct =
      expectedSubmissions > 0
        ? (actualSubmissions / expectedSubmissions) * 100
        : 0;

    // ────────────────────────────────────────────────────────────────
    // Build Telegram message
    // ────────────────────────────────────────────────────────────────
    const lines: string[] = [];
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push(`📄 <b>Monthly Report — ${htmlEscape(lastMonthThai)}</b>`);
    lines.push(`🏢 ${htmlEscape(orgRow.name)}`);
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push(`💰 ยอดรวม: <b>${baht(lastTotal)}</b>`);
    if (vsPrev !== null) {
      const arrow = vsPrev >= 0 ? "📈" : "📉";
      lines.push(
        `${arrow} ${vsPrev >= 0 ? "+" : ""}${vsPrev.toFixed(1)}% vs เดือนก่อน`,
      );
    }
    lines.push("");
    if (top5.length > 0) {
      lines.push("🏆 <b>Top 5 สาขา</b>");
      top5.forEach((b, i) => {
        const e = BUSINESS_TYPES[b.business_type]?.emoji ?? "🏢";
        lines.push(
          `${i + 1}. ${e} ${htmlEscape(b.code)} — ${baht(b.total)}`,
        );
      });
      lines.push("");
    }
    if (typeBreakdown.length > 0) {
      lines.push("🏪 <b>แยกตามประเภทธุรกิจ</b>");
      typeBreakdown.slice(0, 6).forEach((t) => {
        lines.push(`${t.emoji} ${baht(t.total)}`);
      });
      lines.push("");
    }
    lines.push("📋 <b>Report Compliance</b>");
    lines.push(
      `กรอก ${actualSubmissions}/${expectedSubmissions} (${compliancePct.toFixed(1)}%)`,
    );
    lines.push("━━━━━━━━━━━━━━━━━━━━");

    const message = lines.join("\n");
    const reportLink = `${getBaseUrl()}/cashhub/monthly-report?month=${lastMonthLabel}`;
    const inlineKeyboard = [
      [
        {
          text: "📊 ดูรายงานเต็ม",
          url: reportLink,
        },
      ],
    ];

    // ────────────────────────────────────────────────────────────────
    // 1. Insert notifications (super_admin + org_admin + admin)
    // ────────────────────────────────────────────────────────────────
    const { data: adminUsers } = await admin
      .from("users")
      .select("id, telegram_chat_id")
      .eq("org_id", orgRow.id)
      .in("role", ["super_admin", "org_admin", "admin"])
      .eq("is_active", true);

    const adminUserList = (adminUsers ?? []) as Array<{
      id: string;
      telegram_chat_id: string | null;
    }>;

    if (adminUserList.length > 0) {
      const notifRows = adminUserList.map((u) => ({
        id: crypto.randomUUID(),
        org_id: orgRow.id,
        user_id: u.id,
        type: "info",
        module: "core",
        title: titlePrefix,
        body: `ยอดรวม ${baht(lastTotal)} · กรอกครบ ${compliancePct.toFixed(0)}%`,
        link: `/cashhub/monthly-report?month=${lastMonthLabel}`,
      }));
      await admin.from("notifications").insert(notifRows);
    }

    // ────────────────────────────────────────────────────────────────
    // 2. Telegram digest
    // ────────────────────────────────────────────────────────────────
    for (const u of adminUserList) {
      if (u.telegram_chat_id) {
        const r = await sendTelegramMessage({
          chatId: u.telegram_chat_id,
          text: message,
          parseMode: "HTML",
          inlineKeyboard,
        });
        if (r) sentTelegram += 1;
      }
    }

    // ────────────────────────────────────────────────────────────────
    // 3. Audit log
    // ────────────────────────────────────────────────────────────────
    await admin.from("audit_logs").insert({
      id: crypto.randomUUID(),
      org_id: orgRow.id,
      user_id: null,
      action: "MONTHLY_REPORT_GENERATED",
      resource_type: "organization",
      resource_id: orgRow.id,
      diff: {
        new: {
          month: lastMonthLabel,
          total: lastTotal,
          vsPrevPct: vsPrev,
          branches: branches.length,
          compliancePct: Number(compliancePct.toFixed(2)),
          notifiedUsers: adminUserList.length,
        },
      },
    });

    processed += 1;
  }

  return NextResponse.json({
    ok: true,
    processed,
    sentTelegram,
    skipped,
    month: lastMonthLabel,
  });
}
