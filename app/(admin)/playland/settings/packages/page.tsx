import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { PackagesClient } from "@/components/playland/settings/packages-client";

export const dynamic = "force-dynamic";

export default async function PackagesSettingsPage() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const { branches, activeId } = await getBranchContext(orgId);
  // แพ็กเกจของสาขานี้ + ที่ตั้งเป็น "ทุกสาขา" (branchId null)
  const packages = await prisma.playlandPackage.findMany({ where: { orgId, ...(activeId ? { OR: [{ branchId: activeId }, { branchId: null }] } : {}) }, orderBy: [{ sortOrder: "asc" }, { price: "asc" }] });
  return <PackagesClient
    activeBranchId={activeId}
    branches={branches.map((b) => ({ id: b.id, name: b.name }))}
    packages={packages.map((p) => ({
      id: p.id, branchId: p.branchId, type: p.type, name: p.name, description: p.description, minutes: p.minutes, price: p.price, perMinuteRate: p.perMinuteRate, active: p.active,
    }))}
  />;
}
