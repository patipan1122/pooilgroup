// POST /api/admin/users/bulk
// Apply same action to multiple users at once.
// Actions: lock | unlock | force_logout | resend_invite

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

const Schema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(["lock", "unlock", "force_logout", "resend_invite"]),
});

function makeToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: NextRequest) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const { userIds, action } = parsed.data;
  const admin = adminClient();
  const orgId = session.user.org_id;

  // Confirm all users belong to same org + filter out super_admin (protected)
  const { data: targets } = await admin
    .from("users")
    .select("id, role, is_active")
    .in("id", userIds)
    .eq("org_id", orgId);

  if (!targets || targets.length === 0) {
    return NextResponse.json({ error: "ไม่พบผู้ใช้" }, { status: 404 });
  }

  // Filter: cannot apply destructive actions to other super_admins
  const eligible = targets.filter((u) => {
    if (action === "lock" || action === "force_logout") {
      return !(u.role === "super_admin" && u.id !== session.user.id);
    }
    return true;
  });

  const eligibleIds = eligible.map((u) => u.id);
  if (eligibleIds.length === 0) {
    return NextResponse.json(
      { error: "ไม่มีผู้ใช้ที่สามารถดำเนินการได้" },
      { status: 403 },
    );
  }

  const now = new Date().toISOString();
  let result: { processed: number; skipped: number };

  switch (action) {
    case "lock": {
      await admin
        .from("users")
        .update({ is_active: false, updated_at: now })
        .in("id", eligibleIds);
      // Also revoke their sessions
      await admin
        .from("user_sessions")
        .update({ is_revoked: true, logout_at: now })
        .in("user_id", eligibleIds)
        .eq("is_revoked", false);
      result = {
        processed: eligibleIds.length,
        skipped: targets.length - eligibleIds.length,
      };
      break;
    }
    case "unlock": {
      await admin
        .from("users")
        .update({ is_active: true, locked_until: null, updated_at: now })
        .in("id", eligibleIds);
      result = {
        processed: eligibleIds.length,
        skipped: targets.length - eligibleIds.length,
      };
      break;
    }
    case "force_logout": {
      await admin
        .from("user_sessions")
        .update({ is_revoked: true, logout_at: now })
        .in("user_id", eligibleIds)
        .eq("is_revoked", false);
      // Best-effort: invalidate Supabase Auth tokens
      for (const uid of eligibleIds) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin.auth.admin as any).signOut(uid);
        } catch {
          /* noop */
        }
      }
      result = {
        processed: eligibleIds.length,
        skipped: targets.length - eligibleIds.length,
      };
      break;
    }
    case "resend_invite": {
      // Only re-issue tokens for pending users (is_active=false, no invite_used)
      const pending = eligible.filter((u) => !u.is_active);
      const updates = pending.map((u) => ({
        id: u.id,
        invite_token: makeToken(),
        invite_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        updated_at: now,
      }));
      // Update one-by-one (no bulk update for distinct values in supabase-js)
      for (const u of updates) {
        await admin
          .from("users")
          .update({
            invite_token: u.invite_token,
            invite_expires_at: u.invite_expires_at,
            updated_at: u.updated_at,
          })
          .eq("id", u.id);
      }
      result = {
        processed: pending.length,
        skipped: targets.length - pending.length,
      };
      break;
    }
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: "DEACTIVATE_USER",
    resourceType: "user_bulk",
    resourceId: undefined,
    diff: {
      new: { action, processed: result.processed, skipped: result.skipped },
    },
  });

  return NextResponse.json({ success: true, ...result });
}
