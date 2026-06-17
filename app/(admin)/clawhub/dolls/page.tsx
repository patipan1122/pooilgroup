// ClawHub (JOLLY PLAY) — rewards catalog (ตุ๊กตา). Table + create/edit modal.
// ClawhubReward is the source of truth for redemption pricing; CfProduct (PLUSH)
// can be picked to prefill name/sku/image.

import { prisma } from "@/lib/prisma";
import { clawhubOrgId } from "@/lib/clawhub/org";
import { PageHeader, EmptyState } from "../_components/ui";
import { fmtNum } from "../_lib";
import {
  RewardEditorButton,
  type RewardFormValue,
  type CfProductOption,
} from "./_reward-editor";
import { BulkRewardUploaderButton } from "./_bulk-reward-uploader";
import { ActiveToggle } from "./_active-toggle";

export const dynamic = "force-dynamic";

export default async function ClawhubDollsPage() {
  const orgId = await clawhubOrgId();

  const [rewards, cfProductsRaw] = await Promise.all([
    prisma.clawhubReward.findMany({
      where: { orgId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    // Read-only PLUSH products from ClawFleet (public schema) to prefill rewards.
    prisma.cfProduct
      .findMany({
        where: { orgId, category: "PLUSH", isActive: true },
        orderBy: { name: "asc" },
        take: 200,
        select: { id: true, sku: true, name: true, imageUrl: true },
      })
      .catch(() => []),
  ]);

  const cfProducts: CfProductOption[] = cfProductsRaw.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    imageUrl: p.imageUrl,
  }));

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="ตุ๊กตา"
        accent="รางวัล"
        subtitle="ของที่ลูกค้าแลกด้วยแต้ม · เว้นสต็อกว่าง = ไม่จำกัด"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <BulkRewardUploaderButton label="เพิ่มหลายตัว" />
            <RewardEditorButton cfProducts={cfProducts} label="+ เพิ่มตุ๊กตา" />
          </div>
        }
      />

      {rewards.length === 0 ? (
        <EmptyState>ยังไม่มีตุ๊กตาในแคตตาล็อก — กด “เพิ่มตุ๊กตา”</EmptyState>
      ) : (
        <div className="cw-card overflow-x-auto">
          <table className="cw-table w-full text-sm">
            <thead>
              <tr style={{ color: "var(--cw-text-2)" }}>
                <th className="px-3 py-2.5 text-left text-xs font-semibold">รูป</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold">ชื่อ</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold">ราคาแต้ม</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold">สต็อก</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold">สถานะ</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {rewards.map((r) => {
                const initial: RewardFormValue = {
                  id: r.id,
                  name: r.name,
                  imageUrl: r.imageUrl ?? "",
                  pointsPrice: r.pointsPrice,
                  stock: r.stock,
                  isActive: r.isActive,
                  sortOrder: r.sortOrder,
                  sku: r.sku ?? "",
                  productId: r.productId ?? "",
                };
                return (
                  <tr key={r.id} className="border-t" style={{ borderColor: "var(--cw-border)" }}>
                    <td className="px-3 py-2.5">
                      {r.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.imageUrl}
                          alt={r.name}
                          className="h-12 w-12 rounded-lg border object-cover"
                          style={{ borderColor: "var(--cw-border)" }}
                        />
                      ) : (
                        <div
                          className="flex h-12 w-12 items-center justify-center rounded-lg border text-[10px]"
                          style={{ borderColor: "var(--cw-border)", color: "var(--cw-text-3)" }}
                        >
                          ไม่มีรูป
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-semibold">
                      {r.name}
                      {r.sku ? (
                        <span className="ml-1 text-xs" style={{ color: "var(--cw-text-3)" }}>
                          ({r.sku})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="cw-tnum font-bold">{fmtNum(r.pointsPrice)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="cw-tnum">{r.stock == null ? "∞" : fmtNum(r.stock)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <ActiveToggle id={r.id} active={r.isActive} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <RewardEditorButton initial={initial} cfProducts={cfProducts} label="แก้ไข" ghost />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
