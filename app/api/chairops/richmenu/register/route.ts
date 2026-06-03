// POST /api/chairops/richmenu/register — admin-only.
// Registers (or replaces) the ChairOps LINE OA Rich Menu (4-button maid menu)
// using the SERVER's CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN, so the token never
// has to leave Vercel. Server-side equivalent of scripts/chairops-richmenu.mjs
// — lets a non-technical operator press one button instead of running a CLI.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/chairops/auth/session";
import { rankOf } from "@/lib/chairops/auth/role-guards";
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
  if (rankOf(session.user.role) < rankOf("CEO")) {
    return NextResponse.json(
      { ok: false, error: "ต้องเป็นผู้บริหาร (CEO/Admin) เท่านั้น" },
      { status: 403 },
    );
  }

  const token = process.env.CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN;
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "ยังไม่ได้ใส่ค่า CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN ใน Vercel (ค่าว่าง) — ใส่ Channel Access Token จาก LINE Developers ก่อน",
      },
      { status: 400 },
    );
  }
  if (!liffId) {
    return NextResponse.json(
      { ok: false, error: "ยังไม่ได้ใส่ค่า NEXT_PUBLIC_LIFF_ID ใน Vercel" },
      { status: 400 },
    );
  }

  const liff = (next: string) =>
    `https://liff.line.me/${liffId}/chairops?next=${encodeURIComponent(next)}`;

  const richMenu = {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: "ChairOps Maid Menu",
    chatBarText: "เมนู ChairOps",
    areas: [
      {
        bounds: { x: 0, y: 0, width: 1250, height: 843 },
        action: { type: "uri", label: "เก็บเงิน", uri: liff("/chairops/m/collect/new") },
      },
      {
        bounds: { x: 1250, y: 0, width: 1250, height: 843 },
        action: { type: "uri", label: "เช็คคลีน", uri: liff("/chairops/m/cleanliness/new") },
      },
      {
        bounds: { x: 0, y: 843, width: 1250, height: 843 },
        action: { type: "uri", label: "แจ้งซ่อม", uri: liff("/chairops/m/damage") },
      },
      {
        bounds: { x: 1250, y: 843, width: 1250, height: 843 },
        action: { type: "uri", label: "เบิกของ", uri: liff("/chairops/m/parts/new") },
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
        { ok: false, step: "create", status: createRes.status, error: createText.slice(0, 400) },
        { status: 502 },
      );
    }
    const richMenuId = (JSON.parse(createText) as { richMenuId: string }).richMenuId;

    // 2) upload the menu image (the deployed ≤1MB jpg)
    const imgUrl = `${getRequestBaseUrl(request)}/mascot/banner/richmenu-line.jpg`;
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) {
      return NextResponse.json(
        { ok: false, step: "image-fetch", error: `โหลดรูปเมนูไม่ได้ (${imgRes.status}) ${imgUrl}` },
        { status: 502 },
      );
    }
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    const upRes = await fetch(`${LINE_DATA}/v2/bot/richmenu/${richMenuId}/content`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "image/jpeg" },
      body: imgBuf,
    });
    if (!upRes.ok) {
      return NextResponse.json(
        { ok: false, step: "upload", status: upRes.status, error: (await upRes.text()).slice(0, 400) },
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
        { ok: false, step: "set-default", status: defRes.status, error: (await defRes.text()).slice(0, 400) },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      richMenuId,
      message: "ตั้งเมนู Rich Menu สำเร็จ — แม่บ้านทุกคนจะเห็นเมนูน้องแมวน้ำใหม่ใน LINE",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 },
    );
  }
}
