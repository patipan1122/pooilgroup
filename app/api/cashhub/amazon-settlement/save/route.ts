// POST /api/cashhub/amazon-settlement/save — บันทึก config ค่าธรรมเนียม/บัญชีต่อช่องทาง (super_admin)
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { saveChannelConfig } from "@/lib/cashhub/amazon-settlement-data";
import type { ChannelConfig } from "@/lib/cashhub/amazon-settlement";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;
  if (!isSuperAdmin(session.user.role))
    return NextResponse.json(
      { error: "เฉพาะ super_admin ตั้งค่าได้" },
      { status: 403 },
    );

  let body: { configs?: ChannelConfig[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  const configs = Array.isArray(body.configs) ? body.configs : [];
  if (configs.length === 0)
    return NextResponse.json({ error: "ไม่มีข้อมูลตั้งค่า" }, { status: 400 });

  // sanitize เบา ๆ
  for (const c of configs) {
    if (typeof c.cvar !== "string") return NextResponse.json({ error: "ช่องทางไม่ถูกต้อง" }, { status: 400 });
    c.feePercent = Math.max(0, Math.min(100, Number(c.feePercent) || 0));
    c.minSettleBaht = Math.max(0, Number(c.minSettleBaht) || 0);
  }

  const res = await saveChannelConfig(adminClient(), session.user.org_id, configs);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPDATE_AMAZON_SETTLEMENT_CONFIG",
    resourceType: "cashhub_amazon_channel_config",
    diff: { new: { channels: configs.length } },
  });
  return NextResponse.json({ ok: true });
}
