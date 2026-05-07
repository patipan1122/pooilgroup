// GET /api/admin/users/export
// Download all users as CSV (for HR / payroll / records)
// Includes: code, name, role, branches, contact, status, last login

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { formatInTimeZone } from "date-fns-tz";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

function quote(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  org_admin: "Admin",
  area_manager: "ผู้จัดการเขต",
  branch_manager: "ผู้จัดการสาขา",
  staff: "พนักงาน",
  driver: "คนขับ",
  viewer: "ผู้ดู",
};

export async function GET() {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const admin = adminClient();
  const orgId = session.user.org_id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: users } = await (admin.from as any)("users")
    .select(
      "id, name, employee_code, email, phone, role, is_active, line_user_id, telegram_user_id, invite_used_at, last_login_at, created_at",
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  const userList = (users ?? []) as Array<{
    id: string;
    name: string;
    employee_code: string | null;
    email: string | null;
    phone: string | null;
    role: string;
    is_active: boolean;
    line_user_id: string | null;
    telegram_user_id: string | null;
    invite_used_at: string | null;
    last_login_at: string | null;
    created_at: string;
  }>;

  // Get branches assigned to each user
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ubData } = await (admin.from as any)("user_branches")
    .select("user_id, branch_id, branches(code)")
    .eq("org_id", orgId)
    .eq("is_active", true);

  const branchesByUser = new Map<string, string[]>();
  for (const ub of (ubData ?? []) as Array<{
    user_id: string;
    branch_id: string;
    branches: { code: string } | { code: string }[] | null;
  }>) {
    const b = Array.isArray(ub.branches) ? ub.branches[0] : ub.branches;
    if (!b) continue;
    if (!branchesByUser.has(ub.user_id)) branchesByUser.set(ub.user_id, []);
    branchesByUser.get(ub.user_id)!.push(b.code);
  }

  const headers = [
    "employee_code",
    "name",
    "email",
    "phone",
    "role",
    "role_label",
    "branches",
    "status",
    "channels",
    "last_login",
    "created_at",
  ];

  const lines: string[] = [headers.join(",")];
  for (const u of userList) {
    const channels = [
      u.line_user_id ? "LINE" : null,
      u.telegram_user_id ? "Telegram" : null,
    ]
      .filter(Boolean)
      .join("|");
    const status = !u.is_active
      ? "ปิดบัญชี"
      : u.invite_used_at
        ? "ใช้งาน"
        : "รอ activate";
    lines.push(
      [
        quote(u.employee_code),
        quote(u.name),
        quote(u.email),
        quote(u.phone),
        quote(u.role),
        quote(ROLE_LABEL[u.role] ?? u.role),
        quote((branchesByUser.get(u.id) ?? []).join(",")),
        quote(status),
        quote(channels),
        quote(u.last_login_at ? formatInTimeZone(u.last_login_at, TZ, "yyyy-MM-dd HH:mm") : ""),
        quote(u.created_at ? formatInTimeZone(u.created_at, TZ, "yyyy-MM-dd HH:mm") : ""),
      ].join(","),
    );
  }
  const csv = lines.join("\n");
  // Add UTF-8 BOM so Excel opens Thai correctly
  const body = "﻿" + csv;

  await audit({
    orgId,
    userId: session.user.id,
    action: "EXPORT_DATA",
    resourceType: "users",
    diff: { new: { count: userList.length, format: "csv" } },
  });

  const filename = `pooilgroup-users-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
