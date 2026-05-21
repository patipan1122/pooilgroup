// Spare parts list — OFFICE+ can manage
import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/chairops/ui/card";
import { Badge } from "@/components/chairops/ui/badge";
import { Button } from "@/components/chairops/ui/button";
import { baht } from "@/lib/chairops/utils/format";
import { Prisma } from "@/lib/generated/prisma/client";

export default async function PartsListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; low?: string }>;
}) {
  await requireRole("OFFICE");
  const sp = await searchParams;

  const w: Prisma.ChairopsSparePartWhereInput = {};
  if (sp.q) {
    w.OR = [
      { partCode: { contains: sp.q, mode: "insensitive" } },
      { name: { contains: sp.q, mode: "insensitive" } },
    ];
  }
  if (sp.category) w.category = sp.category;

  let parts = await prisma.chairopsSparePart.findMany({
    where: w,
    orderBy: [{ category: "asc" }, { name: "asc" }],
    take: 500,
  });

  if (sp.low === "1") {
    parts = parts.filter((p) => p.stockOnHand <= p.reorderLevel);
  }

  const categories = Array.from(
    new Set(parts.map((p) => p.category).filter((c): c is string => !!c))
  );

  const lowCount = parts.filter((p) => p.stockOnHand <= p.reorderLevel).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">อะไหล่</h1>
          <p className="text-sm text-muted-foreground">
            ทั้งหมด {parts.length} รายการ
            {lowCount > 0 && (
              <span className="ml-2 text-danger">
                · {lowCount} รายการสต็อกต่ำกว่าจุดสั่งซื้อ
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/chairops/parts/new">
            <Button>+ เพิ่มอะไหล่</Button>
          </Link>
        </div>
      </div>

      <Card>
        <div className="p-4">
          <form className="flex flex-wrap items-end gap-3 text-sm" method="GET">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-muted-foreground">ค้นหา</label>
              <input
                type="search"
                name="q"
                defaultValue={sp.q ?? ""}
                placeholder="รหัส / ชื่อ"
                className="h-9 w-full rounded-md border border-border bg-background px-2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">หมวด</label>
              <select
                name="category"
                defaultValue={sp.category ?? ""}
                className="h-9 rounded-md border border-border bg-background px-2"
              >
                <option value="">ทั้งหมด</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="low"
                value="1"
                defaultChecked={sp.low === "1"}
              />
              เฉพาะสต็อกต่ำ
            </label>
            <button
              type="submit"
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              ค้นหา
            </button>
            <Link
              href="/chairops/parts"
              className="h-9 rounded-md border border-border px-4 text-sm font-medium leading-9 hover:bg-muted"
            >
              ล้าง
            </Link>
          </form>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-14 z-10 bg-muted/50 sm:top-16">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">รหัส</th>
                <th className="px-3 py-2 font-medium">ชื่อ</th>
                <th className="px-3 py-2 font-medium">หมวด</th>
                <th className="px-3 py-2 text-right font-medium">คงเหลือ</th>
                <th className="px-3 py-2 text-right font-medium">จุดสั่งซื้อ</th>
                <th className="px-3 py-2 text-right font-medium">ราคา/หน่วย</th>
                <th className="px-3 py-2 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {parts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-muted-foreground">
                    ไม่มีอะไหล่
                  </td>
                </tr>
              ) : (
                parts.map((p) => {
                  const low = p.stockOnHand <= p.reorderLevel;
                  return (
                    <tr key={p.id} className="border-t border-border hover:bg-muted/50">
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link
                          href={`/chairops/parts/${p.id}`}
                          className="text-primary hover:underline"
                        >
                          {p.partCode}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{p.name}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {p.category ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {p.stockOnHand.toLocaleString("en-US")} {p.unit}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {p.reorderLevel.toLocaleString("en-US")}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.unitPrice != null ? baht(p.unitPrice) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {low ? (
                          <Badge variant="danger">ต่ำกว่าจุดสั่งซื้อ</Badge>
                        ) : (
                          <Badge variant="success">พอ</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
