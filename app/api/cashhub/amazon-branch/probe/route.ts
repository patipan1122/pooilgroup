// POST /api/cashhub/amazon-branch/probe — ค้นสาขา Amazon ใน TRCloud ด้วยชื่อ → ดึงค่าตั้งบัญชี (super_admin)
// CEO ไม่ต้องพิมพ์รหัสบัญชีเอง — ดึงจากใบกำกับจริงที่นักบัญชีคีย์ไว้แล้ว (กันตั้งผิด = ลงบัญชีผิดร้าน).
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { probeAmazonBranches } from "@/lib/cashhub/amazon-trcloud";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  if (!isSuperAdmin(gate.session.user.role))
    return NextResponse.json(
      { error: "เฉพาะ super_admin ค้น/เพิ่มสาขาได้" },
      { status: 403 },
    );

  let body: { keyword?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  const keyword = String(body.keyword ?? "").trim();
  if (!keyword)
    return NextResponse.json({ error: "พิมพ์ชื่อสาขาที่ต้องการค้น" }, { status: 400 });

  const { branches, error } = await probeAmazonBranches(keyword);
  if (error) return NextResponse.json({ error }, { status: 502 });
  return NextResponse.json({ ok: true, branches });
}
