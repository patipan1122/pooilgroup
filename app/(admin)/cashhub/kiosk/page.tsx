// Kiosk weekly cash-collection — เก้าอี้นวด + ตู้คีบ
// Manager เข้ามาเก็บเงินสัปดาห์ละครั้ง — กรอก "รอบเก็บ" ไม่ใช่รายวัน

import Link from "next/link";
import { ArrowLeft, Sofa, Gamepad2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { formatBahtCompact, bkkDate } from "@/lib/utils/format";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

export const dynamic = "force-dynamic";
const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export default async function KioskPage() {
  const session = await requireSession();
  const admin = adminClient();
  const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
  const last30 = formatInTimeZone(subDays(new Date(), 29), TZ, "yyyy-MM-dd");

  const { data: branches } = await admin
    .from("branches")
    .select("id, code, name, business_type, parent_branch_id")
    .eq("org_id", session.user.org_id)
    .in("business_type", ["massage_chair", "claw_machine"])
    .eq("is_active", true)
    .order("code");

  const ids = (branches ?? []).map((b) => b.id);
  const reportsByBranch = new Map<
    string,
    Array<{
      id: string;
      report_date: string;
      total_sales: number | string;
      qty1: number | string | null;
      status: string;
    }>
  >();
  if (ids.length > 0) {
    const { data: reports } = await admin
      .from("daily_reports")
      .select("id, branch_id, report_date, total_sales, qty1, status")
      .eq("org_id", session.user.org_id)
      .in("branch_id", ids)
      .gte("report_date", last30)
      .order("report_date", { ascending: false });
    for (const r of reports ?? []) {
      const arr = reportsByBranch.get(r.branch_id as string) ?? [];
      arr.push({
        id: r.id as string,
        report_date: r.report_date as string,
        total_sales: r.total_sales as number | string,
        qty1: r.qty1 as number | string | null,
        status: r.status as string,
      });
      reportsByBranch.set(r.branch_id as string, arr);
    }
  }

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24">
      <Link
        href="/cashhub/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-[var(--color-brand-700)]"
      >
        <ArrowLeft className="size-4" />
        ภาพรวม
      </Link>
      <header className="mt-3 mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold flex items-center gap-2">
          <Sofa className="size-4" /> KIOSK
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display mt-1">
          ตู้ + <span className="accent">เก้าอี้นวด</span>
        </h1>
        <p className="text-zinc-600 mt-1 text-sm">
          เก็บเงินรายสัปดาห์ — ไม่ใช่รายวัน · กรอกตอน Manager ไปเก็บเงินจริง
        </p>
      </header>

      {(!branches || branches.length === 0) ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Sofa className="size-6" />}
              title="ยังไม่มี kiosk"
              description="เพิ่มสาขาประเภท เก้าอี้นวด หรือ ตู้คีบ ก่อน"
            />
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {branches.map((b) => {
            const cfg = BUSINESS_TYPES[b.business_type];
            const list = reportsByBranch.get(b.id) ?? [];
            const last = list[0];
            const lastDate = last?.report_date;
            const daysSinceLast = lastDate
              ? Math.floor(
                  (new Date(today).getTime() -
                    new Date(lastDate).getTime()) /
                    (1000 * 60 * 60 * 24),
                )
              : null;
            const totalLast30 = list
              .filter((r) => r.status === "approved")
              .reduce((s, r) => s + Number(r.total_sales || 0), 0);
            const isOverdue =
              daysSinceLast !== null && daysSinceLast > 9;

            return (
              <Card
                key={b.id}
                className={isOverdue ? "border-amber-300" : ""}
              >
                <CardHeader>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="size-10 rounded-xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-100)] flex items-center justify-center">
                      {b.business_type === "claw_machine" ? (
                        <Gamepad2 className="size-5 text-[var(--color-brand-700)]" />
                      ) : (
                        <Sofa className="size-5 text-[var(--color-brand-700)]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <CardTitle>
                        {b.code} <span className="text-zinc-400">·</span>{" "}
                        <span className="font-medium text-zinc-600 text-sm">
                          {cfg?.label}
                        </span>
                      </CardTitle>
                      <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                        {b.name}
                      </p>
                    </div>
                  </div>
                  {isOverdue ? (
                    <Badge tone="warning">⏰ ครบกำหนดเก็บแล้ว</Badge>
                  ) : daysSinceLast !== null ? (
                    <Badge tone="success">
                      เก็บล่าสุด {daysSinceLast} วันก่อน
                    </Badge>
                  ) : (
                    <Badge tone="neutral">ยังไม่มีรอบ</Badge>
                  )}
                </CardHeader>
                <CardBody className="!p-0">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-zinc-100">
                    <Stat
                      label="รวม 30 วัน"
                      value={formatBahtCompact(totalLast30)}
                    />
                    <Stat
                      label="รอบล่าสุด"
                      value={
                        last
                          ? formatBahtCompact(Number(last.total_sales || 0))
                          : "—"
                      }
                      sub={lastDate ? bkkDate(lastDate) : ""}
                    />
                    <Stat
                      label="Session/รอบ ล่าสุด"
                      value={
                        last?.qty1
                          ? Number(last.qty1).toLocaleString("th-TH")
                          : "—"
                      }
                    />
                  </div>
                  <div className="px-5 py-3 border-t border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                    <Link
                      href={`/cashhub/branches/${b.id}`}
                      className="text-xs text-zinc-500 hover:text-[var(--color-brand-700)]"
                    >
                      ดูประวัติทั้งหมด
                    </Link>
                    <Link
                      href={`/liff/report/${b.id}`}
                      className="inline-flex items-center justify-center h-9 rounded-xl bg-[var(--color-brand-600)] text-white px-4 text-sm font-bold shadow-blue hover:bg-[var(--color-brand-700)]"
                    >
                      💰 บันทึกรอบเก็บเงินใหม่
                    </Link>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <Section number="01" label="HISTORY" title="รอบล่าสุด" className="mt-8">
        <Card>
          <CardBody className="!p-0">
            <ul className="divide-y divide-zinc-100">
              {Array.from(reportsByBranch.values())
                .flat()
                .sort((a, b) =>
                  b.report_date.localeCompare(a.report_date),
                )
                .slice(0, 20)
                .map((r) => {
                  const branch = branches?.find((b) =>
                    (reportsByBranch.get(b.id) ?? []).some(
                      (x) => x.id === r.id,
                    ),
                  );
                  return (
                    <li
                      key={r.id}
                      className="px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/cashhub/reports/${r.id}`}
                          className="text-sm font-bold tabular-num hover:text-[var(--color-brand-700)]"
                        >
                          {branch?.code} · {bkkDate(r.report_date)}
                        </Link>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold tabular-num">
                          {formatBahtCompact(Number(r.total_sales || 0))}
                        </div>
                      </div>
                    </li>
                  );
                })}
            </ul>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="p-4">
      <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
        {label}
      </p>
      <div className="text-xl font-extrabold tabular-num font-display mt-0.5">
        {value}
      </div>
      {sub && <p className="text-[11px] text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );
}
