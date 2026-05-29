// Verify LINE id_token from LIFF and sign user into Supabase using existing email/phone link.
// If LINE userId matches a user.line_user_id row → mint a session via service role.
// If not matched, return needs-link signal so the LIFF page asks user to log in via web first.
//
// Security (P0 hardening — was vulnerable to LINE userId spoofing):
//   ❌ ก่อนหน้านี้: รับ lineUserId จาก client ตรง ๆ → ใครรู้ LINE ID ก็ login เป็นใครก็ได้
//   ✅ ตอนนี้: รับ idToken (JWT จาก LIFF) → verify ผ่าน LINE Verify API ก่อน

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminClient } from "@/lib/db/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { getRequestBaseUrl } from "@/lib/utils/base-url";
import { verifyInvite } from "@/lib/chairops/line/invite";
import { randomUUID } from "node:crypto";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";

type ResolvedUser = {
  id: string;
  orgId: string;
  email: string | null;
  name: string;
  role: string;
};

// ChairOps self-register: every maid already has LINE, so the first time they
// open the Mini App + LINE-login we auto-create a branchless MAID (name from
// LINE). They land on /chairops/m → "ยังไม่ได้กำหนดสาขา · ติดต่อออฟฟิศ"; the
// office just assigns a branch to activate them. No form, no email, no LINE-ID
// copy. Single-org pilot: org derived from any active branch (multi-org later
// = per-OA→org map). Branchless = harmless until an admin approves via branch.
async function selfRegisterChairopsMaid(
  admin: ReturnType<typeof adminClient>,
  lineUserId: string,
  name: string | null,
): Promise<ResolvedUser | null> {
  const branch = await prisma.chairopsBranch.findFirst({
    where: { isActive: true },
    select: { orgId: true },
  });
  if (!branch) return null;
  const orgId = branch.orgId;
  const displayName = (name ?? "").trim().slice(0, 100) || "พนักงานใหม่";

  const existing = await prisma.chairopsUser.findFirst({
    where: { orgId, lineUserId },
    select: { id: true, orgId: true, email: true, displayName: true, role: true },
  });
  if (existing) {
    return { id: existing.id, orgId: existing.orgId, email: existing.email, name: existing.displayName, role: existing.role };
  }

  const email = `maid-${randomUUID().slice(0, 8)}@chairops.local`;
  const { data: authData, error } = await admin.auth.admin.createUser({
    email,
    password: `Ch${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    email_confirm: true,
  });
  if (error || !authData?.user) return null;
  try {
    const row = await prisma.chairopsUser.create({
      data: {
        orgId,
        authUserId: authData.user.id,
        email,
        displayName,
        role: ChairopsUserRole.MAID,
        lineUserId,
        primaryBranchId: null,
        isActive: true,
      },
      select: { id: true, orgId: true, email: true, displayName: true, role: true },
    });
    return { id: row.id, orgId: row.orgId, email: row.email, name: row.displayName, role: row.role };
  } catch {
    // Race on @@unique([orgId, lineUserId]) — roll back auth user + reuse row.
    await admin.auth.admin.deleteUser(authData.user.id).catch(() => {});
    const again = await prisma.chairopsUser.findFirst({
      where: { orgId, lineUserId },
      select: { id: true, orgId: true, email: true, displayName: true, role: true },
    });
    return again ? { id: again.id, orgId: again.orgId, email: again.email, name: again.displayName, role: again.role } : null;
  }
}

const Schema = z.object({
  idToken: z.string().min(20).max(4096),
  displayName: z.string().max(120).optional(),
  // Optional post-login landing path (e.g. "/chairops/m/collect/new" for the
  // ChairOps Rich Menu deep-link). Must be a same-origin relative path.
  redirectTo: z.string().max(512).optional(),
  // Optional signed maid-invite token (admin onboarding link) — binds this
  // verified LINE id to the ChairopsUser in the token.
  invite: z.string().max(512).optional(),
});

// Only allow same-origin relative paths — never an absolute URL or "//host".
function safeRelPath(p: string | undefined): string {
  if (!p || !p.startsWith("/") || p.startsWith("//")) return "/liff/status";
  return p;
}

// Verify LINE id_token via official endpoint
// Returns the verified payload { sub, name, ... } or null if invalid
async function verifyLineIdToken(
  idToken: string,
): Promise<{ sub: string; name?: string } | null> {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) return null;
  // LIFF ID format: "{channelId}-{liffAppId}" — LINE verify expects channelId
  const channelId = liffId.split("-")[0];
  if (!channelId) return null;
  try {
    const r = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { sub?: string; name?: string };
    if (!j.sub) return null;
    return { sub: j.sub, name: j.name };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูล LINE ไม่ครบ" }, { status: 400 });
  }
  const { idToken, displayName, redirectTo, invite } = parsed.data;

  // Verify token via LINE — only proceed if signature is valid + sub returned
  const verified = await verifyLineIdToken(idToken);
  if (!verified) {
    return NextResponse.json(
      { error: "LINE token ไม่ถูกต้อง" },
      { status: 401 },
    );
  }
  const lineUserId = verified.sub;
  const admin = adminClient();

  // Resolve the LINE user against TWO identity stores:
  //   1) Pool `users.line_user_id` — office staff / managers (have a Pool row)
  //   2) ChairOps `ChairopsUser.lineUserId` — maids/techs (auth-only, no Pool row)
  // Both ultimately log into the same Supabase auth user (by email), so the
  // magic-link flow below is identical for either source.
  type Resolved = { id: string; orgId: string; email: string | null; name: string; role: string };
  let resolved: Resolved | null = null;

  // 0) Invite path — a signed admin onboarding link. Binds this verified LINE
  //    id to the ChairopsUser named in the token (first tap wins; a different
  //    LINE id can't hijack an already-bound maid).
  if (invite) {
    const targetId = verifyInvite(invite);
    if (!targetId) {
      return NextResponse.json(
        { error: "ลิงก์เชิญหมดอายุหรือไม่ถูกต้อง" },
        { status: 400 },
      );
    }
    const maid = await prisma.chairopsUser.findFirst({
      where: { id: targetId, isActive: true },
      select: { id: true, orgId: true, email: true, displayName: true, role: true, lineUserId: true },
    });
    if (!maid) {
      return NextResponse.json({ error: "ไม่พบบัญชีในลิงก์เชิญ" }, { status: 404 });
    }
    if (maid.lineUserId && maid.lineUserId !== lineUserId) {
      return NextResponse.json(
        { error: "ลิงก์นี้ถูกใช้ผูกกับ LINE อื่นไปแล้ว" },
        { status: 409 },
      );
    }
    if (!maid.lineUserId) {
      try {
        await prisma.chairopsUser.update({
          where: { id: maid.id },
          data: { lineUserId },
        });
      } catch {
        return NextResponse.json(
          { error: "LINE นี้ถูกผูกกับบัญชีอื่นแล้ว" },
          { status: 409 },
        );
      }
    }
    resolved = {
      id: maid.id,
      orgId: maid.orgId,
      email: maid.email,
      name: maid.displayName,
      role: maid.role,
    };
  }

  if (!resolved) {
    const { data: poolUser } = await admin
      .from("users")
      .select("id, org_id, email, name, role, is_active")
      .eq("line_user_id", lineUserId)
      .eq("is_active", true)
      .maybeSingle();
    if (poolUser) {
      resolved = {
        id: poolUser.id,
        orgId: poolUser.org_id,
        email: poolUser.email,
        name: poolUser.name,
        role: poolUser.role,
      };
    } else {
      const maid = await prisma.chairopsUser.findFirst({
        where: { lineUserId, isActive: true },
        select: { id: true, orgId: true, email: true, displayName: true, role: true },
      });
      if (maid) {
        resolved = {
          id: maid.id,
          orgId: maid.orgId,
          email: maid.email,
          name: maid.displayName,
          role: maid.role,
        };
      }
    }
  }

  // ChairOps context (deep-link into /chairops/*) + still unbound → self-register
  // a branchless MAID from the verified LINE identity. Office assigns a branch
  // to activate. (Recruit/generic LIFF has no /chairops next → not triggered.)
  if (!resolved && (redirectTo ?? "").startsWith("/chairops")) {
    resolved = await selfRegisterChairopsMaid(
      admin,
      lineUserId,
      verified.name ?? displayName ?? null,
    );
  }

  if (!resolved) {
    // Unbound — surface the verified LINE id so the LIFF page can show it for
    // the office to bind (admin-only · see /chairops/users/[id]).
    return NextResponse.json(
      { matched: false, needsLink: true, hint: displayName ?? null, lineUserId },
      { status: 200 },
    );
  }

  // Generate magic link via Supabase admin (so the LIFF page can open it once)
  // We hit Supabase REST through the admin client. If the user has no email,
  // skip — branch_manager can fall back to /login from the LIFF.
  if (!resolved.email) {
    return NextResponse.json({
      matched: true,
      needsLink: false,
      ready: false,
      message: "บัญชีนี้ยังไม่ได้ตั้ง email — ให้ admin ผูก email ก่อน",
    });
  }

  // Use Supabase Auth Admin API to generate a magic link
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "magiclink",
        email: resolved.email,
        // Pin redirect to the same origin the LIFF page is running on
        // (Supabase otherwise uses the dashboard "Site URL" which can drift).
        // Route through /auth/liff-complete: it captures the session from the
        // magic-link URL fragment (writes cookies) then forwards to `next`.
        // Landing directly on the destination loses the session (no browser
        // Supabase client there → fragment ignored → 404/bounce).
        redirect_to: `${getRequestBaseUrl(req)}/auth/liff-complete?next=${encodeURIComponent(
          safeRelPath(redirectTo),
        )}`,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[line-login] magiclink", res.status, errText);
      return NextResponse.json(
        { error: "สร้างลิงก์ login ไม่ได้" },
        { status: 502 },
      );
    }
    const j = (await res.json()) as { properties?: { action_link?: string } };
    const link = j.properties?.action_link;
    if (!link) {
      return NextResponse.json(
        { error: "ลิงก์ login หาย" },
        { status: 502 },
      );
    }
    await audit({
      orgId: resolved.orgId,
      userId: resolved.id,
      action: "LOGIN",
      resourceType: "line_login",
      resourceId: resolved.id,
      diff: { new: { via: "line_liff" } },
    });
    // Don't return the Supabase action_link in the JSON response — anything
    // that can read the response (XSS, browser extension, leaked log) becomes
    // that user. Stash the link in a short-lived httpOnly cookie and have the
    // client navigate to a server route that consumes it via 302.
    const response = NextResponse.json({
      matched: true,
      needsLink: false,
      ready: true,
      completeUrl: "/api/auth/line-complete",
      user: { id: resolved.id, name: resolved.name, role: resolved.role },
    });
    response.cookies.set("ll_pending", link, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/auth/line-complete",
      maxAge: 60, // single-use, expires fast
    });
    return response;
  } catch (err) {
    console.error("[line-login]", err);
    return NextResponse.json({ error: "ติดต่อ auth ไม่ได้" }, { status: 500 });
  }
}
