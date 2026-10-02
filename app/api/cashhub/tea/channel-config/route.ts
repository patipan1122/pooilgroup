// POST /api/cashhub/tea/channel-config — บันทึกการผูกช่องทาง→บัญชี/บริษัท (super_admin)
// เตรียมไป reconcile: แต่ละช่องทาง (เงินสด/QR/EDC/Grab/...) เงินเข้าบริษัท+บัญชีไหน + ค่าธรรมเนียม
// body = { configs: TeaChannelConfig[] }
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { userCanAdminModule } from "@/lib/auth/module-access";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { saveTeaChannelConfig } from "@/lib/cashhub/tea-data";
import type { TeaChannelConfig } from "@/lib/cashhub/tea-channels";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // 2026-10-02: dropped { executive: true } — isProgramAdminTier(role) always implies
  // isExecutiveRole(role), so this was a no-op pre-check for role-based callers; the real
  // authorization line is the module-admin check below, now also letting a staff
  // hand-picked as cashhub's module admin through (same pattern as the DocuFlow fix).
  const gate = await cashHubApiGuard();
  if (gate.error) return gate.error;
  // 2026-09-19: ผูกช่องทาง→บัญชี/บริษัทของเราเอง ไม่ใช่การเชื่อมต่อ TRCloud → program_admin ทำได้
  if (!(await userCanAdminModule(gate.session.user, "cashhub")))
    return NextResponse.json({ error: "เฉพาะ admin/program_admin ตั้งค่าบัญชีได้" }, { status: 403 });

  let body: { configs?: TeaChannelConfig[]; branchCode?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  if (!Array.isArray(body.configs))
    return NextResponse.json({ error: "ไม่พบข้อมูลการตั้งค่า" }, { status: 400 });

  const orgId = gate.session.user.org_id;
  const branchCode = typeof body.branchCode === "string" ? body.branchCode : "";
  const admin = adminClient();
  const res = await saveTeaChannelConfig(admin, orgId, body.configs, branchCode);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });

  await audit({
    orgId,
    userId: gate.session.user.id,
    action: "SAVE_TEA_CHANNEL_CONFIG",
    resourceType: "cashhub_tea_channel_config",
    diff: { new: { channels: body.configs.length, branchCode } },
  });
  return NextResponse.json({ ok: true });
}
