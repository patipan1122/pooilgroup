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

  // Process orgs in parallel; within each org, fan out branches + reports.
  const orgResults = await Promise.all(orgs.map(processOrg));
  const sent = orgResults.reduce((s, n) => s + n, 0);
  return NextResponse.json({ ok: true, sent });

  async function processOrg(org: { id: string }) {
    const [branchesQ, reportsQ] = await Promise.all([
      admin
        .from("branches")
        .select("id, code")
        .eq("org_id", org.id)
        .eq("is_active", true),
      admin
        .from("daily_reports")
        .select("branch_id, status")
        .eq("org_id", org.id)
        .eq("report_date", today),
    ]);
    const branches = branchesQ.data ?? [];
    const todayReports = reportsQ.data ?? [];

    const submittedIds = new Set(todayReports.map((r) => r.branch_id));
    const submittedCount = submittedIds.size;
    const expectedCount = branches.length;
    const pendingCount = todayReports.filter(
      (r) => r.status === "submitted",
    ).length;
    const lateBranches = branches
      .filter((b) => !submittedIds.has(b.id))
      .map((b) => b.code as string);

    if (submittedCount === expectedCount && pendingCount === 0) return 0;

    const message = buildEveningCheck({
      todayDate: today,
      submittedCount,
      expectedCount,
      pendingCount,
      lateBranches,
    });

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
    // Telegram sends in parallel within the org.
    const sendResults = await Promise.all(
      (admins ?? [])
        .filter((a) => a.telegram_chat_id)
        .map((a) =>
          sendTelegramMessage({
            chatId: a.telegram_chat_id as string,
            text: message,
            parseMode: "HTML",
            inlineKeyboard,
          }),
        ),
    );
    return sendResults.filter(Boolean).length;
  }
}
