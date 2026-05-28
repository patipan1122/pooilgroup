// Cron — วันที่ 25 ของทุกเดือน 09:00 BKK
// HR shortage monthly digest — รวมเงินขาดเดือนนี้ ส่ง Telegram + บันทึก audit
// HR agent audit 2026-05-20 · D-020 ledger-only flow
//
// Vercel cron: { path: "/api/cron/shortage-digest", schedule: "0 2 25 * *" } (UTC = 09:00 BKK)

import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/db/server";
import { runWithMonitor } from "@/lib/cron/runner";
import { sendTelegramMessage } from "@/lib/telegram/send";
import { audit } from "@/lib/audit/log";
import { startOfMonth, endOfMonth } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { getBaseUrl } from "@/lib/utils/base-url";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

const MONTHS_TH = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runWithMonitor("shortage-digest", () => run(), { req });
}

export async function POST(req: NextRequest) {
  return GET(req);
}

interface ShortageRow {
  org_id: string;
  amount: number | string;
  person_name: string | null;
  is_identified: boolean;
}

async function run() {
  const admin = adminClient();
  const now = new Date();
  const startStr = formatInTimeZone(startOfMonth(now), TZ, "yyyy-MM-dd");
  const endStr = formatInTimeZone(endOfMonth(now), TZ, "yyyy-MM-dd");
  const monthLabel = `${MONTHS_TH[now.getMonth()]} ${(now.getFullYear() + 543) % 100}`;

  const { data: orgs } = await admin
    .from("organizations")
    .select("id, name")
    .eq("is_active", true);
  if (!orgs) return NextResponse.json({ ok: true, sent: 0 });

  let sent = 0;
  const baseUrl = getBaseUrl();

  for (const org of orgs) {
    const { data: rows } = await admin
      .from("cash_shortages")
      .select("org_id, amount, person_name, is_identified")
      .eq("org_id", org.id)
      .gte("report_date", startStr)
      .lte("report_date", endStr);

    const shortages = (rows ?? []) as ShortageRow[];
    if (shortages.length === 0) continue;

    const total = shortages.reduce((s, r) => s + Number(r.amount || 0), 0);
    const identified = shortages.filter((r) => r.is_identified && r.person_name);
    const unidentified = shortages.length - identified.length;

    // Group by person
    const byPerson = new Map<string, { count: number; total: number }>();
    for (const r of identified) {
      const key = r.person_name || "(ไม่ระบุ)";
      const cur = byPerson.get(key) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(r.amount || 0);
      byPerson.set(key, cur);
    }
    const topPersons = Array.from(byPerson.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5);

    const message = [
      `<b>📋 สรุปเงินขาด — ${monthLabel}</b>`,
      `<i>${org.name ?? "Pooilgroup"}</i>`,
      ``,
      `💰 รวม: <b>${total.toLocaleString("th-TH", { minimumFractionDigits: 2 })} ฿</b>`,
      `📊 ${shortages.length} ครั้ง · ${byPerson.size} คนระบุชื่อ${unidentified > 0 ? ` · <i>${unidentified} ครั้งไม่ระบุ</i>` : ""}`,
      ``,
      ...(topPersons.length > 0
        ? [
            `<b>Top ${Math.min(5, topPersons.length)} ผู้รับผิดชอบ:</b>`,
            ...topPersons.map(
              ([name, agg], i) =>
                `${i + 1}. ${name} — ${agg.total.toLocaleString("th-TH")} ฿ (${agg.count} ครั้ง)`,
            ),
            ``,
          ]
        : []),
      `📥 <a href="${baseUrl}/api/cashhub/shortages/export?from=${startStr}&to=${endStr}">ดาวน์โหลด CSV ฉบับเต็ม</a>`,
      `📊 <a href="${baseUrl}/cashhub/shortages?month=${formatInTimeZone(now, TZ, "yyyy-MM")}">ดูในแดชบอร์ด</a>`,
    ].join("\n");

    // Send to HR + finance admins (role super_admin/org_admin + has telegram_chat_id)
    const { data: admins } = await admin
      .from("users")
      .select("id, telegram_chat_id")
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

    // Audit log — record digest dispatch (for HR forensic later)
    await audit({
      orgId: org.id,
      userId: null,
      action: "SYSTEM_DIGEST_SENT",
      resourceType: "cash_shortages",
      diff: {
        new: {
          digest: "monthly-shortage",
          monthLabel,
          totalAmount: total,
          rowCount: shortages.length,
          identifiedCount: identified.length,
          unidentifiedCount: unidentified,
        },
      },
    });
  }
  return NextResponse.json({ ok: true, sent });
}
