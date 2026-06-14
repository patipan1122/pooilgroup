// GET /api/cashhub/tea/iv-link?ivId=... — คืนลิงก์เปิดใบ IV ใน TRCloud (on-demand)
//   iv/search ไม่คืน link → ต้อง iv/read ตอนกด. executive อ่านได้.
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { getTeaIvLink, teaTrcloudConfigured } from "@/lib/cashhub/tea-trcloud";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  if (!teaTrcloudConfigured())
    return NextResponse.json({ error: "TRCloud ยังไม่ได้ตั้งค่า" }, { status: 503 });

  const ivId = req.nextUrl.searchParams.get("ivId") ?? "";
  if (!/^\d+$/.test(ivId)) return NextResponse.json({ error: "เลข IV ไม่ถูกต้อง" }, { status: 400 });

  const { url, error } = await getTeaIvLink(ivId);
  if (error) return NextResponse.json({ error }, { status: 502 });
  return NextResponse.json({ ok: true, url });
}
