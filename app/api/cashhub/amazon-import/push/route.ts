// POST /api/cashhub/amazon-import/push
// สร้าง IV 1 วัน เข้า TRCloud (ทีละใบ — กัน 429). มี human-confirm จากฝั่ง UI (กดเลือกวันแล้วยืนยัน).
// dedup-guard + checksum guard อยู่ใน createAmazonIv. body = { storeCode, day: AmazonDayRow }
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { audit } from "@/lib/audit/log";
import { branchByStoreCode, createAmazonIv } from "@/lib/cashhub/amazon-trcloud";
import type { AmazonDayRow } from "@/lib/cashhub/amazon-parse";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;

  let body: { storeCode?: string; day?: AmazonDayRow };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  const cfg = branchByStoreCode(body.storeCode ?? null);
  if (!cfg) return NextResponse.json({ error: "ไม่รู้จักสาขานี้" }, { status: 400 });
  const day = body.day;
  if (!day || !day.date)
    return NextResponse.json({ error: "ไม่มีข้อมูลวัน" }, { status: 400 });

  const result = await createAmazonIv(cfg, day);

  if (result.ok) {
    await audit({
      orgId: session.user.org_id,
      userId: session.user.id,
      action: result.duplicate ? "SKIP_AMAZON_IV_DUPLICATE" : "CREATE_AMAZON_IV",
      resourceType: "cashhub_amazon_iv",
      resourceId: `${cfg.storeCode}:${day.date}`,
      diff: {
        new: {
          branch: cfg.label,
          date: day.date,
          gross: day.gross,
          ivNo: result.ivNo,
          duplicate: result.duplicate ?? false,
        },
      },
    });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
