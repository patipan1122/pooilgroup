// /cashhub root — redirect to /cashhub/dashboard.
//
// Without this, clicking the CashHub module pill in the admin topbar
// (which navigates to `m.basePath` = "/cashhub") lands on a 404 because
// CashHub has no root page. Pool's other modules (e.g. /docuflow,
// /repairs) follow the same pattern but they happen to have a default
// route; CashHub didn't.
//
// Reported 2026-05-22 (รอบ 50) — CEO got "เปิดไม่ได้" because the
// landing redirect was missing.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function CashHubRootPage() {
  redirect("/cashhub/dashboard");
}
