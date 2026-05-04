import Link from "next/link";
import { Building2, Plus, MapPin, Phone } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
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
  manager: { name: string } | { name: string }[] | null;
  phone: string | null;
}

export default async function BranchesPage() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();

  const { data } = await admin
    .from("branches")
    .select(
      "id, code, name, business_type, province, is_active, manager_id, phone, manager:manager_id(name)",
    )
    .eq("org_id", session.user.org_id)
    .order("code");

  const list = (data ?? []) as BranchRow[];
  const active = list.filter((b) => b.is_active);
  const inactive = list.filter((b) => !b.is_active);

  // Group counts by business type
  const typeCounts: Record<string, number> = {};
  for (const b of active) {
    typeCounts[b.business_type] = (typeCounts[b.business_type] ?? 0) + 1;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto">
      <header className="mb-8 flex items-end justify-between flex-wrap gap-3 animate-fade-up">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[--color-brand-600] font-bold">
            จัดการระบบ · {thaiDateLong(new Date())}
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display mt-2">
            สาขา <span className="accent">ทั้งหมด</span>
          </h1>
          <p className="text-zinc-600 mt-2">
            {active.length} สาขาใช้งาน · {inactive.length} ปิดใช้งาน · {list.length} ทั้งหมด
          </p>
        </div>
        <Link
          href="/branches/new"
          className="inline-flex items-center gap-2 px-5 h-12 rounded-xl bg-[--color-brand-600] text-white font-bold hover:bg-[--color-brand-700] shadow-blue transition-colors"
        >
          <Plus className="size-5" />
          เพิ่มสาขา
        </Link>
      </header>

      <Section
        number="01"
        label="OVERVIEW"
        title="แยกตามประเภทธุรกิจ"
        className="mb-8 animate-fade-up delay-100"
      >
        {Object.keys(typeCounts).length === 0 ? (
          <p className="text-sm text-zinc-500">— ยังไม่มีสาขา —</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(BUSINESS_TYPES).map(([key, cfg]) => {
              const count = typeCounts[key] ?? 0;
              if (count === 0) return null;
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 rounded-xl border-2 border-zinc-200 bg-white px-3 py-2"
                >
                  <span className="text-xl">{cfg.emoji}</span>
                  <div>
                    <div className="text-xs font-semibold text-zinc-700">
                      {cfg.label}
                    </div>
                    <div className="text-lg font-extrabold tabular-num leading-tight">
                      {count}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        number="02"
        label="LIST"
        title="รายชื่อสาขา"
        description="คลิกแถวเพื่อดูรายละเอียด · กดเพิ่มสาขาที่มุมขวาบน"
        className="animate-fade-up delay-200"
      >
        {list.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-6" />}
            title="ยังไม่มีสาขา"
            description="กดปุ่ม “เพิ่มสาขา” เพื่อเริ่มต้นบันทึกข้อมูลสาขา"
          />
        ) : (
          <DataTable
            rows={list}
            rowKey={(b) => b.id}
            rowHref={(b) => `/branches/${b.id}`}
            columns={[
              {
                key: "code",
                header: "รหัส",
                cell: (b) => {
                  const cfg = BUSINESS_TYPES[b.business_type];
                  return (
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{cfg?.emoji ?? "📋"}</span>
                      <div>
                        <div className="font-bold tabular-num">{b.code}</div>
                        <div className="text-[11px] text-zinc-500">
                          {cfg?.label ?? b.business_type}
                        </div>
                      </div>
                    </div>
                  );
                },
                className: "w-44",
              },
              {
                key: "name",
                header: "ชื่อสาขา",
                cell: (b) => <span className="font-medium">{b.name}</span>,
              },
              {
                key: "location",
                header: "ที่ตั้ง",
                cell: (b) => (
                  <span className="text-xs text-zinc-600 inline-flex items-center gap-1">
                    {b.province && <MapPin className="size-3" />}
                    {b.province ?? "—"}
                  </span>
                ),
              },
              {
                key: "manager",
                header: "ผู้จัดการ",
                cell: (b) => {
                  const m = Array.isArray(b.manager) ? b.manager[0] : b.manager;
                  return (
                    <span className="text-xs text-zinc-700">
                      {m?.name ?? "—"}
                    </span>
                  );
                },
              },
              {
                key: "phone",
                header: "เบอร์",
                cell: (b) =>
                  b.phone ? (
                    <span className="text-xs text-zinc-600 inline-flex items-center gap-1">
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
