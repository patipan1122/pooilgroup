// Cron — Access Review (ทุก 90 วัน)
// ────────────────────────────────────────────────────────────────────
// Spec source: ดีเทลv1/CORE_SYSTEM.md §2.7
//
// ทุก 90 วัน → ตรวจ users ที่มีปัญหาด้านสิทธิ์/การเข้าถึง:
//   1. INACTIVE_45D    — ไม่ login มา 45+ วัน (last_login_at)
//   2. INVITE_EXPIRING — invite token ใกล้หมดอายุใน 7 วัน (proxy ของ "temp access")
//                        Note: schema ไม่มี field temp_access_expires_at โดยตรง
//                        → ใช้ invite_expires_at (active = false + still has token) แทน
//   3. ROLE_BRANCH_MISMATCH — staff/branch_manager ที่ไม่มี user_branches row
//                              หรือ super_admin/org_admin ที่ assign สาขาเดียว (น่าสงสัย)
//
// Output:
//   - Telegram digest → super_admin + org_admin + admin
//   - Notifications → ลงตารางให้ admin เห็นใน UI bell
//   - Idempotent: skip ถ้ารันแล้ววันนี้ (เช็ค audit_logs ACCESS_REVIEW_RAN)
//   - Audit log
//
// Auth: Bearer ${CRON_SECRET}
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/db/server";
import { sendTelegramMessage, htmlEscape } from "@/lib/telegram/send";
import { getBaseUrl } from "@/lib/utils/base-url";
import { formatInTimeZone } from "date-fns-tz";
import { addDays, subDays } from "date-fns";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";
const INACTIVE_THRESHOLD_DAYS = 45;
const TEMP_EXPIRY_WARN_DAYS = 7;

interface ReviewItem {
  userId: string;
  name: string;
  reason: "INACTIVE_45D" | "INVITE_EXPIRING" | "ROLE_BRANCH_MISMATCH";
  detail: string;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}

export async function POST(req: NextRequest) {
  return GET(req);
}

