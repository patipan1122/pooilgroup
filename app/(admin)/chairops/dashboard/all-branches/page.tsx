// Back-compat redirect · the all-branches card grid was replaced by the new
// 3-pane Branches workspace at /chairops/branches (SPEC §B/Branches, 2026-05-28).
// Old bookmarks / nav links keep working.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AllBranchesRedirect() {
  redirect("/chairops/branches");
}
