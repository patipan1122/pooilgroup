// Cron — 18:00 BKK Evening Check (status of today)
// Auth: Bearer ${CRON_SECRET}

import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/db/server";
import { runWithMonitor } from "@/lib/cron/runner";
import { sendTelegramMessage } from "@/lib/telegram/send";
import { buildEveningCheck } from "@/lib/telegram/messages";
import { getBaseUrl } from "@/lib/utils/base-url";
import { formatInTimeZone } from "date-fns-tz";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runWithMonitor("evening-check", () => run(), { req });
}
export async function POST(req: NextRequest) {
  return GET(req);
}

async function run() {
  const admin = adminClient();
  const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");

  const { data: orgs } = await admin
    .from("organizations")
    .select("id")
    .eq("is_active", true);
  if (!orgs) return NextResponse.json({ ok: true, sent: 0 });

  let sent = 0;
  for (const org of orgs) {
    const { data: branches } = await admin
      .from("branches")
      .select("id, code")
      .eq("org_id", org.id)
      .eq("is_active", true);
    const { data: todayReports } = await admin
      .from("daily_reports")
      .select("branch_id, status")
      .eq("org_id", org.id)
      .eq("report_date", today);

    const submittedIds = new Set((todayReports ?? []).map((r) => r.branch_id));
    const submittedCount = submittedIds.size;
    const expectedCount = (branches ?? []).length;
    const pendingCount = (todayReports ?? []).filter(
      (r) => r.status === "submitted",
    ).length;
    const lateBranches = (branches ?? [])
      .filter((b) => !submittedIds.has(b.id))
      .map((b) => b.code as string);

    if (submittedCount === expectedCount && pendingCount === 0) continue; // all good — skip noise

    const message = buildEveningCheck({
      todayDate: today,
      submittedCount,
      expectedCount,
      pendingCount,
      lateBranches,
    });

    // Build inline keyboard for bulk approve when there are pending reports
    const inlineKeyboard =
      pendingCount > 0
        ? [
            [
              {
                text: `✅ อนุมัติทั้งหมด ${pendingCount} รายการ`,
                callback_data: `cashhub:bulkapprove:${org.id}`,
              },
            ],
            [
              {
                text: "👁 ดูในเว็บ",
                url: `${getBaseUrl()}/cashhub/reports?status=submitted`,
              },
            ],
          ]
        : undefined;

    const { data: admins } = await admin
      .from("users")
      .select("telegram_chat_id")
      .eq("org_id", org.id)
      .in("role", ["super_admin", "org_admin", "admin"])
      .eq("is_active", true);
    for (const a of admins ?? []) {
      if (a.telegram_chat_id) {
        const r = await sendTelegramMessage({
          chatId: a.telegram_chat_id as string,
          text: message,
          parseMode: "HTML",
          inlineKeyboard,
        });
        if (r) sent += 1;
      }
    }
  }
  return NextResponse.json({ ok: true, sent });
}
