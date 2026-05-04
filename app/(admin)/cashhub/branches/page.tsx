// Legacy path — Branches moved to /admin/branches (Core, not CashHub-specific).
// Keep this redirect so old links/bookmarks still work.

import { redirect } from "next/navigation";

export default function CashHubBranchesRedirect() {
  redirect("/branches");
}
