// Pinpoint — sessions collection
//   POST /api/pinpoint/sessions  : start a new comment session (any signed-in user)
//
// CEO 2026-06-16: โหมดติชมเปิดให้พนักงานทุก role ส่งความเห็นได้ (ทุกโปรแกรม).
// ฝั่งรีวิว/รวบรวม (/pinpoint page · export) ยังคงเป็น super_admin/admin tier.
//
// org isolation: org_id/author_id ถูก set จาก session ที่ผ่าน requireSession()
// (server-resolved · ไม่รับจาก client) แล้วเขียนด้วย adminClient — ตรงกับ
// pinpoint write route อื่นทุกตัว (pins · sessions/[id] · mark-fixed). RLS เป็น
// backstop บนตาราง. เหตุผล (2026-06-19): create route เดิมเป็น "ตัวเดียว" ที่ใช้
// serverClient (RLS) → INSERT พึ่ง JWT org_id claim · super_admin ลัดผ่านด้วย
// is_super_admin() แต่ program_admin/พนักงาน (ไม่ใช่ super) ถูก RLS ปัด →
// "เริ่ม session ไม่สำเร็จ" ตั้งแต่ก้าวแรก = ใช้งานไม่ได้ทั้งระบบ.
//
// Listing/review happens in the server-rendered /pinpoint page (super_admin),
// so there is no GET here on purpose — keeps the API surface minimal.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { pinpointV1 } from "@/lib/pinpoint/flags";
import { checkRateLimit } from "@/lib/rate-limit";

const CreateSchema = z.object({
  title: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  if (!pinpointV1()) {
    return NextResponse.json({ error: "Pinpoint ปิดอยู่" }, { status: 403 });
  }
  const session = await requireSession();

  // Guard against a runaway client opening many empty sessions.
  const rl = await checkRateLimit({
    bucket: `pinpoint:start:user:${session.user.id}`,
    max: 20,
    windowSec: 60 * 60,
  });
  if (rl.limited) {
    return NextResponse.json(
      { error: "เริ่ม session ถี่เกินไป · ลองใหม่ภายหลัง" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let title: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = CreateSchema.safeParse(body);
    if (parsed.success) title = parsed.data.title;
  } catch {
    /* empty body ok */
  }

  // adminClient (service role) + org_id/author_id จาก session ที่ยืนยันแล้ว —
  // เหมือน pinpoint write route อื่นทุกตัว · กัน RLS/JWT-claim ปัด non-super user.
  const admin = adminClient();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const { error } = await admin.from("pinpoint_sessions").insert({
    id,
    org_id: session.user.org_id,
    author_id: session.user.id,
    title: title ?? null,
    status: "draft",
    pin_count: 0,
    created_at: now,
    updated_at: now,
  });
  if (error) {
    console.error("[POST /pinpoint/sessions]", error);
    return NextResponse.json({ error: "เริ่ม session ไม่สำเร็จ" }, { status: 500 });
  }
  return NextResponse.json({ id });
}
