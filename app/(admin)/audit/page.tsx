import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { bkkDateTime } from "@/lib/utils/format";
import {
  LogIn,
  LogOut,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  UserPlus,
  ShieldOff,
  FileText,
  Pencil,
  Building2,
  Filter,
  Download,
} from "lucide-react";

export const dynamic = "force-dynamic";

const ACTION_META: Record<
  string,
  {
    label: string;
    tone: "neutral" | "brand" | "warning" | "danger" | "success" | "info";
    Icon: typeof LogIn;
  }
> = {
  LOGIN: { label: "เข้าสู่ระบบ", tone: "info", Icon: LogIn },
  LOGOUT: { label: "ออกจากระบบ", tone: "neutral", Icon: LogOut },
  FAILED_LOGIN: { label: "Login ล้มเหลว", tone: "danger", Icon: XCircle },
  CREATE_REPORT: { label: "สร้างรายงาน", tone: "brand", Icon: FileText },
  APPROVE_REPORT: { label: "อนุมัติรายงาน", tone: "success", Icon: CheckCircle2 },
  REJECT_REPORT: { label: "ปฏิเสธรายงาน", tone: "danger", Icon: XCircle },
  UNLOCK_REPORT: { label: "ปลด Lock", tone: "warning", Icon: AlertTriangle },
  CREATE_USER: { label: "สร้างผู้ใช้", tone: "brand", Icon: UserPlus },
  UPDATE_USER: { label: "แก้ไขผู้ใช้", tone: "neutral", Icon: Pencil },
  DEACTIVATE_USER: { label: "ปิดบัญชี", tone: "danger", Icon: ShieldOff },
  CREATE_BRANCH: { label: "สร้างสาขา", tone: "brand", Icon: Building2 },
  UPDATE_BRANCH: { label: "แก้ไขสาขา", tone: "neutral", Icon: Building2 },
  PERMISSION_DENIED: { label: "ไม่มีสิทธิ์", tone: "warning", Icon: AlertTriangle },
  EXPORT_DATA: { label: "Export ข้อมูล", tone: "neutral", Icon: FileText },
};

interface AuditRow {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  diff: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  user_id: string | null;
  user?: { name?: string; role?: string } | null;
}

interface SearchParams {
  action?: string;
  user?: string;
  range?: "today" | "7d" | "30d" | "all";
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireRole("super_admin", "org_admin");
  const params = await searchParams;
  const admin = adminClient();

  const range = params.range ?? "7d";
  const actionFilter = params.action ?? "all";
  const userFilter = params.user ?? "all";

  let q = admin
    .from("audit_logs")
    .select(
      "id, action, resource_type, resource_id, diff, ip_address, user_agent, created_at, user_id, users(name, role)",
    )
    .eq("org_id", session.user.org_id)
    .order("created_at", { ascending: false })
    .limit(500);

  if (range !== "all") {
    const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    q = q.gte("created_at", since);
  }
  if (actionFilter !== "all") q = q.eq("action", actionFilter);
  if (userFilter !== "all") q = q.eq("user_id", userFilter);

  const { data } = await q;

