// Legacy /chairops/dashboard route · superseded by (office)/page.tsx (W1).
// Kept as a back-compat redirect for 1 week per /tmp/claude-design_chairops_plan.md §1.1.
// Bookmark holders land on /chairops without seeing 404.
import { redirect } from "next/navigation";

export default function LegacyDashboardRedirect() {
  redirect("/chairops");
}
