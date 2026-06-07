// Ledger · ตั้งค่า › คลังสินค้า/SKU (สินค้าซื้อมาขาย) — LEDGER_STOCKIN_V1.
// หน้า "สอนระบบ" แบบเลือกสาขาก่อน: ดึง SKU จาก TRCloud → ใส่เข้าสาขา → ตั้งหน่วย →
// สอนชื่อบนใบเสร็จ. มี "ดูทั้งหมด" (ทุกสาขา) แบบเดิมไว้ในส่วนพับ.
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { LedgerHeader, NoCompanyState } from "../../_components/LedgerHeader";
import { SettingsBack } from "../_components/SettingsBack";
import { prisma } from "@/lib/prisma";
import { ledgerStockinV1 } from "@/lib/ledger/flags";
import { parsePackUnits } from "@/lib/ledger/sku-match";
import { SyncSkusCard } from "../_components/SyncSkusCard";
import { BranchInventoryManager } from "../_components/BranchInventoryManager";
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

  const [skuRows, aliasRows, branchLinks] = await Promise.all([
    prisma.ledgerTrcloudSku.findMany({
      where: { orgId: scope.orgId, companyId: scope.companyId },
      orderBy: [{ businessGroup: "asc" }, { productId: "asc" }],
      take: 2000,
      select: {
        id: true, productId: true, productName: true, businessGroup: true, unit: true,
        packFactor: true, packUnits: true, stockTracked: true, status: true, balanceCached: true, syncedAt: true,
      },
    }),
    prisma.ledgerSkuAlias.findMany({
      where: { orgId: scope.orgId, companyId: scope.companyId },
      orderBy: { createdAt: "desc" },
      take: 4000,
      select: { id: true, aliasKey: true, skuId: true, source: true },
    }),
    prisma.ledgerSkuBranch.findMany({
      where: { orgId: scope.orgId, companyId: scope.companyId },
      select: { skuId: true, branchId: true },
    }),
  ]);

  const branchIdsBySku = new Map<string, string[]>();
  for (const l of branchLinks) {
    const arr = branchIdsBySku.get(l.skuId) ?? [];
    arr.push(l.branchId);
    branchIdsBySku.set(l.skuId, arr);
  }

  const branchSkus = skuRows.map((s) => ({
    id: s.id,
    productId: s.productId,
    productName: s.productName,
    businessGroup: s.businessGroup,
    unit: s.unit,
    status: s.status,
    stockTracked: s.stockTracked,
    packUnits: parsePackUnits(s.packUnits),
    balance: s.balanceCached == null ? null : Number(s.balanceCached),
    branchIds: branchIdsBySku.get(s.id) ?? [],
  }));

  const flatSkus = skuRows.map((s) => ({
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
  }));

  const aliases = aliasRows.map((a) => ({ id: a.id, aliasKey: a.aliasKey, skuId: a.skuId, source: a.source }));

  return (
    <div className="p-4 pb-24 sm:p-6 lg:pb-6">
      <SettingsBack companyId={scope.companyId} />
      <LedgerHeader
        title="คลังสินค้า / SKU"
        subtitle="สินค้าซื้อมาขาย — เลือกสาขา → ใส่สินค้า → ตั้งหน่วย → สอนชื่อบนใบเสร็จ"
        scope={scope}
      />

      <div className="mx-auto max-w-3xl space-y-4">
        <SyncSkusCard companyId={scope.companyId} skuCount={skuRows.length} />
        <BranchInventoryManager
          companyId={scope.companyId}
          branches={scope.branches.map((b) => ({ id: b.id, name: b.name, code: b.code, businessType: b.businessType }))}
          skus={branchSkus}
          aliases={aliases}
        />

        <details className="rounded-2xl border border-zinc-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-700">
            ดูสินค้าทั้งหมด (ทุกสาขา)
          </summary>
          <div className="border-t border-zinc-100 p-3">
            <InventoryManager companyId={scope.companyId} skus={flatSkus} aliases={aliases} showSync={false} />
          </div>
        </details>
      </div>
    </div>
  );
}
