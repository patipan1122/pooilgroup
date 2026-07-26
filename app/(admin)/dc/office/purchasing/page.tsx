// DC · หลังบ้าน · ใบสั่งซื้อจีน — workspace มาสเตอร์-ดีเทล + บอร์ดสถานะ (ในจอเดียว)
// แสดงใบสั่งซื้อทั้งหมดของ org · สั่งจีน (¥) / ซื้อไทย (฿) · ติดตามสถานะตั้งแต่สั่งถึงรับเข้าคลัง.
// server โหลด list + สถิติ "งานค้างวันนี้" → ส่งให้ <PurchasingWorkspace> (client) คุม interactivity.
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { listSuppliersForPo } from "@/lib/dc/po-actions";
import { getTodayFxRate } from "@/lib/dc/fx";
import { PurchasingWorkspace, type PoListItem, type PurchasingStats } from "./purchasing-workspace";

export const dynamic = "force-dynamic";

export default async function DcPurchasingPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;
  const canManage = canDcManage(ctx.session.user.role);
  const canDelete = isSuperAdmin(ctx.session.user.role); // ลบใบ = super_admin เท่านั้น

  // โหลดใบ + ผู้ขาย + บรรทัด + กล่อง (เลขพัสดุ/สถานะ) — ใหม่สุดก่อน
  const pos = await prisma.dcPurchaseOrder.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      poCode: true,
      title: true,
      status: true,
      origin: true,
      currency: true,
      fxRate: true, // เรตหยวน→บาทของใบนั้น (ไว้แปลง ¥→฿ สำหรับยอดรวมในมุมมองตาราง)
      createdAt: true,
      orderedAt: true,
      supplier: { select: { name: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true, qty: true, unitPriceCny: true,
          product: { select: { name: true, imageR2Path: true } },
        },
      },
      shipments: { select: { trackingNo: true, status: true, mode: true, createdAt: true, eta: true } },
    },
  });

  const r2Base = process.env.R2_PUBLIC_URL ?? "";
  const imgUrl = (p: string | null) =>
    p ? (p.startsWith("http") ? p : `${r2Base}/${p}`) : null;

  // สถิติ "งานค้างวันนี้" — นับระหว่าง map ครั้งเดียว
  let pendingTracking = 0; // สั่งแล้ว (ORDERED) แต่ยังไม่มีกล่องที่มีเลขพัสดุ
  let pendingGrn = 0; // ถึงโกดัง/ถึงไทย/รับบางส่วน — ค้างรับเข้า (GRN)
  let inTransit = 0; // กล่องที่กำลังขนส่ง (IN_TRANSIT)

  const items: PoListItem[] = pos.map((po) => {
    const total = po.lines.reduce((sum, l) => sum + l.qty * Number(l.unitPriceCny), 0);
    // ยอดเป็นบาท (ไว้รวมข้ามใบจีน+ไทยในตาราง): ไทย=บาทอยู่แล้ว · จีน=แปลงด้วยเรตของใบนั้น
    // ใบจีนเก่าที่ยังไม่มีเรต → null (ตารางโชว์ "—" · ไม่นับเข้ายอดรวมบาท)
    const isThaiPo = po.origin === "THAI" || po.currency === "THB";
    const fxRate = po.fxRate != null ? Number(po.fxRate) : null;
    const totalThb = isThaiPo ? total : fxRate ? total * fxRate : null;
    const boxCount = po.shipments.length;
    const hasTracking = po.shipments.some((s) => (s.trackingNo ?? "").trim() !== "");
    inTransit += po.shipments.filter((s) => s.status === "IN_TRANSIT").length;

    if (po.status === "ORDERED" && !hasTracking) pendingTracking += 1;
    if (po.status === "AT_WAREHOUSE" || po.status === "READY_TO_RECEIVE" || po.status === "ARRIVED_TH" || po.status === "PARTIAL") pendingGrn += 1;

    // กล่องที่ใช้ประเมินวันถึง: เอากล่องที่มีเลขพัสดุก่อน (ไม่มี→กล่องแรก)
    const trackedShip =
      po.shipments.find((s) => (s.trackingNo ?? "").trim() !== "") ?? po.shipments[0] ?? null;
    const hasTrackNo = !!trackedShip && (trackedShip.trackingNo ?? "").trim() !== "";

    return {
      id: po.id,
      poCode: po.poCode,
      title: po.title,
      status: po.status,
      origin: po.origin,
      currency: po.currency,
      supplierName: po.supplier?.name ?? null,
      total,
      totalThb,
      lineCount: po.lines.length,
      boxCount,
      hasTracking,
      date: (po.orderedAt ?? po.createdAt).toISOString(),
      orderedAt: po.orderedAt ? po.orderedAt.toISOString() : null,
      shipMode: trackedShip?.mode ?? null,
      // "วันได้เลข tracking" = วันที่สร้างกล่องที่มีเลขพัสดุ (setPoTracking สร้างกล่องพร้อมเลข)
      trackingDate: hasTrackNo ? trackedShip!.createdAt.toISOString() : null,
      etaExplicit: trackedShip?.eta ? trackedShip.eta.toISOString() : null,
      lines: po.lines.map((l) => ({
        name: l.product?.name ?? "—",
        qty: l.qty,
        unitPrice: Number(l.unitPriceCny),
        imageUrl: imgUrl(l.product?.imageR2Path ?? null),
      })),
    };
  });

  const stats: PurchasingStats = { pendingTracking, pendingGrn, inTransit };
  const r2PublicUrl = process.env.R2_PUBLIC_URL ?? "";

  // ข้อมูลให้ราง "สร้างใบสั่งซื้อ" (#6) ใช้ — โหลดพร้อมกัน
  const [chrome, suppliers, chinaFx] = await Promise.all([
    getDcOfficeChrome(orgId),
    canManage ? listSuppliersForPo() : Promise.resolve([]),
    canManage ? getTodayFxRate("CNY", "THB") : Promise.resolve(null),
  ]);
  const warehouses = ctx.warehouses.map((w) => ({ id: w.id, name: w.name }));

  return (
    <DcOfficeShell active="po" {...dcShellChrome(ctx, chrome)}>
      <div>
        <div style={{ marginBottom: 14 }}>
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 700, letterSpacing: "-.01em" }}>จัดซื้อ &amp; นำเข้า</h1>
          <p style={{ margin: "4px 0 0", color: "var(--ink2)", fontSize: 13.5 }}>
            สั่งของจากจีน (¥) และซื้อในไทย (฿) · ติดตามตั้งแต่สั่งถึงรับเข้าคลัง — ในจอเดียว
          </p>
        </div>
        <PurchasingWorkspace
          items={items}
          stats={stats}
          canManage={canManage}
          canDelete={canDelete}
          r2PublicUrl={r2PublicUrl}
          warehouses={warehouses}
          suppliers={suppliers}
          chinaFxRate={chinaFx?.rate ?? null}
          chinaFxDate={chinaFx?.date ?? null}
        />
      </div>
    </DcOfficeShell>
  );
}
