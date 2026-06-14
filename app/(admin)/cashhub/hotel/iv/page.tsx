// CASHHUB · Hotel → ดึง IV จาก TRCloud (หน้าเต็มของตัวเอง)
// แยกจากหน้า Excel: หน้านี้ = ดึง IV โรงแรมจาก TRCloud มาแสดง + เช็ค IV ครบทุกวัน/กะ
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole, isSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import Link from "next/link";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { TH_MONTHS, type HotelShiftRow } from "@/lib/cashhub/hotel";
import {
  loadHotelChannelConfig,
  computeHotelDeposits,
  readHotelReconcileStatus,
  buildReconcileView,
} from "@/lib/cashhub/hotel-settlement-data";
import { HotelIvExcelView } from "../hotel-iv-excel-view";
import { HotelTtbUpload } from "../hotel-ttb-upload";
import { HotelReconcilePanel } from "../hotel-reconcile-panel";

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
    .select("id, name, code")
    .eq("org_id", orgId)
    .eq("business_type", "hotel")
    .eq("is_active", true)
    .order("name");
  const branches = (data ?? []) as Array<{ id: string; name: string; code: string }>;
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
  let savedMonthCount = 0;
  if (branchId) {
    const from = `${yy}-${String(mm).padStart(2, "0")}-01`;
    // โหลดถึง "วันที่ 1 ของเดือนถัดไป" ด้วย — ใช้ยอด QR เช้ามืดวันนั้นคิดฐานกะของวันสุดท้าย
    const nextY = mm === 12 ? yy + 1 : yy;
    const nextM = mm === 12 ? 1 : mm + 1;
    const to = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
    const { data: sv } = await admin
      .from("cashhub_hotel_daily")
      .select("*")
      .eq("branch_id", branchId)
      .eq("source", "trcloud_iv")
      .gte("sales_date", from)
      .lte("sales_date", to)
      .order("sales_date");
    savedRows = (sv ?? []) as HotelShiftRow[];
    const ymPrefix = `${yy}-${String(mm).padStart(2, "0")}`;
    savedMonthCount = savedRows.filter((r) => r.sales_date.startsWith(ymPrefix)).length;
  }

  // ประวัติการอัปโหลดไฟล์ TTB (จาก audit_logs · kind=ttb · สาขานี้)
  let ttbHistory: Array<{
    at: string;
    fileName: string;
    firstDate: string | null;
    lastDate: string | null;
    daysInFile: number;
    updated: number;
    totalBanked: number;
  }> = [];
  if (branchId) {
    const { data: logs } = await admin
      .from("audit_logs")
      .select("created_at, diff")
      .eq("org_id", orgId)
      .eq("action", "IMPORT_HOTEL_SALES")
      .order("created_at", { ascending: false })
      .limit(40);
    ttbHistory = ((logs ?? []) as Array<{ created_at: string; diff: unknown }>)
      .map((l) => ({
        at: l.created_at,
        n: ((l.diff as { new?: Record<string, unknown> } | null)?.new ??
          {}) as Record<string, unknown>,
      }))
      .filter(({ n }) => n.kind === "ttb" && n.branchId === branchId)
      .slice(0, 8)
      .map(({ at, n }) => ({
        at,
        fileName: String(n.fileName ?? "TTB file"),
        firstDate: (n.firstDate as string) ?? null,
        lastDate: (n.lastDate as string) ?? null,
        daysInFile: Number(n.daysInFile ?? 0),
        updated: Number(n.updated ?? 0),
        totalBanked: Number(n.totalBanked ?? 0),
      }));
  }

  // ── reconcile (กระทบยอดธนาคาร) ──
  const canSend = isSuperAdmin(session.user.role);
  const branchCode = branches.find((b) => b.id === branchId)?.code ?? "";
  let reconcileView: ReturnType<typeof buildReconcileView> | null = null;
  let reconcileConfigured = false;
  if (branchId && branchCode) {
    const mFrom = `${yy}-${String(mm).padStart(2, "0")}-01`;
    const mTo = `${yy}-${String(mm).padStart(2, "0")}-${String(
      new Date(yy, mm, 0).getDate(),
    ).padStart(2, "0")}`;
    const configs = await loadHotelChannelConfig(admin, orgId);
    const settle = configs.filter((c) => c.isSettle && c.active);
    reconcileConfigured = settle.some((c) => c.companyId && c.bankAccountId);
    const deposits = await computeHotelDeposits(admin, orgId, branchId, mFrom, mTo);
    const statusMap = await readHotelReconcileStatus(orgId, branchCode, mFrom, mTo);
    reconcileView = buildReconcileView(
      deposits,
      statusMap,
      settle.map((c) => ({ channel: c.channel, label: c.label })),
    );
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
          <StepLabel n={1} title="ดึง / บันทึก IV ยอดขาย (จาก TRCloud)" />
          <HotelIvExcelView
            branchId={branchId}
            month={monthStr}
            initialRows={savedRows}
            savedCount={savedMonthCount}
          />
          <div className="mt-6">
            <StepLabel n={2} title="อัปไฟล์ธนาคาร TTB → QR เงินเข้าจริง" />
            <HotelTtbUpload
              branchId={branchId}
              month={monthStr}
              history={ttbHistory}
            />
          </div>
          {reconcileView && reconcileView.summary.length > 0 && (
            <div className="mt-6">
              <StepLabel n={3} title="ส่งกระทบยอดธนาคาร (reconcile) → สถานะเขียว" />
              <HotelReconcilePanel
                branchId={branchId}
                month={monthStr}
                configured={reconcileConfigured}
                canSend={canSend}
                summary={reconcileView.summary}
                days={reconcileView.days}
              />
            </div>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-zinc-200 p-8 text-center text-zinc-500">
          ยังไม่มีสาขาโรงแรมในระบบ
        </div>
      )}
    </div>
  );
}

// ป้ายลำดับขั้นตอน — ช่วยให้ผู้ใช้รู้ว่าทำอะไรก่อน-หลัง (1 ดึง IV → 2 อัป TTB → 3 reconcile)
function StepLabel({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--ch-navy,#0b1850)] text-white text-xs font-bold tabular-nums">
        {n}
      </span>
      <span className="text-sm font-semibold text-zinc-700">{title}</span>
    </div>
  );
}
