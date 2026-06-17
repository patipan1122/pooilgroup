// POST /api/clawhub/richmenu/register — super_admin only.
// Registers (or replaces) the ClawHub (JOLLY PLAY) LINE OA Rich Menu — a 6-button
// customer menu — using the SERVER's CLAWHUB_LINE_CHANNEL_ACCESS_TOKEN so the
// token never leaves Vercel. Server-side equivalent of scripts/clawhub-richmenu.mjs
// (lets a non-technical operator press one button instead of running a CLI).
//
// Each button is a `uri` action that opens the customer LIFF app at a screen:
//   สมัครสมาชิก → register · ขอคืนเงิน → refund · แต้มของฉัน → points
//   แลกตุ๊กตา   → rewards  · ช่วยเหลือ  → help   · เงื่อนไข   → help
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { getRequestBaseUrl } from "@/lib/utils/base-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LINE_API = "https://api.line.me";
const LINE_DATA = "https://api-data.line.me";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // ตั้งค่า LINE = โครงสร้างหลังบ้าน → เฉพาะ super_admin (CEO 2026-06-15)
  if (!isSuperAdmin(session.user.role)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "หน้านี้สงวนสำหรับผู้ดูแลระบบ (super admin) เท่านั้น — กรุณาติดต่อผู้ดูแลระบบ",
      },
      { status: 403 },
    );
  }

  const token = process.env.CLAWHUB_LINE_CHANNEL_ACCESS_TOKEN;
  const liffId = process.env.NEXT_PUBLIC_CLAWHUB_LIFF_ID;
  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "ยังไม่ได้ใส่ค่า CLAWHUB_LINE_CHANNEL_ACCESS_TOKEN ใน Vercel (ค่าว่าง) — ใส่ Channel Access Token จาก LINE Developers ก่อน",
      },
      { status: 400 },
    );
  }
  if (!liffId) {
    return NextResponse.json(
      { ok: false, error: "ยังไม่ได้ใส่ค่า NEXT_PUBLIC_CLAWHUB_LIFF_ID ใน Vercel" },
      { status: 400 },
    );
  }

  // Customer LIFF deep-link → /liff/clawhub?screen=<x>.
  const liff = (screen: string) =>
    `https://liff.line.me/${liffId}?screen=${encodeURIComponent(screen)}`;

  const richMenu = {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: "JOLLY PLAY Menu",
    chatBarText: "เมนู JOLLY PLAY",
    areas: [
      // Row 1
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: { type: "uri", label: "สมัครสมาชิก", uri: liff("register") },
      },
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: { type: "uri", label: "ขอคืนเงิน", uri: liff("refund") },
      },
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: { type: "uri", label: "แต้มของฉัน", uri: liff("points") },
      },
      // Row 2
      {
        bounds: { x: 0, y: 843, width: 833, height: 843 },
        action: { type: "uri", label: "แลกตุ๊กตา", uri: liff("rewards") },
      },
      {
        bounds: { x: 833, y: 843, width: 834, height: 843 },
        action: { type: "uri", label: "ช่วยเหลือ", uri: liff("help") },
      },
      {
        bounds: { x: 1667, y: 843, width: 833, height: 843 },
        action: { type: "uri", label: "เงื่อนไข", uri: liff("help") },
      },
    ],
  };

  const auth = { Authorization: `Bearer ${token}` };

  try {
    // 1) create the rich menu definition
    const createRes = await fetch(`${LINE_API}/v2/bot/richmenu`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(richMenu),
    });
    const createText = await createRes.text();
    if (!createRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          step: "create",
          status: createRes.status,
          error: createText.slice(0, 400),
        },
        { status: 502 },
      );
    }
    const richMenuId = (JSON.parse(createText) as { richMenuId: string }).richMenuId;

    // 2) upload the menu image (the deployed ≤1MB png)
    const imgUrl = `${getRequestBaseUrl(request)}/clawhub/richmenu.png`;
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          step: "image-fetch",
          error: `โหลดรูปเมนูไม่ได้ (${imgRes.status}) ${imgUrl}`,
        },
        { status: 502 },
      );
    }
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    const upRes = await fetch(`${LINE_DATA}/v2/bot/richmenu/${richMenuId}/content`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "image/png" },
      body: imgBuf,
    });
    if (!upRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          step: "upload",
          status: upRes.status,
          error: (await upRes.text()).slice(0, 400),
        },
        { status: 502 },
      );
    }

    // 3) set it as the default menu for all users
    const defRes = await fetch(`${LINE_API}/v2/bot/user/all/richmenu/${richMenuId}`, {
      method: "POST",
      headers: auth,
    });
    if (!defRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          step: "set-default",
          status: defRes.status,
          error: (await defRes.text()).slice(0, 400),
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      richMenuId,
      message:
        "ตั้งเมนู Rich Menu สำเร็จ — ลูกค้า JOLLY PLAY ทุกคนจะเห็นเมนูใหม่ใน LINE",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 },
    );
  }
}
