// POST /api/cashhub/amazon-import/push
// สร้าง IV 1 วัน เข้า TRCloud (ทีละใบ — กัน 429). มี human-confirm จากฝั่ง UI (กดเลือกวันแล้วยืนยัน).
// dedup-guard + checksum guard อยู่ใน createAmazonIv. body = { storeCode, day: AmazonDayRow }
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { branchByStoreCode, createAmazonIv } from "@/lib/cashhub/amazon-trcloud";
import { markIvPosted } from "@/lib/cashhub/amazon-data";
import type { AmazonDayRow } from "@/lib/cashhub/amazon-parse";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;
  // ส่งใบกำกับเข้า TRCloud = ลงบัญชี+ภาษีจริง → เฉพาะ super_admin (ตาม super_admin-only connection gating D-022)
  if (!isSuperAdmin(session.user.role))
    return NextResponse.json(
      { error: "เฉพาะ super_admin เท่านั้นที่ส่งใบกำกับเข้า TRCloud ได้" },
      { status: 403 },
    );

  let body: { storeCode?: string; day?: AmazonDayRow; force?: boolean; confirm?: string };
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

  // ⚠️ force = ส่งซ้ำ (ข้าม dedup → ได้ใบกำกับซ้ำจริง) — ต้องพิมพ์ยืนยันตรงเป๊ะ (กันพลาด)
  const force = body.force === true;
  if (force && body.confirm !== "ยืนยัน")
    return NextResponse.json(
      { error: "การส่งซ้ำต้องพิมพ์คำว่า “ยืนยัน” ให้ถูกต้องก่อน" },
      { status: 400 },
    );

  const result = await createAmazonIv(cfg, day, { force });

  if (result.ok) {
    // force = ใบทดสอบซ้ำ → ไม่อัปเดต DB (ไม่ให้ทับสถานะใบจริงเดิม) · ปกติ → markIvPosted
    if (!force) {
      await markIvPosted(
        adminClient(),
        session.user.org_id,
        cfg.storeCode,
        day.date,
        result.ivNo,
        result.ivId,
        day.gross,
      );
    }
    await audit({
      orgId: session.user.org_id,
      userId: session.user.id,
      action: force
        ? "FORCE_CREATE_AMAZON_IV"
        : result.duplicate
          ? "SKIP_AMAZON_IV_DUPLICATE"
          : "CREATE_AMAZON_IV",
      resourceType: "cashhub_amazon_iv",
      resourceId: `${cfg.storeCode}:${day.date}`,
      diff: {
        new: {
          branch: cfg.label,
          date: day.date,
          gross: day.gross,
          ivNo: result.ivNo,
          duplicate: result.duplicate ?? false,
          force,
        },
      },
    });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
