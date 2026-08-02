/**
 * ตู้คีบ OS — ภาพรวมทุกสาขา (all-branches overview)
 * Server: การ์ด 1 ใบ/สาขา · แต่ละใบ = ตู้ทั้งหมด · เก็บวันนี้ · ขาด · เงิน · ปัญหา.
 * 2 โหมด (จาก ?mode=): date = ระบุวัน (default วันนี้) · latest = วันเก็บล่าสุดต่อสาขา.
 * ?date=YYYY-MM-DD (เฉพาะโหมด date) · error → ส่ง rows ว่าง (client โชว์ EmptyState · ไม่หน้าโล่ง).
 */
import { getBranchOverview, type BranchOverview } from "@/lib/clawfleet/overview-queries";
import { OverviewClient } from "./overview-client";

export const dynamic = "force-dynamic";

/** วันไทย (Asia/Bangkok) "YYYY-MM-DD" — default ฝั่ง server ให้ตรงปฏิทินไทย (ไม่ใช่ UTC) */
function bangkokISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d);
}
/** parse "YYYY-MM-DD" ให้ผ่านจริงเท่านั้น (ค่าขยะ → undefined → fallback วันนี้) */
function parseIsoDay(s?: string): string | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? undefined : s;
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; mode?: string }>;
}) {
  const sp = await searchParams;
  const mode: "date" | "latest" = sp.mode === "latest" ? "latest" : "date";
  const today = bangkokISO(0);
  const selected = parseIsoDay(sp.date) ?? today;
  // isoDay อ้างอิง: date = วันที่เลือก · latest = วันนี้ (ตัวเลขต่อสาขาเป็นวันล่าสุดของแต่ละสาขา)
  const isoDay = mode === "date" ? selected : today;

  let overview: BranchOverview = {
    mode,
    isoDay,
    rows: [],
    totals: { branches: 0, machines: 0, collected: 0, missing: 0, cashBaht: 0, problems: 0 },
  };
  try {
    overview = await getBranchOverview({ mode, isoDay });
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate/ไม่มีสิทธิ์ → client โชว์ EmptyState
  }

  return <OverviewClient data={overview} date={selected} mode={mode} />;
}
