// CASHHUB · Hotel — บริหาร + ตรวจสอบยอดขายโรงแรม (read-only · นำเข้าจากชีต)
// CEO 2026-06-13: เอายอดขายโรงแรมจากชีต Google → ตรวจสอบ QR/OTA/เงินสด เตรียม reconcile
//   หัวใจ = การตรวจสอบ ("ทุกช่องมีความหมาย") · บริหาร/บัญชีดูอย่างเดียว · pilot=เม.ย.
//   หน่วยเงินสด = รอบส่งเงิน (กะดึก+กะเช้า) ไม่ใช่รายวัน
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { endOfMonth, startOfMonth } from "date-fns";
import {
  groupByDay,
  summarize,
  TH_MONTHS,
  type HotelShiftRow,
} from "@/lib/cashhub/hotel";
import Link from "next/link";
import { HotelMonthView } from "./hotel-month-view";

export const dynamic = "force-dynamic";

type SP = Promise<{ month?: string; branchId?: string }>;

export default async function HotelSalesPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role); // กัน staff/พนักงานหน้าร้าน
  const orgId = session.user.org_id;
  const admin = adminClient();
  const sp = await searchParams;

  // ── สาขาโรงแรม (business_type=hotel) — ไม่ผูกตายกับ Mix ───────────────
  const { data: hotelBranches } = await admin
    .from("branches")
    .select("id, name, code")
    .eq("org_id", orgId)
    .eq("business_type", "hotel")
    .eq("is_active", true)
    .order("name");
  const branches = (hotelBranches ?? []) as Array<{
    id: string;
    name: string;
    code: string;
  }>;
  // default = สาขาที่ "มีข้อมูลนำเข้าแล้ว" ก่อน (กันกรณีมีหลายสาขาโรงแรมแล้ว
  // default ไปสาขาเปล่าจนดูเหมือนไม่มีข้อมูล) → ไม่งั้นค่อย fallback ตามชื่อ
  let branchWithData: string | null = null;
  if (!sp.branchId && branches.length > 1) {
    const { data: withData } = await admin
      .from("cashhub_hotel_daily")
      .select("branch_id")
      .in(
        "branch_id",
        branches.map((b) => b.id),
      )
      .limit(1);
    branchWithData = (withData?.[0] as { branch_id: string } | undefined)?.branch_id ?? null;
  }
  const branchId = sp.branchId ?? branchWithData ?? branches[0]?.id ?? null;

  // ── เดือน (default = เม.ย. 2026 pilot) ───────────────────────────────
  const monthStr = sp.month ?? "2026-04";
  const [yy, mm] = monthStr.split("-").map((x) => Number.parseInt(x, 10));
  const monthDate = new Date(yy, (mm || 1) - 1, 1);
  const from = startOfMonth(monthDate).toISOString().slice(0, 10);
  const to = endOfMonth(monthDate).toISOString().slice(0, 10);

  let rows: HotelShiftRow[] = [];
  let monthCheck: {
    rooms_sheet: number | null;
    revenue_sheet: number | null;
    rooms_pos: number | null;
    revenue_pos: number | null;
  } | null = null;

  if (branchId) {
    const { data } = await admin
      .from("cashhub_hotel_daily")
      .select("*")
      .eq("branch_id", branchId)
      .gte("sales_date", from)
      .lte("sales_date", to)
      .order("sales_date");
    rows = (data ?? []) as HotelShiftRow[];

    const { data: mc } = await admin
      .from("cashhub_hotel_month")
      .select("rooms_sheet, revenue_sheet, rooms_pos, revenue_pos")
      .eq("branch_id", branchId)
      .eq("year", yy)
      .eq("month", mm)
      .maybeSingle();
    monthCheck = mc as typeof monthCheck;
  }

  const days = groupByDay(rows);
  const summary = summarize(days);
  const branchName = branches.find((b) => b.id === branchId)?.name ?? "โรงแรม";
  const monthLabel = `${TH_MONTHS[(mm || 1) - 1]} ${yy + 543}`;

  return (
    <div className="ch-scope p-3 sm:p-6 lg:p-8 max-w-6xl mx-auto pb-24">
      <BackButton label="ภาพรวม" fallbackHref="/cashhub/dashboard" />
      <header className="mt-3 mb-5">
        <SectionPill num="🏨" label="Hotel · ตรวจยอดขายโรงแรม" />
        <div className="flex flex-wrap items-end justify-between gap-3 mt-1">
          <TwoToneTitle first={branchName} accent={monthLabel} size={30} />
          <a
            href={`/cashhub/import/hotel`}
            className="h-10 inline-flex items-center gap-2 rounded-xl bg-[var(--color-brand-600,#1e3aff)] text-white font-semibold px-4 text-sm shadow-sm hover:opacity-90"
          >
            ⬆ นำเข้าจากชีต
          </a>
        </div>
        <p className="text-sm text-zinc-500 mt-1">
          อ่านอย่างเดียว · ชีต Google เป็นเจ้าของข้อมูล · แก้ในชีตแล้วนำเข้าใหม่
        </p>
      </header>

      {/* month / branch picker */}
      <form method="get" className="flex flex-wrap gap-2 mb-5">
        {branches.length > 1 && (
          <select
            name="branchId"
            aria-label="เลือกสาขาโรงแรม"
            title="เลือกสาขาโรงแรม"
            defaultValue={branchId ?? ""}
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <input
          type="month"
          name="month"
          aria-label="เลือกเดือน"
          title="เลือกเดือน (รูปแบบ ปี-เดือน)"
          placeholder="2026-04"
          defaultValue={monthStr}
          className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
        />
        <button
          type="submit"
          className="h-10 rounded-xl bg-zinc-900 text-white font-semibold px-5 text-sm"
        >
          ดู
        </button>
      </form>

      <HotelMonthView
        days={days}
        summary={summary}
        monthCheck={monthCheck}
        hasBranch={!!branchId}
      />

      {branchId && (
        <Link
          href={`/cashhub/hotel/iv?branchId=${branchId}&month=${monthStr}`}
          className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-[var(--ch-navy,#0b1850)]/20 bg-[var(--ch-navy,#0b1850)]/[0.03] p-4 hover:bg-[var(--ch-navy,#0b1850)]/[0.06] transition"
        >
          <div>
            <div className="font-bold text-zinc-800">🔗 ดึง IV จาก TRCloud</div>
            <div className="text-xs text-zinc-500">
              เช็คว่าหน้างานคีย์ IV ครบทุกวัน/กะไหม + ยอด IV (= ยอดขายในชีต)
            </div>
          </div>
          <span className="text-[var(--ch-navy,#0b1850)] font-semibold text-sm shrink-0">
            เปิดหน้า →
          </span>
        </Link>
      )}
    </div>
  );
}
