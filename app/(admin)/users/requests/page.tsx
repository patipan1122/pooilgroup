import { Inbox, Phone, MapPin, Calendar } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { bkkDateTime } from "@/lib/utils/format";
import { RequestActions } from "./request-actions";
import { BackButton } from "@/components/ui/back-button";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  staff: "Staff",
  branch_manager: "Manager",
  driver: "Driver",
  viewer: "Viewer",
};

interface RequestRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  branch_id: string | null;
  requested_role: string;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  reject_reason: string | null;
  ip_address: string | null;
  created_at: string;
  reviewed_at: string | null;
  branches: { code: string; name: string } | { code: string; name: string }[] | null;
  reviewer:
    | { name: string }
    | { name: string }[]
    | null;
}

export default async function RegisterRequestsPage() {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const admin = adminClient();

  const { data } = await admin
    .from("register_requests")
    .select(
      "id, name, phone, email, branch_id, requested_role, notes, status, reject_reason, ip_address, created_at, reviewed_at, branches:branch_id(code, name), reviewer:reviewed_by_id(name)",
    )
    .eq("org_id", session.user.org_id)
    .order("created_at", { ascending: false })
    .limit(100);

  const list = (data ?? []) as RequestRow[];
  const pending = list.filter((r) => r.status === "pending");
  const reviewed = list.filter((r) => r.status !== "pending");

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto">
      <header className="mb-6 flex items-end justify-between flex-wrap gap-3 animate-fade-up">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
            จัดการระบบ · คำขอใหม่
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display mt-2">
            คำขอ <span className="accent">เข้าใช้งาน</span>
          </h1>
          <p className="text-zinc-600 mt-2">
            มีคำขอ {pending.length} รอพิจารณา · ดูประวัติ {reviewed.length} รายการ
          </p>
        </div>
        <BackButton label="กลับไปรายชื่อผู้ใช้" fallbackHref="/users" />
      </header>

      <Section
        number="01"
        label="PENDING"
        title="รอพิจารณา"
        description="กดอนุมัติเพื่อสร้าง invite link · กดปฏิเสธพร้อมเหตุผลถ้าไม่อนุมัติ"
        className="mb-8 animate-fade-up delay-100"
      >
        {pending.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-6" />}
            title="ไม่มีคำขอรอพิจารณา"
            description="ผู้ใช้ใหม่จะเข้ามาผ่าน /join — Admin จะเห็นที่นี่"
          />
        ) : (
          <div className="space-y-3">
            {pending.map((r) => (
              <RequestCard key={r.id} req={r} />
            ))}
          </div>
        )}
      </Section>

      {reviewed.length > 0 && (
        <Section
          number="02"
          label="HISTORY"
          title="ประวัติการพิจารณา"
          className="animate-fade-up delay-200"
        >
          <div className="space-y-2">
            {reviewed.map((r) => (
              <ReviewedCard key={r.id} req={r} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function RequestCard({ req }: { req: RequestRow }) {
  const branch = Array.isArray(req.branches) ? req.branches[0] : req.branches;
  return (
    <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4 sm:p-5 hover:border-[var(--color-brand-300)] transition-colors">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="size-12 rounded-xl bg-[var(--color-brand-100)] text-[var(--color-brand-700)] flex items-center justify-center font-bold border-2 border-[var(--color-brand-200)] shrink-0">
            {req.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-bold text-base">{req.name}</div>
            <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1 flex-wrap">
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3" />
                {req.phone}
              </span>
              {req.email && <span>· {req.email}</span>}
              <span>
                · <Badge tone="info">{ROLE_LABEL[req.requested_role] ?? req.requested_role}</Badge>
              </span>
            </div>
            {branch && (
              <div className="flex items-center gap-1 text-xs text-zinc-600 mt-1.5">
                <MapPin className="size-3" />
                <span>
                  {branch.code} · {branch.name}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1 text-xs text-zinc-400 mt-1">
              <Calendar className="size-3" />
              <span>ส่งเมื่อ {bkkDateTime(req.created_at)}</span>
            </div>
            {req.notes && (
              <p className="text-sm text-zinc-700 mt-3 rounded-lg bg-zinc-50 p-3 border border-zinc-100">
                💬 {req.notes}
              </p>
            )}
          </div>
        </div>
        <RequestActions requestId={req.id} />
      </div>
    </div>
  );
}

function ReviewedCard({ req }: { req: RequestRow }) {
  const reviewer = Array.isArray(req.reviewer) ? req.reviewer[0] : req.reviewer;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="text-sm">
        <span className="font-medium">{req.name}</span>
        <span className="text-zinc-400 mx-2">·</span>
        <span className="text-xs text-zinc-500">{req.phone}</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        {req.status === "approved" ? (
          <Badge tone="success">อนุมัติ</Badge>
        ) : (
          <Badge tone="danger">ปฏิเสธ</Badge>
        )}
        {reviewer && (
          <span className="text-zinc-500">โดย {reviewer.name}</span>
        )}
        <span className="text-zinc-400">
          {req.reviewed_at && bkkDateTime(req.reviewed_at)}
        </span>
        {req.reject_reason && (
          <span className="text-red-600">· {req.reject_reason}</span>
        )}
      </div>
    </div>
  );
}
