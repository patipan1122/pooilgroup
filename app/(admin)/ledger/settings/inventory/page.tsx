// Ledger · ตั้งค่า › คลังสินค้า/SKU (สินค้าซื้อมาขาย) — LEDGER_STOCKIN_V1.
// ดึง SKU จาก TRCloud มาแสดง · ติ๊กว่าตัวไหนเก็บสต๊อก + ตั้งจำนวนต่อแพ็ค · ดูการจับคู่ชื่อ→SKU.
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { LedgerHeader, NoCompanyState } from "../../_components/LedgerHeader";
import { SettingsBack } from "../_components/SettingsBack";
import { prisma } from "@/lib/prisma";
import { ledgerStockinV1 } from "@/lib/ledger/flags";
import { InventoryManager } from "../_components/InventoryManager";

export const dynamic = "force-dynamic";

export default async function InventorySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string }>;
}) {
  if (!ledgerStockinV1()) notFound();
  const session = await requireRole("super_admin", "org_admin", "admin");
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <SettingsBack companyId={null} />
        <LedgerHeader title="คลังสินค้า / SKU" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const [skus, aliases] = await Promise.all([
    prisma.ledgerTrcloudSku.findMany({
      where: { orgId: scope.orgId, companyId: scope.companyId },
      orderBy: [{ businessGroup: "asc" }, { productId: "asc" }],
      take: 1000,
      select: {
        id: true, productId: true, productName: true, businessGroup: true, unit: true,
        packFactor: true, stockTracked: true, status: true, balanceCached: true, syncedAt: true,
      },
    }),
    prisma.ledgerSkuAlias.findMany({
      where: { orgId: scope.orgId, companyId: scope.companyId },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { id: true, aliasKey: true, skuId: true, source: true },
    }),
  ]);

  return (
    <div className="p-4 pb-24 sm:p-6 lg:pb-6">
      <SettingsBack companyId={scope.companyId} />
      <LedgerHeader
        title="คลังสินค้า / SKU"
        subtitle="สินค้าซื้อมาขาย — ดึงจาก TRCloud · ติ๊กที่เก็บสต๊อก · จับคู่ชื่อบนใบเสร็จ"
        scope={scope}
      />
      <InventoryManager
        companyId={scope.companyId}
        skus={skus.map((s) => ({
          id: s.id,
          productId: s.productId,
          productName: s.productName,
          businessGroup: s.businessGroup,
          unit: s.unit,
          packFactor: Number(s.packFactor),
          stockTracked: s.stockTracked,
          status: s.status,
          balance: s.balanceCached == null ? null : Number(s.balanceCached),
          syncedAt: s.syncedAt ? s.syncedAt.toISOString() : null,
        }))}
        aliases={aliases.map((a) => ({ id: a.id, aliasKey: a.aliasKey, skuId: a.skuId, source: a.source }))}
      />
    </div>
  );
}
