// POST /api/cashhub/fuel/channel-config — บันทึกการผูกช่องทาง→บัญชี/บริษัท ของปั๊ม (super_admin)
// เตรียม reconcile: แต่ละช่องทาง (เงินสด/QR/บัตร) เงินเข้าบริษัท+บัญชีไหน + ค่าธรรมเนียม
// body = { configs: FuelChannelConfig[] }
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { saveFuelChannelConfig } from "@/lib/cashhub/fuel-settlement-data";
import type { FuelChannelConfig } from "@/lib/cashhub/fuel-channels";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  if (!isSuperAdmin(gate.session.user.role))
    return NextResponse.json({ error: "เฉพาะ super_admin ตั้งค่าบัญชีได้" }, { status: 403 });

  let body: { configs?: FuelChannelConfig[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  if (!Array.isArray(body.configs))
    return NextResponse.json({ error: "ไม่พบข้อมูลการตั้งค่า" }, { status: 400 });

  // กฎ "ไม่ส่งมั่ว": ติ๊กเงินเข้าธนาคารแล้วต้องเลือกบัญชี
  for (const c of body.configs) {
    if (c.isSettle && !c.bankAccountId)
      return NextResponse.json(
        { error: `ช่องทาง "${c.label || c.code}" ติ๊กเงินเข้าธนาคารแล้ว ต้องเลือกบัญชีด้วย` },
        { status: 400 },
      );
  }

  const orgId = gate.session.user.org_id;
  const res = await saveFuelChannelConfig(adminClient(), orgId, body.configs);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });

  await audit({
    orgId,
    userId: gate.session.user.id,
    action: "SAVE_FUEL_CHANNEL_CONFIG",
    resourceType: "cashhub_fuel_channel_config",
    diff: { new: { channels: body.configs.length } },
  });
  return NextResponse.json({ ok: true });
}
