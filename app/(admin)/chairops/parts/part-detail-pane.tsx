// Right-pane "detail" content for the parts split-view.
// Server Component · orgId-scoped queries (cross-org leak was P0 this session).
// Reuses the existing edit / adjust-stock client forms from the [id] route.
import { prisma } from "@/lib/prisma";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { baht, thaiDateTime } from "@/lib/chairops/utils/format";
import Link from "next/link";
import { PartEditForm } from "./[id]/part-edit-form";
import { AdjustStockForm } from "./[id]/adjust-stock-form";

export async function PartDetailPane({
  partId,
  orgId,
}: {
  partId: string;
  orgId: string;
}) {
  const part = await prisma.chairopsSparePart.findFirst({
    where: { id: partId, orgId },
  });

  if (!part) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">ไม่พบอะไหล่ที่เลือก</p>
        <Link
          href="/chairops/parts"
          className="text-sm text-primary hover:underline"
        >
          กลับรายการ
        </Link>
      </div>
    );
  }

  const movements = await prisma.chairopsSparePartMovement.findMany({
    where: { partId: part.id, orgId },
    orderBy: { at: "desc" },
    take: 100,
  });

  const userIds = Array.from(new Set(movements.map((m) => m.byUserId)));
  const users = await prisma.chairopsUser.findMany({
    where: { id: { in: userIds }, orgId },
    select: { id: true, displayName: true },
  });
  const userById = new Map(users.map((u) => [u.id, u.displayName]));

  const low = part.stockOnHand <= part.reorderLevel;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-mono text-xl font-bold tracking-tight">
          {part.partCode}
          {low && (
            <Badge tone="danger" className="ml-3 align-middle">
              สต็อกต่ำ
            </Badge>
          )}
        </h2>
        <p className="text-sm text-muted-foreground">{part.name}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">คงเหลือ</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="text-3xl font-bold">
              {part.stockOnHand.toLocaleString("en-US")}
              <span className="ml-1 text-base font-normal text-muted-foreground">
                {part.unit}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              จุดสั่งซื้อ {part.reorderLevel.toLocaleString("en-US")} {part.unit}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ราคา/หน่วย</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="text-3xl font-bold">
              {part.unitPrice != null ? baht(part.unitPrice) : "—"}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">มูลค่ารวม</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="text-3xl font-bold">
              {part.unitPrice != null
                ? baht(part.unitPrice * part.stockOnHand)
                : "—"}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">แก้ไขข้อมูล</CardTitle>
          </CardHeader>
          <CardBody>
            <PartEditForm
              id={part.id}
              name={part.name}
              category={part.category}
              unit={part.unit}
              unitPrice={part.unitPrice}
              reorderLevel={part.reorderLevel}
              notes={part.notes}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ปรับสต็อก</CardTitle>
          </CardHeader>
          <CardBody>
            <AdjustStockForm partId={part.id} currentStock={part.stockOnHand} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            ประวัติการเคลื่อนไหว ({movements.length})
          </CardTitle>
        </CardHeader>
        <CardBody>
          {movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีการเคลื่อนไหว</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 font-medium">เมื่อ</th>
                    <th className="py-2 text-right font-medium">การเปลี่ยน</th>
                    <th className="py-2 font-medium">เหตุผล</th>
                    <th className="py-2 font-medium">โดย</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id} className="border-t border-border">
                      <td className="py-2 text-xs text-muted-foreground">
                        {thaiDateTime(m.at)}
                      </td>
                      <td className="py-2 text-right">
                        <span
                          className={
                            m.delta > 0
                              ? "font-mono font-semibold text-success"
                              : "font-mono font-semibold text-danger"
                          }
                        >
                          {m.delta > 0 ? "+" : ""}
                          {m.delta}
                        </span>
                      </td>
                      <td className="py-2">
                        {m.reason.startsWith("used-in-damage-") ? (
                          <Link
                            href={`/damage/${m.reason.replace(
                              "used-in-damage-",
                              "",
                            )}`}
                            className="text-primary hover:underline"
                          >
                            {m.reason}
                          </Link>
                        ) : (
                          m.reason
                        )}
                      </td>
                      <td className="py-2 text-xs">
                        {userById.get(m.byUserId) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
