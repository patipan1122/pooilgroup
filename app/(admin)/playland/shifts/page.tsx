import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { getPlaylandRole } from "@/lib/playland/position-resolve";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { ShiftClient } from "@/components/playland/shift-client";
import { BranchSwitcher } from "@/components/playland/branch-switcher";

export const dynamic = "force-dynamic";
export const metadata = { title: "กะ · ปิดวัน · Play a lot" };

const INK = "#3A3026", MUTED = "#8a7f70", LINE = "#ece5d8";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  requirePlaylandManager(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role)); // ประวัติกะ/ปิดวัน = ผู้จัดการขึ้นไป
  const orgId = session.user.org_id;
  const { branches, activeId } = await getBranchContext(orgId, sp.branch);
  const branchId = activeId;
  if (!branchId) {
    return (
      <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
        <div style={{ display: "flex", alignItems: "center", padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}` }}>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA }}>ตั้งค่าสาขาก่อน</div>
        </div>
      </div>
    );
  }

  const isManager = ["super_admin", "org_admin", "admin", "area_manager", "branch_manager"].includes(session.user.role);
  const [openShift, recent] = await Promise.all([
    prisma.playlandShift.findFirst({
      where: { orgId, branchId, status: "OPEN", ...(isManager ? {} : { cashierUserId: session.user.id }) },
      orderBy: { startedAt: "desc" },
    }),
    prisma.playlandShift.findMany({ where: { orgId, branchId }, orderBy: { startedAt: "desc" }, take: 30 }),
  ]);

  // เงินสดที่ "ควรอยู่ในลิ้นชัก" = เฉพาะยอดขายเงินสดของกะนี้ (ไม่รวมโอน/บัตร) — ตรงกับวิธี server คิด variance ตอนปิดกะ
  let cashSalesCents = 0;
  if (openShift) {
    const agg = await prisma.playlandSale.aggregate({
      where: { shiftId: openShift.id, paymentMethod: "CASH", voidedAt: null },
      _sum: { totalCents: true },
    });
    cashSalesCents = agg._sum.totalCents ?? 0;
  }

  const branchName = branches.find((b) => b.id === branchId)?.name ?? "";

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* white header strip — back-office only (ไม่มีสลับหน้าร้าน/หลังบ้าน) */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA }}>กะ · ปิดวัน{openShift ? ` · ${openShift.shiftCode}` : ""}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>เปิด/ปิดกะ · นับเงินลิ้นชัก · ตรวจประวัติกะย้อนหลัง</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <BranchSwitcher branches={branches} activeId={activeId} />
        </div>
      </div>

      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "22px 28px 40px" }}>
        <ShiftClient
          readOnly
          branchId={branchId}
          branchName={branchName}
          openShift={openShift ? {
            id: openShift.id, shiftCode: openShift.shiftCode,
            startedAt: openShift.startedAt.toISOString(),
            openingCashCents: openShift.openingCashCents, totalSalesCents: openShift.totalSalesCents,
            cashSalesCents,
          } : null}
          recent={recent.map((r) => ({
            id: r.id, shiftCode: r.shiftCode, cashierUserId: r.cashierUserId, status: r.status,
            startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null,
            openingCashCents: r.openingCashCents, closingCashCents: r.closingCashCents,
            totalSalesCents: r.totalSalesCents, varianceCents: r.varianceCents, isDayClose: r.isDayClose,
          }))}
        />
      </div>
    </div>
  );
}
