// Branch Rentals — สัญญาเช่า สาขาในสาขา (CASHHUB §13b — sub-tenant)

import Link from "next/link";
import {Home, ExternalLink } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { isAdmin } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { formatBaht, bkkDate } from "@/lib/utils/format";
import { BackButton } from "@/components/ui/back-button";

export const dynamic = "force-dynamic";

interface RentalRow {
  id: string;
  host_branch_id: string;
  tenant_branch_id: string | null;
  tenant_name: string;
  rental_type: "fixed_monthly" | "percentage" | "mixed";
  fixed_amount: number | string | null;
  percentage_rate: number | string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  notes: string | null;
}

const RENTAL_TYPE_LABEL: Record<RentalRow["rental_type"], string> = {
  fixed_monthly: "💰 รายเดือนคงที่",
  percentage: "📊 % ของยอดขาย",
  mixed: "⚖️ ผสม (Fixed + %)",
};

export default async function RentalsPage() {
  const session = await requireSession();
  if (!isAdmin(session.user)) redirect("/403");

  const admin = adminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from as any)("branch_rentals")
    .select(
      "id, host_branch_id, tenant_branch_id, tenant_name, rental_type, fixed_amount, percentage_rate, start_date, end_date, is_active, notes",
    )
    .eq("org_id", session.user.org_id)
    .order("is_active", { ascending: false })
    .order("start_date", { ascending: false });

  const tableMissing =
    error && (error.code === "42P01" || error.code === "PGRST205");
  const rows = (data ?? []) as RentalRow[];

  // Branch lookup
  const branchIds = new Set<string>();
  for (const r of rows) {
    branchIds.add(r.host_branch_id);
    if (r.tenant_branch_id) branchIds.add(r.tenant_branch_id);
  }
  const branchMap = new Map<string, { code: string; name: string }>();
  if (branchIds.size > 0) {
    const { data: branches } = await admin
      .from("branches")
      .select("id, code, name")
      .in("id", Array.from(branchIds));
    for (const b of branches ?? []) {
      branchMap.set(b.id as string, { code: b.code as string, name: b.name as string });
    }
  }

  const active = rows.filter((r) => r.is_active);
  const expired = rows.filter((r) => !r.is_active);

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24">
      <BackButton label="ภาพรวม" fallbackHref="/cashhub/dashboard" />
      <header className="mt-3 mb-6 flex flex-col gap-2">
        <SectionPill num="00" label="Rentals · สัญญาเช่า" />
        <TwoToneTitle first="สัญญา" accent="ค่าเช่า" size={32} />
        <p className="text-[var(--ch-text-2)] mt-1 text-sm">
          {active.length} สัญญายังใช้งาน · {expired.length} สิ้นสุดแล้ว
        </p>
      </header>

      {tableMissing && (
        <Card className="mb-4 border-amber-200 bg-amber-50/40">
          <CardBody className="text-sm">
            <p className="font-bold mb-1">⚠️ ตารางสัญญาเช่ายังไม่ถูกสร้าง</p>
            <p className="text-zinc-700">
              รัน migration{" "}
              <code className="bg-white px-1.5 py-0.5 rounded text-xs">
                20260505000001_companies_and_business_types.sql
              </code>{" "}
              ก่อน
            </p>
          </CardBody>
        </Card>
      )}

      <Section number="01" label="ใช้งานอยู่" title="สัญญาที่ใช้งานอยู่">
        {active.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<Home className="size-6" />}
                title="ยังไม่มีสัญญาเช่า"
                description="ปั๊ม + 7-11 ในนั้น (host ↔ tenant) จะอยู่ตรงนี้"
              />
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {active.map((r) => (
              <RentalCard
                key={r.id}
                rental={r}
                branchMap={branchMap}
              />
            ))}
          </div>
        )}
      </Section>

      {expired.length > 0 && (
        <Section
          number="02"
          label="สิ้นสุดแล้ว"
          title="สัญญาที่สิ้นสุดแล้ว"
          className="mt-8"
        >
          <Card>
            <CardBody className="!p-0">
              <ul className="divide-y divide-zinc-100">
                {expired.map((r) => {
                  const host = branchMap.get(r.host_branch_id);
                  return (
                    <li
                      key={r.id}
                      className="px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">
                          {host?.code} ↔ {r.tenant_name}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5">
                          {bkkDate(r.start_date)} —{" "}
                          {r.end_date ? bkkDate(r.end_date) : "—"}
                        </div>
                      </div>
                      <Badge tone="neutral">หมดอายุ</Badge>
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
        </Section>
      )}
    </div>
  );
}

function RentalCard({
  rental: r,
  branchMap,
}: {
  rental: RentalRow;
  branchMap: Map<string, { code: string; name: string }>;
}) {
  const host = branchMap.get(r.host_branch_id);
  const tenant = r.tenant_branch_id
    ? branchMap.get(r.tenant_branch_id)
    : null;
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>
            {host?.code} <span className="text-zinc-400 mx-1">↔</span>{" "}
            <span className="text-[var(--color-brand-700)]">
              {tenant?.code ?? r.tenant_name}
            </span>
          </CardTitle>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {host?.name}
          </p>
        </div>
        <Badge tone="brand">{RENTAL_TYPE_LABEL[r.rental_type]}</Badge>
      </CardHeader>
      <CardBody className="space-y-2 text-sm">
        {r.fixed_amount && Number(r.fixed_amount) > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">รายเดือน</span>
            <span className="font-bold tabular-num">
              {formatBaht(Number(r.fixed_amount))}
            </span>
          </div>
        )}
        {r.percentage_rate && Number(r.percentage_rate) > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">% ของยอดขาย</span>
            <span className="font-bold tabular-num">
              {(Number(r.percentage_rate) * 100).toFixed(2)}%
            </span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">เริ่มสัญญา</span>
          <span className="tabular-num">{bkkDate(r.start_date)}</span>
        </div>
        {r.end_date && (
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">สิ้นสุด</span>
            <span className="tabular-num">{bkkDate(r.end_date)}</span>
          </div>
        )}
        {r.notes && (
          <p className="pt-2 border-t border-zinc-100 text-xs text-zinc-600 italic">
            {r.notes}
          </p>
        )}
        {tenant && (
          <Link
            href={`/cashhub/branches/${r.tenant_branch_id}`}
            className="inline-flex items-center gap-1 text-xs font-bold text-[var(--color-brand-700)] hover:underline pt-1"
          >
            <ExternalLink className="size-3" />
            ดูสาขา {tenant.code}
          </Link>
        )}
      </CardBody>
    </Card>
  );
}
