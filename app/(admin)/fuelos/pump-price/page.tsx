import { requireUser } from "@/lib/fuelos/auth";
import { fetchPumpPrices } from "@/lib/fuelos/pump-price";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { Fuel, ExternalLink } from "lucide-react";

export const revalidate = 1800; // อัปเดตทุก 30 นาที

// หน้าราคาหน้าปั๊ม (อ้างอิง) — ดึงจาก PTTOR. ถ้า SOAP ยังไม่พร้อม (รอ CEO ยืนยันค่า/auth)
// แสดง price board ทางการของ OR (iframe) แทน เพื่อให้เห็นข้อมูลประกอบได้ทันที.
export default async function PumpPricePage() {
  await requireUser();
  const result = await fetchPumpPrices("TH");

  return (
    <div>
      <PageHeader title="ราคาหน้าปั๊ม (อ้างอิง)" subtitle="ราคาขายปลีก PTT Station — ใช้ประกอบการตั้งราคาขายส่ง" />

      {result.ok ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {result.prices.map((p) => (
            <div key={p.product} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500"><Fuel className="size-3.5" /> {p.product}</div>
              <div className="text-2xl font-bold tabular-nums mt-1 font-[family-name:var(--font-plex-mono)]">{p.price}</div>
              <div className="text-[11px] text-zinc-400">฿/ลิตร</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <Fuel className="size-10 mx-auto text-zinc-300" />
          <p className="mt-3 font-semibold">ยังไม่ได้เชื่อมราคาหน้าปั๊ม</p>
          <p className="text-sm text-zinc-500 mt-1.5 max-w-md mx-auto">
            ระบบพร้อมดึงราคาจาก API ของ PTTOR แล้ว · รอ CEO แจ้งค่า/สิทธิ์ (auth) ของ API → จะแสดงเป็นการ์ดราคาให้อัตโนมัติ
            <span className="block text-[11px] text-zinc-400 mt-1">สถานะ API: {result.error}</span>
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
