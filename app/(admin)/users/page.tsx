import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { bkkDate } from "@/lib/utils/format";
import { CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";

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

export default async function UsersListPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();

  const { data: users } = await admin
    .from("users")
    .select(
      "id, email, name, phone, role, is_active, last_login_at, created_at, line_user_id, telegram_user_id",
    )
    .eq("org_id", session.user.org_id)
    .order("created_at", { ascending: false });

  const list = users ?? [];
  const active = list.filter((u) => u.is_active);
  const byRole: Record<string, number> = {};
  for (const u of active) byRole[u.role] = (byRole[u.role] ?? 0) + 1;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-6 flex items-end justify-between flex-wrap gap-3 animate-fade-up">
        <div>
          <p className="text-xs uppercase tracking-widest text-[--color-brand-600] font-semibold">
            ผู้ใช้งาน
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
            จัดการ <span className="accent">บัญชี</span>
          </h1>
          <p className="text-zinc-600 mt-2 text-sm">
            ทั้งหมด {active.length} บัญชี · {Object.entries(byRole).map(([r, c]) => `${ROLE_LABEL[r]} ${c}`).join(" · ")}
          </p>
        </div>
        <Link
          href="/users/new"
          className="inline-flex items-center gap-2 px-5 h-12 rounded-xl bg-[--color-brand-600] text-white font-semibold hover:bg-[--color-brand-700] shadow-soft transition-colors"
        >
          + เชิญผู้ใช้
        </Link>
      </div>

      <Card className="animate-fade-up delay-100">
        <CardHeader>
          <CardTitle>รายชื่อทั้งหมด</CardTitle>
          <Badge tone="brand">{list.length}</Badge>
        </CardHeader>
        <CardBody className="!pt-0">
          {list.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm text-zinc-500">ยังไม่มีผู้ใช้</p>
            </div>
          )}
          <div className="divide-y divide-zinc-100">
            {list.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-3 py-3.5 px-1"
              >
                <div className="size-10 shrink-0 rounded-full bg-[--color-brand-100] text-[--color-brand-700] flex items-center justify-center font-semibold">
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{u.name}</span>
                    <Badge tone={ROLE_TONE[u.role] ?? "neutral"}>
                      {ROLE_LABEL[u.role] ?? u.role}
                    </Badge>
                    {!u.is_active && <Badge tone="neutral">ปิดอยู่</Badge>}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span className="truncate">{u.email ?? u.phone ?? "—"}</span>
                    {u.line_user_id && (
                      <span className="inline-flex items-center gap-0.5">
                        <CheckCircle2 className="size-3 text-green-600" />
                        LINE
                      </span>
                    )}
                    {u.telegram_user_id ? (
                      <span className="inline-flex items-center gap-0.5">
                        <CheckCircle2 className="size-3 text-green-600" />
                        Telegram
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-zinc-400">
                        <XCircle className="size-3" />
                        Telegram
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-zinc-500">
                    {u.last_login_at
                      ? `ล่าสุด ${bkkDate(u.last_login_at)}`
                      : "ยังไม่ Login"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
