// DC · หลังบ้าน → สิทธิ์พนักงาน (ใครเห็นคลังไหน) — แอดมินเท่านั้น
import { getDcContext } from "@/lib/dc/access";
import { requireDcAdmin, canDcManage } from "@/lib/dc/role-guard";
import { prisma } from "@/lib/prisma";
import { adminClient } from "@/lib/db/server";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { PermissionMatrix, type OrgUser, type Assignment } from "./permission-matrix";

export const dynamic = "force-dynamic";

export default async function DcPermissionsPage() {
  const ctx = await getDcContext();
  requireDcAdmin(ctx.session.user.role);

  const orgId = ctx.session.user.org_id;

  // คลังขององค์กร (รวมที่ปิดใช้ — ผูกสิทธิ์ได้ทุกคลัง)
  const warehouses = await prisma.dcWarehouse.findMany({
    where: { orgId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, isActive: true },
  });

  // พนักงานขององค์กร (Supabase admin client)
  const { data: usersData } = await adminClient()
    .from("users")
    .select("id, name, email, role")
    .eq("org_id", orgId)
    .eq("is_active", true);

  const users: OrgUser[] = (usersData ?? []).map((u) => ({
    id: u.id as string,
    name: (u.name as string | null) ?? "",
    email: (u.email as string | null) ?? null,
    role: (u.role as string | null) ?? "",
  }));

  // การผูกสิทธิ์ที่มีอยู่ (เปิดใช้)
  const bindings = await prisma.dcWarehouseUser.findMany({
    where: { orgId, isActive: true },
    select: { warehouseId: true, userId: true, role: true },
  });
  const assignments: Assignment[] = bindings.map((b) => ({
    warehouseId: b.warehouseId,
    userId: b.userId,
    role: b.role,
  }));

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <div className="dc-h1">สิทธิ์พนักงาน</div>
          <div className="dc-sub">ผูกพนักงานเข้าคลัง — ใครเห็นคลังไหน</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <div className="dc-card mb-5 text-sm leading-relaxed text-zinc-600">
        <span className="font-semibold text-zinc-800">วิธีคิดสิทธิ์การมองเห็น:</span>{" "}
        ผู้ดูแล (admin) เห็นทุกคลังเสมอ ·{" "}
        พนักงานที่<span className="font-medium">ยังไม่ผูก</span> = เห็นทุกคลัง ·{" "}
        ผูกแล้ว = เห็น<span className="font-medium">เฉพาะคลังที่ผูก</span>
      </div>

      <PermissionMatrix
        warehouses={warehouses}
        users={users}
        assignments={assignments}
      />
    </div>
  );
}
