// ApprovalBanner — global CashHub banner shown above every page.
// Counts: pending daily reports + pending register requests.
// Server component — reads counts from Supabase on each render.

import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { adminClient } from "@/lib/db/server";

interface Props {
  orgId: string;
}

async function loadCounts(orgId: string) {
  const admin = adminClient();
  const [reportsQ, requestsQ] = await Promise.all([
    admin
      .from("daily_reports")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "submitted"),
    admin
      .from("register_requests")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "pending"),
  ]);
  return {
    reports: reportsQ.count ?? 0,
    requests: requestsQ.count ?? 0,
  };
}

export async function ApprovalBanner({ orgId }: Props) {
  const { reports, requests } = await loadCounts(orgId);
  const total = reports + requests;
  if (total === 0) return null;
  return (
    <div className="mx-3 sm:mx-6 lg:mx-8 mt-3 rounded-xl bg-[var(--ch-navy)] text-white px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm shadow-md">
      <span className="size-5 rounded-full bg-white/15 grid place-items-center shrink-0">
        <CheckCircle2 className="size-3" />
      </span>
      <span>
        <b className="ch-tnum">{total.toLocaleString("en-US")}</b> รายการรออนุมัติ
      </span>
      <span className="opacity-50">·</span>
      <span className="opacity-90">
        💰 <b className="ch-tnum">{reports.toLocaleString("en-US")}</b> รายงาน
      </span>
      {requests > 0 && (
        <>
          <span className="opacity-50">·</span>
          <span className="opacity-90">
            👤 <b className="ch-tnum">{requests}</b> คำขอเข้าร่วม
          </span>
        </>
      )}
      <div className="flex-1" />
      {reports > 0 && (
        <Link
          href="/cashhub/reports?status=submitted"
          className="inline-flex items-center gap-1 bg-white text-[var(--ch-navy)] px-3 py-1 rounded-md text-xs font-semibold hover:bg-zinc-100 transition-colors"
        >
          อนุมัติรายงาน <ChevronRight className="size-3" />
        </Link>
      )}
      {requests > 0 && (
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 bg-white/15 text-white px-3 py-1 rounded-md text-xs font-semibold hover:bg-white/25 transition-colors"
        >
          คำขอเข้าใช้งาน <ChevronRight className="size-3" />
        </Link>
      )}
    </div>
  );
}
