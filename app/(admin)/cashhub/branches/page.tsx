import Link from "next/link";
import { Building2, MapPin, Phone } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { thaiDateLong } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

interface BranchRow {
  id: string;
  code: string;
  name: string;
  business_type: string;
  province: string | null;
  is_active: boolean;
  manager_id: string | null;
  phone: string | null;
}

export default async function CashHubBranchesPage() {
  const session = await requireSession();
  const admin = adminClient();

  const { data } = await admin
    .from("branches")
    .select(
      "id, code, name, business_type, province, is_active, manager_id, phone",
    )
    .eq("org_id", session.user.org_id)
    .order("code");

  const branches = (data ?? []) as BranchRow[];
  const activeCount = branches.filter((b) => b.is_active).length;

  // Group counts by business type
  const typeCounts: Record<string, number> = {};
  for (const b of branches) {
    if (b.is_active)
      typeCounts[b.business_type] = (typeCounts[b.business_type] ?? 0) + 1;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-7xl mx-auto">
      <header className="mb-8 animate-fade-up">
        <p className="text-xs uppercase tracking-[0.18em] text-[--color-brand-600] font-bold">
          💰 CashHub · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display mt-2">
          จัดการ <span className="accent">สาขา</span>
        </h1>
        <p className="text-zinc-600 mt-2">
          {activeCount} สาขาใช้งาน · {branches.length} ทั้งหมด
        </p>
      </header>

      {/* Section 01 — Type breakdown chips */}
      <Section
        number="01"
        label="OVERVIEW"
        title="แยกตามประเภทธุรกิจ"
        className="mb-8 animate-fade-up delay-100"
      >
        <div className="flex flex-wrap gap-2">
          {Object.entries(BUSINESS_TYPES).map(([key, cfg]) => {
            const count = typeCounts[key] ?? 0;
            if (count === 0) return null;
            return (
              <div
                key={key}
                className="flex items-center gap-2 rounded-xl border-2 border-zinc-200 bg-white px-3 py-2 hover:border-[--color-brand-300] transition-colors"
              >
                <span className="text-xl">{cfg.emoji}</span>
                <div>
                  <div className="text-xs font-semibold text-zinc-700">
                    {cfg.label}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">
                    {count} สาขา
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Section 02 — Branch list (table style) */}
      <Section
        number="02"
        label="LIST"
        title="รายการสาขาทั้งหมด"
        description="คลิกสาขาเพื่อดูรายงานเฉพาะสาขานั้น"
        className="animate-fade-up delay-200"
      >
        {branches.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-6" />}
            title="ยังไม่มีสาขา"
            description="เพิ่มสาขาผ่าน seed หรือ CSV import เพื่อเริ่มใช้งาน"
          />
        ) : (
          <DataTable
            rows={branches}
            rowKey={(b) => b.id}
            rowHref={(b) => `/cashhub/reports?branchId=${b.id}`}
            columns={[
              {
                key: "type",
                header: "ประเภท",
                cell: (b) => {
                  const cfg = BUSINESS_TYPES[b.business_type];
                  return (
                    <span className="text-2xl">{cfg?.emoji || "📋"}</span>
                  );
                },
                className: "w-12",
              },
              {
                key: "code",
                header: "รหัส",
                cell: (b) => (
                  <div className="font-bold tabular-num text-zinc-900">
                    {b.code}
                  </div>
                ),
              },
              {
                key: "name",
                header: "ชื่อสาขา",
                cell: (b) => (
                  <div>
                    <div className="font-medium truncate">{b.name}</div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {BUSINESS_TYPES[b.business_type]?.label ?? b.business_type}
                    </div>
                  </div>
                ),
              },
              {
                key: "location",
                header: "ที่ตั้ง",
                cell: (b) =>
                  b.province ? (
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-600">
                      <MapPin className="size-3" />
                      {b.province}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400">—</span>
                  ),
              },
              {
                key: "phone",
                header: "ติดต่อ",
                cell: (b) =>
                  b.phone ? (
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-600">
                      <Phone className="size-3" />
                      {b.phone}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400">—</span>
                  ),
              },
              {
                key: "status",
                header: "สถานะ",
                align: "right",
                cell: (b) =>
                  b.is_active ? (
                    <Badge tone="success">ใช้งาน</Badge>
                  ) : (
                    <Badge tone="neutral">ปิด</Badge>
                  ),
              },
            ]}
          />
        )}
      </Section>
    </div>
  );
}
