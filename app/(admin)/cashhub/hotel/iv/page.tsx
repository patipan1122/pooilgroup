// CASHHUB · Hotel → ดึง IV จาก TRCloud (หน้าเต็มของตัวเอง)
// แยกจากหน้า Excel: หน้านี้ = ดึง IV โรงแรมจาก TRCloud มาแสดง + เช็ค IV ครบทุกวัน/กะ
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import Link from "next/link";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { TH_MONTHS, type HotelShiftRow } from "@/lib/cashhub/hotel";
import { HotelIvExcelView } from "../hotel-iv-excel-view";
import { HotelTtbUpload } from "../hotel-ttb-upload";

export const dynamic = "force-dynamic";

type SP = Promise<{ month?: string; branchId?: string }>;

export default async function HotelIvPage({ searchParams }: { searchParams: SP }) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const admin = adminClient();
  const sp = await searchParams;

  const { data } = await admin
    .from("branches")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("business_type", "hotel")
    .eq("is_active", true)
    .order("name");
  const branches = (data ?? []) as Array<{ id: string; name: string }>;
  // default = สาขาที่มีข้อมูล Excel ก่อน
  let withData: string | null = null;
  if (!sp.branchId && branches.length > 1) {
    const { data: d } = await admin
      .from("cashhub_hotel_daily")
      .select("branch_id")
      .in("branch_id", branches.map((b) => b.id))
      .limit(1);
    withData = (d?.[0] as { branch_id: string } | undefined)?.branch_id ?? null;
  }
  const branchId = sp.branchId ?? withData ?? branches[0]?.id ?? null;
  const monthStr = sp.month ?? "2026-06";
  const [yy, mm] = monthStr.split("-").map((x) => Number.parseInt(x, 10));
  const monthLabel = `${TH_MONTHS[(mm || 1) - 1]} ${yy + 543}`;

  // อ่านข้อมูล IV ที่บันทึกไว้ (source=trcloud_iv) → แสดงทันทีตอนโหลด ไม่ต้องดึง TRCloud ซ้ำ
  let savedRows: HotelShiftRow[] = [];
  if (branchId) {
    const from = `${yy}-${String(mm).padStart(2, "0")}-01`;
    const to = `${yy}-${String(mm).padStart(2, "0")}-${String(
      new Date(yy, mm, 0).getDate(),
    ).padStart(2, "0")}`;
    const { data: sv } = await admin
      .from("cashhub_hotel_daily")
      .select("*")
      .eq("branch_id", branchId)
      .eq("source", "trcloud_iv")
      .gte("sales_date", from)
      .lte("sales_date", to)
      .order("sales_date");
    savedRows = (sv ?? []) as HotelShiftRow[];
  }

  return (
    <div className="ch-scope p-3 sm:p-6 lg:p-8 max-w-4xl mx-auto pb-24">
      <BackButton label="ตรวจยอดขายโรงแรม" fallbackHref="/cashhub/hotel" />
      <header className="mt-3 mb-5">
        <SectionPill num="🔗" label="Hotel · ดึง IV จาก TRCloud" />
        <div className="flex flex-wrap items-end justify-between gap-3 mt-1">
          <TwoToneTitle first="ดึง IV โรงแรม" accent={monthLabel} size={28} />
          <Link
            href={`/cashhub/hotel?branchId=${branchId ?? ""}&month=${monthStr}`}
            className="h-10 inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 bg-white text-sm font-semibold px-4 hover:bg-zinc-50"
          >
            📊 ไปหน้า Excel ยอดขาย
          </Link>
        </div>
        <p className="text-sm text-zinc-500 mt-1">
          หน้างานคีย์ IV เข้า TRCloud → ดึงมาเช็คว่าคีย์ครบทุกวัน/กะไหม (ยอด IV = ยอดขายในชีต)
        </p>
      </header>

      {/* picker */}
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
          title="เลือกเดือน"
          placeholder="2026-06"
          defaultValue={monthStr}
          className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
        />
        <button type="submit" className="h-10 rounded-xl bg-zinc-900 text-white font-semibold px-5 text-sm">
          เปลี่ยนเดือน
        </button>
      </form>

      {branchId ? (
        <>
          <HotelIvExcelView
            branchId={branchId}
            month={monthStr}
            initialRows={savedRows}
            savedCount={savedRows.length}
          />
          <div className="mt-5">
            <HotelTtbUpload branchId={branchId} month={monthStr} />
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-zinc-200 p-8 text-center text-zinc-500">
          ยังไม่มีสาขาโรงแรมในระบบ
        </div>
      )}
    </div>
  );
}
