/**
 * ตู้คีบ OS — รายงานตู้ 7-11 (Fleet 711)
 * ------------------------------------------------------------------
 * หน้าเฉพาะ "ตู้ที่ตั้งในร้าน 7-11" — 2 แท็บ:
 *   1) รายตู้ (fleet)   : ตารางตู้ทุกตัว + สถานะ + รายได้ 7 วัน + อัตราออก + cross-check เงิน/ตุ๊กตา
 *   2) รายงานสรุป (report): สรุป transaction รายวัน/รายเดือน + เจาะรายตู้ต่อวัน + matrix ทุกตู้ × วัน/เดือน
 *
 * ── ข้อมูลจริงทั้งหมด (ไม่มี money math ใหม่ · reuse authoritative queries):
 *   - getMachinePnl()  → รายได้/ตุ๊กตาออก/เฉลี่ยต่อตัว 7 วัน ต่อตู้ (COLLECTION-only · = P&L)
 *   - getMatrixData()  → เงิน/ตุ๊กตา รายวันต่อตู้ ย้อนหลัง 60 วัน (สำหรับ report + matrix)
 *   - listRepairTickets(OPEN/IN_PROGRESS) → ตู้ที่กำลังเสีย (status broken)
 * ทุกตัวเลขบนจอ = ที่ query คำนวณจาก cf_collection_events. หน้านี้ READ-ONLY (ไม่มี server action).
 *
 * G-010: DB ว่าง → client โชว์ EmptyState (ไม่มี hard-code demo numbers).
 */
import { getV2Branches } from "@/lib/clawfleet/queries";
import { getMachinePnl, bangkokRangeLastDays } from "@/lib/clawfleet/pnl-queries";
import { getMatrixData } from "@/lib/clawfleet/matrix-queries";
import { listRepairTickets } from "@/lib/clawfleet/repair-queries";
import { Client711, type Fleet711Machine } from "./client-711";

export const dynamic = "force-dynamic";

/** จำนวนวันย้อนหลังที่ดึงข้อมูลรายวัน (cap ของ getMatrixData = 60) — พอสำหรับ 30วัน + bucket เดือน ~2 เดือน */
const DAILY_WINDOW = 60;

/** วันหน้าที่ตู้เงียบเกินกี่วัน = "ต้องเติม/ต้องไปดูแล" (heuristic · ไม่ใช่ money) */
const IDLE_REFILL_DAYS = 5;

function daysAgoIso(iso: string): number {
  // iso = "YYYY-MM-DD" (เวลาไทย) → จำนวนวันจากวันนี้แบบหยาบ (พอสำหรับ label idle)
  const t = new Date(iso + "T00:00:00+07:00").getTime();
  return Math.floor((Date.now() - t) / 86_400_000);
}

export default async function Fleet711Page() {
  let machines: Fleet711Machine[] = [];
  let isoDays: string[] = [];
  let rangeLabel = "";

  try {
    const branches = await getV2Branches();

    // ตู้ที่กำลังเสีย (มีใบแจ้งซ่อมค้าง) → set ของ machineId
    const [openTix, wipTix] = await Promise.all([
      listRepairTickets({ status: "OPEN" }),
      listRepairTickets({ status: "IN_PROGRESS" }),
    ]);
    const brokenSet = new Set<string>([...openTix, ...wipTix].map((t) => t.machineId));

    const last7 = bangkokRangeLastDays(7);

    // ดึงต่อสาขา: P&L 7 วัน (รายได้/เฉลี่ย) + matrix รายวัน 60 วัน (report/heatmap)
    const perBranch = await Promise.all(
      branches.map(async (b) => {
        const [pnl, matrix] = await Promise.all([
          getMachinePnl(b.id, last7),
          getMatrixData({ branchCode: b.code, days: DAILY_WINDOW }),
        ]);
        return { branch: b, pnl, matrix };
      }),
    );

    // isoDays เหมือนกันทุกสาขา (อิงวันนี้) — เก็บจากสาขาแรกที่มี
    for (const pb of perBranch) {
      if (pb.matrix.isoDays.length > 0) { isoDays = pb.matrix.isoDays; break; }
    }
    if (isoDays.length > 0) {
      const to = isoDays[0], from = isoDays[Math.min(6, isoDays.length - 1)];
      rangeLabel = thShortRange(from, to);
    }

    for (const { branch, pnl, matrix } of perBranch) {
      // map machineId → daily cells (จาก matrix)
      const dayMap = new Map(matrix.machines.map((m) => [m.machineId, m]));
      for (const mp of pnl.machines) {
        const mx = dayMap.get(mp.machineId);
        const days: Record<string, { cash: number; dolls: number }> = {};
        let hasAnomaly7d = false;
        if (mx) {
          for (const [iso, c] of mx.byDay.entries()) {
            days[iso] = { cash: c.cash, dolls: c.dolls };
          }
          // cross-check เงิน/ตุ๊กตา: มีรอบ "รอตรวจ" (ANOMALY_REVIEW) ใน 7 วันล่าสุดไหม
          for (let i = 0; i < Math.min(7, isoDays.length); i++) {
            const c = mx.byDay.get(isoDays[i]);
            if (c?.anomaly) { hasAnomaly7d = true; break; }
          }
        }

        const broken = brokenSet.has(mp.machineId);
        // ต้องเติม/ต้องไปดูแล: ไม่เสีย + เงียบเกิน N วัน (idle) — heuristic ป้ายสถานะ (ไม่ใช่ money)
        const idleDays = mp.lastCollectedAt ? daysAgoIso(isoOf(mp.lastCollectedAt)) : 999;
        const status: Fleet711Machine["status"] = broken
          ? "broken"
          : idleDays >= IDLE_REFILL_DAYS
            ? "refill"
            : "ok";

        machines.push({
          machineId: mp.machineId,
          code: mp.code,
          // "ทำเล" = ชื่อสาขา + ชื่อเล่นตู้ (แทนคอนเซปต์ร้าน 7-11 ที่ยังไม่มีใน data model)
          loc: mp.nickname ? `${branch.name} · ${mp.nickname}` : branch.name,
          status,
          revenue: Math.round(mp.revenue),
          dolls: mp.dollsOut,
          avg: mp.avgBahtPerDoll != null ? Math.round(mp.avgBahtPerDoll) : null,
          lastLabel: mp.lastCollectedLabel,
          cashOk: broken ? null : !hasAnomaly7d,
          dollOk: broken ? null : !hasAnomaly7d,
          days,
        });
      }
    }

    // เรียง: เสียก่อน → ต้องเติม → ปกติ, แล้วรายได้มากก่อน
    const rank = { broken: 0, refill: 1, ok: 2 } as const;
    machines.sort((a, b) =>
      rank[a.status] - rank[b.status] || b.revenue - a.revenue,
    );
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → client โชว์ EmptyState
    machines = [];
    isoDays = [];
  }

  return <Client711 machines={machines} isoDays={isoDays} rangeLabel={rangeLabel} />;
}

/** Date → ISO "YYYY-MM-DD" เวลาไทย */
function isoOf(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** "18–24 มิ.ย. 69" จาก iso from/to */
function thShortRange(fromIso: string, toIso: string): string {
  const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const be = (y: number) => (y + 543) % 100;
  if (fm === tm) return `${fd}–${td} ${TH_MON[tm - 1]} ${be(ty)}`;
  return `${fd} ${TH_MON[fm - 1]} – ${td} ${TH_MON[tm - 1]} ${be(ty)}`;
}
