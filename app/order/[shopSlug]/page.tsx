// CafeOrder · storefront ลูกค้า (PUBLIC web · web-first pivot 2026-07-25)
//   /order/<shopSlug> — ลิงก์ร้านค้าแยกต่อสาขา · ไม่ใช่ LIFF · ไม่ผ่านด่าน (admin).
//   Wave 1 = โครง read-only (แต่งดีไซน์พรีเมียมแล้ว) · สั่ง/จ่าย/แต้ม มาเวฟถัดไป.
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import "@/components/cafeorder/tokens.css";

export const dynamic = "force-dynamic";

const baht = (c: number) => (c / 100).toLocaleString("th-TH", { maximumFractionDigits: 0 });

// glyph ตามหมวด (placeholder เมื่อไม่มีรูป — ให้ดูมีชีวิตกว่าอิโมจิลอย)
function glyph(cat: string): string {
  const s = cat.toLowerCase();
  if (s.includes("ชา") || s.includes("มัทฉะ") || s.includes("tea")) return "🍵";
  if (s.includes("ปั่น") || s.includes("สมูท") || s.includes("โซดา") || s.includes("น้ำ")) return "🧊";
  if (s.includes("นม") || s.includes("ช็อก")) return "🥛";
  if (s.includes("เบเกอ") || s.includes("ขนม") || s.includes("food")) return "🥐";
  return "☕";
}

export default async function StorefrontPage({ params }: { params: Promise<{ shopSlug: string }> }) {
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

  const groups = new Map<string, { name: string; sortOrder: number; items: typeof items }>();
  for (const it of items) {
    if (!groups.has(it.categoryId)) groups.set(it.categoryId, { name: it.category.name, sortOrder: it.category.sortOrder, items: [] });
    groups.get(it.categoryId)!.items.push(it);
  }
  const cats = Array.from(groups.entries())
    .map(([id, g]) => ({ id, ...g }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const brandName = shop.brand === "punthai" ? "ร้านกาแฟพันธุ์ไทย" : "Café Amazon";

  return (
    <div className="cafe-scope min-h-screen bg-[#faf7f2]" data-brand={shop.brand}>
      <div className="mx-auto max-w-md pb-16">
        {/* ── hero ── */}
        <header
          className="relative overflow-hidden rounded-b-[32px] px-5 pb-6 pt-8 text-white"
          style={{ background: "linear-gradient(150deg, var(--cafe-accent), color-mix(in srgb, var(--cafe-accent) 68%, #000))" }}
        >
          <div aria-hidden className="pointer-events-none absolute -right-6 -top-8 text-[150px] leading-none opacity-15 select-none">
            ☕
          </div>
          <div className="relative">
            <div className="text-xs font-semibold uppercase tracking-widest opacity-80">{brandName}</div>
            <h1 className="mt-1 text-[26px] font-extrabold leading-tight">{shop.displayName}</h1>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${shop.acceptingOrders ? "bg-white/25" : "bg-black/30"}`}>
                <span className={`size-1.5 rounded-full ${shop.acceptingOrders ? "bg-emerald-300" : "bg-rose-300"}`} />
                {shop.acceptingOrders ? "เปิดรับออเดอร์" : "ปิดรับชั่วคราว"}
              </span>
              {shop.etaMinutes ? <span className="rounded-full bg-white/20 px-2.5 py-1">🛵 ~{shop.etaMinutes} นาที</span> : null}
              {shop.minOrderCents ? <span className="rounded-full bg-white/20 px-2.5 py-1">ขั้นต่ำ ฿{baht(shop.minOrderCents)}</span> : null}
            </div>
          </div>
        </header>

        {/* ── category chips (sticky) ── */}
        {cats.length > 0 && (
          <nav className="sticky top-0 z-10 -mt-3 overflow-x-auto bg-[#faf7f2]/90 px-4 py-3 backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex gap-2">
              {cats.map((c) => (
                <a
                  key={c.id}
                  href={`#cat-${c.id}`}
                  className="whitespace-nowrap rounded-full border border-black/5 bg-white px-3.5 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm"
                >
                  {c.name}
                </a>
              ))}
            </div>
          </nav>
        )}

        {/* ── menu ── */}
        <main className="px-4 pt-2">
          {cats.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
              ยังไม่มีเมนูเปิดขายในร้านนี้
            </div>
          ) : (
            <div className="space-y-7">
              {cats.map((cat) => (
                <section key={cat.id} id={`cat-${cat.id}`} className="scroll-mt-16">
                  <h2 className="mb-3 flex items-baseline gap-2">
                    <span className="text-base font-extrabold text-zinc-900">{cat.name}</span>
                    <span className="text-xs font-medium text-zinc-400">{cat.items.length} เมนู</span>
                  </h2>
                  <div className="grid grid-cols-2 gap-3.5">
                    {cat.items.map((it) => {
                      const price = it.variants[0]?.priceCents;
                      return (
                        <article key={it.id} className="group overflow-hidden rounded-3xl bg-white shadow-[0_2px_12px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.03]">
                          <div className="relative aspect-[5/4] overflow-hidden">
                            {it.imageKey ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={it.imageKey} alt="" className="h-full w-full object-cover transition duration-300 group-active:scale-[1.03]" />
                            ) : (
                              <div
                                className="flex h-full w-full items-center justify-center text-5xl"
                                style={{ background: "linear-gradient(160deg, var(--cafe-accent-weak), #fff)" }}
                              >
                                <span className="opacity-60">{glyph(cat.name)}</span>
                              </div>
                            )}
                            <button
                              type="button"
                              aria-label="เพิ่ม (เร็ว ๆ นี้)"
                              className="absolute bottom-2 right-2 grid size-8 place-items-center rounded-full text-lg font-bold text-white shadow-md"
                              style={{ background: "var(--cafe-accent)" }}
                            >
                              +
                            </button>
                          </div>
                          <div className="p-3">
                            <div className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-tight text-zinc-900">{it.name}</div>
                            <div className="mt-1 text-[15px] font-extrabold tabular-nums" style={{ color: "var(--cafe-accent)" }}>
                              {price != null ? `฿${baht(price)}` : "—"}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}

          <p className="mt-10 rounded-2xl bg-white/70 px-4 py-3 text-center text-xs text-zinc-400 ring-1 ring-black/[0.03]">
            🚧 กำลังพัฒนา — ปุ่มสั่ง · เลือกหวาน/น้ำแข็ง · จ่ายเงิน · สะสมแต้ม กำลังจะมา
          </p>
        </main>
      </div>
    </div>
  );
}
