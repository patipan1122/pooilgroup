// DC Redesign v2 · chrome ของ shell หลังบ้าน (badge เมนู + แถบงานค้าง) — server-only.
// ใช้ร่วมทุกหน้าที่ห่อด้วย DcOfficeShell เพื่อไม่ซ้ำ COUNT query.
import "server-only";
import { prisma } from "@/lib/prisma";
import { DcPoStatus, DcShipmentStatus, DcPostStatus } from "@/lib/generated/prisma/enums";

export type DcChrome = {
  badges: { po: number; ship: number; grn: number };
  taskStrip: { tracking: number; grn: number; inTransit: number };
};

/** นับสด: ใบสั่งกำลังดำเนิน · ชิปเมนต์ยังไม่รับ · GRN รอลงบัญชี · รอ tracking · ระหว่างทาง. */
export async function getDcOfficeChrome(orgId: string): Promise<DcChrome> {
  const [poOpen, shipOpen, grnPending, poOrdered, shipInTransit] = await Promise.all([
    prisma.dcPurchaseOrder.count({
      where: { orgId, status: { notIn: [DcPoStatus.RECEIVED, DcPoStatus.CLOSED, DcPoStatus.CANCELLED] } },
    }),
    prisma.dcShipment.count({ where: { orgId, status: { not: DcShipmentStatus.RECEIVED } } }),
    prisma.dcGoodsReceipt.count({ where: { orgId, postStatus: DcPostStatus.PENDING } }),
    prisma.dcPurchaseOrder.count({ where: { orgId, status: DcPoStatus.ORDERED } }),
    prisma.dcShipment.count({ where: { orgId, status: DcShipmentStatus.IN_TRANSIT } }),
  ]);
  return {
    badges: { po: poOpen, ship: shipOpen, grn: grnPending },
    taskStrip: { tracking: poOrdered, grn: grnPending, inTransit: shipInTransit },
  };
}

export const DC_ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin", org_admin: "Admin", admin: "Admin", program_admin: "Program Admin",
  area_manager: "Area Manager", branch_manager: "Manager", staff: "Staff", viewer: "Viewer",
};
