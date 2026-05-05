// /branches list redirects to the unified /users page (Team & Branches).
// The /branches/[id] detail + edit pages are still used for editing a single branch.

import { redirect } from "next/navigation";

export default function BranchesPage() {
  redirect("/users");
}
