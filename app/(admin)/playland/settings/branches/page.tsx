import { requireSession } from "@/lib/auth/session";
import { listBranches } from "@/lib/playland/queries";
import { BranchesClient } from "@/components/playland/settings/branches-client";

export const dynamic = "force-dynamic";

export default async function BranchesSettingsPage() {
  const session = await requireSession();
  const branches = await listBranches(session.user.org_id);
  return <BranchesClient branches={branches.map((b) => ({
    id: b.id, name: b.name, slug: b.slug, address: b.address, phone: b.phone, active: b.active,
  }))} />;
}
