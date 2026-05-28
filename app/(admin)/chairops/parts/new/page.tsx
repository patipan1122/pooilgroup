// Back-compat: the add form now lives in the split-view right pane.
// Old bookmarks / links to /chairops/parts/new redirect into the workspace.
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/chairops/auth/session";

export default async function NewPartRedirect() {
  await requireRole("OFFICE");
  redirect("/chairops/parts?selected=new");
}
