import { requireUser } from "@/lib/fuelos/auth";
import { fetchPumpPrices } from "@/lib/fuelos/pump-price";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { Fuel, ExternalLink } from "lucide-react";

export const revalidate = 1800; // อัปเดตทุก 30 นาที

// หน้าราคาหน้าปั๊ม (อ้างอิง) — ดึงราคาขายปลีกจริงรายวัน (thai-oil-api · ไม่ต้อง auth)
export default async function PumpPricePage() {
  await requireUser();
  const result = await fetchPumpPrices();

  return (
    <div>
      <PageHeader title="ราคาหน้าปั๊ม (อ้างอิง)" subtitle="ราคาขายปลีกหน้าปั๊ม — ใช้ประกอบการตั้งราคาขายส่ง" />

      {result.ok ? (
        <div className="space-y-5">
          <div className="text-xs text-zinc-500">
            ราคา ณ {result.date} · {result.note}
          </div>
          {result.stations.map((s) => (
            <div key={s.key}>
              <h2 className="font-bold mb-2 flex items-center gap-1.5">
                <Fuel className="size-4 text-brand-600" /> {s.label}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {s.products.map((p) => (
                  <div key={p.name} className="rounded-xl border border-border bg-surface px-3 py-2.5">
                    <div className="text-[11px] text-zinc-500 truncate" title={p.name}>{p.name}</div>
                    <div className="text-xl font-bold tabular-nums mt-0.5 font-[family-name:var(--font-plex-mono)]">{p.price}</div>
                    <div className="text-[10px] text-zinc-400">฿/ลิตร</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-zinc-400">
            ข้อมูลจาก thai-oil-api (อัปเดตรายวัน · ราคาขายปลีก กทม. และปริมณฑล) · ใช้อ้างอิงเทียบราคาขายส่งของเราเท่านั้น
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <Fuel className="size-10 mx-auto text-zinc-300" />
          <p className="mt-3 font-semibold">ดึงราคาหน้าปั๊มไม่ได้ชั่วคราว</p>
          <p className="text-sm text-zinc-500 mt-1.5 max-w-md mx-auto">
            แหล่งข้อมูลราคาตอบไม่สำเร็จ ({result.error}) · ลองรีเฟรชอีกครั้ง หรือดูที่เว็บ OR โดยตรง
          </p>
          <a
            href="https://www.pttor.com/th/oil_price"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-brand-600 text-white text-sm font-medium"
          >
            เปิดราคาหน้าปั๊ม OR (แท็บใหม่) <ExternalLink className="size-4" />
          </a>
        </div>
      )}
    </div>
  );
}
