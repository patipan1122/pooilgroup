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
} from "lucide-react";

export const dynamic = "force-dynamic";

const ACTION_META: Record<
  string,
  { label: string; tone: "neutral" | "brand" | "warning" | "danger" | "success" | "info"; Icon: typeof LogIn }
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

export default async function AuditLogPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();

  const { data } = await admin
    .from("audit_logs")
    .select(
      "id, action, resource_type, resource_id, diff, ip_address, user_agent, created_at, user_id, users(name, role)",
    )
    .eq("org_id", session.user.org_id)
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []).map((r) => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    return { ...r, user: u as { name?: string; role?: string } | null };
  }) as AuditRow[];

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
          200 รายการล่าสุด · ทุก sensitive action ถูกบันทึก (RULES §12)
        </p>
      </div>

      <Card className="animate-fade-up delay-100">
        <CardHeader>
          <CardTitle>เหตุการณ์ล่าสุด</CardTitle>
          <Badge tone="brand">{rows.length}</Badge>
        </CardHeader>
        <CardBody className="!pt-0">
          {rows.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">
              ยังไม่มี audit log
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
                      <meta.Icon className={`size-4 ${TONE_FG[meta.tone]}`} />
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
