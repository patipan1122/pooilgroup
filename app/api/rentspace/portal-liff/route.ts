// LIFF (เว็บแอปในไลน์) — client ส่ง id_token มา → ตรวจกับ LINE → userId → หาผู้เช่า → คืนข้อมูลพอร์ทัล
// ปลอดภัย: เชื่อ userId (sub) จาก LINE เท่านั้น ไม่เชื่อค่าที่ client ส่งมาเอง
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rentspaceVerifyIdToken } from "@/lib/rentspace/line";
import { buildPortalView } from "@/lib/rentspace/portal";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let idToken = "";
  try {
    const b = (await req.json()) as { idToken?: string };
    idToken = String(b?.idToken ?? "");
  } catch {
    return NextResponse.json({ linked: false, error: "bad-body" }, { status: 400 });
  }
  if (!idToken) return NextResponse.json({ linked: false, error: "no-token" }, { status: 400 });

  const v = await rentspaceVerifyIdToken(idToken);
  if (!v) return NextResponse.json({ linked: false, error: "verify-failed" }, { status: 401 });

  const tenant = await prisma.rentalTenant.findUnique({ where: { lineUserId: v.userId } });
  if (!tenant || !tenant.isActive) return NextResponse.json({ linked: false });

  const view = await buildPortalView(tenant);
  return NextResponse.json({ linked: true, view });
}
