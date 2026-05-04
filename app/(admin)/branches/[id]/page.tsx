import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  Building2,
  MapPin,
  Phone,
  Clock,
  User as UserIcon,
  Hash,
} from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { bkkDateTime } from "@/lib/utils/format";
import { BranchDetailActions } from "./detail-actions";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function BranchDetailPage({ params }: Props) {
  const session = await requireRole("super_admin", "org_admin");
  const { id } = await params;
  const admin = adminClient();

  const { data: branch } = await admin
    .from("branches")
    .select(
      "id, code, name, business_type, province, region, address, lat, lng, manager_id, phone, line_group_id, report_deadline, is_active, created_at, manager:manager_id(name)",
    )
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!branch) notFound();

  const cfg = BUSINESS_TYPES[branch.business_type];

  // Linked staff
  const { data: staff } = await admin
    .from("user_branches")
    .select("user:user_id(id, name, role, is_active)")
    .eq("branch_id", id)
    .eq("is_active", true);

  // Recent reports
  const { count: reportCount } = await admin
    .from("daily_reports")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", id);

  const manager = Array.isArray(branch.manager) ? branch.manager[0] : branch.manager;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <Link
        href="/branches"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-[--color-brand-700] mb-3"
      >
        <ChevronLeft className="size-4" />
        กลับไปรายชื่อสาขา
      </Link>

      <header className="flex items-start justify-between flex-wrap gap-4 mb-6 animate-fade-up">
        <div className="flex items-start gap-4">
          <div className="size-16 rounded-2xl bg-[--color-brand-50] border-2 border-[--color-brand-200] flex items-center justify-center text-3xl">
            {cfg?.emoji ?? "📋"}
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-zinc-500 font-semibold">
              {cfg?.label ?? branch.business_type} · {branch.code}
            </p>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display mt-1">
              {branch.name}
            </h1>
            <div className="flex items-center gap-2 mt-2">
              {branch.is_active ? (
                <Badge tone="success">ใช้งาน</Badge>
              ) : (
                <Badge tone="neutral">ปิดใช้งาน</Badge>
              )}
              {branch.province && (
                <span className="text-xs text-zinc-500 inline-flex items-center gap-1">
                  <MapPin className="size-3" />
                  {branch.province}
                </span>
              )}
            </div>
          </div>
        </div>
        <BranchDetailActions branchId={branch.id} isActive={branch.is_active} />
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="animate-fade-up delay-100">
          <CardHeader>
            <CardTitle>ข้อมูลทั่วไป</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2.5 text-sm">
            <Row icon={<Hash className="size-4" />} label="รหัส">
              {branch.code}
            </Row>
            <Row icon={<Building2 className="size-4" />} label="ประเภท">
              {cfg?.label ?? branch.business_type}
            </Row>
            <Row icon={<UserIcon className="size-4" />} label="ผู้จัดการ">
              {manager?.name ?? "ยังไม่กำหนด"}
            </Row>
            <Row icon={<Phone className="size-4" />} label="เบอร์">
              {branch.phone ?? "—"}
            </Row>
            <Row icon={<Clock className="size-4" />} label="Deadline">
              {branch.report_deadline}
            </Row>
          </CardBody>
        </Card>

        <Card className="animate-fade-up delay-150">
          <CardHeader>
            <CardTitle>ที่ตั้ง</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2.5 text-sm">
            <Row icon={<MapPin className="size-4" />} label="จังหวัด">
              {branch.province ?? "—"}
            </Row>
            <Row icon={<MapPin className="size-4" />} label="ภาค">
              {branch.region ?? "—"}
            </Row>
            {branch.address && (
              <p className="text-zinc-700 text-sm pt-1">{branch.address}</p>
            )}
            {branch.lat != null && branch.lng != null && (
              <a
                href={`https://www.google.com/maps?q=${branch.lat},${branch.lng}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[--color-brand-700] underline pt-1 inline-block"
              >
                เปิดใน Google Maps · {branch.lat}, {branch.lng}
              </a>
            )}
          </CardBody>
        </Card>

        <Card className="animate-fade-up delay-200">
          <CardHeader>
            <CardTitle>ทีมงานที่ผูกกับสาขา</CardTitle>
            <Badge tone="brand">{staff?.length ?? 0}</Badge>
          </CardHeader>
          <CardBody>
            {!staff || staff.length === 0 ? (
              <p className="text-sm text-zinc-500">
                ยังไม่มีพนักงานผูกกับสาขานี้ — ไปที่ /users เพื่อ assign
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {staff.map((s) => {
                  const u = Array.isArray(s.user) ? s.user[0] : s.user;
                  if (!u) return null;
                  return (
                    <li
                      key={u.id}
                      className="flex justify-between items-center py-1"
                    >
                      <Link
                        href={`/users/${u.id}`}
                        className="text-zinc-900 hover:text-[--color-brand-700] hover:underline font-medium"
                      >
                        {u.name}
                      </Link>
                      <Badge tone="neutral">{u.role}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card className="animate-fade-up delay-250">
          <CardHeader>
            <CardTitle>กิจกรรม</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">รายงานทั้งหมด</span>
              <span className="font-bold tabular-num">{reportCount ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">เพิ่มเมื่อ</span>
              <span className="font-medium">{bkkDateTime(branch.created_at)}</span>
            </div>
            {branch.line_group_id && (
              <div className="pt-2 border-t border-zinc-100">
                <p className="text-xs text-zinc-500 mb-1">LINE Group ID</p>
                <code className="text-xs font-mono">{branch.line_group_id}</code>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-zinc-400 shrink-0">{icon}</span>
      <span className="text-zinc-500 w-20 shrink-0">{label}</span>
      <span className="text-zinc-900 font-medium truncate">{children}</span>
    </div>
  );
}
