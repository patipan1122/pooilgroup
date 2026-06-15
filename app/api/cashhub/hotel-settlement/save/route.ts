// POST /api/cashhub/hotel-settlement/save — บันทึก mapping ช่องทาง→บัญชี ของโรงแรม (super_admin)
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import {
  saveHotelChannelConfig,
  type HotelChannelConfig,
} from "@/lib/cashhub/hotel-settlement-data";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;
  if (!isSuperAdmin(session.user.role))
    return NextResponse.json({ error: "เฉพาะ super_admin ตั้งค่าได้" }, { status: 403 });

  let body: { configs?: HotelChannelConfig[]; branchCode?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  const configs = Array.isArray(body.configs) ? body.configs : [];
  if (configs.length === 0)
    return NextResponse.json({ error: "ไม่มีข้อมูลตั้งค่า" }, { status: 400 });
  const branchCode = typeof body.branchCode === "string" ? body.branchCode : "";

  // sanitize เบา ๆ
  for (const c of configs) {
    if (typeof c.channel !== "string")
      return NextResponse.json({ error: "ช่องทางไม่ถูกต้อง" }, { status: 400 });
    c.feePercent = Math.max(0, Math.min(100, Number(c.feePercent) || 0));
    // ถ้าเป็นเงินเข้าธนาคารต้องระบุบัญชี (กันส่งเข้า reconcile แบบไม่รู้บัญชี — กฎ "ไม่ชัวร์อย่าส่งมั่ว")
    if (c.isSettle && !c.bankAccountId)
      return NextResponse.json(
        { error: `ช่องทาง "${c.label || c.channel}" ติ๊กเงินเข้าธนาคารแล้ว ต้องเลือกบัญชีที่เงินเข้าด้วย` },
        { status: 400 },
      );
  }

  const res = await saveHotelChannelConfig(adminClient(), session.user.org_id, configs, branchCode);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPDATE_HOTEL_SETTLEMENT_CONFIG",
    resourceType: "cashhub_hotel_channel_config",
    diff: { new: { channels: configs.length, branchCode } },
  });
  return NextResponse.json({ ok: true });
}
