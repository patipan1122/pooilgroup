// LeanUX C2 (2026-06-09): "สิทธิ์การใช้งาน" merged into the combined "ทีม & สิทธิ์"
// page (/ledger/settings/members) as the "สิทธิ์" tab — same mental model as members.
// This route redirects so old links/bookmarks still land on the permissions tab.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PermissionSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.company) qs.set("company", sp.company);
  if (sp.branch) qs.set("branch", sp.branch);
  qs.set("tab", "permissions");
  redirect(`/ledger/settings/members?${qs.toString()}`);
}
