// POST /api/cashhub/tea/send-iv — สร้าง IV ร้านชา 1 วันเข้า TRCloud (เฉพาะวันที่ยังไม่มี IV)
//   super_admin เท่านั้น (สร้างเอกสารบัญชีจริง) · กันใบซ้ำใน createTeaIv · c1=เงินสด c2=ที่เหลือ.
//   หลังสร้างสำเร็จ → re-pull IV วันนั้น → อัปเดต DB ให้ตารางโชว์ทันที.
// body = { branchCode, date }
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { teaBranchByCode, createTeaIv, fetchTeaIvs, teaTrcloudConfigured } from "@/lib/cashhub/tea-trcloud";
import { loadTeaDays, upsertTeaIvs } from "@/lib/cashhub/tea-data";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  if (!isSuperAdmin(gate.session.user.role))
    return NextResponse.json({ error: "เฉพาะ super_admin สร้าง IV เข้า TRCloud ได้" }, { status: 403 });
  if (!teaTrcloudConfigured())
    return NextResponse.json({ error: "TRCloud ยังไม่ได้ตั้งค่า" }, { status: 503 });

  let body: { branchCode?: string; date?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  const cfg = teaBranchByCode(body.branchCode ?? null);
  if (!cfg) return NextResponse.json({ error: "ไม่รู้จักสาขานี้" }, { status: 400 });
  const date = String(body.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return NextResponse.json({ error: "ระบุวันที่ให้ถูกต้อง" }, { status: 400 });

  const orgId = gate.session.user.org_id;
  const admin = adminClient();

  // โหลดยอด POS ของวันนั้น
  const rows = await loadTeaDays(admin, orgId, date, date, cfg.code);
  const day = rows[0];
  if (!day || day.pos_gross == null)
    return NextResponse.json({ error: "วันนี้ยังไม่มียอด POS — อัปไฟล์ก่อน" }, { status: 400 });
  if (day.iv_gross != null)
    return NextResponse.json({ error: "วันนี้มี IV อยู่แล้ว — ไม่สร้างซ้ำ" }, { status: 409 });

  // c1 = เงินสด · c2 = ที่เหลือ (Σ = pos_gross เป๊ะ)
  const cash = day.pos_channels?.cash ?? 0;
  const c1 = Math.round(cash * 100) / 100;
  const c2 = Math.round((day.pos_gross - c1) * 100) / 100;

  const res = await createTeaIv(cfg, date, c1, c2);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
  if (res.duplicate)
    return NextResponse.json({ ok: true, duplicate: true, ivNo: res.ivNo, message: "มี IV ของวันนี้อยู่แล้ว" });

  // re-pull IV วันนั้น → อัปเดต DB (โชว์เลข IV + match ทันที)
  const { ivs } = await fetchTeaIvs(cfg, date, date);
  if (ivs.length > 0) await upsertTeaIvs(admin, orgId, cfg, date, date, ivs);

  await audit({
    orgId,
    userId: gate.session.user.id,
    action: "SEND_TEA_IV",
    resourceType: "cashhub_tea_daily",
    diff: { new: { branchCode: cfg.code, date, ivId: res.ivId, ivNo: res.ivNo, total: c1 + c2 } },
  });

  return NextResponse.json({ ok: true, ivId: res.ivId, ivNo: res.ivNo });
}
