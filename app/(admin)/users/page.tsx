import Link from "next/link";
import { CheckCircle2, XCircle, UserPlus, Users, Inbox } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { bkkDate, thaiDateLong } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

const ROLE_TONE: Record<string, "brand" | "neutral" | "warning" | "info"> = {
  super_admin: "warning",
  org_admin: "warning",
  branch_manager: "brand",
  staff: "info",
  driver: "info",
  viewer: "neutral",
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  org_admin: "Admin",
  branch_manager: "Manager",
  staff: "Staff",
  driver: "Driver",
  viewer: "Viewer",
};

interface UserRow {
  id: string;
  email: string | null;
  name: string;
  phone: string | null;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
  line_user_id: string | null;
  telegram_user_id: string | null;
}

export default async function UsersListPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();

  const { data } = await admin
    .from("users")
    .select(
      "id, email, name, phone, role, is_active, last_login_at, created_at, line_user_id, telegram_user_id",
    )
    .eq("org_id", session.user.org_id)
    .order("created_at", { ascending: false });

  const { count: pendingRequests } = await admin
    .from("register_requests")
    .select("id", { count: "exact", head: true })
    .eq("org_id", session.user.org_id)
    .eq("status", "pending");

  const list = (data ?? []) as UserRow[];
  const active = list.filter((u) => u.is_active);
  const byRole: Record<string, number> = {};
  for (const u of active) byRole[u.role] = (byRole[u.role] ?? 0) + 1;

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto">
      <header className="mb-8 animate-fade-up flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[--color-brand-600] font-bold">
            จัดการระบบ · {thaiDateLong(new Date())}
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display mt-2">
            ผู้ใช้ <span className="accent">ทั้งหมด</span>
          </h1>
          <p className="text-zinc-600 mt-2">
            {active.length} บัญชีใช้งาน ·{" "}
            {Object.entries(byRole)
              .map(([r, c]) => `${ROLE_LABEL[r]} ${c}`)
              .join(" · ")}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/users/requests"
            className="inline-flex items-center gap-2 px-4 h-12 rounded-xl border-2 border-zinc-200 bg-white font-semibold hover:border-[--color-brand-300] hover:bg-[--color-brand-50]/40 transition-colors text-sm relative"
          >
            <Inbox className="size-4" />
            คำขอใหม่
            {(pendingRequests ?? 0) > 0 && (
              <span className="ml-1 inline-flex items-center justify-center size-5 rounded-full bg-[--color-danger] text-white text-[10px] font-bold">
                {pendingRequests}
              </span>
            )}
          </Link>
          <Link
            href="/users/new"
            className="inline-flex items-center gap-2 px-5 h-12 rounded-xl bg-[--color-brand-600] text-white font-bold hover:bg-[--color-brand-700] shadow-blue transition-colors"
          >
            <UserPlus className="size-5" />
            เชิญผู้ใช้ใหม่
          </Link>
        </div>
      </header>

      <Section
        number="01"
        label="OVERVIEW"
        title="แยกตามบทบาท"
        className="mb-8 animate-fade-up delay-100"
      >
        <div className="flex flex-wrap gap-2">
          {Object.entries(byRole).map(([role, count]) => (
            <div
              key={role}
              className="flex items-center gap-2 rounded-xl border-2 border-zinc-200 bg-white px-4 py-2.5"
            >
              <Badge tone={ROLE_TONE[role] ?? "neutral"}>
                {ROLE_LABEL[role] ?? role}
              </Badge>
              <span className="text-lg font-extrabold tabular-num">{count}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        number="02"
        label="LIST"
        title="รายชื่อผู้ใช้"
        description="คลิกเชิญผู้ใช้ใหม่ที่มุมขวาบน · invite link หมดอายุ 48 ชั่วโมง"
        className="animate-fade-up delay-200"
      >
        {list.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" />}
            title="ยังไม่มีผู้ใช้"
            description="เชิญผู้ใช้คนแรกเข้าระบบเพื่อเริ่มต้น"
          />
        ) : (
          <DataTable
            rows={list}
            rowKey={(u) => u.id}
            rowHref={(u) => `/users/${u.id}`}
            columns={[
              {
                key: "avatar",
                header: "",
                cell: (u) => (
                  <div className="size-10 rounded-full bg-[--color-brand-100] text-[--color-brand-700] flex items-center justify-center font-bold border-2 border-[--color-brand-200]">
                    {u.name.charAt(0).toUpperCase()}
                  </div>
                ),
                className: "w-12",
              },
              {
                key: "name",
                header: "ชื่อ",
                cell: (u) => (
                  <div>
                    <div className="font-bold truncate">{u.name}</div>
                    <div className="text-xs text-zinc-500 truncate mt-0.5">
                      {u.email ?? u.phone ?? "—"}
                    </div>
                  </div>
                ),
              },
              {
                key: "role",
                header: "บทบาท",
                cell: (u) => (
                  <Badge tone={ROLE_TONE[u.role] ?? "neutral"}>
                    {ROLE_LABEL[u.role] ?? u.role}
                  </Badge>
                ),
              },
              {
                key: "channels",
                header: "Channels",
                cell: (u) => (
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={
                        u.line_user_id
                          ? "inline-flex items-center gap-0.5 text-green-700 font-semibold"
                          : "inline-flex items-center gap-0.5 text-zinc-400"
                      }
                    >
                      {u.line_user_id ? (
                        <CheckCircle2 className="size-3" />
                      ) : (
                        <XCircle className="size-3" />
                      )}
                      LINE
                    </span>
                    <span
                      className={
                        u.telegram_user_id
                          ? "inline-flex items-center gap-0.5 text-green-700 font-semibold"
                          : "inline-flex items-center gap-0.5 text-zinc-400"
                      }
                    >
                      {u.telegram_user_id ? (
                        <CheckCircle2 className="size-3" />
                      ) : (
                        <XCircle className="size-3" />
                      )}
                      Telegram
                    </span>
                  </div>
                ),
              },
              {
                key: "status",
                header: "สถานะ",
                cell: (u) =>
                  !u.is_active ? (
                    <Badge tone="neutral">ปิด</Badge>
                  ) : (
                    <Badge tone="success">ใช้งาน</Badge>
                  ),
              },
              {
                key: "lastLogin",
                header: "เข้าล่าสุด",
                align: "right",
                cell: (u) => (
                  <span className="text-xs text-zinc-500 tabular-num">
                    {u.last_login_at ? bkkDate(u.last_login_at) : "ยังไม่ Login"}
                  </span>
                ),
              },
            ]}
          />
        )}
      </Section>
    </div>
  );
}
