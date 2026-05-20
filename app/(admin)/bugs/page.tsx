// Admin Bug Reports page — list, filter, update status
// 2026-05-20: CEO requested aggregated bug list. Admin tier only.

import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { BugsView, type BugRow } from "./bugs-view";

export const dynamic = "force-dynamic";

export default async function BugsPage() {
  const session = await requireSession();
  requireAdminTier(session.user.role);

  const admin = adminClient();
  const { data: rawBugs } = await admin
    .from("bug_reports")
    .select(
      "id, url, description, screenshot_key, status, admin_note, acknowledged_at, fixed_at, created_at, updated_at, reporter:reporter_id(id, name, email), acknowledged_by:acknowledged_by_id(id, name)",
    )
    .eq("org_id", session.user.org_id)
    .order("created_at", { ascending: false })
    .limit(200);

  const r2Base = process.env.R2_PUBLIC_URL ?? "";
  const bugs: BugRow[] = ((rawBugs ?? []) as unknown as BugRow[]).map((b) => ({
    ...b,
    screenshotUrl:
      b.screenshot_key && r2Base ? `${r2Base}/${b.screenshot_key}` : null,
  }));

  return <BugsView initialBugs={bugs} />;
}
