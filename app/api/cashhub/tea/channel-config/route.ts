// POST /api/cashhub/tea/channel-config — บันทึกการผูกช่องทาง→บัญชี/บริษัท (super_admin)
// เตรียมไป reconcile: แต่ละช่องทาง (เงินสด/QR/EDC/Grab/...) เงินเข้าบริษัท+บัญชีไหน + ค่าธรรมเนียม
// body = { configs: TeaChannelConfig[] }
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { saveTeaChannelConfig } from "@/lib/cashhub/tea-data";
import type { TeaChannelConfig } from "@/lib/cashhub/tea-channels";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  if (!isSuperAdmin(gate.session.user.role))
    return NextResponse.json({ error: "เฉพาะ super_admin ตั้งค่าบัญชีได้" }, { status: 403 });

  let body: { configs?: TeaChannelConfig[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  if (!Array.isArray(body.configs))
    return NextResponse.json({ error: "ไม่พบข้อมูลการตั้งค่า" }, { status: 400 });

  const orgId = gate.session.user.org_id;
  const admin = adminClient();
  const res = await saveTeaChannelConfig(admin, orgId, body.configs);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });

  await audit({
    orgId,
    userId: gate.session.user.id,
    action: "SAVE_TEA_CHANNEL_CONFIG",
    resourceType: "cashhub_tea_channel_config",
    diff: { new: { channels: body.configs.length } },
  });
  return NextResponse.json({ ok: true });
}
