// CafeOrder · storefront ลูกค้า (PUBLIC web · web-first pivot 2026-07-25)
//   /order/<shopSlug> — ลิงก์ร้านค้าแยกต่อสาขา · ไม่ใช่ LIFF · ไม่ผ่านด่าน (admin).
//   Wave 1 = โครง read-only แสดงเมนูของร้าน · สั่ง/จ่าย/แต้ม มาเวฟถัดไป.
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import "@/components/cafeorder/tokens.css";

export const dynamic = "force-dynamic";

function baht(cents: number): string {
  return (cents / 100).toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const shop = await prisma.cafeShop.findUnique({ where: { shopSlug } });
  if (!shop || !shop.isOpen) notFound();

  const items = await prisma.cafeMenuItem.findMany({
    where: {
      orgId: shop.orgId,
      brand: shop.brand,
      isActive: true,
      branchItems: { some: { shopId: shop.id, isAvailable: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      category: { select: { name: true, sortOrder: true } },
      variants: { where: { isActive: true }, orderBy: { priceCents: "asc" } },
    },
  });

  // group by category
  const groups = new Map<string, { name: string; sortOrder: number; items: typeof items }>();
  for (const it of items) {
    const key = it.categoryId;
    if (!groups.has(key)) groups.set(key, { name: it.category.name, sortOrder: it.category.sortOrder, items: [] });
    groups.get(key)!.items.push(it);
  }
  const cats = Array.from(groups.values()).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="cafe-scope min-h-screen bg-zinc-50" data-brand={shop.brand}>
      {/* header */}
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white px-4 py-3" style={{ borderTopColor: "var(--cafe-accent)", borderTopWidth: 3 }}>
        <div className="mx-auto max-w-lg">
          <h1 className="text-lg font-extrabold text-zinc-900">{shop.displayName}</h1>
          <p className="text-xs text-zinc-500">
            {shop.brand === "punthai" ? "ร้านกาแฟพันธุ์ไทย" : "Café Amazon"}
            {shop.acceptingOrders ? " · เปิดรับออเดอร์" : " · ปิดรับชั่วคราว"}
            {shop.etaMinutes ? ` · ~${shop.etaMinutes} นาที` : ""}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-lg p-4">
        {cats.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500">
            ยังไม่มีเมนูเปิดขายในร้านนี้
          </div>
        ) : (
          <div className="space-y-6">
            {cats.map((cat) => (
              <section key={cat.name}>
                <h2 className="mb-2 text-sm font-bold text-zinc-500">{cat.name}</h2>
                <div className="grid grid-cols-2 gap-3">
                  {cat.items.map((it) => (
                    <div key={it.id} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
                      <div className="flex aspect-square items-center justify-center bg-zinc-100 text-3xl text-zinc-300">
                        {it.imageKey ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.imageKey} alt="" className="h-full w-full object-cover" />
                        ) : (
                          "☕"
                        )}
                      </div>
                      <div className="p-2.5">
                        <div className="truncate text-sm font-semibold text-zinc-900">{it.name}</div>
                        <div className="mt-0.5 text-sm font-bold" style={{ color: "var(--cafe-accent)" }}>
                          {it.variants.length ? `฿${baht(it.variants[0].priceCents)}` : "-"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        <p className="mt-8 rounded-xl bg-white px-4 py-3 text-center text-xs text-zinc-400">
          กำลังพัฒนา — ปุ่มสั่ง · เลือกตัวเลือก · จ่ายเงิน · สะสมแต้ม มาเร็ว ๆ นี้
        </p>
      </main>
    </div>
  );
}
