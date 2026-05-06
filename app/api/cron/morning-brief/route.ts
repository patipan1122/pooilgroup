// Cron — 07:00 BKK Morning Brief to all org admins via Telegram
// Auth: Bearer ${CRON_SECRET}

import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/db/server";
import { sendTelegramMessage } from "@/lib/telegram/send";
import { buildMorningBrief } from "@/lib/telegram/messages";
import { getBaseUrl } from "@/lib/utils/base-url";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { loadBranches, loadReports, indexBranches } from "@/lib/cashhub/data";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}

export async function POST(req: NextRequest) {
  return GET(req);
}

async function run() {
  const admin = adminClient();
  const now = new Date();
  const yesterday = formatInTimeZone(subDays(now, 1), TZ, "yyyy-MM-dd");
  const dayBefore = formatInTimeZone(subDays(now, 2), TZ, "yyyy-MM-dd");

  const { data: orgs } = await admin
    .from("organizations")
    .select("id, name")
    .eq("is_active", true);
  if (!orgs) return NextResponse.json({ ok: true, sent: 0 });

  let sent = 0;
  for (const org of orgs) {
    // All reads through the canonical loader.
    const branches = await loadBranches(org.id, { activeOnly: true });
    const branchById = indexBranches(branches);

    const yReports = await loadReports(org.id, {
      dateFrom: yesterday,
      dateTo: yesterday,
      statuses: ["approved"],
    });
    const dReports = await loadReports(org.id, {
      dateFrom: dayBefore,
      dateTo: dayBefore,
      statuses: ["approved"],
    });
    const pendingRows = await loadReports(org.id, {
      statuses: ["submitted"],
    });

    const yTotal = yReports.reduce(
      (s, r) => s + Number(r.total_sales || 0),
      0,
    );
    const dTotal = dReports.reduce(
      (s, r) => s + Number(r.total_sales || 0),
      0,
    );
    const vsPrev = dTotal > 0 ? ((yTotal - dTotal) / dTotal) * 100 : null;

    // Top 3 branches yesterday
    const byBranch = new Map<string, { code: string; emoji: string; total: number }>();
    for (const r of yReports) {
      const id = r.branch_id;
      const b = branchById.get(id);
      const code = b?.code ?? "—";
      const emoji = BUSINESS_TYPES[b?.business_type ?? ""]?.emoji ?? "🏢";
      const cur = byBranch.get(id) ?? { code, emoji, total: 0 };
      cur.total += Number(r.total_sales || 0);
      byBranch.set(id, cur);
    }
    const topBranches = Array.from(byBranch.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);

    // Alerts: branches that didn't submit yesterday
    const submittedIds = new Set(yReports.map((r) => r.branch_id));
    const missing = branches.filter((b) => !submittedIds.has(b.id));
    const alertLines = missing.slice(0, 5).map((b) => `${b.code} — ไม่กรอกเมื่อวาน`);

    const message = buildMorningBrief({
      yesterdayDate: yesterday,
      yesterdayTotal: yTotal,
      vsPrevDayPct: vsPrev,
      topBranches,
      pendingCount: (pendingRows ?? []).length,
      alertLines,
      webBaseUrl: getBaseUrl(),
    });

    // Send to org admins with linked Telegram
    const { data: admins } = await admin
      .from("users")
      .select("telegram_chat_id, name")
      .eq("org_id", org.id)
      .in("role", ["super_admin", "org_admin", "admin"])
      .eq("is_active", true);
    for (const a of admins ?? []) {
      if (a.telegram_chat_id) {
        const r = await sendTelegramMessage({
          chatId: a.telegram_chat_id as string,
          text: message,
          parseMode: "HTML",
        });
        if (r) sent += 1;
      }
    }
  }
  return NextResponse.json({ ok: true, sent });
}
