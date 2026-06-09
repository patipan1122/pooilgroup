// LeanUX C1 (2026-06-09): the floating-slip work merged into /ledger/reconcile
// (one money home — the old standalone "สลิปจ่ายเงิน" page was an orphan with no
// nav entry that duplicated reconcile's slip pairing). This route now redirects so
// any old links/bookmarks still land on the right place; the slip→bill pairing UI
// lives in reconcile (gated by LEDGER_SLIP_V1).
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.company) qs.set("company", sp.company);
  if (sp.branch) qs.set("branch", sp.branch);
  const q = qs.toString();
  redirect(q ? `/ledger/reconcile?${q}` : "/ledger/reconcile");
}
