import Link from "next/link";
import { notFound } from "next/navigation";
import {Mail, Phone, Calendar, ShieldAlert } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { bkkDateTime } from "@/lib/utils/format";
import { UserDetailActions } from "./detail-actions";
import { BackButton } from "@/components/ui/back-button";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  org_admin: "Admin",
  branch_manager: "Manager",
  staff: "Staff",
  driver: "Driver",
  viewer: "Viewer",
};

const ROLE_TONE: Record<string, "brand" | "neutral" | "warning" | "info"> = {
  super_admin: "warning",
  org_admin: "warning",
  branch_manager: "brand",
  staff: "info",
  driver: "info",
  viewer: "neutral",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: Props) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const { id } = await params;
  const admin = adminClient();

  const { data: user } = await admin
    .from("users")
    .select(
      "id, email, name, phone, role, is_active, last_login_at, line_user_id, telegram_user_id, locked_until, failed_login_count, invite_token, invite_expires_at, invite_used_at, created_at",
    )
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!user) notFound();

  const { data: branchLinks } = await admin
    .from("user_branches")
    .select("branch_id, is_active, branches(id, code, name, business_type)")
    .eq("user_id", id)
    .eq("is_active", true);

  const { data: allBranches } = await admin
    .from("branches")
    .select("id, code, name, business_type")
    .eq("org_id", session.user.org_id)
    .eq("is_active", true)
    .order("code");

  const { data: recentSessions } = await admin
    .from("user_sessions")
    .select("id, device, ip_address, login_at, logout_at, is_revoked")
    .eq("user_id", id)
    .order("login_at", { ascending: false })
    .limit(5);

  const isPendingInvite = !user.is_active && !user.invite_used_at;
  const isLocked = user.locked_until && new Date(user.locked_until) > new Date();

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <BackButton label="กลับไปรายชื่อ" fallbackHref="/users" />

      <header className="flex items-start justify-between flex-wrap gap-4 mb-6 animate-fade-up">
        <div className="flex items-start gap-4">
          <div className="size-16 rounded-2xl bg-[var(--color-brand-100)] text-[var(--color-brand-700)] flex items-center justify-center text-2xl font-bold border-2 border-[var(--color-brand-200)]">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display">
              {user.name}
            </h1>
            <div className="flex items-center gap-2 mt-2">
              <Badge tone={ROLE_TONE[user.role] ?? "neutral"}>
                {ROLE_LABEL[user.role] ?? user.role}
              </Badge>
              {!user.is_active && (
                <Badge tone="neutral">
                  {isPendingInvite ? "รออนุมัติ Invite" : "ปิดใช้งาน"}
                </Badge>
              )}
              {isLocked && <Badge tone="danger">ถูกล็อก</Badge>}
            </div>
          </div>
        </div>
        <UserDetailActions
          userId={user.id}
          isActive={user.is_active}
          isPendingInvite={isPendingInvite}
          isSelf={user.id === session.user.id}
          canImpersonate={
            (session.actingAs?.realUser.role ?? session.user.role) ===
            "super_admin"
          }
        />
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Contact */}
        <Card className="animate-fade-up delay-100">
          <CardHeader>
            <CardTitle>ข้อมูลติดต่อ</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <div className="flex items-center gap-2.5">
              <Mail className="size-4 text-zinc-400" />
              <span className="text-zinc-900">{user.email ?? "—"}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Phone className="size-4 text-zinc-400" />
              <span className="text-zinc-900">{user.phone ?? "—"}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Calendar className="size-4 text-zinc-400" />
              <span className="text-zinc-900">
                สมัครเมื่อ {bkkDateTime(user.created_at)}
              </span>
            </div>
          </CardBody>
        </Card>

        {/* Channels */}
        <Card className="animate-fade-up delay-150">
          <CardHeader>
            <CardTitle>ช่องทางแจ้งเตือน</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span>LINE</span>
              {user.line_user_id ? (
                <Badge tone="success">ผูกแล้ว</Badge>
              ) : (
                <Badge tone="neutral">ยังไม่ผูก</Badge>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span>Telegram</span>
              {user.telegram_user_id ? (
                <Badge tone="success">ผูกแล้ว</Badge>
              ) : (
                <Badge tone="neutral">ยังไม่ผูก</Badge>
              )}
            </div>
            <p className="text-xs text-zinc-400 pt-2">
              ผู้ใช้ผูกเองที่หน้าโปรไฟล์ + Telegram bot /start
            </p>
          </CardBody>
        </Card>

        {/* Branches */}
        <Card className="animate-fade-up delay-200">
          <CardHeader>
            <CardTitle>สาขาที่ดูแล</CardTitle>
            <Badge tone="brand">{branchLinks?.length ?? 0}</Badge>
          </CardHeader>
          <CardBody>
            {!branchLinks || branchLinks.length === 0 ? (
              <p className="text-sm text-zinc-500">
                ยังไม่ได้กำหนดสาขา — กดแก้ไขเพื่อเลือก
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {branchLinks.map((b) => {
                  const branch = b.branches as unknown as
                    | { code: string; name: string }
                    | { code: string; name: string }[]
                    | null;
                  const arr = Array.isArray(branch) ? branch : branch ? [branch] : [];
                  return arr.map((br) => (
                    <Link
                      key={b.branch_id}
                      href={`/branches/${b.branch_id}`}
                      className="text-xs rounded-lg bg-zinc-100 px-2 py-1 font-medium hover:bg-[var(--color-brand-100)] transition-colors"
                    >
                      {br.code} · {br.name}
                    </Link>
                  ));
                })}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Login activity */}
        <Card className="animate-fade-up delay-250">
          <CardHeader>
            <CardTitle>กิจกรรมล่าสุด</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">เข้าใช้ล่าสุด</span>
              <span className="font-medium">
                {user.last_login_at ? bkkDateTime(user.last_login_at) : "ยังไม่เคย"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">รหัสผิดสะสม</span>
              <span className="font-medium tabular-num">
                {user.failed_login_count}
              </span>
            </div>
            {recentSessions && recentSessions.length > 0 && (
              <div className="pt-3 border-t border-zinc-100 space-y-1.5">
                <p className="text-xs uppercase tracking-wider text-zinc-500 font-bold">
                  5 อุปกรณ์ล่าสุด
                </p>
                {recentSessions.map((s) => (
                  <div key={s.id} className="text-xs flex justify-between">
                    <span className="text-zinc-700">{s.device || "ไม่ทราบ"}</span>
                    <span className="text-zinc-400">{bkkDateTime(s.login_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Quick links: drill into related data */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 animate-fade-up delay-300">
        <Link
          href={`/audit?user=${user.id}`}
          className="rounded-xl border-2 border-zinc-200 bg-white px-4 py-3 hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/40 transition-colors text-sm font-bold text-zinc-800 inline-flex items-center justify-between"
        >
          <span>Audit log ของคนนี้</span>
          <span className="text-zinc-400">→</span>
        </Link>
        <Link
          href={`/cashhub/reports?submitted_by=${user.id}`}
          className="rounded-xl border-2 border-zinc-200 bg-white px-4 py-3 hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/40 transition-colors text-sm font-bold text-zinc-800 inline-flex items-center justify-between"
        >
          <span>รายงานที่ส่ง</span>
          <span className="text-zinc-400">→</span>
        </Link>
        <Link
          href={`/cashhub/reports?approved_by=${user.id}`}
          className="rounded-xl border-2 border-zinc-200 bg-white px-4 py-3 hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/40 transition-colors text-sm font-bold text-zinc-800 inline-flex items-center justify-between"
        >
          <span>รายงานที่อนุมัติ</span>
          <span className="text-zinc-400">→</span>
        </Link>
      </div>

      {isPendingInvite && (
        <div className="mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3 animate-fade-up delay-300">
          <ShieldAlert className="size-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800">
              ผู้ใช้ยังไม่ได้กดยืนยัน invite link
            </p>
            <p className="text-amber-700 text-xs mt-0.5">
              ลิงก์หมดอายุ:{" "}
              {user.invite_expires_at ? bkkDateTime(user.invite_expires_at) : "—"} —
              ถ้าหมดอายุแล้วกด "ส่งลิงก์ใหม่" ที่ปุ่มด้านบน
            </p>
          </div>
        </div>
      )}

      {/* Hidden form for branch IDs — used by edit modal in actions */}
      <input
        type="hidden"
        id="all-branches"
        value={JSON.stringify(allBranches ?? [])}
        readOnly
      />
    </div>
  );
}
