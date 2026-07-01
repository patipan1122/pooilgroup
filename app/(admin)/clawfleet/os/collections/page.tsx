/**
 * ตู้คีบ OS — ตรวจเงิน & กระทบยอด (Collections / Audit)
 * Server: "รอบเก็บเงินทั้งหมด" ที่ปิดแล้วในช่วง 30 วันล่าสุด (ไม่ใช่แค่รอบผิดปกติ)
 *         → การ์ดสรุป + แท็บ (ทั้งหมด/ตรงกัน/ไม่ตรง/ตู้เสีย) คำนวณจากชุดเต็มจริง.
 * ถ้า DB ว่าง → client ใช้ SAMPLE fallback + แบนเนอร์ "กำลังแสดงตัวอย่าง"
 * (ตาม pattern ClawFleet เดิม — ห้ามหน้าโล่ง).
 */
import { getV2AllRounds, getV2Branches, orgHasAnyRounds } from "@/lib/clawfleet/queries";
import { CollectionsClient, type CollectionRow, type BranchOption } from "./collections-client";

export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  let rounds: Awaited<ReturnType<typeof getV2AllRounds>>["rounds"] = [];
  let branches: Awaited<ReturnType<typeof getV2Branches>> = [];
  // hasAnyRounds = org เคยมีรอบใด ๆ (ทุกสถานะ/ทุกเวลา) — ตัดสิน sample-vs-empty.
  // total (รอบปิดใน 30 วัน) ใช้แค่ pagination/summary เท่านั้น.
  let hasAnyRounds = false;
  try {
    const [res, br, everHad] = await Promise.all([
      getV2AllRounds(),
      getV2Branches(),
      orgHasAnyRounds(),
    ]);
    rounds = res.rounds;
    branches = br;
    hasAnyRounds = everHad;
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → client ใช้ sample fallback
  }

  const branchOptions: BranchOption[] = branches.map((b) => ({
    value: b.id,
    label: `${b.name} (${b.code})`,
  }));

  // Map V2Round → CollectionRow (ทุกรอบที่ปิดแล้ว · ไม่ใช่แค่ผิดปกติ)
  // expectedCash/actualCash/gap เป็น "บาท" แล้ว · gap เก็บทิศทาง (+ ขาด / − เกิน)
  const rows: CollectionRow[] = rounds.map((r) => ({
    id: r.id,
    code: r.id,
    branchId: r.branchId,
    branch: r.branchName || r.branchCode || "สาขา",
    staff: r.staff || "—",
    date: r.timeAgo ? `${r.timeAgo}ที่แล้ว` : r.when || "—",
    expectedCash: r.expectedCash,
    actualCash: r.actualCash,
    gap: r.gap,
    prizeExpected: r.prizeExpected,
    prizeActual: r.prizeActual,
    prizeGap: r.prizeGap,
    severity: r.severity,
    type: r.type,
    reason: r.reason || (r.type === "cash_short" ? "ยอดเงินไม่ตรงกับมิเตอร์" : "ตุ๊กตาหายไม่ตรงกับมิเตอร์"),
    // มิเตอร์เหรียญจริงจาก event (รวมทั้งรอบ) — client โชว์ delta×10 จริง (ไม่ประมาณ)
    coinMeterBefore: r.coinMeterBefore,
    coinMeterAfter: r.coinMeterAfter,
    // รูปจริงที่พนักงานถ่ายต่อตู้ (anti-cheat) — ผ่าน eventToMachine → photoShots
    machines: r.machines.map((m) => ({
      code: m.code,
      name: m.name,
      photoShots: m.photoShots ?? [],
    })),
    sample: false,
  }));

  return <CollectionsClient rows={rows} branchOptions={branchOptions} hasAnyRounds={hasAnyRounds} />;
}
