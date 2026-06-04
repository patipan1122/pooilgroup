// POST /api/ledger/invite/accept — { token, idToken }.
// Accepts a scoped LINE invite: verifies the LINE id_token server-side (NEVER
// trusts a raw userId), then upserts a scoped ledger_line_member. Idempotent —
// re-opening the link just refreshes the member's scope. One-time per token
// (the first accept stamps used_at; the row is kept so re-opens still resolve
// the same member instead of erroring).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loginChannelIdForModule } from "@/lib/line/channels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface VerifyResult {
  sub?: string; // the LINE userId
  name?: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  let body: { token?: string; idToken?: string };
  try {
    body = (await req.json()) as { token?: string; idToken?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const token = body.token?.trim();
  const idToken = body.idToken?.trim();
  if (!token || !idToken) {
    return NextResponse.json({ ok: false, error: "ลิงก์เชิญไม่ครบ" }, { status: 400 });
  }

  // 1. Verify the LINE id_token (proves the caller's real LINE userId).
  const clientId = loginChannelIdForModule("ledger");
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "ระบบ LINE ยังไม่พร้อม" }, { status: 500 });
  }
  let verified: VerifyResult;
  try {
    const r = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
      signal: AbortSignal.timeout(8000),
    });
    verified = (await r.json()) as VerifyResult;
    if (!r.ok || !verified.sub) {
      return NextResponse.json(
        { ok: false, error: "ยืนยันตัวตน LINE ไม่สำเร็จ ลองเปิดลิงก์ใหม่อีกครั้ง" },
        { status: 401 },
      );
    }
  } catch {
    return NextResponse.json({ ok: false, error: "เชื่อมต่อ LINE ไม่สำเร็จ" }, { status: 502 });
  }
  const lineUserId = verified.sub;
  const displayName = verified.name ?? null;

  // 2. Load the invite (must exist; reject expired).
  const invite = await prisma.ledgerLineInvite.findUnique({
    where: { token },
    select: {
      id: true, orgId: true, companyId: true, role: true,
      scopeBranchIds: true, scopeCategoryIds: true, expiresAt: true,
      usedAt: true, usedByLineUserId: true,
    },
  });
  if (!invite) {
    return NextResponse.json({ ok: false, error: "ไม่พบคำเชิญนี้ (อาจถูกยกเลิก)" }, { status: 404 });
  }
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ ok: false, error: "คำเชิญหมดอายุแล้ว ขอลิงก์ใหม่จากแอดมิน" }, { status: 410 });
  }
  // A used invite may only be re-opened by the SAME person (idempotent refresh).
  if (invite.usedAt && invite.usedByLineUserId && invite.usedByLineUserId !== lineUserId) {
    return NextResponse.json({ ok: false, error: "คำเชิญนี้ถูกใช้ไปแล้ว" }, { status: 409 });
  }

  // 3. Upsert the scoped member + stamp the invite (transaction).
  try {
    await prisma.$transaction(async (tx) => {
      await tx.ledgerLineMember.upsert({
        where: { orgId_lineUserId: { orgId: invite.orgId, lineUserId } },
        create: {
          orgId: invite.orgId,
          companyId: invite.companyId,
          lineUserId,
          displayName,
          role: invite.role,
          scopeBranchIds: invite.scopeBranchIds,
          scopeCategoryIds: invite.scopeCategoryIds,
          active: true,
        },
        update: {
          companyId: invite.companyId,
          displayName: displayName ?? undefined,
          role: invite.role,
          scopeBranchIds: invite.scopeBranchIds,
          scopeCategoryIds: invite.scopeCategoryIds,
          active: true,
        },
      });
      if (!invite.usedAt) {
        await tx.ledgerLineInvite.update({
          where: { id: invite.id },
          data: { usedAt: new Date(), usedByLineUserId: lineUserId },
        });
      }
    });
  } catch (e) {
    console.error("[ledger:invite-accept] failed", e);
    return NextResponse.json({ ok: false, error: "บันทึกสมาชิกไม่สำเร็จ" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    role: invite.role,
    displayName,
    message: "เข้าร่วมเรียบร้อย — ส่งใบเสร็จในกลุ่ม LINE ได้เลย 🧾",
  });
}
