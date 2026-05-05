// Quick Note inbox — list reports with notes from staff (CASHHUB §11.6)
// GET /api/cashhub/notes — recent notes (30 days, including unread tracking from settings)

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const admin = adminClient();
  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get("days") || "30", 10);
  const since = formatInTimeZone(
    subDays(new Date(), days),
    TZ,
    "yyyy-MM-dd",
  );

  const { data } = await admin
    .from("daily_reports")
    .select(
      "id, branch_id, report_date, shift, notes, status, total_sales, branches(code, name, business_type)",
    )
    .eq("org_id", session.user.org_id)
    .not("notes", "is", null)
    .gte("report_date", since)
    .order("report_date", { ascending: false })
    .limit(80);

  const filtered = (data ?? []).filter((r) => (r.notes ?? "").trim().length > 0);
  return NextResponse.json({ notes: filtered });
}
