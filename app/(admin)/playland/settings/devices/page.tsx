import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { DevicesClient } from "@/components/playland/settings/devices-client";

export const dynamic = "force-dynamic";

// กุญแจลับ webhook ของเครื่องสแกนหน้า (ACS) = โครงสร้างหลังบ้าน → super_admin เท่านั้น
// แอดมิน/ผู้จัดการอื่นยังทำงาน Playland ประจำวันได้ แต่ไม่เห็นกุญแจลับของอุปกรณ์
export default async function DevicesSettingsPage() {
  const session = await requireSession();
  if (!isSuperAdmin(session.user.role)) redirect("/playland/settings");
  const orgId = session.user.org_id;
  const [branches, devices] = await Promise.all([
    listBranches(orgId),
    prisma.playlandDevice.findMany({ where: { orgId }, include: { branch: true }, orderBy: { createdAt: "asc" } }),
  ]);
  return <DevicesClient
    branches={branches.map((b) => ({ id: b.id, name: b.name }))}
    devices={devices.map((d) => ({
      id: d.id, branchId: d.branchId, branchName: d.branch.name, vendor: d.vendor,
      deviceId: d.deviceId, deviceName: d.deviceName, baseUrl: d.baseUrl,
      protocol: d.protocol, modelVersion: d.modelVersion, status: d.status,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null, webhookSecret: d.webhookSecret,
    }))}
  />;
}
