// DC · หลังบ้าน · รายการใบโอน (Transfer list)
//   • สถานะ · ต้นทาง → ปลายทาง · วันที่ส่ง · จำนวนบรรทัด
//   • เน้นแถบ "กำลังส่ง" (IN_TRANSIT) ที่รอปลายทางยืนยันรับ
import { Truck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { DcTransferDestType, DcTransferStatus } from "@/lib/generated/prisma/enums";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { DcDocsSubnav } from "@/components/dc/docs-subnav";
import { EmptyState } from "@/components/ui/empty-state";
import { TransfersOfficeRows, type OfficeTransferRow } from "./transfers-office-rows";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default async function DcTransfersPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const transfers = await prisma.dcTransfer.findMany({
    where: { orgId },
    orderBy: { dispatchedAt: "desc" },
    select: {
      id: true,
      transferCode: true,
      status: true,
      destType: true,
      fromWarehouseId: true,
      toWarehouseId: true,
      toLabel: true,
      sameSite: true,
      dispatchedAt: true,
      _count: { select: { lines: true } },
      lines: {
        take: 1,
        select: { product: { select: { imageR2Path: true } } },
      },
    },
  });

  // resolve รูปสินค้าแรกของแต่ละใบเป็น URL เต็มฝั่ง server (client อ่าน env ไม่ได้)
  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  const toImageUrl = (key: string | null | undefined): string | null =>
    !key ? null : /^https?:\/\//.test(key) ? key : r2Public ? `${r2Public}/${key}` : null;
  const firstImageOf = (t: (typeof transfers)[number]): string | null =>
    toImageUrl(t.lines[0]?.product?.imageR2Path);

  // join ชื่อคลัง (ต้นทาง + ปลายทางที่เป็น warehouse)
  const whIds = new Set<string>();
  for (const t of transfers) {
    whIds.add(t.fromWarehouseId);
    if (t.toWarehouseId) whIds.add(t.toWarehouseId);
  }
  const warehouses = whIds.size
    ? await prisma.dcWarehouse.findMany({
        where: { id: { in: [...whIds] }, orgId },
        select: { id: true, name: true },
      })
    : [];
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));

  const destLabel = (t: (typeof transfers)[number]): string => {
    if (t.destType === DcTransferDestType.WAREHOUSE && t.toWarehouseId) {
      return whName.get(t.toWarehouseId) ?? "คลังปลายทาง";
    }
    return t.toLabel ?? "สาขา/โมดูล";
  };

  const inTransitCount = transfers.filter((t) => t.status === DcTransferStatus.IN_TRANSIT).length;
  const canDelete = isSuperAdmin(ctx.session.user.role); // ลบใบโอน = super_admin เท่านั้น
  const chrome = await getDcOfficeChrome(orgId);

  // แถวหัวใบ (serializable) ส่งให้ client component เรนเดอร์แถวกางได้ (inline-expand + ปุ่มพิมพ์)
  const rows: OfficeTransferRow[] = transfers.map((t) => ({
    id: t.id,
    transferCode: t.transferCode,
    status: t.status,
    fromName: whName.get(t.fromWarehouseId) ?? "คลังต้นทาง",
    destName: destLabel(t),
    sameSite: t.sameSite,
    lineCount: t._count.lines,
    dispatchedAtLabel: fmtDate(t.dispatchedAt),
    firstImageUrl: firstImageOf(t),
    isInTransit: t.status === DcTransferStatus.IN_TRANSIT,
  }));

  return (
    <DcOfficeShell active="transfer" {...dcShellChrome(ctx, chrome)}>
      <div className="dc-page dc-page--wide" style={{ padding: 0, maxWidth: "none", margin: 0 }}>
        <DcDocsSubnav active="transfers" />
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em" }}>ใบโอน (ส่ง / รับระหว่างคลัง)</h1>
          <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>ส่งของออก 2 จังหวะ — ปลายทางกดยืนยันรับ · ต้นทุนตามของไป</p>
        </div>

      {inTransitCount > 0 && (
        <div
          style={{
            background: "#fff7ed",
            color: "#9a3412",
            border: "1px solid #fed7aa",
            borderRadius: 12,
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 700,
            marginBottom: 16,
          }}
        >
          มี {inTransitCount} ใบกำลังส่ง — รอปลายทางกดยืนยันรับ
        </div>
      )}

      {transfers.length === 0 ? (
        <EmptyState
          icon={<Truck size={26} />}
          title="ยังไม่มีใบโอน"
          description="ส่งของจากหน้าคลัง (ส่ง / โอน) — เลือกปลายทาง สแกนสินค้า แล้วส่งออก จะมาโผล่ที่นี่"
        />
      ) : (
        <TransfersOfficeRows rows={rows} canDelete={canDelete} />
      )}
      </div>
    </DcOfficeShell>
  );
}
