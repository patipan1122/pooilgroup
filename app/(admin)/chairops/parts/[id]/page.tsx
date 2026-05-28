// Back-compat: part detail now renders in the split-view right pane.
// Old /chairops/parts/<id> links redirect into the workspace with that part selected.
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/chairops/auth/session";

export default async function PartDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("OFFICE");
  const { id } = await params;
  redirect(`/chairops/parts?selected=${id}`);
}