  const rows = (data ?? []).map((r) => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    return { ...r, user: u as { name?: string; role?: string } | null };
  }) as AuditRow[];

  // Active users for filter dropdown
  const { data: users } = await admin
    .from("users")
    .select("id, name")
    .eq("org_id", session.user.org_id)
    .order("name");

  // Counts per action (for current filter window) — for the chip display
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.action] = (counts[r.action] ?? 0) + 1;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[--color-brand-600] font-semibold">
          Audit · Compliance
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
          ประวัติ <span className="accent">การกระทำ</span>
        </h1>
        <p className="text-zinc-600 mt-2 text-sm">
          {rows.length} รายการในช่วงที่เลือก · ทุก sensitive action ถูกบันทึก
        </p>
      </div>

      {/* Filter bar */}
      <Card className="mb-4 animate-fade-up delay-100">
        <CardBody className="!py-3.5">
          <form
            method="GET"
            className="flex flex-wrap gap-2 items-end"
          >
            <div className="flex items-center gap-1.5">
              <Filter className="size-4 text-zinc-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                Filter
              </span>
            </div>

            <FilterSelect
              name="range"
              value={range}
              options={[
                { v: "today", l: "วันนี้" },
                { v: "7d", l: "7 วัน" },
                { v: "30d", l: "30 วัน" },
                { v: "all", l: "ทั้งหมด" },
              ]}
            />
            <FilterSelect
              name="action"
              value={actionFilter}
              options={[
                { v: "all", l: "ทุก action" },
                ...Object.entries(ACTION_META).map(([v, m]) => ({
                  v,
                  l: m.label,
                })),
              ]}
            />
            <FilterSelect
              name="user"
              value={userFilter}
              options={[
                { v: "all", l: "ทุกคน" },
                ...((users ?? []).map((u) => ({ v: u.id, l: u.name }))),
              ]}
            />

            <button
              type="submit"
              className="h-9 px-4 rounded-lg bg-[--color-brand-600] text-white font-semibold text-sm hover:bg-[--color-brand-700]"
            >
              ค้นหา
            </button>
            {(range !== "7d" ||
              actionFilter !== "all" ||
              userFilter !== "all") && (
              <Link
                href="/audit"
                className="h-9 px-3 inline-flex items-center rounded-lg text-zinc-600 text-sm hover:bg-zinc-100"
              >
                ล้าง
              </Link>
            )}
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-zinc-400">
              <Download className="size-3.5" />
              Export Excel — เร็ว ๆ นี้
            </span>
          </form>
        </CardBody>
      </Card>

      <Card className="animate-fade-up delay-150">
        <CardHeader>
          <CardTitle>เหตุการณ์</CardTitle>
          <Badge tone="brand">{rows.length}</Badge>
        </CardHeader>
        <CardBody className="!pt-0">
          {Object.keys(counts).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3 pb-3 border-b border-zinc-100">
              {Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([action, n]) => {
                  const meta = ACTION_META[action] ?? {
                    label: action,
                    tone: "neutral" as const,
                  };
                  return (
                    <span
                      key={action}
                      className="inline-flex items-center gap-1 text-xs"
                    >
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <span className="font-bold text-zinc-700 tabular-num">
                        {n}
                      </span>
                    </span>
                  );
                })}
            </div>
          )}

          {rows.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-12">
              ไม่มี audit log ที่ตรงกับ filter
            </p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {rows.map((r) => {
                const meta = ACTION_META[r.action] ?? {
                  label: r.action,
                  tone: "neutral" as const,
                  Icon: FileText,
                };
                return (
                  <div
                    key={r.id}
                    className="flex items-start gap-3 py-3 px-1"
                  >
                    <div
                      className={`size-9 shrink-0 rounded-full flex items-center justify-center ${TONE_BG[meta.tone]}`}
                    >
                      <meta.Icon
                        className={`size-4 ${TONE_FG[meta.tone]}`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        <span className="text-sm text-zinc-700">
                          {r.user?.name ?? "ระบบ"}
                        </span>
                        <span className="text-xs text-zinc-400">
                          · {r.resource_type}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {bkkDateTime(r.created_at)}
                        {r.ip_address && ` · IP ${r.ip_address}`}
                      </div>
                      {r.diff != null && (
                        <details className="mt-1 group">
                          <summary className="text-xs text-zinc-400 cursor-pointer select-none hover:text-zinc-700">
                            ดูข้อมูลเพิ่มเติม
                          </summary>
                          <pre className="mt-1 text-[11px] bg-zinc-50 rounded-lg p-2 overflow-x-auto font-mono">
                            {JSON.stringify(r.diff, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function FilterSelect({
  name,
  value,
  options,
}: {
  name: string;
  value: string;
  options: { v: string; l: string }[];
}) {
  return (
    <select
      name={name}
      defaultValue={value}
      className="h-9 px-3 rounded-lg border-2 border-zinc-200 bg-white text-sm focus:border-[--color-brand-500] focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </select>
  );
}

const TONE_BG: Record<string, string> = {
  neutral: "bg-zinc-100",
  brand: "bg-[--color-brand-100]",
  success: "bg-green-100",
  warning: "bg-amber-100",
  danger: "bg-red-100",
  info: "bg-blue-100",
};
const TONE_FG: Record<string, string> = {
  neutral: "text-zinc-600",
  brand: "text-[--color-brand-700]",
  success: "text-green-700",
  warning: "text-amber-700",
  danger: "text-red-700",
  info: "text-blue-700",
};
