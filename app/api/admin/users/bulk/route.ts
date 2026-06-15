// POST /api/admin/users/bulk
// Apply same action to multiple users at once.
// Actions: lock | unlock | force_logout | resend_invite | delete
//
// "delete" = HARD delete (row removed permanently). super_admin ONLY.
// Protected by Postgres FK ON DELETE RESTRICT: users who created work history
// (daily reports, recruit/clawfleet records, …) cannot be deleted — the DB
// blocks it and we report them as "blocked" so the admin uses "ปิดบัญชี" instead.
// Audit logs of deleted users are preserved (their FK is ON DELETE SetNull).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

const Schema = z.object({
  userIds: z.array(zUUID()).min(1).max(100),
  action: z.enum([
    "lock",
    "unlock",
    "force_logout",
    "resend_invite",
    "delete",
  ]),
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

  // Hard delete is super_admin-only. Gate on the SURFACE role so a super_admin
  // who is impersonating an admin is blocked too (they see the admin's view).
  // [[ledgerline-superadmin-only-connection-gating]] — two-layer lock (UI + server).
  if (action === "delete" && session.user.role !== "super_admin") {
    return NextResponse.json(
      { error: "เฉพาะ Super Admin เท่านั้นที่ลบผู้ใช้ถาวรได้" },
      { status: 403 },
    );
  }

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
    // Hard delete: never the caller themselves, never ANY super_admin.
    if (action === "delete") {
      return u.id !== session.user.id && u.role !== "super_admin";
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
  // For "delete": how many were skipped specifically because the DB blocked
  // them (FK RESTRICT — they have work history). Reported separately so the UI
  // can tell the admin "use ปิดบัญชี instead".
  let blockedByHistory = 0;

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
      // Best-effort: invalidate Supabase Auth tokens (parallel — was N×50ms sequential)
      await Promise.all(
        eligibleIds.map(async (uid) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin.auth.admin as any).signOut(uid);
          } catch {
            /* noop */
          }
        }),
      );
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
      // Each row has a distinct invite_token → can't batch into a single SQL
      // update. Parallelize instead (was N×50ms sequential).
      await Promise.all(
        updates.map((u) =>
          admin
            .from("users")
            .update({
              invite_token: u.invite_token,
              invite_expires_at: u.invite_expires_at,
              updated_at: u.updated_at,
            })
            .eq("id", u.id),
        ),
      );
      result = {
        processed: pending.length,
        skipped: targets.length - pending.length,
      };
      break;
    }
    case "delete": {
      // Revoke sessions first (best-effort) so a deleted user is kicked even if
      // their row removal races a live request.
      await admin
        .from("user_sessions")
        .update({ is_revoked: true, logout_at: now })
        .in("user_id", eligibleIds)
        .eq("is_revoked", false);

      // Delete one-by-one: a single .in() delete is one transaction, so ONE
      // user with protected history (FK RESTRICT) would abort the whole batch.
      // Per-row lets the clean ones through and reports the blocked ones.
      const outcomes = await Promise.all(
        eligibleIds.map(async (uid) => {
          const { error } = await admin
            .from("users")
            .delete()
            .eq("id", uid)
            .eq("org_id", orgId);
          if (error) {
            // 23503 = foreign_key_violation → user has work history (RESTRICT)
            return { ok: false, history: error.code === "23503" };
          }
          // Best-effort: drop the Supabase Auth identity too
          try {
            await admin.auth.admin.deleteUser(uid);
          } catch {
            /* no auth identity / already gone — ignore */
          }
          return { ok: true, history: false };
        }),
      );
      const deleted = outcomes.filter((o) => o.ok).length;
      blockedByHistory = outcomes.filter((o) => !o.ok && o.history).length;
      const otherFailed = outcomes.filter((o) => !o.ok && !o.history).length;
      result = {
        processed: deleted,
        skipped:
          targets.length - eligibleIds.length + blockedByHistory + otherFailed,
      };
      break;
    }
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: action === "delete" ? "DELETE_USER" : "DEACTIVATE_USER",
    resourceType: "user_bulk",
    resourceId: undefined,
    diff: {
      new: {
        action,
        processed: result.processed,
        skipped: result.skipped,
        ...(action === "delete" ? { userIds: eligibleIds } : {}),
      },
    },
  });

  return NextResponse.json({ success: true, ...result, blockedByHistory });
}
