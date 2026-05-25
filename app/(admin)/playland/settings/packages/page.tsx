import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { PackagesClient } from "@/components/playland/settings/packages-client";

export const dynamic = "force-dynamic";

export default async function PackagesSettingsPage() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const [branches, packages] = await Promise.all([
    listBranches(orgId),
    prisma.playlandPackage.findMany({ where: { orgId }, orderBy: [{ sortOrder: "asc" }, { price: "asc" }] }),
  ]);
  return <PackagesClient
    branches={branches.map((b) => ({ id: b.id, name: b.name }))}
    packages={packages.map((p) => ({
      id: p.id, branchId: p.branchId, type: p.type, name: p.name, description: p.description, minutes: p.minutes, price: p.price, perMinuteRate: p.perMinuteRate, active: p.active,
    }))}
  />;
}
