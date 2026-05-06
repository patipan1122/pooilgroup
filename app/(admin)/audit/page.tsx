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

/** Map an audit row to the resource page it logged about, or null if not linkable. */
function resourceHref(
  resourceType: string,
  resourceId: string | null,
): string | null {
  if (!resourceId) return null;
  switch (resourceType) {
    case "user":
      return `/users/${resourceId}`;
    case "branch":
      return `/branches/${resourceId}`;
    case "report":
    case "daily_report":
      return `/cashhub/reports/${resourceId}`;
    case "company":
      return `/companies/${resourceId}`;
    default:
      return null;
  }
}

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
  page?: string;
}

const PAGE_SIZE = 50;

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
  const page = Math.max(1, Number(params.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let q = admin
    .from("audit_logs")
    .select(
      "id, action, resource_type, resource_id, diff, ip_address, user_agent, created_at, user_id, users(name, role)",
      { count: "exact" },
    )
    .eq("org_id", session.user.org_id)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (range !== "all") {
    const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    q = q.gte("created_at", since);
  }
  if (actionFilter !== "all") q = q.eq("action", actionFilter);
  if (userFilter !== "all") q = q.eq("user_id", userFilter);

  // Run audit query + users dropdown in parallel
  const [{ data, count }, usersRes] = await Promise.all([
    q,
    admin
      .from("users")
      .select("id, name")
      .eq("org_id", session.user.org_id)
      .order("name"),
  ]);

  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const users = usersRes.data;

  const rows = (data ?? []).map((r) => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    return { ...r, user: u as { name?: string; role?: string } | null };
  }) as AuditRow[];

  // Counts per action (for current filter window) — for the chip display
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.action] = (counts[r.action] ?? 0) + 1;

  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -top-20 -left-20 size-96 rounded-full blur-3xl opacity-15 pointer-events-none animate-drift"
        style={{
          background:
            "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
        }}
      />

      <div className="relative p-4 sm:p-8 lg:p-12 max-w-6xl mx-auto pb-24">
      <div className="mb-12 animate-slide-up-soft">
        <p className="text-[11px] sm:text-xs uppercase tracking-[0.22em] text-[var(--color-brand-700)] font-bold">
          AUDIT · COMPLIANCE
        </p>
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-[-0.04em] font-display mt-5 leading-[0.95]">
          ประวัติ <span className="text-gradient-blue">การกระทำ</span>
        </h1>
        <p className="text-base sm:text-lg text-zinc-600 mt-5 max-w-2xl leading-relaxed">
          <strong className="font-bold text-zinc-900 tabular-num">
            {totalCount.toLocaleString()}
          </strong>{" "}
          รายการในช่วงที่เลือก · ทุก sensitive action ถูกบันทึกไว้
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
              className="h-9 px-4 rounded-lg bg-[var(--color-brand-600)] text-white font-semibold text-sm hover:bg-[var(--color-brand-700)]"
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
          <Badge tone="brand">
            {totalCount > PAGE_SIZE
              ? `${from + 1}–${Math.min(to + 1, totalCount)} / ${totalCount.toLocaleString()}`
              : totalCount}
          </Badge>
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
            <>
            <div className="divide-y divide-zinc-100">
              {rows.map((r) => {
                const meta = ACTION_META[r.action] ?? {
                  label: r.action,
                  tone: "neutral" as const,
                  Icon: FileText,
                };
                const href = resourceHref(r.resource_type, r.resource_id);
                return (
                  <div
                    key={r.id}
                    className={`flex items-start gap-3 py-3 px-1 ${href ? "hover:bg-zinc-50/60 rounded-lg transition-colors" : ""}`}
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
                        {href ? (
                          <Link
                            href={href}
                            className="text-xs text-[var(--color-brand-700)] hover:underline font-medium"
                          >
                            · {r.resource_type} →
                          </Link>
                        ) : (
                          <span className="text-xs text-zinc-400">
                            · {r.resource_type}
                          </span>
                        )}
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
            {totalPages > 1 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                range={range}
                action={actionFilter}
                user={userFilter}
              />
            )}
            </>
          )}
        </CardBody>
      </Card>
      </div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  range,
  action,
  user,
}: {
  page: number;
  totalPages: number;
  range: string;
  action: string;
  user: string;
}) {
  const buildHref = (p: number) => {
    const sp = new URLSearchParams();
    if (range !== "7d") sp.set("range", range);
    if (action !== "all") sp.set("action", action);
    if (user !== "all") sp.set("user", user);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `/audit?${qs}` : "/audit";
  };
  const prev = page > 1 ? buildHref(page - 1) : null;
  const next = page < totalPages ? buildHref(page + 1) : null;
  return (
    <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-100">
      <span className="text-xs text-zinc-500">
        หน้า <span className="font-bold text-zinc-700 tabular-num">{page}</span>
        <span className="text-zinc-400"> / {totalPages}</span>
      </span>
      <div className="flex gap-1.5">
        {prev ? (
          <Link
            href={prev}
            className="h-9 px-3 inline-flex items-center rounded-lg border-2 border-zinc-200 bg-white text-sm font-semibold text-zinc-700 hover:border-[var(--color-brand-300)]"
          >
            ← ก่อนหน้า
          </Link>
        ) : (
          <span className="h-9 px-3 inline-flex items-center rounded-lg border-2 border-zinc-100 bg-zinc-50 text-sm font-semibold text-zinc-300 cursor-not-allowed">
            ← ก่อนหน้า
          </span>
        )}
        {next ? (
          <Link
            href={next}
            className="h-9 px-3 inline-flex items-center rounded-lg border-2 border-zinc-200 bg-white text-sm font-semibold text-zinc-700 hover:border-[var(--color-brand-300)]"
          >
            ถัดไป →
          </Link>
        ) : (
          <span className="h-9 px-3 inline-flex items-center rounded-lg border-2 border-zinc-100 bg-zinc-50 text-sm font-semibold text-zinc-300 cursor-not-allowed">
            ถัดไป →
          </span>
        )}
      </div>
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
      className="h-9 px-3 rounded-lg border-2 border-zinc-200 bg-white text-sm focus:border-[var(--color-brand-500)] focus:outline-none"
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
  brand: "bg-[var(--color-brand-100)]",
  success: "bg-green-100",
  warning: "bg-amber-100",
  danger: "bg-red-100",
  info: "bg-blue-100",
};
const TONE_FG: Record<string, string> = {
  neutral: "text-zinc-600",
  brand: "text-[var(--color-brand-700)]",
  success: "text-green-700",
  warning: "text-amber-700",
  danger: "text-red-700",
  info: "text-blue-700",
};
