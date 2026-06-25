// DC · หลังบ้าน · ใบสั่งซื้อจีน — workspace มาสเตอร์-ดีเทล + บอร์ดสถานะ (ในจอเดียว)
// แสดงใบสั่งซื้อทั้งหมดของ org · สั่งจีน (¥) / ซื้อไทย (฿) · ติดตามสถานะตั้งแต่สั่งถึงรับเข้าคลัง.
// server โหลด list + สถิติ "งานค้างวันนี้" → ส่งให้ <PurchasingWorkspace> (client) คุม interactivity.
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { PurchasingWorkspace, type PoListItem, type PurchasingStats } from "./purchasing-workspace";

export const dynamic = "force-dynamic";

export default async function DcPurchasingPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;
  const canManage = canDcManage(ctx.session.user.role);

  // โหลดใบ + ผู้ขาย + บรรทัด + กล่อง (เลขพัสดุ/สถานะ) — ใหม่สุดก่อน
  const pos = await prisma.dcPurchaseOrder.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      poCode: true,
      status: true,
      origin: true,
      currency: true,
      createdAt: true,
      orderedAt: true,
      supplier: { select: { name: true } },
      lines: {
        orderBy: { id: "asc" },
        select: { id: true, qty: true, unitPriceCny: true },
      },
      shipments: { select: { trackingNo: true, status: true } },
    },
  });

  // สถิติ "งานค้างวันนี้" — นับระหว่าง map ครั้งเดียว
  let pendingTracking = 0; // สั่งแล้ว (ORDERED) แต่ยังไม่มีกล่องที่มีเลขพัสดุ
  let pendingGrn = 0; // ถึงโกดัง/ถึงไทย/รับบางส่วน — ค้างรับเข้า (GRN)
  let inTransit = 0; // กล่องที่กำลังขนส่ง (IN_TRANSIT)

  const items: PoListItem[] = pos.map((po) => {
    const total = po.lines.reduce((sum, l) => sum + l.qty * Number(l.unitPriceCny), 0);
    const boxCount = po.shipments.length;
    const hasTracking = po.shipments.some((s) => (s.trackingNo ?? "").trim() !== "");
    inTransit += po.shipments.filter((s) => s.status === "IN_TRANSIT").length;

    if (po.status === "ORDERED" && !hasTracking) pendingTracking += 1;
    if (po.status === "AT_WAREHOUSE" || po.status === "ARRIVED_TH" || po.status === "PARTIAL") pendingGrn += 1;

    return {
      id: po.id,
      poCode: po.poCode,
      status: po.status,
      origin: po.origin,
      currency: po.currency,
      supplierName: po.supplier?.name ?? null,
      total,
      lineCount: po.lines.length,
      boxCount,
      hasTracking,
      date: (po.orderedAt ?? po.createdAt).toISOString(),
    };
  });

  const stats: PurchasingStats = { pendingTracking, pendingGrn, inTransit };
  const r2PublicUrl = process.env.R2_PUBLIC_URL ?? "";
  const chrome = await getDcOfficeChrome(orgId);

  return (
    <DcOfficeShell active="po" {...dcShellChrome(ctx, chrome)}>
      <div>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em" }}>ใบสั่งซื้อจีน</h1>
          <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>
            สั่งของจากจีน (¥) และซื้อในไทย (฿) · ติดตามสถานะตั้งแต่สั่งถึงรับเข้าคลัง — ในจอเดียว
          </p>
        </div>
        <PurchasingWorkspace items={items} stats={stats} canManage={canManage} r2PublicUrl={r2PublicUrl} />
      </div>
    </DcOfficeShell>
  );
}
