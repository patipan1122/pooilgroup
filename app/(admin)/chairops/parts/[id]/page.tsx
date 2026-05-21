// Spare part detail · movement history · adjust stock form
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/chairops/ui/card";
import { Badge } from "@/components/chairops/ui/badge";
import { baht, thaiDateTime } from "@/lib/chairops/utils/format";
import { PartEditForm } from "./part-edit-form";
import { AdjustStockForm } from "./adjust-stock-form";

export default async function PartDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("OFFICE");
  const { id } = await params;

  const part = await prisma.chairopsSparePart.findUnique({
    where: { id },
  });
  if (!part) notFound();

  const movements = await prisma.chairopsSparePartMovement.findMany({
    where: { partId: part.id },
    orderBy: { at: "desc" },
    take: 100,
  });

  // hydrate user displays for movements
  const userIds = Array.from(new Set(movements.map((m) => m.byUserId)));
  const users = await prisma.chairopsUser.findMany({
    where: { id: { in: userIds } },
    select: { id: true, displayName: true },
  });
  const userById = new Map(users.map((u) => [u.id, u.displayName]));

  const low = part.stockOnHand <= part.reorderLevel;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/chairops/parts" className="text-sm text-muted-foreground hover:underline">
          ← กลับรายการอะไหล่
        </Link>
        <h1 className="font-mono text-2xl font-bold tracking-tight">
          {part.partCode}
          {low && (
            <Badge variant="danger" className="ml-3 align-middle">
              สต็อกต่ำ
            </Badge>
          )}
        </h1>
        <p className="text-sm text-muted-foreground">{part.name}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">คงเหลือ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {part.stockOnHand.toLocaleString("en-US")}
              <span className="ml-1 text-base font-normal text-muted-foreground">
                {part.unit}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              จุดสั่งซื้อ {part.reorderLevel.toLocaleString("en-US")} {part.unit}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ราคา/หน่วย</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {part.unitPrice != null ? baht(part.unitPrice) : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">มูลค่ารวม</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {part.unitPrice != null
                ? baht(part.unitPrice * part.stockOnHand)
                : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">แก้ไขข้อมูล</CardTitle>
          </CardHeader>
          <CardContent>
            <PartEditForm
              id={part.id}
              name={part.name}
              category={part.category}
              unit={part.unit}
              unitPrice={part.unitPrice}
              reorderLevel={part.reorderLevel}
              notes={part.notes}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ปรับสต็อก</CardTitle>
          </CardHeader>
          <CardContent>
            <AdjustStockForm partId={part.id} currentStock={part.stockOnHand} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ประวัติการเคลื่อนไหว ({movements.length})</CardTitle>
        </CardHeader>
        <CardContent>
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
                            href={`/damage/${m.reason.replace("used-in-damage-", "")}`}
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
        </CardContent>
      </Card>
    </div>
  );
}
