// ผู้เช่ากด "เชื่อม LINE" ในพอร์ทัล → เด้งไป LINE Login (OAuth) พร้อม state ที่พก portalToken
import { NextRequest, NextResponse } from "next/server";
import { getTenantByPortalToken } from "@/lib/rentspace/portal";
import { rentspaceLineAuthorizeUrl, rentspaceLineConfigured, signPortalState } from "@/lib/rentspace/line";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const tenant = await getTenantByPortalToken(token);
  if (!tenant) {
    return NextResponse.redirect(new URL(`/rentspace/portal/${encodeURIComponent(token)}`, req.url));
  }
  if (!rentspaceLineConfigured()) {
    // ยังไม่ใส่กุญแจ LINE → กลับพอร์ทัลพร้อมข้อความ
    return NextResponse.redirect(new URL(`/rentspace/portal/${encodeURIComponent(token)}?line=unavailable`, req.url));
  }
  return NextResponse.redirect(rentspaceLineAuthorizeUrl(signPortalState(token)));
}
