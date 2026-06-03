import { requireUser } from "@/lib/fuelos/auth";
import { fetchPumpPrices } from "@/lib/fuelos/pump-price";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { Fuel, ExternalLink, Info } from "lucide-react";

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
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-xs text-zinc-500 flex items-start gap-2">
            <Info className="size-4 shrink-0 mt-0.5 text-info" />
            <span>
              ดึงจาก API ของ PTTOR ยังไม่สมบูรณ์ ({result.error}) — แสดงกระดานราคาทางการของ OR แทนชั่วคราว ·
              เมื่อ CEO แจ้งค่า/สิทธิ์ของ API ระบบจะดึงเป็นการ์ดราคาให้อัตโนมัติ
            </span>
          </div>
          {/* กระดานราคาทางการ OR (embed) — เห็นข้อมูลได้ทันที */}
          <div className="rounded-2xl border border-border overflow-hidden bg-white">
            <iframe
              title="ราคาน้ำมัน PTT Station"
              src="https://orweb-dev.rts2003.co.th/oil_price_board?lang=th"
              className="w-full"
              style={{ height: 460, border: 0 }}
            />
          </div>
          <a href="https://www.pttor.com/th/oil_price" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline">
            ดูราคาเต็มที่เว็บ OR <ExternalLink className="size-3.5" />
          </a>
        </div>
      )}
    </div>
  );
}
