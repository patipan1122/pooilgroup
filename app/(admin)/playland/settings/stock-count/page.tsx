// Playland · นับสต๊อก ย้ายไปรวมที่ "สต๊อก·คลังสินค้า" แล้ว → redirect (ลิงก์เก่ายังใช้ได้)
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LegacyStockCountRedirect({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  redirect(sp.branch ? `/playland/stock/count?branch=${sp.branch}` : "/playland/stock/count");
}
