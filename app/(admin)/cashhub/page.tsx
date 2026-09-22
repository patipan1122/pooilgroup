// /cashhub root — redirect to /cashhub/import.
//
// Without this, clicking the CashHub module pill in the admin topbar
// (which navigates to `m.basePath` = "/cashhub") lands on a 404 because
// CashHub has no root page. Pool's other modules (e.g. /docuflow,
// /repairs) follow the same pattern but they happen to have a default
// route; CashHub didn't.
//
// Reported 2026-05-22 (รอบ 50) — CEO got "เปิดไม่ได้" because the
// landing redirect was missing.
//
// Was /cashhub/dashboard until 2026-09-20 — CEO flagged it as unusable as
// a landing page (stuck on skeleton) and asked for the Data Import Center
// instead. "ภาพรวม" is kept in the nav for direct access.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function CashHubRootPage() {
  redirect("/cashhub/import");
}
