import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("id, name, slug, settings, created_at")
    .eq("id", session.user.org_id)
    .single();

  const { count: userCount } = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("org_id", session.user.org_id)
    .eq("is_active", true);

  const { count: branchCount } = await admin
    .from("branches")
    .select("id", { count: "exact", head: true })
    .eq("org_id", session.user.org_id)
    .eq("is_active", true);

  const settings = (org?.settings as Record<string, unknown>) ?? {};

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[--color-brand-600] font-semibold">
          องค์กร
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
          ตั้งค่า <span className="accent">ระบบ</span>
        </h1>
        <p className="text-zinc-600 mt-2 text-sm">
          การกำหนดค่าทั่วไปขององค์กร
        </p>
      </div>

      <Card className="mb-4 animate-fade-up delay-100">
        <CardHeader>
          <CardTitle>ข้อมูลองค์กร</CardTitle>
          <Badge tone="brand">{org?.slug ?? "—"}</Badge>
        </CardHeader>
        <CardBody className="grid grid-cols-2 gap-4 text-sm">
          <Stat label="ชื่อองค์กร" value={org?.name ?? "—"} />
          <Stat label="Timezone" value={String(settings.timezone ?? "Asia/Bangkok")} />
          <Stat label="สกุลเงิน" value={String(settings.currency ?? "THB")} />
          <Stat
            label="Reconcile Mode"
            value={
              settings.reconcileMode === "binary"
                ? "Binary (ตรง/ไม่ตรง)"
                : String(settings.reconcileMode ?? "—")
            }
          />
          <Stat label="ผู้ใช้ Active" value={String(userCount ?? 0)} />
          <Stat label="สาขา Active" value={String(branchCount ?? 0)} />
        </CardBody>
      </Card>

      <Card className="animate-fade-up delay-150">
        <CardHeader>
          <CardTitle>เส้นทางตั้งค่าเพิ่มเติม</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          <SettingLink
            href="/users"
            label="จัดการผู้ใช้"
            desc="เพิ่ม/แก้ไข/เชิญผู้ใช้ เข้าระบบ"
          />
          <SettingLink
            href="/branches"
            label="จัดการสาขา"
            desc="ข้อมูลสาขา · ผู้จัดการ · เวลา deadline"
          />
          <SettingLink
            href="/audit"
            label="Audit Log"
            desc="ประวัติการกระทำทุกอย่างในระบบ"
          />
          <SettingLink
            href="/profile"
            label="โปรไฟล์ของฉัน"
            desc="แก้ข้อมูลส่วนตัว · เปลี่ยนรหัสผ่าน"
          />
        </CardBody>
      </Card>

      <Card className="mt-4 animate-fade-up delay-200 border-amber-200 bg-amber-50">
        <CardBody className="text-sm">
          <div className="font-semibold text-amber-900 mb-1">
            ⚙️ Phase 2 — ที่ยังไม่มีใน UI
          </div>
          <ul className="text-xs text-amber-800 space-y-1 list-disc pl-5">
            <li>Cash Shortage Analytics — รายงานเงินขาดรายเดือน + รายคน</li>
            <li>Calendar Heatmap — สาขาไหนกรอกวันไหน</li>
            <li>Health Score A-F — เก็บสถิติ 30 วันก่อน</li>
            <li>Custom Form Templates — เพิ่ม field ต่อประเภทเอง</li>
            <li>Email notifications (Resend) — Phase 2</li>
            <li>Branch Groups — กลุ่มจัดสาขาเพื่อ Filter</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 mb-0.5">{label}</div>
      <div className="font-semibold text-zinc-900 truncate">{value}</div>
    </div>
  );
}

function SettingLink({
  href,
  label,
  desc,
}: {
  href: string;
  label: string;
  desc: string;
}) {
  return (
    <a
      href={href}
      className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl hover:bg-zinc-50 transition-colors"
    >
      <div className="min-w-0">
        <div className="font-medium text-sm">{label}</div>
        <div className="text-xs text-zinc-500 truncate">{desc}</div>
      </div>
      <ExternalLink className="size-4 text-zinc-400 shrink-0" />
    </a>
  );
}
