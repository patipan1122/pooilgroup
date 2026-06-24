// DC · หลังบ้าน · รายละเอียดใบสั่งซื้อจีน + ปุ่มดำเนินการตามสถานะ
// แสดงหัวใบ · รายการ + รูป + CBM · ยอดรวม · ผู้สร้าง/ผู้อนุมัติ + เวลา.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { PoDetail, type PoDetailData } from "./po-detail";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

/** ดึงชื่อผู้ใช้ (ข้าม schema public.users) — best-effort, ไม่พังถ้าไม่เจอ. */
async function userName(orgId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const u = await prisma.user.findFirst({
      where: { id: userId, orgId },
      select: { name: true, email: true },
    });
    return u?.name ?? u?.email ?? null;
  } catch {
    return null;
  }
}

export default async function DcPoDetailPage({ params }: { params: Params }) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const { id } = await params;
  const po = await prisma.dcPurchaseOrder.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      poCode: true,
      status: true,
      currency: true,
      fxRate: true,
      note: true,
      createdByUserId: true,
      approvedByUserId: true,
      approvedAt: true,
      orderedAt: true,
      createdAt: true,
      supplier: { select: { name: true } },
      warehouseId: true,
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          qty: true,
          unitPriceCny: true,
          unitPriceThb: true,
          photoR2Key: true,
          lengthCm: true,
          widthCm: true,
          heightCm: true,
          cbmPerUnit: true,
          note: true,
          product: { select: { sku: true, name: true, unit: true } },
        },
      },
    },
  });

  if (!po) notFound();

  // ชื่อคลัง (ถ้ามี)
  let warehouseName: string | null = null;
  if (po.warehouseId) {
    const w = await prisma.dcWarehouse.findFirst({
      where: { id: po.warehouseId, orgId },
      select: { name: true },
    });
    warehouseName = w?.name ?? null;
  }

  const [createdBy, approvedBy] = await Promise.all([
    userName(orgId, po.createdByUserId),
    userName(orgId, po.approvedByUserId),
  ]);

  const fxRate = po.fxRate != null ? Number(po.fxRate) : null;

  const data: PoDetailData = {
    id: po.id,
    poCode: po.poCode,
    status: po.status,
    currency: po.currency,
    fxRate,
    note: po.note,
    supplierName: po.supplier?.name ?? null,
    warehouseName,
    createdBy,
    approvedBy,
    approvedAt: po.approvedAt ? po.approvedAt.toISOString() : null,
    orderedAt: po.orderedAt ? po.orderedAt.toISOString() : null,
    createdAt: po.createdAt.toISOString(),
    lines: po.lines.map((l) => ({
      id: l.id,
      sku: l.product.sku,
      name: l.product.name,
      unit: l.product.unit,
      qty: l.qty,
      unitPriceCny: Number(l.unitPriceCny),
      unitPriceThb: l.unitPriceThb != null ? Number(l.unitPriceThb) : null,
      photoR2Key: l.photoR2Key,
      lengthCm: l.lengthCm != null ? Number(l.lengthCm) : null,
      widthCm: l.widthCm != null ? Number(l.widthCm) : null,
      heightCm: l.heightCm != null ? Number(l.heightCm) : null,
      cbmPerUnit: l.cbmPerUnit != null ? Number(l.cbmPerUnit) : null,
      note: l.note,
    })),
  };

  // ฐาน URL ของ R2 (อ่านฝั่ง server) — เอาไว้ประกอบ key → ลิงก์รูปจริง
  const r2Public = process.env.R2_PUBLIC_URL ?? "";

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <Link
            href="/dc/office/purchasing"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "#71717a",
              marginBottom: 4,
            }}
          >
            <ArrowLeft size={15} /> กลับรายการใบสั่งซื้อ
          </Link>
          <div className="dc-h1">ใบสั่งซื้อ {po.poCode}</div>
          <div className="dc-sub">รายละเอียดใบสั่งซื้อจีน · อนุมัติ → สั่ง</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <PoDetail data={data} canManage={canDcManage(ctx.session.user.role)} r2PublicUrl={r2Public} />
    </div>
  );
}
