// DocuFlow — /docuflow/browse (DEPRECATED — thin redirect stub)
// ────────────────────────────────────────────────────────────────────
// Docuflow redesign 2026-09-23: /docuflow/browse merged into the
// canonical /docuflow/documents page (its 3 view tabs — ตามประเภท /
// ตามบริษัท / รายการ — now do everything this page used to). This route
// stays only for back-compat with existing links (e.g. category tiles /
// bookmarks using `?tag=`) — forwards straight through, preserving the
// query string.
// ────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

export default async function DocuFlowBrowsePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) search.append(key, v);
    } else {
      search.set(key, value);
    }
  }
  const qs = search.toString();
  redirect("/docuflow/documents" + (qs ? "?" + qs : ""));
}
