// /chairops/maids/[userId]/pay — Daily-pay month calendar (BF1).
//
// CEO+ADMIN only — MANAGER/OFFICE/MAID redirected by requireRole(CEO).
// Calendar grid shows each day of the chosen month with ฿ paid + total.
// Click a cell → modal to record (upsert) · admin can delete via row trash.
// Manual ledger, NO formula.

import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Wallet } from "lucide-react";

import { requireRole } from "@/lib/chairops/auth/session";
import { rankOf } from "@/lib/chairops/auth/role-guards";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  getMaidPayForMonth,
  getMaidDetail,
} from "@/lib/chairops/queries/maid-roster";
import { baht } from "@/lib/chairops/utils/format";

import { PayCalendarGrid } from "./_components/pay-calendar-grid";

export const dynamic = "force-dynamic";

function bkkYmFallback(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  });
  return fmt.format(new Date()).slice(0, 7); // "YYYY-MM"
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
}

function thaiMonthLabel(ym: string): string {
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const [y, m] = ym.split("-").map(Number);
  return `${months[m - 1]} ${y + 543}`;
}

export default async function MaidPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireRole(ChairopsUserRole.CEO);
  void rankOf;
  const { userId } = await params;
  const sp = await searchParams;
  const ym = (sp.month ?? bkkYmFallback()).match(/^\d{4}-\d{2}$/)
    ? (sp.month ?? bkkYmFallback())
    : bkkYmFallback();

  const detail = await getMaidDetail(session.user.orgId, userId);
  if (!detail) redirect("/chairops/maids");
  const { maid } = detail;
  void prisma;

  const rows = await getMaidPayForMonth(session.user.orgId, userId, ym);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-zinc-500">
            <Link href="/chairops/maids" className="hover:text-emerald-700">
              แม่บ้าน
            </Link>{" "}
            /{" "}
            <Link href={`/chairops/maids/${maid.id}`} className="hover:text-emerald-700">
              {maid.displayName}
            </Link>{" "}
            / ค่าจ้าง
          </div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-900">
            <Wallet className="size-5 text-emerald-700" />
            ค่าจ้าง {thaiMonthLabel(ym)}
          </h1>
          <p className="text-sm text-zinc-500">
            รวมเดือนนี้:{" "}
            <span
              className={
                "font-semibold tabular-nums " +
                (total < 0 ? "text-rose-700" : "text-zinc-900")
              }
            >
              {baht(total)}
            </span>{" "}
            · {rows.length} วัน
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/chairops/maids/${maid.id}/pay?month=${prevMonth(ym)}`}
            className="inline-flex size-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
            aria-label="เดือนก่อน"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <Link
            href={`/chairops/maids/${maid.id}/pay?month=${nextMonth(ym)}`}
            className="inline-flex size-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
            aria-label="เดือนถัดไป"
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </header>

      <PayCalendarGrid maidId={maid.id} ym={ym} rows={rows} />
    </div>
  );
}
