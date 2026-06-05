// POST /api/ledger/invite/accept — { token, idToken }.
// Accepts a scoped LINE invite: verifies the LINE id_token server-side (NEVER
// trusts a raw userId), then upserts a scoped ledger_line_member. Idempotent —
// re-opening the link just refreshes the member's scope. One-time per token
// (the first accept stamps used_at; the row is kept so re-opens still resolve
// the same member instead of erroring).
//
// IDENTITY (audit 2026-06-05): the id_token is verified against the LEDGER LOGIN
// channel, so `sub` here is the LOGIN/LIFF identity. Two invite shapes bind a Pool
// account to that login sub so the owner/admins pass the LIFF + bot with no fragile
// id matching:
//   • targetPoolUserId set  → bind THIS sub to that existing Pool user (owner
//        self-claim, or promoting an existing Pool user). kind='admin_claim' also
//        marks the ledger member admin.
//   • kind='admin_claim', no target → mint a FRESH, ledger-only Pool user (isolated
//        from ChairOps: ledger.local email, no ChairopsUser) and make them admin.
// All Pool binding is isolated to LedgerLine — never touches ChairOps identities.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { adminClient } from "@/lib/db/server";
import { loginChannelIdForModule } from "@/lib/line/channels";
import { UserRole } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface VerifyResult {
  sub?: string; // the LINE userId
  name?: string;
  error?: string;
}

/** Mint a fresh, LEDGER-ONLY Pool user (isolated from ChairOps) so a promoted
 *  LINE person can hold a session + ledger admin. Returns the Pool user id. */
async function ensureLedgerAdminPoolUser(
  admin: ReturnType<typeof adminClient>,
  orgId: string,
  displayName: string | null,
): Promise<string | null> {
  const email = `ledger-${randomUUID().slice(0, 8)}@ledger.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: `Lg${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    email_confirm: true,
  });
  if (error || !data?.user) return null;
  try {
    await prisma.user.create({
      data: {
        id: data.user.id,
        orgId,
        email,
        name: (displayName ?? "").trim().slice(0, 100) || "ผู้ดูแลบัญชี",
        role: UserRole.staff, // NOT org-admin — ledger admin comes from the member row
        isActive: true,
      },
    });
    await prisma.userModule.create({
      data: { orgId, userId: data.user.id, moduleName: "ledger", isActive: true, role: "admin" },
    });
    return data.user.id;
  } catch (e) {
    console.error("[ledger:invite-accept] ensureLedgerAdminPoolUser failed", e);
    await admin.auth.admin.deleteUser(data.user.id).catch(() => {});
    return null;
  }
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

  // 1. Verify the LINE id_token (proves the caller's real LINE LOGIN sub).
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
  const lineUserId = verified.sub; // the LOGIN sub
  const displayName = verified.name ?? null;

  // 2. Load the invite (must exist; reject expired).
  const invite = await prisma.ledgerLineInvite.findUnique({
    where: { token },
    select: {
      id: true, orgId: true, companyId: true, role: true, kind: true,
      targetPoolUserId: true, scopeBranchIds: true, scopeCategoryIds: true,
      expiresAt: true, usedAt: true, usedByLineUserId: true,
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

  const isAdminClaim = invite.kind === "admin_claim";
  const memberRole = isAdminClaim ? "admin" : invite.role;
  const admin = adminClient();

  // 3. Resolve which Pool account (if any) this login sub binds to.
  //    - explicit target (owner self-claim / promote existing Pool user), or
  //    - admin_claim with no target → mint a fresh ledger-only Pool user.
  let poolUserId: string | null = invite.targetPoolUserId;
  if (!poolUserId && isAdminClaim) {
    poolUserId = await ensureLedgerAdminPoolUser(admin, invite.orgId, displayName);
    if (!poolUserId) {
      return NextResponse.json({ ok: false, error: "สร้างบัญชีผู้ดูแลไม่สำเร็จ" }, { status: 500 });
    }
  }

  // Guard: a login sub belongs to exactly one Pool user (unique). If it's already
  // bound elsewhere, refuse rather than silently steal an identity.
  if (poolUserId) {
    const clash = await prisma.user.findFirst({
      where: { lineLoginSub: lineUserId },
      select: { id: true, name: true },
    });
    if (clash && clash.id !== poolUserId) {
      return NextResponse.json(
        { ok: false, error: `LINE นี้ผูกกับบัญชี "${clash.name}" อยู่แล้ว` },
        { status: 409 },
      );
    }
  }

  // 4. Bind everything in one transaction.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.ledgerLineMember.upsert({
        where: { orgId_lineUserId: { orgId: invite.orgId, lineUserId } },
        create: {
          orgId: invite.orgId,
          companyId: invite.companyId,
          lineUserId,
          displayName,
          role: memberRole,
          scopeBranchIds: invite.scopeBranchIds,
          scopeCategoryIds: invite.scopeCategoryIds,
          poolUserId: poolUserId ?? undefined,
          active: true,
        },
        update: {
          companyId: invite.companyId,
          displayName: displayName ?? undefined,
          role: memberRole,
          scopeBranchIds: invite.scopeBranchIds,
          scopeCategoryIds: invite.scopeCategoryIds,
          poolUserId: poolUserId ?? undefined,
          active: true,
        },
      });
      // Bind the login sub to the Pool user so the LIFF + bot resolve them.
      if (poolUserId) {
        await tx.user.update({
          where: { id: poolUserId },
          data: { lineLoginSub: lineUserId },
        });
      }
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
    role: memberRole,
    displayName,
    message: isAdminClaim
      ? "ผูกบัญชีเรียบร้อย — คุณใช้สิทธิ์ผู้ดูแลในแชต/มินิแอปได้แล้ว 🛠️"
      : "เข้าร่วมเรียบร้อย — ส่งใบเสร็จในกลุ่ม LINE ได้เลย 🧾",
  });
}
