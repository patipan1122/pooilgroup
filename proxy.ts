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
//
// ⚠️ ห้ามเด้ง "คนที่มี session อยู่แล้ว" ข้ามโดเมน (เพิ่ม 2026-06-16):
// แม่บ้าน/พนักงานเข้าผ่านลิงก์เชิญ LINE → LIFF endpoint ใน LINE console ยังชี้
// pooilgroup.vercel.app → เขา login สำเร็จ "ที่ vercel" (cookie sb-* ผูกกับ .vercel.app).
// ถ้าเด้งเขาไป pooilgroup.com ตอนเดินหน้าถัดไป → cookie หาย (cookie ผูกตามโดเมน) →
// requireSession เด้งไปหน้า login หลัก = แม่บ้านเข้าระบบไม่ได้เลย (อาการ CEO เจอ
// 2026-06-16: "กดลิงก์เชิญแล้วเด้งมาหน้า login pooil หลัก"). จึงไม่ย้ายคำขอที่ถือ
// session อยู่แล้วออกจากโดเมนที่ session นั้นมีชีวิต — anonymous traffic ยังย้ายไป
// .com ตามเดิม. ลบ guard นี้ได้เมื่อย้าย LIFF Endpoint URL → https://pooilgroup.com/liff
// ใน LINE console แล้ว. ดู memory chairops-invite-link-liff-endpoint-url-2026-06-16.
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

// เป็น "การเปิดหน้าเว็บ" (ไม่ใช่ RSC/prefetch/fetch/webhook) ไหม.
// ดัก 3 ชั้น ให้แกร่ง: sec-fetch-dest=document · sec-fetch-mode=navigate ·
// (กรณีไม่ส่ง sec-fetch-* เลย) Accept ขอ text/html และไม่มี header ของ RSC/prefetch.
function isPageNavigation(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-dest") === "document") return true;
  if (request.headers.get("sec-fetch-mode") === "navigate") return true;
  // fallback: client ที่ไม่ส่ง sec-fetch-* (เก่า/บาง webview) — ใช้ Accept แยกหน้า HTML
  const dest = request.headers.get("sec-fetch-dest");
  const mode = request.headers.get("sec-fetch-mode");
  if (!dest && !mode) {
    const accept = request.headers.get("accept") ?? "";
    const isRsc =
      request.headers.get("rsc") ||
      request.headers.get("next-router-prefetch") ||
      request.headers.get("next-url");
    if (accept.includes("text/html") && !isRsc) return true;
  }
  return false;
}

// มี Supabase session cookie ติดมากับคำขอไหม (sb-<ref>-auth-token · อาจถูกแบ่งเป็น
// .0/.1). ถ้ามี = คน ๆ นี้ login อยู่บนโดเมนนี้แล้ว → ห้ามเด้งข้ามโดเมน (cookie จะหาย).
function hasActiveSession(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
}

function legacyHostRedirect(request: NextRequest): NextResponse | null {
  if ((request.headers.get("host") ?? "") !== LEGACY_HOST) return null;
  if (request.method !== "GET") return null;
  if (!isPageNavigation(request)) return null;
  // อย่าย้ายคนที่ถือ session อยู่แล้วออกจากโดเมนที่ cookie มีชีวิต (ดูคอมเมนต์หัวไฟล์).
  if (hasActiveSession(request)) return null;
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
