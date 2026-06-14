// POST /api/cashhub/hotel/iv-lines — ดึง line items ของ IV (แยก ค่าห้อง/ขนม/ทิป)
// 1 IV = 1 TRCloud call → throttle + cap 12/ครั้ง กัน rate-limit (~8-10). กดซ้ำเพื่อดึงเพิ่ม.
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { fetchIvLineSplit, type IvLineSplit } from "@/lib/cashhub/hotel-trcloud";

export const runtime = "nodejs";

const CAP = 15; // ต่อคำขอ (กัน serverless timeout) — client วนเรียกจนครบ
const DELAY_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;

  let body: { ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const ids = (body.ids ?? []).filter(Boolean).slice(0, CAP);
  if (ids.length === 0)
    return NextResponse.json({ error: "ไม่มี IV" }, { status: 400 });

  const splits: Record<string, IvLineSplit> = {};
  let stoppedRateLimit = false;
  for (let i = 0; i < ids.length; i++) {
    const { split, error } = await fetchIvLineSplit(ids[i]!);
    if (error) {
      if (/rate-limit/.test(error)) {
        stoppedRateLimit = true;
        break; // หยุดทันทีถ้าโดน limit — กดใหม่ทีหลัง
      }
      continue; // ใบเดียวพัง ข้ามไป
    }
    if (split) splits[ids[i]!] = split;
    if (i < ids.length - 1) await sleep(DELAY_MS);
  }

  return NextResponse.json({
    ok: true,
    splits,
    fetched: Object.keys(splits).length,
    rateLimited: stoppedRateLimit,
  });
}
