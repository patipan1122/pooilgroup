// LINE เรียกกลับหลังผู้เช่าอนุญาต → แลก code เป็น userId → ผูกกับผู้เช่า (tenant.lineUserId)
// ไม่ใช้ cookie/session — ทุกอย่างผ่าน state (HMAC) เพราะ LINE webview ทิ้ง cookie
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantByPortalToken } from "@/lib/rentspace/portal";
import { rentspaceLineExchangeCode, rentspaceLineProfile, verifyPortalState } from "@/lib/rentspace/line";

export const dynamic = "force-dynamic";

function back(req: NextRequest, token: string, status: string) {
  const url = new URL(`/rentspace/portal/${encodeURIComponent(token)}`, req.url);
  url.searchParams.set("line", status);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  const state = sp.get("state") ?? "";
  const oauthErr = sp.get("error");

  const portalToken = verifyPortalState(state);
  if (!portalToken) return NextResponse.redirect(new URL("/rentspace/portal/-?line=err", req.url));
  if (oauthErr || !code) return back(req, portalToken, "cancel");

  const tenant = await getTenantByPortalToken(portalToken);
  if (!tenant) return back(req, portalToken, "err");

  const tok = await rentspaceLineExchangeCode(code);
  if (!tok) return back(req, portalToken, "err");
  const profile = await rentspaceLineProfile(tok.accessToken);
  if (!profile) return back(req, portalToken, "err");

  // กัน LINE เดียวผูกหลายผู้เช่า (คอลัมน์ unique) — ถ้า userId นี้ผูกคนอื่นไปแล้ว
  const existing = await prisma.rentalTenant.findUnique({
    where: { lineUserId: profile.userId },
    select: { id: true },
  });
  if (existing && existing.id !== tenant.id) return back(req, portalToken, "dupe");

  await prisma.rentalTenant.update({
    where: { id: tenant.id },
    data: { lineUserId: profile.userId, lineDisplayName: profile.displayName || null, lineLinkedAt: new Date() },
  });
  return back(req, portalToken, "ok");
}
