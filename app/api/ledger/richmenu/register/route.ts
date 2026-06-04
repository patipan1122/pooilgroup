// POST /api/ledger/richmenu/register — admin-only.
// Registers (or replaces) the LedgerLine LINE OA Rich Menu (6-cell staff menu)
// using the connected channel's encrypted access token (per-module rule — the
// token lives in ledger_line_channel, NOT a shared env var). One-button setup
// from /ledger/settings so a non-technical operator never touches the CLI.
//
// Mirrors app/api/chairops/richmenu/register/route.ts, but the token is decrypted
// from the DB and the saved richMenuId is written back to the channel row.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { decryptToken } from "@/lib/recruit/channel-crypto";
import { getRequestBaseUrl } from "@/lib/utils/base-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LINE_API = "https://api.line.me";
const LINE_DATA = "https://api-data.line.me";

export async function POST(request: NextRequest) {
  let orgId: string;
  try {
    const session = await requireSession();
    if (!isAdminTier(session.user.role)) {
      return NextResponse.json(
        { ok: false, error: "ต้องเป็นผู้ดูแล (Admin) เท่านั้น" },
        { status: 403 },
      );
    }
    orgId = session.user.org_id;
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Resolve the channel to register: explicit ?company= or the org's active one.
  const companyId = request.nextUrl.searchParams.get("company");
  const channel = await prisma.ledgerLineChannel.findFirst({
    where: { orgId, active: true, ...(companyId ? { companyId } : {}) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, accessTokenEnc: true },
  });
  if (!channel) {
    return NextResponse.json(
      { ok: false, error: "ยังไม่ได้เชื่อมต่อ LINE OA — ไปที่ /ledger/settings เพื่อเชื่อมต่อก่อน" },
      { status: 400 },
    );
  }
  const token = decryptToken(channel.accessTokenEnc);
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "ยังไม่มี Access Token ของช่อง LINE นี้ (ใส่ใน /ledger/settings)" },
      { status: 400 },
    );
  }

  const liffId = process.env.NEXT_PUBLIC_LEDGER_LIFF_ID;
  const base = getRequestBaseUrl(request);
  // LIFF opens the capture app (endpoint = /liff/ledger); ?next deep-links the web pane.
  const liff = (next?: string) =>
    liffId
      ? `https://liff.line.me/${liffId}${next ? `?next=${encodeURIComponent(next)}` : ""}`
      : `${base}${next ?? "/liff/ledger"}`;

  // 6 cells (2500×1686, 3 cols × 2 rows) matching public/ledger/brand/richmenu.png.
  const W = 2500, H = 1686, cw = Math.round(W / 3), ch = Math.round(H / 2);
  const richMenu = {
    size: { width: W, height: H },
    selected: true,
    name: "LedgerLine Menu",
    chatBarText: "เมนูบัญชี",
    areas: [
      { bounds: { x: 0, y: 0, width: cw, height: ch }, action: { type: "uri", label: "ถ่ายใบเสร็จ", uri: liff() } },
      { bounds: { x: cw, y: 0, width: cw, height: ch }, action: { type: "message", label: "พิมพ์รายจ่าย", text: "/guide" } },
      { bounds: { x: cw * 2, y: 0, width: W - cw * 2, height: ch }, action: { type: "uri", label: "รายการของฉัน", uri: liff("/ledger/expenses") } },
      { bounds: { x: 0, y: ch, width: cw, height: H - ch }, action: { type: "message", label: "เปลี่ยนสาขา", text: "/setting" } },
      { bounds: { x: cw, y: ch, width: cw, height: H - ch }, action: { type: "message", label: "วิธีใช้", text: "/help" } },
      { bounds: { x: cw * 2, y: ch, width: W - cw * 2, height: H - ch }, action: { type: "message", label: "แจ้งปัญหา", text: "แจ้งปัญหา" } },
    ],
  };

  const auth = { Authorization: `Bearer ${token}` };
  try {
    // 1) create definition
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

    // 2) upload the menu image (the deployed ≤1MB png)
    const imgUrl = `${base}/ledger/brand/richmenu.png`;
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
      headers: { ...auth, "Content-Type": "image/png" },
      body: imgBuf,
    });
    if (!upRes.ok) {
      return NextResponse.json(
        { ok: false, step: "upload", status: upRes.status, error: (await upRes.text()).slice(0, 400) },
        { status: 502 },
      );
    }

    // 3) set as the default menu for all users
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

    // 4) remember the menu id on the channel row (so a re-register can replace it)
    await prisma.ledgerLineChannel.update({
      where: { id: channel.id },
      data: { richMenuId },
    });

    return NextResponse.json({
      ok: true,
      richMenuId,
      message: "ตั้งเมนูในแชต LINE สำเร็จ — พนักงานทุกคนจะเห็นเมนู 6 ปุ่มของน้องใบเสร็จ",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 },
    );
  }
}
