import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// ── ย้ายโดเมนเก่า → ใหม่ (pooilgroup.vercel.app → pooilgroup.com) ───────────────
// ใครเปิด "หน้าเว็บ" บนโดเมนเก่า → เด้งไป pooilgroup.com อัตโนมัติ (308 ถาวร).
// เด้งเฉพาะการเปิดหน้าจริง (sec-fetch-dest=document, GET) — machine traffic
// (RSC/prefetch/fetch + webhook server-to-server ไม่ส่ง dest=document) จึงไม่โดนแตะ.
// ยกเว้น path ที่ผูกกับโดเมนเก่าฝั่งภายนอก/ระบบ (ไม่งั้น LINE/บอท/login พัง):
//   /api    — webhook (LINE/Telegram/FB) · OAuth callback · cron
//   /auth   — LINE login callback · liff-complete
//   /liff   — LIFF endpoint (ยังชี้ vercel จนกว่าจะย้ายใน LINE console)
//   /health — uptime monitor · /_next · PWA/asset (กัน service-worker cache poisoning)
// หมายเหตุ: ผู้ที่ค้าง login บน vercel จะถูกเด้งมา login ใหม่ที่ .com 1 ครั้ง
// (cookie ผูกตามโดเมน) — เป็นพฤติกรรมที่ตั้งใจ (ย้ายทุกคนมาโดเมนใหม่).
const LEGACY_HOST = "pooilgroup.vercel.app";
const DIR_EXEMPT = ["/api", "/auth", "/liff", "/health", "/_next"];
const FILE_EXEMPT = new Set([
  "/sw.js",
  "/manifest.json",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
  "/favicon.ico",
]);

function legacyHostRedirect(request: NextRequest): NextResponse | null {
  if ((request.headers.get("host") ?? "") !== LEGACY_HOST) return null;
  if (request.method !== "GET") return null;
  if (request.headers.get("sec-fetch-dest") !== "document") return null;
  const { pathname, search } = request.nextUrl;
  if (FILE_EXEMPT.has(pathname)) return null;
  if (DIR_EXEMPT.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return null;
  }
  return NextResponse.redirect(`https://pooilgroup.com${pathname}${search}`, 308);
}

export async function proxy(request: NextRequest) {
  const moved = legacyHostRedirect(request);
  if (moved) return moved;
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