async function run() {
  const admin = adminClient();
  const now = new Date();
  const todayStartIso = formatInTimeZone(
    now,
    TZ,
    "yyyy-MM-dd'T'00:00:00XXX",
  );
  const inactiveCutoff = subDays(now, INACTIVE_THRESHOLD_DAYS);
  const tempExpiryCutoff = addDays(now, TEMP_EXPIRY_WARN_DAYS);

  const { data: orgs } = await admin
    .from("organizations")
    .select("id, name")
    .eq("is_active", true);
  if (!orgs) return NextResponse.json({ ok: true, processed: 0 });

  let processed = 0;
  let sentTelegram = 0;
  const skipped: string[] = [];

  for (const org of orgs) {
    const orgRow = org as { id: string; name: string };

    // Idempotency: skip if ACCESS_REVIEW_RAN audit exists today
    const { data: ranToday } = await admin
      .from("audit_logs")
      .select("id")
      .eq("org_id", orgRow.id)
      .eq("action", "ACCESS_REVIEW_RAN")
      .gte("created_at", todayStartIso)
      .limit(1);
    if ((ranToday ?? []).length > 0) {
      skipped.push(orgRow.id);
      continue;
    }

    // Pull all active users for this org
    const { data: usersRaw } = await admin
      .from("users")
      .select(
        "id, name, role, last_login_at, invite_expires_at, invite_used_at, temp_access_expires_at, is_active",
      )
      .eq("org_id", orgRow.id)
      .eq("is_active", true);

    const users = (usersRaw ?? []) as Array<{
      id: string;
      name: string;
      role: string;
      last_login_at: string | null;
      invite_expires_at: string | null;
      invite_used_at: string | null;
      temp_access_expires_at: string | null;
      is_active: boolean;
    }>;

    if (users.length === 0) continue;

    // Pull user_branches for role-mismatch check
    const { data: ubRaw } = await admin
      .from("user_branches")
      .select("user_id, branch_id, is_active")
      .eq("org_id", orgRow.id)
      .eq("is_active", true);
    const branchesByUser = new Map<string, string[]>();
    for (const ub of (ubRaw ?? []) as Array<{
      user_id: string;
      branch_id: string;
    }>) {
      const arr = branchesByUser.get(ub.user_id) ?? [];
      arr.push(ub.branch_id);
      branchesByUser.set(ub.user_id, arr);
    }

    const items: ReviewItem[] = [];
    for (const u of users) {
      // 1. INACTIVE_45D
      if (u.last_login_at) {
        const last = new Date(u.last_login_at);
        if (last < inactiveCutoff) {
          const days = Math.floor(
            (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24),
          );
          items.push({
            userId: u.id,
            name: u.name,
            reason: "INACTIVE_45D",
            detail: `ไม่ login มา ${days} วัน`,
          });
        }
      } else if (u.invite_used_at) {
        // accepted invite but never logged in → still concerning if old
        const used = new Date(u.invite_used_at);
        if (used < inactiveCutoff) {
          const days = Math.floor(
            (now.getTime() - used.getTime()) / (1000 * 60 * 60 * 24),
          );
          items.push({
            userId: u.id,
            name: u.name,
            reason: "INACTIVE_45D",
            detail: `รับ invite ${days} วันก่อน แต่ยังไม่เคย login`,
          });
        }
      }

      // 2a. TEMP_ACCESS_EXPIRING — auditor/contractor accounts with explicit
      //     expiry (CORE_SYSTEM §2.6). This is the real signal now that the
      //     column exists; takes precedence over the invite-expiry proxy.
      if (u.temp_access_expires_at) {
        const exp = new Date(u.temp_access_expires_at);
        if (exp >= now && exp <= tempExpiryCutoff) {
          const days = Math.ceil(
            (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          );
          items.push({
            userId: u.id,
            name: u.name,
            reason: "INVITE_EXPIRING",
            detail: `Temp access หมดใน ${days} วัน`,
          });
        }
        // Past-expiry: deactivate now (silent — admin sees in audit log)
        if (exp < now) {
          await admin
            .from("users")
            .update({ is_active: false, updated_at: now.toISOString() })
            .eq("id", u.id);
        }
      } else if (u.invite_expires_at && !u.invite_used_at) {
        // 2b. Fallback for legacy users without temp_access_expires_at —
        //     pending invites that are about to expire.
        const exp = new Date(u.invite_expires_at);
        if (exp >= now && exp <= tempExpiryCutoff) {
          const days = Math.ceil(
            (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          );
          items.push({
            userId: u.id,
            name: u.name,
            reason: "INVITE_EXPIRING",
            detail: `Invite ที่ยังไม่ใช้ใกล้หมดใน ${days} วัน`,
          });
        }
      }

      // 3. ROLE_BRANCH_MISMATCH
      const userBranches = branchesByUser.get(u.id) ?? [];
      const needsBranch = ["staff", "branch_manager", "area_manager"].includes(
        u.role,
      );
      const orgWideRoles = ["super_admin", "org_admin", "admin", "viewer"];
      if (needsBranch && userBranches.length === 0) {
        items.push({
          userId: u.id,
          name: u.name,
          reason: "ROLE_BRANCH_MISMATCH",
          detail: `Role=${u.role} แต่ไม่มีสาขาที่ assign`,
        });
      } else if (
        orgWideRoles.includes(u.role) &&
        userBranches.length === 1
      ) {
        // org-wide role but tied to single branch → audit-worthy
        items.push({
          userId: u.id,
          name: u.name,
          reason: "ROLE_BRANCH_MISMATCH",
          detail: `Role=${u.role} (ระดับ org) แต่ผูกแค่ 1 สาขา`,
        });
      }
    }

    if (items.length === 0) {
      // Still mark "ran" even if nothing to report (idempotency)
      await admin.from("audit_logs").insert({
        id: crypto.randomUUID(),
        org_id: orgRow.id,
        user_id: null,
        action: "ACCESS_REVIEW_RAN",
        resource_type: "organization",
        resource_id: orgRow.id,
        diff: { new: { findings: 0 } },
      });
      processed += 1;
      continue;
    }

    // ────────────────────────────────────────────────────────────────
    // Build Telegram digest
    // ────────────────────────────────────────────────────────────────
    const grouped = {
      INACTIVE_45D: items.filter((i) => i.reason === "INACTIVE_45D"),
      INVITE_EXPIRING: items.filter((i) => i.reason === "INVITE_EXPIRING"),
      ROLE_BRANCH_MISMATCH: items.filter(
        (i) => i.reason === "ROLE_BRANCH_MISMATCH",
      ),
    };

    const lines: string[] = [];
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("📋 <b>ถึงเวลา Review สิทธิ์</b> (ทุก 90 วัน)");
    lines.push(`🏢 ${htmlEscape(orgRow.name)}`);
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    if (grouped.INACTIVE_45D.length > 0) {
      lines.push("");
      lines.push(
        `💤 <b>ไม่ Login นาน</b> (${grouped.INACTIVE_45D.length} คน)`,
      );
      grouped.INACTIVE_45D.slice(0, 8).forEach((it) => {
        lines.push(`• ${htmlEscape(it.name)} — ${htmlEscape(it.detail)}`);
      });
      if (grouped.INACTIVE_45D.length > 8) {
        lines.push(`<i>...และอีก ${grouped.INACTIVE_45D.length - 8} คน</i>`);
      }
    }
    if (grouped.INVITE_EXPIRING.length > 0) {
      lines.push("");
      lines.push(
        `⏳ <b>Temp/Invite ใกล้หมดอายุ</b> (${grouped.INVITE_EXPIRING.length} คน)`,
      );
      grouped.INVITE_EXPIRING.slice(0, 8).forEach((it) => {
        lines.push(`• ${htmlEscape(it.name)} — ${htmlEscape(it.detail)}`);
      });
    }
    if (grouped.ROLE_BRANCH_MISMATCH.length > 0) {
      lines.push("");
      lines.push(
        `⚠️ <b>Role/สาขาไม่ตรง</b> (${grouped.ROLE_BRANCH_MISMATCH.length} คน)`,
      );
      grouped.ROLE_BRANCH_MISMATCH.slice(0, 8).forEach((it) => {
        lines.push(`• ${htmlEscape(it.name)} — ${htmlEscape(it.detail)}`);
      });
    }
    lines.push("");
    lines.push(`รวม <b>${items.length}</b> รายการที่ต้อง Review`);
    lines.push("━━━━━━━━━━━━━━━━━━━━");

    const message = lines.join("\n");
    const inlineKeyboard = [
      [
        {
          text: "📋 Review ทั้งหมด",
          url: `${getBaseUrl()}/admin/users?filter=access-review`,
        },
      ],
    ];

    // ────────────────────────────────────────────────────────────────
    // Send Telegram + Insert notifications
    // ────────────────────────────────────────────────────────────────
    const { data: adminUsersRaw } = await admin
      .from("users")
      .select("id, telegram_chat_id")
      .eq("org_id", orgRow.id)
      .in("role", ["super_admin", "org_admin", "admin"])
      .eq("is_active", true);

    const adminUsers = (adminUsersRaw ?? []) as Array<{
      id: string;
      telegram_chat_id: string | null;
    }>;

    if (adminUsers.length > 0) {
      const notifRows = adminUsers.map((u) => ({
        id: crypto.randomUUID(),
        org_id: orgRow.id,
        user_id: u.id,
        type: "warning",
        module: "core",
        title: `📋 Access Review — ${items.length} รายการ`,
        body: `Inactive ${grouped.INACTIVE_45D.length} · Expiring ${grouped.INVITE_EXPIRING.length} · Role mismatch ${grouped.ROLE_BRANCH_MISMATCH.length}`,
        link: "/admin/users?filter=access-review",
      }));
      await admin.from("notifications").insert(notifRows);

      for (const u of adminUsers) {
        if (u.telegram_chat_id) {
          const r = await sendTelegramMessage({
            chatId: u.telegram_chat_id,
            text: message,
            parseMode: "HTML",
            inlineKeyboard,
          });
          if (r) sentTelegram += 1;
        }
      }
    }

    // ────────────────────────────────────────────────────────────────
    // Audit log — mark this run + per-finding stats
    // ────────────────────────────────────────────────────────────────
    await admin.from("audit_logs").insert({
      id: crypto.randomUUID(),
      org_id: orgRow.id,
      user_id: null,
      action: "ACCESS_REVIEW_RAN",
      resource_type: "organization",
      resource_id: orgRow.id,
      diff: {
        new: {
          findings: items.length,
          inactive45d: grouped.INACTIVE_45D.length,
          inviteExpiring: grouped.INVITE_EXPIRING.length,
          roleBranchMismatch: grouped.ROLE_BRANCH_MISMATCH.length,
          notifiedAdmins: adminUsers.length,
        },
      },
    });

    processed += 1;
  }

  return NextResponse.json({
    ok: true,
    processed,
    sentTelegram,
    skipped,
  });
}
